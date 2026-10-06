/**
 * Assessment, and the leak this probe exists to catch.
 *
 * **The correct answers must not leave the server before an attempt is
 * submitted.** A paper handed to the browser with `isCorrect` on each option
 * is a paper anybody passes by reading the page source, and it is the normal
 * way this gets built — not because somebody decides to send the answers, but
 * because the obvious query selects the whole options row and nobody decides
 * not to.
 *
 * So the paper is searched, recursively, for anything that would give the
 * game away.
 */
import { asJson, check, contextFor, db, finish, makeUser, close, refuses, reset, rows, setUp, sql } from './harness.js';
import { addMember, createCohort, releaseCourse } from '../src/services/enrolment.js';
import { createCourse, createLesson, createModule, setCourseStatus, upsertQuiz } from '../src/services/authoring.js';
import { attemptsFor, getQuizPaper, submitAttempt } from '../src/services/assessment.js';
import { getQuizForEditing } from '../src/services/authoring.js';

const TAG = 'probe-quiz';

/** Every string and boolean anywhere inside an object, flattened. */
function flatten(value: unknown, path = '$'): { path: string; value: unknown }[] {
  if (value === null || typeof value !== 'object') return [{ path, value }];
  if (Array.isArray(value)) return value.flatMap((item, i) => flatten(item, `${path}[${i}]`));
  return Object.entries(value).flatMap(([key, item]) => flatten(item, `${path}.${key}`));
}

async function main(): Promise<void> {
  await setUp();
  await reset(TAG);

  const admin = await makeUser(TAG, 'admin');
  const learner = await makeUser(TAG, 'learner');
  const other = await makeUser(TAG, 'other');

  const asAdmin = contextFor(admin, 'admin');
  const asLearner = contextFor(learner, 'learner');
  const asOther = contextFor(other, 'learner');

  const course = await createCourse(asAdmin, { title: `${TAG} Course` });
  await db.execute(sql`update lms_courses set slug = ${`${TAG}-course`} where id = ${course.id}`);
  const unit = await createModule(asAdmin, { courseId: course.id, title: 'Unit' });
  const lesson = await createLesson(asAdmin, { moduleId: unit.id, title: 'Lesson' });
  await db.execute(sql`update lms_lessons set is_published = true where id = ${lesson.id}`);
  await setCourseStatus(asAdmin, course.id, 'published');

  const cohort = await createCohort(asAdmin, { name: `${TAG} Cohort` });
  await db.execute(sql`update lms_cohorts set slug = ${`${TAG}-cohort`} where id = ${cohort.id}`);
  await addMember(asAdmin, cohort.id, learner);
  await addMember(asAdmin, cohort.id, other);
  await releaseCourse(asAdmin, { cohortId: cohort.id, courseId: course.id });

  const quiz = await upsertQuiz(asAdmin, {
    lessonId: lesson.id,
    title: 'Four questions',
    passingScore: 75,
    maxAttempts: 2,
    questions: [
      {
        prompt: 'First?',
        explanation: 'Because of the first reason.',
        options: [{ label: 'Right one', isCorrect: true }, { label: 'Wrong one', isCorrect: false }],
      },
      { prompt: 'Second?', options: [{ label: 'No', isCorrect: false }, { label: 'Yes', isCorrect: true }] },
      { prompt: 'Third?', options: [{ label: 'A', isCorrect: true }, { label: 'B', isCorrect: false }] },
      { prompt: 'Fourth?', options: [{ label: 'X', isCorrect: false }, { label: 'Y', isCorrect: true }] },
    ],
  });

  /* ---- the leak ---------------------------------------------------------- */
  const paper = (await getQuizPaper(asLearner, lesson.id))!;
  check('a learner gets the paper', paper !== null && paper.questions.length === 4);

  const leaves = flatten(paper);
  check(
    'nothing in the paper is named like an answer key',
    !leaves.some((leaf) => /correct|isRight|answer|explanation/i.test(leaf.path)),
    leaves.filter((l) => /correct|answer|explanation/i.test(l.path)).map((l) => l.path).join(', '),
  );
  check(
    'and no boolean is hiding in it either',
    !leaves.some((leaf) => typeof leaf.value === 'boolean' && leaf.path.includes('options')),
    leaves.filter((l) => typeof l.value === 'boolean').map((l) => l.path).join(', '),
  );
  // The explanations are the other half of the key: they say why an answer is
  // right, so they belong with the result and not with the paper.
  check(
    'the explanations are not in the paper',
    !JSON.stringify(paper).includes('Because of the first reason'),
  );

  /* ---- what the author sees is different -------------------------------- */
  const editable = (await getQuizForEditing(asAdmin, lesson.id))!;
  check('an author does see which option is correct', editable.questions[0]!.options.some((o) => o.isCorrect));
  await refuses('and a learner cannot read that at all', () => getQuizForEditing(asLearner, lesson.id));

  /* ---- scoring ----------------------------------------------------------- */
  const correctFor = (prompt: string) =>
    editable.questions.find((q) => q.prompt === prompt)!.options.find((o) => o.isCorrect)!.id;
  const wrongFor = (prompt: string) =>
    editable.questions.find((q) => q.prompt === prompt)!.options.find((o) => !o.isCorrect)!.id;
  const idFor = (prompt: string) => editable.questions.find((q) => q.prompt === prompt)!.id;

  const threeOfFour = await submitAttempt(asLearner, {
    quizId: quiz.id,
    answers: {
      [idFor('First?')]: correctFor('First?'),
      [idFor('Second?')]: correctFor('Second?'),
      [idFor('Third?')]: correctFor('Third?'),
      [idFor('Fourth?')]: wrongFor('Fourth?'),
    },
  });
  check('three of four scores 75', threeOfFour.score === 75, String(threeOfFour.score));
  check('and 75 passes a pass mark of 75', threeOfFour.passed);
  check('the result reviews every question', threeOfFour.review.length === 4);
  check('and now names the correct option', threeOfFour.review[0]!.correctOptionId === correctFor('First?'));
  check('and the explanation', threeOfFour.review[0]!.explanation === 'Because of the first reason.');

  /* ---- an unanswered question is wrong, not skipped --------------------- */
  /*
   * If it were skipped, leaving out the questions you do not know would raise
   * your percentage: answer one of four and score 100%.
   */
  const onlyOne = await submitAttempt(asOther, {
    quizId: quiz.id,
    answers: { [idFor('First?')]: correctFor('First?') },
  });
  check('one answer out of four scores 25, not 100', onlyOne.score === 25, String(onlyOne.score));
  check('and does not pass', !onlyOne.passed);

  /* ---- answers from elsewhere are not stored ---------------------------- */
  const forged = await submitAttempt(asOther, {
    quizId: quiz.id,
    answers: {
      [idFor('First?')]: '00000000-0000-0000-0000-000000000000',
      'not-a-question-id': correctFor('Second?'),
    },
  });
  check('an option id that is not on the question is discarded', forged.score === 0, String(forged.score));
  const stored = await rows<{ answers: unknown }>(
    sql`select answers from lms_quiz_attempts where id = ${forged.attemptId}`,
  );
  const storedAnswers = asJson<Record<string, string>>(stored[0]!.answers, { bad: 'unreadable' });
  check(
    'and nothing invented is written to the attempt',
    Object.keys(storedAnswers).length === 0,
    JSON.stringify(storedAnswers),
  );

  /* ---- attempt limits ---------------------------------------------------- */
  check('the learner has one attempt left of two', threeOfFour.attemptsLeft === 1, String(threeOfFour.attemptsLeft));
  await submitAttempt(asLearner, { quizId: quiz.id, answers: {} });
  await refuses(
    'a third attempt at a two-attempt quiz is refused',
    () => submitAttempt(asLearner, { quizId: quiz.id, answers: {} }),
    'LmsConflict',
  );

  const paperAfter = (await getQuizPaper(asLearner, lesson.id))!;
  check('the paper reports no attempts left', paperAfter.attemptsLeft === 0, String(paperAfter.attemptsLeft));
  check('and remembers the best score', paperAfter.bestScore === 75, String(paperAfter.bestScore));
  check('and that they passed', paperAfter.hasPassed);

  /* ---- unlimited attempts ------------------------------------------------ */
  await upsertQuiz(asAdmin, {
    lessonId: lesson.id,
    title: 'Open',
    maxAttempts: 0,
    questions: [{ prompt: 'Open?', options: [{ label: 'Yes', isCorrect: true }, { label: 'No', isCorrect: false }] }],
  });
  const openPaper = (await getQuizPaper(asLearner, lesson.id))!;
  check('zero max attempts reads as unlimited, not as none left', openPaper.attemptsLeft === null);

  /* ---- a quiz an author has not finished -------------------------------- */
  await refuses(
    'a quiz with no questions is refused rather than scored',
    () => upsertQuiz(asAdmin, { lessonId: lesson.id, title: 'Empty', questions: [] }),
    'LmsInvalid',
  );
  await refuses(
    'a question with two correct options is refused',
    () =>
      upsertQuiz(asAdmin, {
        lessonId: lesson.id,
        title: 'Ambiguous',
        questions: [{ prompt: 'Both?', options: [{ label: 'A', isCorrect: true }, { label: 'B', isCorrect: true }] }],
      }),
    'LmsInvalid',
  );
  await refuses(
    'and so is one with none',
    () =>
      upsertQuiz(asAdmin, {
        lessonId: lesson.id,
        title: 'Unpassable',
        questions: [{ prompt: 'Neither?', options: [{ label: 'A', isCorrect: false }, { label: 'B', isCorrect: false }] }],
      }),
    'LmsInvalid',
  );
  await refuses(
    'a question with one option is refused',
    () =>
      upsertQuiz(asAdmin, {
        lessonId: lesson.id,
        title: 'Single',
        questions: [{ prompt: 'Only?', options: [{ label: 'A', isCorrect: true }] }],
      }),
    'LmsInvalid',
  );

  /* ---- whose attempts you may read -------------------------------------- */
  const mine = await attemptsFor(asLearner, quiz.id, learner);
  check('a learner reads their own attempts', mine.length >= 1);
  await refuses("but not somebody else's", () => attemptsFor(asLearner, quiz.id, other));
  const staffView = await attemptsFor(asAdmin, quiz.id, learner);
  check('staff can read a learner’s attempts, for marking', staffView.length >= 1);

  await reset(TAG);
  await close();
  finish('assessment');
}

void main();
