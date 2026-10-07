/**
 * @kcc/lms — a learning-management module.
 *
 * Courses, cohorts, modules, lessons, progress and assessments, built to be
 * merged into an application that already exists. It owns thirteen tables,
 * all prefixed `lms_`, and knows nothing about the host beyond what
 * `src/ports.ts` asks for.
 *
 * Start at the README. The short version:
 *
 *     import { lmsContext, asViewer, myCourses } from '@kcc/lms';
 *
 *     const lms = lmsContext({ db, viewer: asViewer(user.id, user.role) });
 *     const shelf = await myCourses(lms);
 *
 * The one thing worth reading before writing any screen: every read and
 * write of course material goes through `entitlement()`, which answers "may
 * this person see this" in one place. Call the services; do not query the
 * tables directly, or that rule stops being the only answer.
 */

export { lmsContext, emit, type LmsContext } from './context.js';

/* ------------------------------------------------ the database, either one */

/**
 * The store is the seam between the rules and the database. Build one with
 * `postgresStore()` or `mysqlStore()` and hand it to `lmsContext()`; a host
 * that uses neither Drizzle nor these two engines can implement `Store`
 * itself and every rule in the module comes with it.
 */
export { postgresStore, mysqlStore } from './stores/index.js';
export { drizzleStore, type DrizzleStoreInput, type LmsTables } from './stores/drizzle.js';
export { dialectFor, mysqlDialect, postgresDialect, type Dialect, type DialectName } from './stores/dialect.js';
export type * from './store.js';

export {
  asViewer,
  hasAtLeast,
  systemClock,
  type ClockPort,
  type LmsEvent,
  type LmsPorts,
  type LmsRole,
  type NotifierPort,
  type StoragePort,
  type VideoPort,
  type Viewer,
} from './ports.js';

export { LmsError, LmsForbidden, LmsNotFound, LmsInvalid, LmsConflict } from './errors.js';

export { PAGE_SIZE, paging, readPage, type Paged, type Paging } from './paging.js';
export { likePattern } from './like.js';
export { slugify, uniqueSlug } from './slug.js';

/* --------------------------------------------------- cohorts and access */

export {
  addMember,
  cohortsFor,
  createCohort,
  decideEntitlement,
  entitledCourseIds,
  entitlement,
  listCohorts,
  releaseCourse,
  removeMember,
  requireEntitlement,
  withdrawCourse,
  type CohortSummary,
  type Entitlement,
} from './services/enrolment.js';

/* ---------------------------------------------------------------- reading */

export {
  canOpen,
  courseProgress,
  getCourse,
  getLesson,
  myCourses,
  type CourseCard,
  type CourseDetail,
  type CourseStat,
  type LessonSummary,
  type LessonView,
  type ModuleOutline,
} from './services/learning.js';

export {
  browseCatalogue,
  catalogueFacets,
  type CatalogueCard,
  type CatalogueFilters,
} from './services/catalogue.js';

/* --------------------------------------------------------------- progress */

export { completeLesson, recordWatched, uncompleteLesson } from './services/progress.js';

/* ------------------------------------------------------------ assessment */

export {
  attemptsFor,
  getQuizPaper,
  markAttempt,
  submitAttempt,
  type QuizPaper,
  type QuizResult,
} from './services/assessment.js';

/* ------------------------------------------------------------- authoring */

export {
  addAttachment,
  createCourse,
  createLesson,
  createModule,
  deleteLesson,
  deleteModule,
  deleteQuiz,
  getQuizForEditing,
  readList,
  recordVideoState,
  removeAttachment,
  setCourseStatus,
  updateCourse,
  updateLesson,
  updateModule,
  upsertQuiz,
  type CourseInput,
  type LessonInput,
} from './services/authoring.js';

/* ----------------------------------------------------------------- schema */

/**
 * The Drizzle table definitions, one set per dialect. A convenience for a
 * host that already uses Drizzle; `migrations/*` is the authority.
 */
export * as pgSchema from './schema/pg.js';
export * as mysqlSchema from './schema/mysql.js';
export { HOST_USERS_TABLE } from './schema/pg.js';
