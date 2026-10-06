/**
 * The catalogue: paging, searching, and the line between a card and the
 * material behind it.
 *
 * The catalogue is the one read that is not gated by entitlement, so what it
 * returns matters: describing fields, yes; lesson bodies, never.
 */
import { check, contextFor, db, finish, makeUser, close, reset, setUp, sql } from './harness.js';
import { addMember, createCohort, releaseCourse } from '../src/services/enrolment.js';
import { createCourse, createLesson, createModule, setCourseStatus } from '../src/services/authoring.js';
import { browseCatalogue, catalogueFacets } from '../src/services/catalogue.js';
import { PAGE_SIZE, paging, readPage } from '../src/paging.js';

const TAG = 'probe-cat';
const COUNT = PAGE_SIZE + 7;

function ascending(ids: string[]): boolean {
  return ids.every((id, i) => i === 0 || ids[i - 1]! < id);
}

async function main(): Promise<void> {
  await setUp();
  await reset(TAG);

  const admin = await makeUser(TAG, 'admin');
  const learner = await makeUser(TAG, 'learner');
  const asAdmin = contextFor(admin, 'admin');
  const asLearner = contextFor(learner, 'learner');

  /* ---- page arithmetic --------------------------------------------------- */
  check('a page below one is page one', readPage('0') === 1 && readPage('-2') === 1);
  check('a nonsense page is page one', readPage('banana') === 1 && readPage(undefined) === 1);
  const past = paging(10, 99, 4);
  check('a page past the end lands on the last one', past.page === 3 && past.to === 10);
  const empty = paging(0, 1);
  check('an empty catalogue is one page counting from zero', empty.pages === 1 && empty.from === 0);

  /*
   * Every seeded course shares one title, so the whole list is one tie. A
   * sort on title alone is not stable, and an unstable sort drops a course
   * between page one and page two while showing another twice — both pages
   * still look plausible.
   */
  const twin = `${TAG} Identical Title`;
  const ids: string[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const course = await createCourse(asAdmin, {
      title: twin,
      summary: 'A seeded course for probing the catalogue',
      topics: ['Prayer', 'Discipleship'],
      level: i % 2 === 0 ? 'foundation' : 'advanced',
      language: i % 3 === 0 ? 'Português' : 'English',
    });
    await db.execute(sql`update lms_courses set slug = ${`${TAG}-${String(i).padStart(3, '0')}`} where id = ${course.id}`);
    const unit = await createModule(asAdmin, { courseId: course.id, title: 'Unit' });
    const lesson = await createLesson(asAdmin, {
      moduleId: unit.id,
      title: 'Lesson',
      body: 'THE-SECRET-LESSON-BODY',
    });
    await db.execute(sql`update lms_lessons set is_published = true where id = ${lesson.id}`);
    await setCourseStatus(asAdmin, course.id, 'published');
    ids.push(course.id);
  }

  // A draft course, which must not appear at all.
  const draft = await createCourse(asAdmin, { title: `${TAG} Not Published Yet` });
  await db.execute(sql`update lms_courses set slug = ${`${TAG}-draft`} where id = ${draft.id}`);

  /* ---- paging ------------------------------------------------------------ */
  const first = await browseCatalogue(asLearner, { query: twin });
  check('a page holds no more than the page size', first.items.length === PAGE_SIZE, String(first.items.length));
  check('the total counts every match', first.total === COUNT, `${first.total} vs ${COUNT}`);
  check('pages come from the total', first.pages === Math.ceil(COUNT / PAGE_SIZE));

  const walk: string[] = [];
  for (let page = 1; page <= first.pages; page += 1) {
    const slice = await browseCatalogue(asLearner, { query: twin, page });
    for (const card of slice.items) walk.push(card.id);
  }
  check('walking every page returns each course once', new Set(walk).size === COUNT, `${new Set(walk).size} distinct`);
  check('and none of them twice', walk.length === COUNT, `${walk.length} rows`);
  check('a title tie is broken by id', ascending(walk));

  const beyond = await browseCatalogue(asLearner, { query: twin, page: 999 });
  check('a page past the end shows the last one', beyond.items.length > 0 && beyond.page === first.pages);

  /* ---- what is on a card, and what is not ------------------------------- */
  const card = first.items[0]!;
  check('a card carries what somebody needs to choose', card.title.length > 0 && card.lessonCount === 1);
  check(
    'and no lesson body',
    !JSON.stringify(first.items).includes('THE-SECRET-LESSON-BODY'),
  );

  /* ---- drafts are not on sale ------------------------------------------- */
  const everything = await browseCatalogue(asLearner, {});
  check(
    'an unpublished course is not in the catalogue',
    !everything.items.some((item) => item.id === draft.id) && everything.total >= COUNT,
  );

  /* ---- enrolment is marked ---------------------------------------------- */
  check('a course nobody released is not marked as enrolled', first.items.every((item) => !item.enrolled));

  const cohort = await createCohort(asAdmin, { name: `${TAG} Cohort` });
  await db.execute(sql`update lms_cohorts set slug = ${`${TAG}-cohort`} where id = ${cohort.id}`);
  await addMember(asAdmin, cohort.id, learner);

  /*
   * Release a course that is on the page about to be inspected. Picking
   * `ids[0]` instead looks equivalent and is not: every seeded course shares
   * a title, so the order is by id, and a random uuid lands on page two
   * about a quarter of the time. That is how this check passed for a while
   * and then failed for no reason anybody had changed.
   */
  const onPageOne = first.items[0]!.id;
  await releaseCourse(asAdmin, { cohortId: cohort.id, courseId: onPageOne });

  const marked = await browseCatalogue(asLearner, { query: twin });
  const mine = marked.items.find((item) => item.id === onPageOne);
  check('a released course is marked as enrolled', mine?.enrolled === true);
  check('and the others are not', marked.items.filter((item) => item.enrolled).length === 1);

  /* ---- filters ----------------------------------------------------------- */
  const foundation = await browseCatalogue(asLearner, { query: twin, level: 'foundation' });
  check('a level filter narrows', foundation.items.every((item) => item.level === 'foundation'));
  check('and the total follows the filter', foundation.total < COUNT && foundation.total > 0, String(foundation.total));

  const portuguese = await browseCatalogue(asLearner, { query: twin, language: 'Português' });
  check('a language filter matches an accented value', portuguese.total > 0, String(portuguese.total));

  const byTopic = await browseCatalogue(asLearner, { topic: 'Prayer' });
  check('a topic filter matches on the element', byTopic.total >= COUNT, String(byTopic.total));
  const notATopic = await browseCatalogue(asLearner, { topic: 'Pray' });
  check(
    'and matches the whole element, not part of one',
    notATopic.total === 0,
    `"Pray" matched ${notATopic.total}`,
  );

  /* ---- searching --------------------------------------------------------- */
  check('a search reads the summary', (await browseCatalogue(asLearner, { query: 'seeded course' })).total >= COUNT);
  check('and ignores case', (await browseCatalogue(asLearner, { query: twin.toUpperCase() })).total === COUNT);

  // % and _ are LIKE wildcards. Unescaped, a search for "%" returns the whole
  // catalogue, which reads as a broken search rather than a generous one.
  const wild = await browseCatalogue(asLearner, { query: '%' });
  check('a bare % is a literal, not a wildcard', wild.total === 0, `${wild.total} matched`);
  const underscore = await browseCatalogue(asLearner, { query: 'seeded_course' });
  check('an underscore is a literal too', underscore.total === 0, `${underscore.total} matched`);

  /* ---- facets ------------------------------------------------------------ */
  const facets = await catalogueFacets(asLearner);
  check('the facets list the levels in use', facets.levels.length >= 2, JSON.stringify(facets.levels));
  check('and the languages', facets.languages.some((row) => row.value === 'Português'));
  check('and the topics, from every course rather than one page', facets.topics.some((row) => row.value === 'Prayer' && row.count >= COUNT));

  await reset(TAG);
  await close();
  finish('catalogue');
}

void main();
