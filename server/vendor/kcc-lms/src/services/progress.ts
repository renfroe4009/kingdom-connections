/**
 * Recording what a learner has watched and finished.
 *
 * Every write checks entitlement first. That is not ceremony: a progress
 * endpoint that takes a lesson id and writes a row without checking is a way
 * to enumerate the lesson table and to award yourself a course you were
 * never given.
 */
import { LmsInvalid, LmsNotFound } from '../errors.js';
import { emit, type LmsContext } from '../context.js';
import { requireEntitlement } from './enrolment.js';
import { courseProgress } from './learning.js';

async function lessonInCourse(context: LmsContext, lessonId: string) {
  const found = await context.store.findLessonById(lessonId);
  if (!found) throw new LmsNotFound('No such lesson.');
  await requireEntitlement(context, found.courseId);
  return found;
}

/**
 * Records how far into a video somebody has got.
 *
 * The rule that `secondsWatched` only ever rises lives in the store, because
 * it has to be one statement — see `recordWatched` there. Here the figures
 * are only sanitised: a negative or non-finite position is a bug or a forged
 * request, and either way it is floored rather than stored.
 */
export async function recordWatched(
  context: LmsContext,
  input: { lessonId: string; secondsWatched: number; lastPositionSeconds: number },
): Promise<void> {
  const lesson = await lessonInCourse(context, input.lessonId);

  const watched = Math.max(0, Math.floor(input.secondsWatched));
  const position = Math.max(0, Math.floor(input.lastPositionSeconds));
  if (!Number.isFinite(watched) || !Number.isFinite(position)) throw new LmsInvalid('Not a position.');

  await context.store.recordWatched({
    userId: context.viewer.id,
    lessonId: lesson.lesson.id,
    secondsWatched: watched,
    lastPositionSeconds: position,
    at: context.clock.now(),
  });
}

/**
 * Marks a lesson complete.
 *
 * Idempotent, and `completedAt` is set once: a learner who re-opens a
 * finished lesson and reaches the end again keeps the date they first
 * finished it, because that is the date a certificate or a report means.
 */
export async function completeLesson(
  context: LmsContext,
  lessonId: string,
): Promise<{ courseCompleted: boolean; percent: number }> {
  const found = await lessonInCourse(context, lessonId);
  const now = context.clock.now();

  const before = await context.store.findProgress(context.viewer.id, lessonId);
  const wasAlreadyComplete = Boolean(before?.completedAt);

  await context.store.markCompleted(context.viewer.id, lessonId, now);

  if (!wasAlreadyComplete) {
    emit(context, {
      kind: 'lesson.completed',
      userId: context.viewer.id,
      lessonId,
      lessonTitle: found.lesson.title,
    });
  }

  const stats = await courseProgress(context, context.viewer.id, [found.courseId]);
  const stat = stats.get(found.courseId)!;
  const courseCompleted = stat.lessonCount > 0 && stat.completedCount === stat.lessonCount;

  // Only on the transition, or finishing the last lesson twice announces the
  // course twice.
  if (courseCompleted && !wasAlreadyComplete) {
    emit(context, {
      kind: 'course.completed',
      userId: context.viewer.id,
      courseId: found.courseId,
      courseTitle: found.courseTitle,
    });
  }

  return { courseCompleted, percent: stat.percent };
}

/**
 * Un-marks a lesson.
 *
 * Here because a learner who clicked the wrong thing should be able to undo
 * it. It clears the completion but keeps the watched seconds, which is what
 * "I had not actually finished this" means.
 */
export async function uncompleteLesson(context: LmsContext, lessonId: string): Promise<void> {
  await lessonInCourse(context, lessonId);
  await context.store.clearCompletion(context.viewer.id, lessonId, context.clock.now());
}
