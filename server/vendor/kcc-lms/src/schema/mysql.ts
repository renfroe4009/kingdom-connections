/**
 * The module's tables, for MySQL.
 *
 * The same thirteen tables as `./pg.ts`, and five differences that are not
 * cosmetic. They are listed here because each one has already changed a line
 * of code somewhere, and somebody reading only the Postgres schema would
 * assume none of them.
 *
 * 1. **No `uuid` column type.** Keys are `char(36)` holding a text UUID.
 *    `binary(16)` would be smaller and faster to index, and is rejected: it
 *    makes every id unreadable in a console, in a log and in a bug report,
 *    and this module is going into somebody else's application where those
 *    are the tools they have. The cost is 20 bytes a row.
 *
 * 2. **No `gen_random_uuid()` default, and no `RETURNING`.** Postgres lets
 *    the database mint an id and hand it back in one statement. MySQL does
 *    neither — MariaDB has `RETURNING`, MySQL does not, so relying on it
 *    would pass every test here and fail on the host's real database. Ids
 *    are generated in the application before the insert, for both dialects,
 *    so there is one code path rather than two.
 *
 * 3. **No native enums as separate types.** MySQL spells them inline on the
 *    column. Same values, same validation, no `create type`.
 *
 * 4. **An indexed column cannot be `text`.** InnoDB will not index a `text`
 *    column without a prefix length, so every column carrying a unique or
 *    searched key is `varchar` with an explicit limit. 191 rather than 255
 *    because a `utf8mb4` index key is limited to 767 bytes on older InnoDB
 *    row formats, and 191 × 4 fits under it. A slug or a video reference
 *    longer than that is refused by the database rather than silently cut.
 *
 * 5. **`jsonb` is `json`, and the operators differ.** No `@>` and no
 *    `jsonb_array_elements_text`; `JSON_CONTAINS` and `JSON_TABLE` do the
 *    same work. Those two live in `../stores/dialect.ts` rather than here.
 *
 * One more thing that is not a schema difference but belongs with them:
 * **MySQL's default collations are case-insensitive**, so `LIKE` already
 * behaves like Postgres's `ILIKE` and the dialect uses `like` rather than
 * `ilike`. A host that has configured a binary collation will get
 * case-sensitive search, and that is worth knowing before they wonder why.
 */
import {
  boolean,
  char,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * See the note of the same name in `./pg.ts`. The seam is identical, except
 * that this copy is wired to Kingdom Connections' `contacts` table (church
 * members) rather than `users` (internal staff) — see the header note in
 * `migrations/mysql/0001_lms.sql`.
 */
export const HOST_USERS_TABLE = 'contacts';

/**
 * Timestamps.
 *
 * `timestamp` with `fsp: 3` for millisecond precision, which matters because
 * two lessons completed in the same second are ordered by it.
 *
 * MySQL's `TIMESTAMP` converts to and from the session's time zone, so a
 * connection in a zone other than UTC reads back a different instant than it
 * wrote. **The host must connect with the session time zone set to UTC** —
 * `timezone: 'Z'` in mysql2 — and the migration says so too. That is not a
 * preference; it is the difference between a release date that opens a course
 * when it should and one that opens it seven hours early.
 */
const timestamps = {
  createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { fsp: 3 }).notNull().defaultNow(),
};

const id = () => char('id', { length: 36 }).primaryKey();
const ref = (column: string) => char(column, { length: 36 }).notNull();

// Kingdom Connections wiring: these three columns hold a `contacts.id`
// (int unsigned, so a short numeric string fits easily), not a 36-char
// UUID. See migrations/mysql/0001_lms.sql for why there is no DB-level FK.
const userRef = (column: string) => varchar(column, { length: 20 }).notNull();

/* --------------------------------------------------------------- cohorts */

export const cohorts = mysqlTable(
  'lms_cohorts',
  {
    id: id(),
    name: varchar('name', { length: 191 }).notNull(),
    slug: varchar('slug', { length: 191 }).notNull(),
    description: text('description'),
    status: mysqlEnum('status', ['planned', 'active', 'archived']).notNull().default('planned'),
    startsOn: timestamp('starts_on', { fsp: 3 }),
    endsOn: timestamp('ends_on', { fsp: 3 }),
    ...timestamps,
  },
  (t) => [uniqueIndex('lms_cohorts_slug_key').on(t.slug)],
);

export const cohortMembers = mysqlTable(
  'lms_cohort_members',
  {
    cohortId: ref('cohort_id'),
    userId: userRef('user_id'),
    joinedAt: timestamp('joined_at', { fsp: 3 }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.cohortId, t.userId] }),
    index('lms_cohort_members_user_idx').on(t.userId),
  ],
);

/* --------------------------------------------------------------- courses */

export const courses = mysqlTable(
  'lms_courses',
  {
    id: id(),
    slug: varchar('slug', { length: 191 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    subtitle: varchar('subtitle', { length: 500 }),
    summary: text('summary'),
    description: text('description'),
    coverImageUrl: varchar('cover_image_url', { length: 1000 }),
    status: mysqlEnum('status', ['draft', 'published', 'archived']).notNull().default('draft'),
    estimatedMinutes: int('estimated_minutes'),
    level: mysqlEnum('level', ['foundation', 'intermediate', 'advanced']).notNull().default('foundation'),
    language: varchar('language', { length: 100 }).notNull().default('English'),
    audience: text('audience'),
    outcomes: json('outcomes').$type<string[]>().notNull(),
    prerequisites: json('prerequisites').$type<string[]>().notNull(),
    topics: json('topics').$type<string[]>().notNull(),
    createdBy: varchar('created_by', { length: 20 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('lms_courses_slug_key').on(t.slug),
    index('lms_courses_status_idx').on(t.status),
    index('lms_courses_title_idx').on(t.title),
  ],
);

export const cohortCourses = mysqlTable(
  'lms_cohort_courses',
  {
    cohortId: ref('cohort_id'),
    courseId: ref('course_id'),
    availableFrom: timestamp('available_from', { fsp: 3 }),
    position: int('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.cohortId, t.courseId] }),
    index('lms_cohort_courses_course_idx').on(t.courseId),
  ],
);

export const modules = mysqlTable(
  'lms_modules',
  {
    id: id(),
    courseId: ref('course_id'),
    title: varchar('title', { length: 255 }).notNull(),
    summary: text('summary'),
    position: int('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('lms_modules_course_idx').on(t.courseId, t.position)],
);

export const lessons = mysqlTable(
  'lms_lessons',
  {
    id: id(),
    moduleId: ref('module_id'),
    slug: varchar('slug', { length: 191 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    summary: text('summary'),
    kind: mysqlEnum('kind', ['video', 'reading', 'assignment']).notNull().default('video'),
    body: text('body'),
    bodyFormat: mysqlEnum('body_format', ['html', 'markdown']).notNull().default('markdown'),
    keyPoints: json('key_points').$type<string[]>().notNull(),
    reflectionQuestions: json('reflection_questions').$type<string[]>().notNull(),
    estimatedMinutes: int('estimated_minutes'),
    videoRef: varchar('video_ref', { length: 191 }),
    videoStatus: mysqlEnum('video_status', ['none', 'uploading', 'processing', 'ready', 'error'])
      .notNull()
      .default('none'),
    videoDurationSeconds: int('video_duration_seconds'),
    videoThumbnailUrl: varchar('video_thumbnail_url', { length: 1000 }),
    position: int('position').notNull().default(0),
    isPublished: boolean('is_published').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index('lms_lessons_module_idx').on(t.moduleId, t.position),
    uniqueIndex('lms_lessons_module_slug_key').on(t.moduleId, t.slug),
    index('lms_lessons_video_ref_idx').on(t.videoRef),
  ],
);

export const lessonAttachments = mysqlTable(
  'lms_lesson_attachments',
  {
    id: id(),
    lessonId: ref('lesson_id'),
    label: varchar('label', { length: 191 }).notNull(),
    objectKey: varchar('object_key', { length: 500 }).notNull(),
    contentType: varchar('content_type', { length: 191 }),
    sizeBytes: int('size_bytes'),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull().defaultNow(),
  },
  (t) => [index('lms_lesson_attachments_lesson_idx').on(t.lessonId)],
);

/* -------------------------------------------------------------- progress */

export const lessonProgress = mysqlTable(
  'lms_lesson_progress',
  {
    userId: userRef('user_id'),
    lessonId: ref('lesson_id'),
    status: mysqlEnum('status', ['in_progress', 'completed']).notNull().default('in_progress'),
    secondsWatched: int('seconds_watched').notNull().default(0),
    lastPositionSeconds: int('last_position_seconds').notNull().default(0),
    completedAt: timestamp('completed_at', { fsp: 3 }),
    updatedAt: timestamp('updated_at', { fsp: 3 }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.lessonId] }),
    index('lms_lesson_progress_lesson_idx').on(t.lessonId),
  ],
);

/* ----------------------------------------------------------- assessments */

export const quizzes = mysqlTable(
  'lms_quizzes',
  {
    id: id(),
    lessonId: ref('lesson_id'),
    title: varchar('title', { length: 255 }).notNull(),
    instructions: text('instructions'),
    passingScore: int('passing_score').notNull().default(80),
    maxAttempts: int('max_attempts').notNull().default(3),
    ...timestamps,
  },
  (t) => [uniqueIndex('lms_quizzes_lesson_key').on(t.lessonId)],
);

export const quizQuestions = mysqlTable(
  'lms_quiz_questions',
  {
    id: id(),
    quizId: ref('quiz_id'),
    prompt: text('prompt').notNull(),
    explanation: text('explanation'),
    position: int('position').notNull().default(0),
  },
  (t) => [index('lms_quiz_questions_quiz_idx').on(t.quizId, t.position)],
);

export const quizOptions = mysqlTable(
  'lms_quiz_options',
  {
    id: id(),
    questionId: ref('question_id'),
    label: text('label').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
    position: int('position').notNull().default(0),
  },
  (t) => [index('lms_quiz_options_question_idx').on(t.questionId, t.position)],
);

export const quizAttempts = mysqlTable(
  'lms_quiz_attempts',
  {
    id: id(),
    quizId: ref('quiz_id'),
    userId: userRef('user_id'),
    score: int('score').notNull(),
    passed: boolean('passed').notNull(),
    answers: json('answers').$type<Record<string, string>>().notNull(),
    submittedAt: timestamp('submitted_at', { fsp: 3 }).notNull().defaultNow(),
  },
  (t) => [index('lms_quiz_attempts_user_idx').on(t.userId, t.quizId)],
);
