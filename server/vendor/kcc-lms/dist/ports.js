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
const RANK = { learner: 0, instructor: 1, admin: 2 };
/** Whether a viewer holds at least this much authority. */
export function hasAtLeast(viewer, role) {
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
export function asViewer(id, hostRole) {
    const role = hostRole.trim().toLowerCase();
    if (['admin', 'administrator', 'owner', 'superuser', 'staff'].includes(role)) {
        return { id, role: 'admin' };
    }
    if (['instructor', 'teacher', 'facilitator', 'leader', 'coach', 'mentor'].includes(role)) {
        return { id, role: 'instructor' };
    }
    return { id, role: 'learner' };
}
export const systemClock = { now: () => new Date() };
