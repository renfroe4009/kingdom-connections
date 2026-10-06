/**
 * Authoring: who may write, and what the module refuses to let them write.
 *
 * Most of these are refusals. An authoring service that accepts whatever a
 * form sends is how a course goes live unreviewed, how a lesson URL ends up
 * with a collision in it, and how a quiz ends up unpassable.
 */
import { check, contextFor, db, finish, makeUser, close, refuses, reset, rows, setUp, sql } from './harness.js';
import {
  addAttachment,
  createCourse,
  createLesson,
  createModule,
  deleteLesson,
  readList,
  recordVideoState,
  removeAttachment,
  setCourseStatus,
  updateCourse,
  updateLesson,
} from '../src/services/authoring.js';
import { getLesson } from '../src/services/learning.js';
import { addMember, createCohort, releaseCourse } from '../src/services/enrolment.js';
import { slugify } from '../src/slug.js';
import type { StoragePort, VideoPort } from '../src/ports.js';

const TAG = 'probe-auth';

async function main(): Promise<void> {
  await setUp();
  await reset(TAG);

  const admin = await makeUser(TAG, 'admin');
  const instructor = await makeUser(TAG, 'instructor');
  const learner = await makeUser(TAG, 'learner');

  const removed: string[] = [];
  const storage: StoragePort = {
    signedUrl: async (key) => `https://files.example.test/${key}?signed=yes`,
    remove: async (key) => void removed.push(key),
  };
  const video: VideoPort = {
    playback: async (ref) => ({ token: `token-for-${ref}`, poster: `poster-${ref}` }),
  };

  const asAdmin = contextFor(admin, 'admin', { storage, video });
  const asInstructor = contextFor(instructor, 'instructor', { storage, video });
  const asLearner = contextFor(learner, 'learner', { storage, video });

  /* ---- who may author ---------------------------------------------------- */
  await refuses('a learner cannot create a course', () => createCourse(asLearner, { title: 'Mine now' }));
  const course = await createCourse(asInstructor, { title: `${TAG} Authored Course` });
  check('an instructor can', course.id.length > 0);

  await db.execute(sql`update lms_courses set slug = ${`${TAG}-authored`} where id = ${course.id}`);
  const slug = `${TAG}-authored`;

  /* ---- a course cannot be born published -------------------------------- */
  /*
   * Publishing is its own call. Accepting a status on creation means a form
   * that posts `status: published` puts unreviewed material in front of
   * every cohort it is attached to.
   */
  const born = await rows<{ status: string }>(sql`select status from lms_courses where id = ${course.id}`);
  check('a new course is a draft, whatever was asked for', born[0]!.status === 'draft', born[0]!.status);

  await refuses('an instructor cannot publish', () => setCourseStatus(asInstructor, course.id, 'published'));

  /* ---- a course with nothing in it cannot be published ------------------ */
  await refuses(
    'an empty course cannot be published',
    () => setCourseStatus(asAdmin, course.id, 'published'),
    'LmsInvalid',
  );

  const unit = await createModule(asInstructor, { courseId: course.id, title: 'First Unit' });
  const lesson = await createLesson(asInstructor, { moduleId: unit.id, title: 'First Lesson' });

  await refuses(
    'nor can one whose only lesson is a draft',
    () => setCourseStatus(asAdmin, course.id, 'published'),
    'LmsInvalid',
  );

  await updateLesson(asInstructor, lesson.id, { isPublished: true });
  await setCourseStatus(asAdmin, course.id, 'published');
  const published = await rows<{ status: string }>(sql`select status from lms_courses where id = ${course.id}`);
  check('with one published lesson, it publishes', published[0]!.status === 'published');

  /* ---- positions ---------------------------------------------------------- */
  const second = await createModule(asInstructor, { courseId: course.id, title: 'Second Unit' });
  const positions = await rows<{ position: number }>(
    sql`select position from lms_modules where course_id = ${course.id} order by position`,
  );
  check('a second module takes the next position', positions.map((r) => Number(r.position)).join(',') === '0,1');

  /*
   * A deleted row leaves a gap. `count` would hand out a position that is
   * already in use and the two rows would then order arbitrarily against
   * each other; `max + 1` does not.
   */
  await db.execute(sql`delete from lms_modules where id = ${second.id}`);
  const third = await createModule(asInstructor, { courseId: course.id, title: 'Third Unit' });
  const afterGap = await rows<{ position: number }>(sql`select position from lms_modules where id = ${third.id}`);
  check('after a deletion the next position is still free', Number(afterGap[0]!.position) === 1, String(afterGap[0]!.position));

  /* ---- slugs -------------------------------------------------------------- */
  const twinA = await createLesson(asInstructor, { moduleId: unit.id, title: 'Same Name' });
  const twinB = await createLesson(asInstructor, { moduleId: unit.id, title: 'Same Name' });
  check('two lessons with one title get different slugs', twinA.slug !== twinB.slug, `${twinA.slug} / ${twinB.slug}`);

  // Unique within the module, not globally: two courses may both have an
  // "Introduction", and forcing "introduction-2" on the second puts the
  // collision into a URL a learner reads.
  const elsewhere = await createLesson(asInstructor, { moduleId: third.id, title: 'Same Name' });
  check('but a lesson in another module may reuse it', elsewhere.slug === twinA.slug, elsewhere.slug);

  check('accents reduce rather than vanish', slugify('Começar Aqui') === 'comecar-aqui', slugify('Começar Aqui'));
  check('a title with no ASCII form still gets a slug', slugify('مرحبا').length > 0);
  check('and two of them do not collide', slugify('مرحبا') !== slugify('مرحبا'));

  /* ---- list fields -------------------------------------------------------- */
  check('a list drops blank lines', readList('one\n\n  \ntwo').join('|') === 'one|two');
  check('and collapses whitespace', readList(['  a   b  ']).join('|') === 'a b');
  check('and caps the count', readList(Array.from({ length: 40 }, (_, i) => `x${i}`)).length === 12);
  check('and the length of each', readList(['y'.repeat(900)])[0]!.length === 300);

  /* ---- narrow writes ------------------------------------------------------ */
  /*
   * `updateCourse` takes the fields it changes. A service that takes a row
   * and writes it wholesale lets a title change carry `status` or
   * `createdBy` with it, and nothing in the types notices.
   */
  await updateCourse(asInstructor, course.id, { title: `${TAG} Renamed` });
  const kept = await rows<{ status: string; created_by: string | null; slug: string }>(
    sql`select status, created_by, slug from lms_courses where id = ${course.id}`,
  );
  check('renaming a course leaves it published', kept[0]!.status === 'published');
  check('and does not change who made it', kept[0]!.created_by === instructor);
  check('and does not move its URL', kept[0]!.slug === slug);

  /* ---- video state from a provider callback ----------------------------- */
  await updateLesson(asInstructor, lesson.id, { videoRef: 'vid-abc-123' });
  const processing = await rows<{ video_status: string }>(sql`select video_status from lms_lessons where id = ${lesson.id}`);
  check('attaching a video marks it processing, not ready', processing[0]!.video_status === 'processing');

  const hit = await recordVideoState(asAdmin, { videoRef: 'vid-abc-123', status: 'ready', durationSeconds: 754 });
  check('a provider callback updates the lesson it names', hit.updated === 1);

  // A callback naming a video nobody has heard of must update nothing rather
  // than create a row or throw.
  const miss = await recordVideoState(asAdmin, { videoRef: 'vid-never-seen', status: 'ready' });
  check('a callback for an unknown video changes nothing', miss.updated === 0);

  /* ---- what a learner is handed for a video and its files --------------- */
  const cohort = await createCohort(asAdmin, { name: `${TAG} Cohort` });
  await db.execute(sql`update lms_cohorts set slug = ${`${TAG}-cohort`} where id = ${cohort.id}`);
  await addMember(asAdmin, cohort.id, learner);
  await releaseCourse(asAdmin, { cohortId: cohort.id, courseId: course.id });

  const attachment = await addAttachment(asInstructor, {
    lessonId: lesson.id,
    label: 'Workbook',
    objectKey: `${TAG}/workbook.pdf`,
    contentType: 'application/pdf',
  });

  const view = (await getLesson(asLearner, slug, lesson.slug))!;
  check('an entitled learner gets a playback token from the host', view.video?.token === 'token-for-vid-abc-123');
  check('and the duration the provider reported', view.videoDurationSeconds === 754);
  check('and a signed URL for each attachment', view.attachments[0]?.url.includes('signed=yes') === true);

  /*
   * With no storage port configured the module returns no attachments rather
   * than an unsigned object key — a key is not a URL, and a host that has
   * not wired storage up should get nothing rather than something broken.
   */
  const noPorts = contextFor(learner, 'learner');
  const bare = (await getLesson(noPorts, slug, lesson.slug))!;
  check('with no storage port, attachments are withheld', bare.attachments.length === 0);
  check('and with no video port, no token is invented', bare.video === null);

  /* ---- files follow their rows ------------------------------------------- */
  removed.length = 0;
  await removeAttachment(asInstructor, attachment.id);
  check('removing an attachment asks the host to delete the file', removed.includes(`${TAG}/workbook.pdf`));

  await addAttachment(asInstructor, { lessonId: lesson.id, label: 'Second', objectKey: `${TAG}/second.pdf` });
  removed.length = 0;
  await refuses('an instructor cannot delete a lesson', () => deleteLesson(asInstructor, twinB.id));
  await deleteLesson(asAdmin, lesson.id);
  check('deleting a lesson takes its files with it', removed.includes(`${TAG}/second.pdf`));
  const gone = await rows<{ count: number }>(
    // Plain `count(*)`, not `count(*)::int`: the cast is Postgres-only, and
    // these probes run on both engines. The number is coerced below.
    sql`select count(*) as count from lms_lesson_attachments where lesson_id = ${lesson.id}`,
  );
  check('and its attachment rows', Number(gone[0]!.count) === 0);

  /* ---- input that should be refused ------------------------------------- */
  await refuses('a course with no title is refused', () => createCourse(asInstructor, { title: '   ' }), 'LmsInvalid');
  await refuses(
    'a title of 300 characters is refused',
    () => createCourse(asInstructor, { title: 'z'.repeat(300) }),
    'LmsInvalid',
  );
  await refuses(
    'a lesson under a module that does not exist is refused',
    () => createLesson(asInstructor, { moduleId: '00000000-0000-0000-0000-000000000000', title: 'Orphan' }),
    'LmsNotFound',
  );
  await refuses(
    'editing a course that does not exist is refused',
    () => updateCourse(asAdmin, '00000000-0000-0000-0000-000000000000', { title: 'Ghost' }),
    'LmsNotFound',
  );

  await reset(TAG);
  await close();
  finish('authoring');
}

void main();
