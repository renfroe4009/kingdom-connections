/**
 * Progress: the rules that stop a learner losing work they have done.
 *
 * Two of them exist because of how a video player behaves rather than
 * anything a person does, and both are invisible until somebody complains
 * that their progress went backwards.
 */
import { check, contextFor, db, finish, fixedClock, makeUser, close, reset, rows, setUp, sql } from './harness.js';
import { addMember, createCohort, releaseCourse } from '../src/services/enrolment.js';
import { createCourse, createLesson, createModule, setCourseStatus } from '../src/services/authoring.js';
import { completeLesson, recordWatched, uncompleteLesson } from '../src/services/progress.js';
import { courseProgress, getCourse } from '../src/services/learning.js';
import type { LmsEvent } from '../src/ports.js';

const TAG = 'probe-prog';

async function main(): Promise<void> {
  await setUp();
  await reset(TAG);

  const admin = await makeUser(TAG, 'admin');
  const learner = await makeUser(TAG, 'learner');

  const clock = fixedClock(new Date('2026-03-01T10:00:00Z'));
  const seen: LmsEvent[] = [];
  const ports = { clock: clock.port, notifier: { notify: (event: LmsEvent) => void seen.push(event) } };

  const asAdmin = contextFor(admin, 'admin', ports);
  const asLearner = contextFor(learner, 'learner', ports);

  const course = await createCourse(asAdmin, { title: `${TAG} Course` });
  await db.execute(sql`update lms_courses set slug = ${`${TAG}-course`} where id = ${course.id}`);
  const unit = await createModule(asAdmin, { courseId: course.id, title: 'Unit' });

  const lessonIds: string[] = [];
  for (const title of ['One', 'Two', 'Three']) {
    const lesson = await createLesson(asAdmin, { moduleId: unit.id, title });
    await db.execute(sql`update lms_lessons set is_published = true where id = ${lesson.id}`);
    lessonIds.push(lesson.id);
  }
  // A draft lesson, which must not count towards the total.
  const draft = await createLesson(asAdmin, { moduleId: unit.id, title: 'Unfinished' });

  await setCourseStatus(asAdmin, course.id, 'published');
  const cohort = await createCohort(asAdmin, { name: `${TAG} Cohort` });
  await db.execute(sql`update lms_cohorts set slug = ${`${TAG}-cohort`} where id = ${cohort.id}`);
  await addMember(asAdmin, cohort.id, learner);
  await releaseCourse(asAdmin, { cohortId: cohort.id, courseId: course.id });

  /* ---- watched seconds only ever go up ---------------------------------- */
  /*
   * A player posts these every few seconds and they arrive out of order over
   * a flaky connection. A late packet carrying an earlier figure must not
   * rewind what the learner has watched.
   */
  await recordWatched(asLearner, { lessonId: lessonIds[0]!, secondsWatched: 300, lastPositionSeconds: 300 });
  await recordWatched(asLearner, { lessonId: lessonIds[0]!, secondsWatched: 120, lastPositionSeconds: 120 });

  const [row] = await rows<{ seconds_watched: number; last_position_seconds: number }>(
    sql`select seconds_watched, last_position_seconds from lms_lesson_progress
        where user_id = ${learner} and lesson_id = ${lessonIds[0]!}`,
  );

  check('a late, lower watched figure does not rewind progress', Number(row!.seconds_watched) === 300, String(row!.seconds_watched));
  // The resume point is different: scrubbing back to re-watch something is
  // deliberate, so that one is simply set.
  check('but the resume position follows the player', Number(row!.last_position_seconds) === 120);

  /* ---- re-watching does not un-complete --------------------------------- */
  await completeLesson(asLearner, lessonIds[0]!);
  await recordWatched(asLearner, { lessonId: lessonIds[0]!, secondsWatched: 310, lastPositionSeconds: 20 });

  const [after] = await rows<{ status: string; completed_at: Date | null }>(
    sql`select status, completed_at from lms_lesson_progress where user_id = ${learner} and lesson_id = ${lessonIds[0]!}`,
  );
  check('watching a finished lesson again leaves it finished', after!.status === 'completed', after!.status);

  /* ---- the completion date is the first one ----------------------------- */
  const firstDate = after!.completed_at;
  clock.set(new Date('2026-04-01T10:00:00Z'));
  await completeLesson(asLearner, lessonIds[0]!);
  const [again] = await rows<{ completed_at: Date }>(
    sql`select completed_at from lms_lesson_progress where user_id = ${learner} and lesson_id = ${lessonIds[0]!}`,
  );
  check(
    'completing twice keeps the date it was first finished',
    new Date(again!.completed_at).getTime() === new Date(firstDate!).getTime(),
  );

  /* ---- percentages count published lessons only ------------------------- */
  const stats = await courseProgress(asLearner, learner, [course.id]);
  const stat = stats.get(course.id)!;
  check('the total counts published lessons', stat.lessonCount === 3, String(stat.lessonCount));
  check('and not the draft one', stat.lessonCount !== 4);
  check('one of three is 33%', stat.percent === 33, String(stat.percent));

  /* ---- finishing the course --------------------------------------------- */
  seen.length = 0;
  const second = await completeLesson(asLearner, lessonIds[1]!);
  check('two of three is not the whole course', !second.courseCompleted);

  const third = await completeLesson(asLearner, lessonIds[2]!);
  check('the last published lesson completes the course', third.courseCompleted);
  check('even with a draft lesson left unfinished', third.percent === 100, String(third.percent));
  check(
    'and the course completion is announced once',
    seen.filter((event) => event.kind === 'course.completed').length === 1,
    JSON.stringify(seen.map((e) => e.kind)),
  );

  seen.length = 0;
  await completeLesson(asLearner, lessonIds[2]!);
  check(
    'finishing the last lesson twice does not announce it twice',
    seen.filter((event) => event.kind === 'course.completed').length === 0,
  );

  /* ---- publishing another lesson must not cost earned progress ---------- */
  await db.execute(sql`update lms_lessons set is_published = true where id = ${draft.id}`);
  const grown = (await courseProgress(asLearner, learner, [course.id])).get(course.id)!;
  check('publishing a fourth lesson raises the total', grown.lessonCount === 4);
  check('and keeps the three completions', grown.completedCount === 3, String(grown.completedCount));

  /* ---- undo -------------------------------------------------------------- */
  await uncompleteLesson(asLearner, lessonIds[0]!);
  const undone = (await courseProgress(asLearner, learner, [course.id])).get(course.id)!;
  check('un-marking a lesson drops the count', undone.completedCount === 2);
  const [kept] = await rows<{ seconds_watched: number }>(
    sql`select seconds_watched from lms_lesson_progress where user_id = ${learner} and lesson_id = ${lessonIds[0]!}`,
  );
  check('but keeps the seconds watched', Number(kept!.seconds_watched) === 310, String(kept!.seconds_watched));

  /* ---- a learner cannot read somebody else's progress ------------------- */
  try {
    await courseProgress(asLearner, admin, [course.id]);
    check("a learner cannot read another person's progress", false, 'it was allowed');
  } catch (error) {
    check("a learner cannot read another person's progress", (error as Error).name === 'LmsForbidden');
  }

  /* ---- the outline marks what is done ----------------------------------- */
  const detail = await getCourse(asLearner, `${TAG}-course`);
  const done = detail!.modules.flatMap((m) => m.lessons).filter((l) => l.isCompleted).length;
  check('the outline shows the completed lessons', done === 2, String(done));
  check('and offers the next unfinished one', detail!.nextLessonSlug === 'one', String(detail!.nextLessonSlug));

  /* ---- a nonsense position is rejected ---------------------------------- */
  await recordWatched(asLearner, { lessonId: lessonIds[1]!, secondsWatched: -5, lastPositionSeconds: -5 });
  const [floored] = await rows<{ seconds_watched: number }>(
    sql`select seconds_watched from lms_lesson_progress where user_id = ${learner} and lesson_id = ${lessonIds[1]!}`,
  );
  check('a negative position is floored at zero, not stored', Number(floored!.seconds_watched) >= 0);

  await reset(TAG);
  await close();
  finish('progress');
}

void main();
