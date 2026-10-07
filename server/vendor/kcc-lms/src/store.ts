/**
 * Every database operation the module performs, in domain terms.
 *
 * This interface exists so the services — where all the rules live — are
 * written once and do not know which database is underneath. One
 * implementation satisfies it for both PostgreSQL and MySQL
 * (`stores/drizzle.ts`), with the handful of genuine dialect differences
 * isolated in `stores/dialect.ts`.
 *
 * Two copies of the services, one per dialect, was the obvious alternative
 * and is rejected: the rules here are the product, and two copies of a rule
 * is one rule that is about to be wrong on one engine. What keeps the two
 * stores honest is that the whole probe suite runs against both.
 *
 * It is also the seam for a host that does not use Drizzle. Implement this —
 * forty-odd methods, none of them clever — against Prisma, Kysely or raw SQL
 * and every rule in the module comes with it, unchanged.
 *
 * **Nothing in here enforces access.** A store method does what it says and
 * no more; it is the services that decide who may call it. A store that
 * filtered by viewer would be a second place where entitlement is decided,
 * which is the one thing this module is built to avoid.
 */

export type CourseStatus = 'draft' | 'published' | 'archived';
export type CourseLevel = 'foundation' | 'intermediate' | 'advanced';
export type CohortStatus = 'planned' | 'active' | 'archived';
export type LessonKind = 'video' | 'reading' | 'assignment';
export type BodyFormat = 'html' | 'markdown';
export type ProgressState = 'in_progress' | 'completed';
export type VideoState = 'none' | 'uploading' | 'processing' | 'ready' | 'error';

export type CourseRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  description: string | null;
  coverImageUrl: string | null;
  status: CourseStatus;
  estimatedMinutes: number | null;
  level: CourseLevel;
  language: string;
  audience: string | null;
  outcomes: string[];
  prerequisites: string[];
  topics: string[];
  createdBy: string | null;
};

export type CohortRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: CohortStatus;
  startsOn: Date | null;
  endsOn: Date | null;
};

export type CohortWithCounts = CohortRow & { memberCount: number; courseCount: number };

/** One release of one course to one cohort the learner is in. */
export type ReleaseRow = { cohortId: string; availableFrom: Date | null };

export type ShelfRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  coverImageUrl: string | null;
  cohortName: string | null;
  availableFrom: Date | null;
  position: number;
};

/** A row of the course outline: a module, and a lesson under it if any. */
export type OutlineRow = {
  moduleId: string;
  moduleTitle: string;
  moduleSummary: string | null;
  modulePosition: number;
  lessonId: string | null;
  lessonSlug: string | null;
  lessonTitle: string | null;
  lessonSummary: string | null;
  lessonKind: LessonKind | null;
  lessonMinutes: number | null;
  lessonPosition: number | null;
  isPublished: boolean | null;
  hasQuiz: boolean;
  completedAt: Date | null;
};

export type LessonRow = {
  id: string;
  moduleId: string;
  slug: string;
  title: string;
  summary: string | null;
  kind: LessonKind;
  body: string | null;
  bodyFormat: BodyFormat;
  keyPoints: string[];
  reflectionQuestions: string[];
  estimatedMinutes: number | null;
  videoRef: string | null;
  videoStatus: VideoState;
  videoDurationSeconds: number | null;
  videoThumbnailUrl: string | null;
  position: number;
  isPublished: boolean;
};

export type LessonInContext = {
  lesson: LessonRow;
  moduleTitle: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
};

export type ProgressRow = {
  status: ProgressState;
  secondsWatched: number;
  lastPositionSeconds: number;
  completedAt: Date | null;
};

export type AttachmentRow = {
  id: string;
  label: string;
  objectKey: string;
  contentType: string | null;
  sizeBytes: number | null;
};

export type QuizRow = {
  id: string;
  lessonId: string;
  title: string;
  instructions: string | null;
  passingScore: number;
  maxAttempts: number;
};

/** A question with its options, and deliberately no correctness. */
export type PaperQuestion = {
  id: string;
  prompt: string;
  options: { id: string; label: string }[];
};

export type ScoringQuestion = { id: string; prompt: string; explanation: string | null };
export type ScoringOption = { id: string; questionId: string; isCorrect: boolean };

export type AttemptRow = { id: string; score: number; passed: boolean; submittedAt: Date };

export type EditableQuiz = QuizRow & {
  questions: {
    id: string;
    prompt: string;
    explanation: string | null;
    options: { id: string; label: string; isCorrect: boolean }[];
  }[];
};

export type CatalogueRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  coverImageUrl: string | null;
  level: CourseLevel;
  language: string;
  topics: string[];
  outcomes: string[];
  estimatedMinutes: number | null;
};

export type CatalogueQuery = {
  query?: string;
  level?: CourseLevel;
  language?: string;
  topic?: string;
  limit: number;
  offset: number;
};

export type Facets = {
  levels: { value: string; count: number }[];
  languages: { value: string; count: number }[];
  topics: { value: string; count: number }[];
};

export type NewCourse = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  description: string | null;
  coverImageUrl: string | null;
  level: CourseLevel;
  language: string;
  audience: string | null;
  outcomes: string[];
  prerequisites: string[];
  topics: string[];
  estimatedMinutes: number | null;
  createdBy: string | null;
};

export type NewLesson = {
  id: string;
  moduleId: string;
  slug: string;
  title: string;
  summary: string | null;
  kind: LessonKind;
  body: string | null;
  bodyFormat: BodyFormat;
  keyPoints: string[];
  reflectionQuestions: string[];
  estimatedMinutes: number | null;
  videoRef: string | null;
  videoStatus: VideoState;
  position: number;
};

export type QuizDraft = {
  id: string;
  lessonId: string;
  title: string;
  instructions: string | null;
  passingScore: number;
  maxAttempts: number;
  questions: {
    id: string;
    prompt: string;
    explanation: string | null;
    options: { id: string; label: string; isCorrect: boolean; position: number }[];
  }[];
};

export type Store = {
  /** A fresh id, in whatever form the dialect's key column takes. */
  newId(): string;

  /* ------------------------------------------------------------- courses */
  findCourseById(id: string): Promise<CourseRow | null>;
  findCourseBySlug(slug: string): Promise<CourseRow | null>;
  courseSlugExists(slug: string): Promise<boolean>;
  allCourseIds(): Promise<string[]>;
  insertCourse(course: NewCourse): Promise<void>;
  updateCourse(id: string, patch: Partial<NewCourse> & { updatedAt: Date }): Promise<number>;
  setCourseStatus(id: string, status: CourseStatus, updatedAt: Date): Promise<number>;
  countPublishedLessons(courseId: string): Promise<number>;

  /* ------------------------------------------------------------- cohorts */
  listCohortsWithCounts(): Promise<CohortWithCounts[]>;
  findCohortById(id: string): Promise<CohortRow | null>;
  cohortSlugExists(slug: string): Promise<boolean>;
  insertCohort(cohort: CohortRow): Promise<void>;
  addCohortMember(cohortId: string, userId: string, joinedAt: Date): Promise<void>;
  removeCohortMember(cohortId: string, userId: string): Promise<void>;
  cohortMemberIds(cohortId: string): Promise<string[]>;
  cohortsForUser(userId: string): Promise<{ id: string; name: string }[]>;

  /* --------------------------------------------------------- entitlement */
  /** Releases of one course to the cohorts this person is in. */
  releasesFor(userId: string, courseId: string): Promise<ReleaseRow[]>;
  /** Published courses released to this person and open at `now`. */
  openCourseIdsFor(userId: string, now: Date): Promise<string[]>;
  upsertRelease(release: {
    cohortId: string;
    courseId: string;
    availableFrom: Date | null;
    position: number;
  }): Promise<void>;
  deleteRelease(cohortId: string, courseId: string): Promise<void>;

  /* ------------------------------------------------------------ learning */
  shelfFor(userId: string): Promise<ShelfRow[]>;
  /** Published lesson count and this person's completions, per course. */
  progressCounts(
    userId: string,
    courseIds: string[],
  ): Promise<Map<string, { lessonCount: number; completedCount: number }>>;
  outlineFor(courseId: string, userId: string): Promise<OutlineRow[]>;
  findLessonById(id: string): Promise<LessonInContext | null>;
  findLessonBySlug(courseSlug: string, lessonSlug: string): Promise<LessonInContext | null>;
  lessonSequence(courseId: string): Promise<{ id: string; slug: string; isPublished: boolean }[]>;
  attachmentsFor(lessonId: string): Promise<AttachmentRow[]>;

  /* ------------------------------------------------------------- modules */
  moduleExists(id: string): Promise<boolean>;
  nextModulePosition(courseId: string): Promise<number>;
  insertModule(module: {
    id: string;
    courseId: string;
    title: string;
    summary: string | null;
    position: number;
  }): Promise<void>;
  updateModule(
    id: string,
    patch: { title?: string; summary?: string | null; position?: number; updatedAt: Date },
  ): Promise<number>;
  deleteModule(id: string): Promise<void>;

  /* ------------------------------------------------------------- lessons */
  lessonSlugExistsInModule(moduleId: string, slug: string): Promise<boolean>;
  nextLessonPosition(moduleId: string): Promise<number>;
  insertLesson(lesson: NewLesson): Promise<void>;
  updateLesson(id: string, patch: Partial<NewLesson> & { isPublished?: boolean; updatedAt: Date }): Promise<number>;
  deleteLesson(id: string): Promise<void>;
  /** Returns how many rows matched, so a stray callback can be reported. */
  updateVideoByRef(
    videoRef: string,
    state: { status: VideoState; durationSeconds: number | null; thumbnailUrl: string | null; updatedAt: Date },
  ): Promise<number>;

  /* --------------------------------------------------------- attachments */
  insertAttachment(attachment: AttachmentRow & { lessonId: string; createdAt: Date }): Promise<void>;
  findAttachment(id: string): Promise<{ id: string; objectKey: string } | null>;
  deleteAttachment(id: string): Promise<void>;

  /* ------------------------------------------------------------ progress */
  findProgress(userId: string, lessonId: string): Promise<ProgressRow | null>;
  /** Raises `secondsWatched` and sets the resume point. Never un-completes. */
  recordWatched(input: {
    userId: string;
    lessonId: string;
    secondsWatched: number;
    lastPositionSeconds: number;
    at: Date;
  }): Promise<void>;
  /** Marks complete, keeping the first completion date if there is one. */
  markCompleted(userId: string, lessonId: string, at: Date): Promise<void>;
  clearCompletion(userId: string, lessonId: string, at: Date): Promise<void>;

  /* ---------------------------------------------------------- assessment */
  findQuizById(id: string): Promise<(QuizRow & { courseId: string; lessonPublished: boolean }) | null>;
  findQuizByLesson(lessonId: string): Promise<QuizRow | null>;
  /** The paper, with no correctness in it. */
  paperFor(quizId: string): Promise<PaperQuestion[]>;
  scoringQuestions(quizId: string): Promise<ScoringQuestion[]>;
  scoringOptions(quizId: string): Promise<ScoringOption[]>;
  attemptsFor(quizId: string, userId: string): Promise<AttemptRow[]>;
  countAttempts(quizId: string, userId: string): Promise<number>;
  insertAttempt(attempt: {
    id: string;
    quizId: string;
    userId: string;
    score: number;
    passed: boolean;
    answers: Record<string, string>;
    submittedAt: Date;
  }): Promise<void>;
  /** Replaces a quiz and its questions wholesale, in one transaction. */
  replaceQuiz(draft: QuizDraft, at: Date): Promise<void>;
  deleteQuiz(id: string): Promise<void>;
  editableQuiz(lessonId: string): Promise<EditableQuiz | null>;

  /* ----------------------------------------------------------- catalogue */
  browseCourses(query: CatalogueQuery): Promise<{ rows: CatalogueRow[]; total: number }>;
  facets(): Promise<Facets>;
};
