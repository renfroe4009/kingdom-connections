/**
 * Cohorts, membership, and the one rule the whole module turns on.
 *
 * **A learner may open a course only through a cohort they belong to, which
 * that course has been released to, on or after its release date.** Four
 * conditions, all of them easy to leave out, and leaving any of them out
 * shows somebody coursework they have not been given. It is answered here,
 * once, by `entitlement()`, and every other service asks this one rather than
 * rebuilding the join — a screen added later cannot widen access by
 * forgetting a condition it never knew about.
 *
 * Instructors and admins are not exempt by accident: they are exempt
 * deliberately, because they author and mark the material. That exemption is
 * stated in one place too.
 */
import { hasAtLeast } from '../ports.js';
import { LmsConflict, LmsForbidden, LmsInvalid, LmsNotFound } from '../errors.js';
import { emit } from '../context.js';
import { uniqueSlug } from '../slug.js';
/**
 * The decision, as a pure function over facts.
 *
 * Separated from the queries so it can be read in one screen and checked
 * without a database. The four conditions are all here; `entitlement()` does
 * nothing but fetch the facts and call this.
 */
export function decideEntitlement(input) {
    if (!input.course)
        return { allowed: false, reason: 'no_such_course' };
    /*
     * The staff bypass is checked after the releases are known rather than
     * before, because the cohort ids are still wanted: an instructor looking
     * at a course they are also enrolled on should see their own progress.
     */
    if (input.isStaff) {
        return { allowed: true, reason: 'staff', cohortIds: input.releases.map((row) => row.cohortId) };
    }
    if (input.course.status !== 'published')
        return { allowed: false, reason: 'not_published' };
    if (input.releases.length === 0)
        return { allowed: false, reason: 'not_enrolled' };
    const open = input.releases.filter((row) => row.availableFrom === null || row.availableFrom <= input.now);
    if (open.length === 0) {
        /*
         * Several cohorts may hold the same course with different dates. The
         * soonest is the one to report — telling somebody about a later date
         * when an earlier one exists is simply wrong.
         */
        const soonest = input.releases
            .map((row) => row.availableFrom)
            .filter((date) => date !== null)
            .sort((a, b) => a.getTime() - b.getTime())[0];
        return { allowed: false, reason: 'not_yet', availableFrom: soonest };
    }
    return { allowed: true, reason: 'cohort', cohortIds: open.map((row) => row.cohortId) };
}
/**
 * Whether this viewer may open this course, and why.
 *
 * Returns the reason rather than a boolean because the screens need it: "not
 * yet, opens on the 14th" and "you are not enrolled on this" are different
 * things to tell somebody, and a caller that only has `false` has to guess
 * or run the query again.
 */
export async function entitlement(context, courseId) {
    const { store, viewer, clock } = context;
    const course = await store.findCourseById(courseId);
    if (!course)
        return { allowed: false, reason: 'no_such_course' };
    const releases = await store.releasesFor(viewer.id, courseId);
    return decideEntitlement({
        course,
        releases,
        isStaff: hasAtLeast(viewer, 'instructor'),
        now: clock.now(),
    });
}
/** Throws unless the viewer may open the course. For callers that need it. */
export async function requireEntitlement(context, courseId) {
    const result = await entitlement(context, courseId);
    if (result.allowed)
        return result;
    if (result.reason === 'no_such_course')
        throw new LmsNotFound('No such course.');
    if (result.reason === 'not_yet') {
        throw new LmsForbidden(`This course opens on ${result.availableFrom.toISOString().slice(0, 10)}.`);
    }
    /*
     * "Not published" and "not enrolled" both answer the same way on purpose.
     * Telling somebody a course exists but is not released to them is telling
     * them something about a course they have no business knowing about.
     */
    throw new LmsForbidden('This course has not been released to you.');
}
export async function listCohorts(context) {
    if (!hasAtLeast(context.viewer, 'instructor'))
        throw new LmsForbidden('Cohorts are staff only.');
    return context.store.listCohortsWithCounts();
}
export async function createCohort(context, input) {
    if (!hasAtLeast(context.viewer, 'admin'))
        throw new LmsForbidden('Only an administrator creates cohorts.');
    const name = input.name.replace(/\s+/g, ' ').trim();
    if (name.length < 2)
        throw new LmsInvalid('A cohort needs a name.');
    if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) {
        throw new LmsInvalid('A cohort cannot end before it starts.');
    }
    const slug = await uniqueSlug(name, (candidate) => context.store.cohortSlugExists(candidate));
    const id = context.store.newId();
    await context.store.insertCohort({
        id,
        name,
        slug,
        description: input.description?.trim() || null,
        status: 'planned',
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
    });
    return { id, slug };
}
/**
 * Adds somebody to a cohort.
 *
 * Idempotent: adding a person who is already a member is not an error,
 * because the caller is usually a form somebody submitted twice, and the
 * second submission should not show them a failure for a thing that is true.
 */
export async function addMember(context, cohortId, userId) {
    if (!hasAtLeast(context.viewer, 'admin'))
        throw new LmsForbidden('Only an administrator changes membership.');
    const cohort = await context.store.findCohortById(cohortId);
    if (!cohort)
        throw new LmsNotFound('No such cohort.');
    await context.store.addCohortMember(cohortId, userId, context.clock.now());
}
export async function removeMember(context, cohortId, userId) {
    if (!hasAtLeast(context.viewer, 'admin'))
        throw new LmsForbidden('Only an administrator changes membership.');
    await context.store.removeCohortMember(cohortId, userId);
}
/**
 * Releases a course to a cohort, optionally from a date.
 *
 * This is the write that grants access, so it is the one to read closely. A
 * course that is not published can be attached — authors line up a term
 * before publishing — but `entitlement()` still refuses it to learners until
 * it is, which is why that check lives there and not here.
 */
export async function releaseCourse(context, input) {
    if (!hasAtLeast(context.viewer, 'admin'))
        throw new LmsForbidden('Only an administrator releases courses.');
    const cohort = await context.store.findCohortById(input.cohortId);
    if (!cohort)
        throw new LmsNotFound('No such cohort.');
    if (cohort.status === 'archived')
        throw new LmsConflict('That cohort is archived.');
    const course = await context.store.findCourseById(input.courseId);
    if (!course)
        throw new LmsNotFound('No such course.');
    await context.store.upsertRelease({
        cohortId: input.cohortId,
        courseId: input.courseId,
        availableFrom: input.availableFrom ?? null,
        position: input.position ?? 0,
    });
    /*
     * Only tell people about a course they can open now. A release dated three
     * weeks out that announces itself today is a notification about nothing,
     * and the learner who follows it finds a locked page.
     */
    if (!input.availableFrom || input.availableFrom <= context.clock.now()) {
        for (const userId of await context.store.cohortMemberIds(input.cohortId)) {
            emit(context, {
                kind: 'course.released',
                userId,
                courseId: course.id,
                courseTitle: course.title,
            });
        }
    }
}
export async function withdrawCourse(context, cohortId, courseId) {
    if (!hasAtLeast(context.viewer, 'admin'))
        throw new LmsForbidden('Only an administrator withdraws courses.');
    await context.store.deleteRelease(cohortId, courseId);
}
/** The cohorts a person is in. Their own, or anybody's if staff. */
export async function cohortsFor(context, userId) {
    if (userId !== context.viewer.id && !hasAtLeast(context.viewer, 'instructor')) {
        throw new LmsForbidden('You can only see your own cohorts.');
    }
    return context.store.cohortsForUser(userId);
}
/**
 * The course ids a learner is entitled to right now.
 *
 * One query rather than `entitlement()` per course, for the list screens.
 * The conditions are the same four, and the probe checks the two paths agree
 * — two implementations of one access rule is exactly how they drift apart.
 */
export async function entitledCourseIds(context) {
    const { store, viewer, clock } = context;
    if (hasAtLeast(viewer, 'instructor'))
        return store.allCourseIds();
    return store.openCourseIdsFor(viewer.id, clock.now());
}
