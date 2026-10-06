/**
 * The rule the module turns on, checked through every door.
 *
 * A learner reaches course material only through a cohort they belong to,
 * which that course has been released to, on or after its release date. Four
 * conditions. Leaving any one out shows somebody coursework they were never
 * given, and each one is checked here on its own so a failure says which.
 *
 * Then the same refusal is checked through every door into the material,
 * because a rule enforced on four screens out of five is not enforced. If you
 * add a sixth way to read a lesson, add it to `DOORS`.
 */
import { randomUUID } from 'node:crypto';
import { check, contextFor, db, finish, fixedClock, makeUser, close, refuses, reset, setUp, sql } from './harness.js';
import { lmsContext } from '../src/context.js';
import { store } from './harness.js';
import {
  addMember,
  createCohort,
  entitledCourseIds,
  entitlement,
  releaseCourse,
} from '../src/services/enrolment.js';
import { createCourse, createLesson, createModule, setCourseStatus, upsertQuiz } from '../src/services/authoring.js';
import { getCourse, getLesson } from '../src/services/learning.js';
import { completeLesson, recordWatched } from '../src/services/progress.js';
import { getQuizPaper, submitAttempt } from '../src/services/assessment.js';

const TAG = 'probe-ent';

async function main(): Promise<void> {
  await setUp();
  await reset(TAG);

  const admin = await makeUser(TAG, 'admin');
  const learner = await makeUser(TAG, 'learner');
  const stranger = await makeUser(TAG, 'stranger');
  const instructor = await makeUser(TAG, 'instructor');

  const now = new Date('2026-06-01T12:00:00Z');
  const clock = fixedClock(now);
  const ports = { clock: clock.port };

  const asAdmin = contextFor(admin, 'admin', ports);
  const asLearner = contextFor(learner, 'learner', ports);
  const asStranger = contextFor(stranger, 'learner', ports);
  const asInstructor = contextFor(instructor, 'instructor', ports);

  /* ---- build a course with one published lesson and a quiz --------------- */
  const course = await createCourse(asInstructor, { title: `${TAG} Foundations`, summary: 'A probe course.' });
  await db.execute(sql`update lms_courses set slug = ${`${TAG}-foundations`} where id = ${course.id}`);
  const unit = await createModule(asInstructor, { courseId: course.id, title: 'Unit One' });
  const lesson = await createLesson(asInstructor, { moduleId: unit.id, title: 'First Lesson', kind: 'reading' });
  await db.execute(sql`update lms_lessons set is_published = true where id = ${lesson.id}`);
  await setCourseStatus(asAdmin, course.id, 'published');
  const quiz = await upsertQuiz(asInstructor, {
    lessonId: lesson.id,
    title: 'A check',
    questions: [{ prompt: 'Is this a probe?', options: [{ label: 'Yes', isCorrect: true }, { label: 'No', isCorrect: false }] }],
  });

  const slug = `${TAG}-foundations`;

  /* ---- condition one: not in any cohort ---------------------------------- */
  let state = await entitlement(asLearner, course.id);
  check('a learner in no cohort is not entitled', !state.allowed);
  check('and the reason is that they are not enrolled', state.allowed === false && state.reason === 'not_enrolled');

  /* ---- condition two: in a cohort the course is not released to ---------- */
  const other = await createCohort(asAdmin, { name: `${TAG} Other Cohort` });
  await db.execute(sql`update lms_cohorts set slug = ${`${TAG}-other`} where id = ${other.id}`);
  await addMember(asAdmin, other.id, learner);

  state = await entitlement(asLearner, course.id);
  check('being in a cohort is not enough on its own', !state.allowed, JSON.stringify(state));

  /* ---- condition three: released, but dated in the future ---------------- */
  const cohort = await createCohort(asAdmin, { name: `${TAG} Autumn Cohort` });
  await db.execute(sql`update lms_cohorts set slug = ${`${TAG}-autumn`} where id = ${cohort.id}`);
  await addMember(asAdmin, cohort.id, learner);

  const opensLater = new Date('2026-06-15T09:00:00Z');
  await releaseCourse(asAdmin, { cohortId: cohort.id, courseId: course.id, availableFrom: opensLater });

  state = await entitlement(asLearner, course.id);
  check('a course released for later is not open yet', !state.allowed);
  check('and the reason names the date', state.allowed === false && state.reason === 'not_yet');
  check(
    'which is the release date, not today',
    state.allowed === false && state.reason === 'not_yet' && state.availableFrom.getTime() === opensLater.getTime(),
  );

  /* ---- the clock moving is what opens it --------------------------------- */
  clock.set(new Date('2026-06-15T09:00:01Z'));
  state = await entitlement(asLearner, course.id);
  check('once the date passes, the learner is entitled', state.allowed, JSON.stringify(state));
  check('through their cohort', state.allowed && state.reason === 'cohort');
  clock.set(now);

  /* ---- condition four: the course is not published ----------------------- */
  await releaseCourse(asAdmin, { cohortId: cohort.id, courseId: course.id, availableFrom: null });
  state = await entitlement(asLearner, course.id);
  check('released with no date, the learner is entitled', state.allowed);

  await setCourseStatus(asAdmin, course.id, 'draft');
  state = await entitlement(asLearner, course.id);
  check('unpublishing a course withdraws it from an enrolled learner', !state.allowed);
  check('and says so', state.allowed === false && state.reason === 'not_published');
  await setCourseStatus(asAdmin, course.id, 'published');

  /* ---- staff ------------------------------------------------------------- */
  state = await entitlement(asInstructor, course.id);
  check('an instructor reaches it without a cohort', state.allowed && state.reason === 'staff');
  state = await entitlement(asAdmin, course.id);
  check('so does an administrator', state.allowed && state.reason === 'staff');

  /* ---- a course that does not exist -------------------------------------- */
  state = await entitlement(asLearner, randomUUID());
  check('an unknown course id is refused, not crashed', state.allowed === false && state.reason === 'no_such_course');

  /* ---- EVERY DOOR -------------------------------------------------------- */
  /*
   * The stranger is in no cohort. Each of these is a way into the material,
   * and every one of them must refuse. A door added later and left out of
   * this list is the bug this probe exists to prevent.
   */
  const DOORS: { name: string; run: () => Promise<unknown>; expected?: string }[] = [
    { name: 'the course page', run: () => getCourse(asStranger, slug) },
    { name: 'a lesson', run: () => getLesson(asStranger, slug, 'first-lesson') },
    {
      name: 'recording video progress',
      run: () => recordWatched(asStranger, { lessonId: lesson.id, secondsWatched: 30, lastPositionSeconds: 30 }),
    },
    { name: 'marking a lesson complete', run: () => completeLesson(asStranger, lesson.id) },
    { name: 'reading the quiz paper', run: () => getQuizPaper(asStranger, lesson.id) },
    {
      name: 'submitting a quiz attempt',
      run: () => submitAttempt(asStranger, { quizId: quiz.id, answers: {} }),
    },
  ];

  for (const door of DOORS) {
    await refuses(`a stranger is refused ${door.name}`, door.run, door.expected ?? 'LmsForbidden');
  }

  /* ---- and the same doors open for the enrolled learner ------------------ */
  check('the enrolled learner can open the course', (await getCourse(asLearner, slug)) !== null);
  check('and the lesson', (await getLesson(asLearner, slug, 'first-lesson')) !== null);
  await recordWatched(asLearner, { lessonId: lesson.id, secondsWatched: 10, lastPositionSeconds: 10 });
  check('and record progress', true);
  check('and read the quiz paper', (await getQuizPaper(asLearner, lesson.id)) !== null);

  /* ---- the list query must agree with the single-course answer ----------- */
  /*
   * Two implementations of one access rule — `entitlement()` for a page and
   * `entitledCourseIds()` for a list — is exactly how they drift apart, so
   * they are checked against each other rather than each on its own.
   */
  const ids = await entitledCourseIds(asLearner);
  check('the list query includes a course the single check allows', ids.includes(course.id));

  await releaseCourse(asAdmin, { cohortId: cohort.id, courseId: course.id, availableFrom: opensLater });
  const laterIds = await entitledCourseIds(asLearner);
  const single = await entitlement(asLearner, course.id);
  check(
    'and excludes one it refuses, for the same reason',
    !laterIds.includes(course.id) && !single.allowed,
    `list ${laterIds.length}, single ${JSON.stringify(single)}`,
  );

  const strangerIds = await entitledCourseIds(asStranger);
  check('a stranger is entitled to nothing', !strangerIds.includes(course.id));

  /* ---- a viewer id that is not a real person ----------------------------- */
  // A forged session is the host's problem, not the module's, but the module
  // must not hand out material to an id it has never seen either.
  const forged = lmsContext({ store, viewer: { id: randomUUID(), role: 'learner' }, ports });
  await refuses('an unknown user id is refused the course', () => getCourse(forged, slug));

  await reset(TAG);
  await close();
  finish('entitlement');
}

void main();
