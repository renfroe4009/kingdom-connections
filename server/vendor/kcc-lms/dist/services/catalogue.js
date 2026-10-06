/**
 * Browsing the published catalogue.
 *
 * This is the one read in the module that is not gated by entitlement, and
 * that is deliberate: a catalogue exists so somebody can see what is on offer
 * before they are enrolled on it. So it shows published courses only, and it
 * returns the describing fields — title, outcomes, level, length — and never
 * the material. A course card is an advertisement; the lessons are behind
 * `entitlement()`.
 *
 * `enrolled` on each card is the one personal fact here, so a signed-in
 * visitor can tell what they already have.
 */
import { paging, PAGE_SIZE } from '../paging.js';
import { entitledCourseIds } from './enrolment.js';
export async function browseCatalogue(context, filters = {}) {
    const size = filters.pageSize ?? PAGE_SIZE;
    const requested = paging(Number.MAX_SAFE_INTEGER, filters.page ?? 1, size);
    const query = {
        query: filters.query,
        level: filters.level,
        language: filters.language,
        topic: filters.topic,
        limit: size,
    };
    /*
     * Asked for at the offset requested, and asked again only if that page
     * turned out not to exist. The total is not known until the first answer
     * comes back, and a page past the end has to be clamped to one that does
     * exist — a learner who had page four open when a course was unpublished
     * should see courses, not a blank screen. Clamping before the count would
     * mean counting first and so two queries for every page, including the
     * first; this way the second one happens only when somebody is out of
     * range.
     */
    const firstPass = await context.store.browseCourses({ ...query, offset: requested.offset });
    const place = paging(firstPass.total, filters.page ?? 1, size);
    const rows = place.offset === requested.offset
        ? firstPass.rows
        : (await context.store.browseCourses({ ...query, offset: place.offset })).rows;
    const mine = new Set(await entitledCourseIds(context));
    const lessonCounts = await context.store.progressCounts(context.viewer.id, rows.map((row) => row.id));
    return {
        items: rows.map((row) => ({
            ...row,
            lessonCount: lessonCounts.get(row.id)?.lessonCount ?? 0,
            enrolled: mine.has(row.id),
        })),
        total: firstPass.total,
        ...place,
    };
}
/** The distinct values worth offering as filters, with how many each holds. */
export async function catalogueFacets(context) {
    return context.store.facets();
}
