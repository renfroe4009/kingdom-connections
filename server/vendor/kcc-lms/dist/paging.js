/** Page arithmetic, shared by every list the module returns. */
export const PAGE_SIZE = 24;
export function readPage(raw) {
    const page = typeof raw === 'number' ? raw : Number.parseInt(raw ?? '1', 10);
    return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}
/**
 * Clamps a requested page to one that exists.
 *
 * A page past the end returns the last page rather than an empty list: a
 * learner who had page four open when a course was unpublished should see
 * courses, not a blank screen.
 */
export function paging(total, requested, size = PAGE_SIZE) {
    const pages = Math.max(1, Math.ceil(total / size));
    const page = Math.min(Math.max(1, requested), pages);
    const offset = (page - 1) * size;
    return { page, pages, offset, from: total === 0 ? 0 : offset + 1, to: Math.min(offset + size, total) };
}
