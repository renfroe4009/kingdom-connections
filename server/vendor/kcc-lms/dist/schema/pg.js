/**
 * The module's tables, for PostgreSQL.
 *
 * `./mysql.ts` is the same thirteen tables for MySQL. The two are kept
 * side by side rather than generated from one description, because the
 * differences are not cosmetic — see the note at the top of `./mysql.ts` —
 * and a generator hiding them would be a generator nobody could debug.
 *
 * What keeps them honest is that the same probe suite runs against both
 * engines. Two schemas that drift apart fail it.
 *
 * All thirteen are prefixed `lms_` so they cannot collide with anything
 * already in the host's database. The only thing that reaches outside the
 * module is `user_id` — see `HOST_USERS_TABLE` below.
 *
 * These Drizzle definitions are a convenience, not a requirement:
 * `migrations/postgres/0001_lms.sql` is plain SQL and creates exactly these
 * tables, so a host on Prisma, TypeORM or hand-written SQL can apply the
 * migration and ignore this file.
 */
import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
/**
 * The host's user table, named once.
 *
 * The module stores a `user_id` on three tables — cohort membership, lesson
 * progress and quiz attempts — and declares a foreign key to the host's own
 * user table so that deleting a person takes their LMS rows with them. It
 * reads no column but `id` and writes to that table never, so nothing else
 * about the host's user model matters: extra columns, soft deletes and a
 * different name for "name" are all invisible here.
 *
 * Two things to change if the host differs, both in one place each:
 *
 *   - **A different table name.** Change this constant and the matching
 *     `references` clauses in `migrations/postgres/0001_lms.sql`.
 *   - **Ids that are not uuid.** If the host keys users by bigint or text,
 *     change the three `user_id` columns here and in the migration to match.
 *     Nothing else in the module cares what the type is; it passes ids
 *     through as strings.
 *
 * If the host would rather keep the module at arm's length, drop the three
 * foreign keys from the migration. The module keeps working, and the cost is
 * that deleting a person leaves their progress rows behind — which is a real
 * cost under most privacy regimes, so prefer the foreign keys.
 */
export const HOST_USERS_TABLE = 'users';
/*
 * A declared reference rather than a Drizzle relation, because the host owns
 * that table and this module must not define it: two definitions of one table
 * in one application is how a migration ends up dropping somebody's column.
 */
const hostUserId = (column) => uuid(column)
    .notNull()
    .references(() => hostUsers.id, { onDelete: 'cascade' });
/** A stub standing in for the host's table, for the foreign key only. */
const hostUsers = pgTable(HOST_USERS_TABLE, {
    id: uuid('id').primaryKey(),
});
export const lmsCohortStatus = pgEnum('lms_cohort_status', ['planned', 'active', 'archived']);
export const lmsCourseStatus = pgEnum('lms_course_status', ['draft', 'published', 'archived']);
export const lmsCourseLevel = pgEnum('lms_course_level', ['foundation', 'intermediate', 'advanced']);
export const lmsLessonKind = pgEnum('lms_lesson_kind', ['video', 'reading', 'assignment']);
export const lmsBodyFormat = pgEnum('lms_body_format', ['html', 'markdown']);
export const lmsProgressStatus = pgEnum('lms_progress_status', ['in_progress', 'completed']);
export const lmsVideoStatus = pgEnum('lms_video_status', ['none', 'uploading', 'processing', 'ready', 'error']);
const timestamps = {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};
/* --------------------------------------------------------------- cohorts */
/**
 * A group of learners taken through courses together.
 *
 * Cohorts are the entitlement mechanism, not a reporting convenience: a
 * learner can open a course only through a cohort it has been released to.
 * See `services/enrolment.ts`.
 */
export const cohorts = pgTable('lms_cohorts', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    status: lmsCohortStatus('status').notNull().default('planned'),
    startsOn: timestamp('starts_on', { withTimezone: true }),
    endsOn: timestamp('ends_on', { withTimezone: true }),
    ...timestamps,
}, (t) => [uniqueIndex('lms_cohorts_slug_key').on(t.slug)]);
export const cohortMembers = pgTable('lms_cohort_members', {
    cohortId: uuid('cohort_id')
        .notNull()
        .references(() => cohorts.id, { onDelete: 'cascade' }),
    userId: hostUserId('user_id'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    primaryKey({ columns: [t.cohortId, t.userId] }),
    index('lms_cohort_members_user_idx').on(t.userId),
]);
/* --------------------------------------------------------------- courses */
export const courses = pgTable('lms_courses', {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    /** One line under the title. A course is sold on its subtitle. */
    subtitle: text('subtitle'),
    summary: text('summary'),
    description: text('description'),
    coverImageUrl: text('cover_image_url'),
    status: lmsCourseStatus('status').notNull().default('draft'),
    estimatedMinutes: integer('estimated_minutes'),
    /*
     * What a learner needs in order to decide whether a course is for them.
     * Lists rather than prose, because that is how they are read: somebody
     * deciding whether to start scans outcomes, they do not read a paragraph.
     * Stored as jsonb arrays of plain strings — a table of one-line strings
     * per course would buy a join and no query anybody wants to write.
     */
    level: lmsCourseLevel('level').notNull().default('foundation'),
    /** Written out ("English", "Português") rather than a code: it is shown. */
    language: text('language').notNull().default('English'),
    audience: text('audience'),
    /** What a learner will be able to do at the end. */
    outcomes: jsonb('outcomes').$type().notNull().default([]),
    /** What they should have done first. Empty means none, and says so. */
    prerequisites: jsonb('prerequisites').$type().notNull().default([]),
    /** Subjects covered, for browsing and for search. */
    topics: jsonb('topics').$type().notNull().default([]),
    createdBy: uuid('created_by'),
    ...timestamps,
}, (t) => [
    uniqueIndex('lms_courses_slug_key').on(t.slug),
    index('lms_courses_status_idx').on(t.status),
]);
/** The entitlement edge: a learner opens a course only through their cohort. */
export const cohortCourses = pgTable('lms_cohort_courses', {
    cohortId: uuid('cohort_id')
        .notNull()
        .references(() => cohorts.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
        .notNull()
        .references(() => courses.id, { onDelete: 'cascade' }),
    /** Null means available now. A future date means not yet. */
    availableFrom: timestamp('available_from', { withTimezone: true }),
    position: integer('position').notNull().default(0),
}, (t) => [
    primaryKey({ columns: [t.cohortId, t.courseId] }),
    index('lms_cohort_courses_course_idx').on(t.courseId),
]);
export const modules = pgTable('lms_modules', {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
        .notNull()
        .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary'),
    position: integer('position').notNull().default(0),
    ...timestamps,
}, (t) => [index('lms_modules_course_idx').on(t.courseId, t.position)]);
export const lessons = pgTable('lms_lessons', {
    id: uuid('id').primaryKey().defaultRandom(),
    moduleId: uuid('module_id')
        .notNull()
        .references(() => modules.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    kind: lmsLessonKind('kind').notNull().default('video'),
    body: text('body'),
    /**
     * How `body` should be read. Stored rather than assumed, so a host
     * importing existing HTML lessons alongside new Markdown ones does not
     * have to convert them or watch the old ones render their own tags.
     *
     * Whichever it is, the module never injects it: `body` is returned as
     * data and the host renders it. Markdown should be rendered to elements
     * rather than to HTML, and HTML should be sanitised, or a lesson author
     * can put a script tag in front of a cohort.
     */
    bodyFormat: lmsBodyFormat('body_format').notNull().default('markdown'),
    /** The three or four things to take away. */
    keyPoints: jsonb('key_points').$type().notNull().default([]),
    /** Questions to sit with. Not marked. */
    reflectionQuestions: jsonb('reflection_questions').$type().notNull().default([]),
    /** What to tell somebody deciding whether they have time for this now. */
    estimatedMinutes: integer('estimated_minutes'),
    /**
     * An opaque reference for the host's video provider, and the state the
     * host last reported. The module stores and returns these; it never calls
     * a provider. See `VideoPort` in `ports.ts`.
     */
    videoRef: text('video_ref'),
    videoStatus: lmsVideoStatus('video_status').notNull().default('none'),
    videoDurationSeconds: integer('video_duration_seconds'),
    videoThumbnailUrl: text('video_thumbnail_url'),
    position: integer('position').notNull().default(0),
    isPublished: boolean('is_published').notNull().default(false),
    ...timestamps,
}, (t) => [
    index('lms_lessons_module_idx').on(t.moduleId, t.position),
    uniqueIndex('lms_lessons_module_slug_key').on(t.moduleId, t.slug),
]);
/**
 * Study resources. `objectKey` is whatever the host's storage calls a file —
 * an S3 or R2 key, a path, an id. The module stores it and hands it to
 * `StoragePort.signedUrl()`; it never serves a file itself.
 */
export const lessonAttachments = pgTable('lms_lesson_attachments', {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
        .notNull()
        .references(() => lessons.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('lms_lesson_attachments_lesson_idx').on(t.lessonId)]);
/* -------------------------------------------------------------- progress */
export const lessonProgress = pgTable('lms_lesson_progress', {
    userId: hostUserId('user_id'),
    lessonId: uuid('lesson_id')
        .notNull()
        .references(() => lessons.id, { onDelete: 'cascade' }),
    status: lmsProgressStatus('status').notNull().default('in_progress'),
    secondsWatched: integer('seconds_watched').notNull().default(0),
    lastPositionSeconds: integer('last_position_seconds').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    primaryKey({ columns: [t.userId, t.lessonId] }),
    index('lms_lesson_progress_lesson_idx').on(t.lessonId),
]);
/* ----------------------------------------------------------- assessments */
export const quizzes = pgTable('lms_quizzes', {
    id: uuid('id').primaryKey().defaultRandom(),
    lessonId: uuid('lesson_id')
        .notNull()
        .references(() => lessons.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    instructions: text('instructions'),
    /** Percent. A score at or above this passes. */
    passingScore: integer('passing_score').notNull().default(80),
    /** Zero means unlimited. */
    maxAttempts: integer('max_attempts').notNull().default(3),
    ...timestamps,
}, (t) => [uniqueIndex('lms_quizzes_lesson_key').on(t.lessonId)]);
export const quizQuestions = pgTable('lms_quiz_questions', {
    id: uuid('id').primaryKey().defaultRandom(),
    quizId: uuid('quiz_id')
        .notNull()
        .references(() => quizzes.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    /** Shown after an attempt, not before. */
    explanation: text('explanation'),
    position: integer('position').notNull().default(0),
}, (t) => [index('lms_quiz_questions_quiz_idx').on(t.quizId, t.position)]);
export const quizOptions = pgTable('lms_quiz_options', {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
        .notNull()
        .references(() => quizQuestions.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    isCorrect: boolean('is_correct').notNull().default(false),
    position: integer('position').notNull().default(0),
}, (t) => [index('lms_quiz_options_question_idx').on(t.questionId, t.position)]);
export const quizAttempts = pgTable('lms_quiz_attempts', {
    id: uuid('id').primaryKey().defaultRandom(),
    quizId: uuid('quiz_id')
        .notNull()
        .references(() => quizzes.id, { onDelete: 'cascade' }),
    userId: hostUserId('user_id'),
    /** Percent, rounded. */
    score: integer('score').notNull(),
    passed: boolean('passed').notNull(),
    /** questionId -> chosen optionId, kept so results can be reviewed. */
    answers: jsonb('answers').$type().notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('lms_quiz_attempts_user_idx').on(t.userId, t.quizId)]);
