/**
 * What the module needs from the application it is merged into.
 *
 * This file is the whole integration surface. Everything the module cannot
 * know about a host — who is signed in, what a role means, where files live,
 * who sends notifications, what time it is — arrives through here, so the
 * services never import a framework, a session library or a storage client.
 *
 * Three of the five ports are optional. A host can be up and running with a
 * database handle and a viewer, and add the rest when it wants video,
 * attachments or notifications.
 */

/**
 * The person making the request, as the host already understands them.
 *
 * `id` must be the host's own user id — the module stores it and declares a
 * foreign key to the host's user table. `role` is the module's own three-way
 * split, which the host maps onto whatever it uses: see `asViewer()` below.
 *
 * There is no `email` or `name` here on purpose. The module never emails
 * anybody and never renders a person's name, so asking for them would be
 * asking the host to hand over personal data for no reason.
 */
export type Viewer = {
  id: string;
  role: LmsRole;
};

/**
 * What a person may do, in the only three gradations the module needs.
 *
 *   - `learner` — sees the courses released to their cohorts, records
 *     progress, sits assessments.
 *   - `instructor` — all of that, plus authoring and marking: creating
 *     courses, modules, lessons and quizzes, and seeing cohort progress.
 *   - `admin` — all of that, plus cohorts and membership.
 *
 * A host with richer roles maps them down. A host with only "user" and
 * "staff" maps staff to `admin` and everybody else to `learner`, and the
 * instructor tier simply goes unused.
 */
export type LmsRole = 'learner' | 'instructor' | 'admin';

const RANK: Record<LmsRole, number> = { learner: 0, instructor: 1, admin: 2 };

/** Whether a viewer holds at least this much authority. */
export function hasAtLeast(viewer: Viewer, role: LmsRole): boolean {
  return RANK[viewer.role] >= RANK[role];
}

/**
 * Maps a host's own role onto the module's.
 *
 * Supplied as a convenience for the common shapes. A host whose roles do not
 * resemble these should write its own mapping rather than bend to this one —
 * it is four lines either way, and a wrong mapping here is an authorisation
 * bug, which is the one kind this module cannot catch for the host.
 */
export function asViewer(id: string, hostRole: string): Viewer {
  const role = hostRole.trim().toLowerCase();
  if (['admin', 'administrator', 'owner', 'superuser', 'staff'].includes(role)) {
    return { id, role: 'admin' };
  }
  if (['instructor', 'teacher', 'facilitator', 'leader', 'coach', 'mentor'].includes(role)) {
    return { id, role: 'instructor' };
  }
  return { id, role: 'learner' };
}

/**
 * Where lesson attachments live.
 *
 * The module stores an opaque `objectKey` per attachment and asks for a URL
 * when a learner who is entitled to the lesson opens it. It never holds a
 * bucket credential and never streams a file, so a host can back this with
 * S3, R2, GCS, a CDN or its own route handler without the module changing.
 *
 * `expiresInSeconds` is a request, not a guarantee. Return a URL that works
 * for roughly that long; a host serving through its own authenticated route
 * can ignore it and return a plain path.
 */
export type StoragePort = {
  signedUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  /** Called when an attachment row is deleted. Optional: a host may keep files. */
  remove?(objectKey: string): Promise<void>;
};

/**
 * How a lesson video is played.
 *
 * Same shape and same reason as storage. The module stores `videoRef` —
 * whatever the host's provider calls a video — and asks for what the player
 * needs when an entitled learner opens the lesson. Returning a signed token
 * rather than a URL is supported because that is how Cloudflare Stream and
 * Mux both work; a host serving plain files returns a `url` instead.
 */
export type VideoPort = {
  playback(videoRef: string): Promise<{ url?: string; token?: string; poster?: string }>;
};

/**
 * Told when something happens that a person would want to know about.
 *
 * Deliberately fire-and-forget and deliberately not awaited by the services
 * that raise it: a notification provider being down must not roll back a
 * learner's progress or lose their quiz attempt. Throwing from here is safe;
 * it is caught and swallowed.
 */
export type NotifierPort = {
  notify(event: LmsEvent): Promise<void> | void;
};

export type LmsEvent =
  | { kind: 'course.released'; userId: string; courseId: string; courseTitle: string }
  | { kind: 'lesson.completed'; userId: string; lessonId: string; lessonTitle: string }
  | { kind: 'course.completed'; userId: string; courseId: string; courseTitle: string }
  | { kind: 'quiz.passed'; userId: string; quizId: string; score: number }
  | { kind: 'quiz.failed'; userId: string; quizId: string; score: number; attemptsLeft: number };

/**
 * The clock.
 *
 * Injectable because two of the module's rules are time-dependent — a course
 * released with a future `availableFrom`, and a cohort that has ended — and a
 * rule that can only be tested by waiting is a rule that does not get tested.
 * Defaults to the real clock.
 */
export type ClockPort = { now(): Date };

export const systemClock: ClockPort = { now: () => new Date() };

export type LmsPorts = {
  storage?: StoragePort;
  video?: VideoPort;
  notifier?: NotifierPort;
  clock?: ClockPort;
};
