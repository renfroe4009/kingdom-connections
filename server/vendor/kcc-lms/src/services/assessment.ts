/**
 * Quizzes: sitting them, scoring them, and counting attempts.
 *
 * The rule that earns the care here is that **the correct answers never leave
 * the server before an attempt is submitted.** A quiz handed to the browser
 * with `isCorrect` on each option is a quiz anybody can pass by reading the
 * page source, and that is the normal way this gets built, because the
 * natural query selects the whole options table.
 *
 * So there are two shapes: `QuizPaper`, which is what a learner is given and
 * carries no answers, and `QuizResult`, which exists only after a submission.
 * The store enforces the first by naming its columns — see `paperFor()`.
 */
import { hasAtLeast } from '../ports.js';
import { LmsConflict, LmsForbidden, LmsInvalid, LmsNotFound } from '../errors.js';
import { emit, type LmsContext } from '../context.js';
import { requireEntitlement } from './enrolment.js';
import type { AttemptRow, PaperQuestion, ScoringOption, ScoringQuestion } from '../store.js';

export type QuizPaper = {
  id: string;
  lessonId: string;
  title: string;
  instructions: string | null;
  passingScore: number;
  maxAttempts: number;
  attemptsTaken: number;
  attemptsLeft: number | null;
  bestScore: number | null;
  hasPassed: boolean;
  /** No `isCorrect`, by construction rather than by filtering. */
  questions: PaperQuestion[];
};

async function quizWithCourse(context: LmsContext, quizId: string) {
  const found = await context.store.findQuizById(quizId);
  if (!found) throw new LmsNotFound('No such quiz.');
  await requireEntitlement(context, found.courseId);
  if (!found.lessonPublished && context.viewer.role === 'learner') throw new LmsNotFound('No such quiz.');
  return found;
}

/** The paper, as a learner gets it. */
export async function getQuizPaper(context: LmsContext, lessonId: string): Promise<QuizPaper | null> {
  const quiz = await context.store.findQuizByLesson(lessonId);
  if (!quiz) return null;

  await quizWithCourse(context, quiz.id);

  const questions = await context.store.paperFor(quiz.id);
  const attempts = await context.store.attemptsFor(quiz.id, context.viewer.id);

  const attemptsTaken = attempts.length;
  const bestScore = attempts.length === 0 ? null : Math.max(...attempts.map((a) => a.score));

  return {
    id: quiz.id,
    lessonId: quiz.lessonId,
    title: quiz.title,
    instructions: quiz.instructions,
    passingScore: quiz.passingScore,
    maxAttempts: quiz.maxAttempts,
    attemptsTaken,
    // Zero means unlimited, and `null` says so rather than reporting a
    // negative number of attempts left.
    attemptsLeft: quiz.maxAttempts === 0 ? null : Math.max(0, quiz.maxAttempts - attemptsTaken),
    bestScore,
    hasPassed: attempts.some((a) => a.passed),
    questions,
  };
}

export type QuizResult = {
  attemptId: string;
  score: number;
  passed: boolean;
  passingScore: number;
  attemptsLeft: number | null;
  /** Per question, after the fact: what they chose, what was right, and why. */
  review: {
    questionId: string;
    prompt: string;
    chosenOptionId: string | null;
    correctOptionId: string | null;
    wasCorrect: boolean;
    explanation: string | null;
  }[];
};

/**
 * Marks an attempt, as a pure function over the stored questions and options.
 *
 * Separated from the writes so the arithmetic can be read and checked on its
 * own. Nothing the client sends about correctness reaches it — only which
 * option was chosen per question.
 */
export function markAttempt(input: {
  questions: ScoringQuestion[];
  options: ScoringOption[];
  answers: Record<string, string>;
  passingScore: number;
}): { score: number; passed: boolean; clean: Record<string, string>; review: QuizResult['review'] } {
  const correctByQuestion = new Map<string, string>();
  const optionsByQuestion = new Map<string, Set<string>>();
  for (const option of input.options) {
    if (!optionsByQuestion.has(option.questionId)) optionsByQuestion.set(option.questionId, new Set());
    optionsByQuestion.get(option.questionId)!.add(option.id);
    if (option.isCorrect) correctByQuestion.set(option.questionId, option.id);
  }

  /*
   * Answers are filtered to this quiz's own options before anything is
   * stored. Without it, a submission can carry an option id from a different
   * quiz — or an arbitrary string — and the stored attempt becomes a record
   * of something that never happened.
   */
  const clean: Record<string, string> = {};
  for (const question of input.questions) {
    const chosen = input.answers[question.id];
    if (chosen && optionsByQuestion.get(question.id)?.has(chosen)) clean[question.id] = chosen;
  }

  const review = input.questions.map((question) => {
    const chosen = clean[question.id] ?? null;
    const correct = correctByQuestion.get(question.id) ?? null;
    return {
      questionId: question.id,
      prompt: question.prompt,
      chosenOptionId: chosen,
      correctOptionId: correct,
      wasCorrect: chosen !== null && chosen === correct,
      explanation: question.explanation,
    };
  });

  /*
   * Divided by every question, not by the ones answered. An unanswered
   * question counts as wrong rather than being skipped, because otherwise
   * leaving out the questions you do not know raises your percentage —
   * answer one of twenty correctly and score 100%.
   */
  const right = review.filter((row) => row.wasCorrect).length;
  const score = Math.round((right / input.questions.length) * 100);

  return { score, passed: score >= input.passingScore, clean, review };
}

/** Scores an attempt and records it. */
export async function submitAttempt(
  context: LmsContext,
  input: { quizId: string; answers: Record<string, string> },
): Promise<QuizResult> {
  const quiz = await quizWithCourse(context, input.quizId);

  const attemptsTaken = await context.store.countAttempts(quiz.id, context.viewer.id);
  if (quiz.maxAttempts > 0 && attemptsTaken >= quiz.maxAttempts) {
    throw new LmsConflict('You have used all your attempts at this quiz.');
  }

  const questions = await context.store.scoringQuestions(quiz.id);
  if (questions.length === 0) throw new LmsInvalid('That quiz has no questions yet.');
  const options = await context.store.scoringOptions(quiz.id);

  const marked = markAttempt({
    questions,
    options,
    answers: input.answers,
    passingScore: quiz.passingScore,
  });

  const attemptId = context.store.newId();
  await context.store.insertAttempt({
    id: attemptId,
    quizId: quiz.id,
    userId: context.viewer.id,
    score: marked.score,
    passed: marked.passed,
    answers: marked.clean,
    submittedAt: context.clock.now(),
  });

  const attemptsLeft = quiz.maxAttempts === 0 ? null : Math.max(0, quiz.maxAttempts - (attemptsTaken + 1));

  emit(
    context,
    marked.passed
      ? { kind: 'quiz.passed', userId: context.viewer.id, quizId: quiz.id, score: marked.score }
      : {
          kind: 'quiz.failed',
          userId: context.viewer.id,
          quizId: quiz.id,
          score: marked.score,
          attemptsLeft: attemptsLeft ?? 0,
        },
  );

  return {
    attemptId,
    score: marked.score,
    passed: marked.passed,
    passingScore: quiz.passingScore,
    attemptsLeft,
    review: marked.review,
  };
}

/** Somebody's attempts at one quiz. Their own, or anybody's if staff. */
export async function attemptsFor(
  context: LmsContext,
  quizId: string,
  userId: string,
): Promise<AttemptRow[]> {
  if (userId !== context.viewer.id && !hasAtLeast(context.viewer, 'instructor')) {
    throw new LmsForbidden('You can only see your own attempts.');
  }
  await quizWithCourse(context, quizId);
  return context.store.attemptsFor(quizId, userId);
}
