/**
 * The handle a host passes to every service call.
 *
 * One object holding the store, the viewer and the ports, rather than
 * module-level state, because a server handles several people's requests at
 * once: a viewer kept in a module-level variable is a viewer that leaks from
 * one request into another, and that bug reads other people's coursework.
 */
import { systemClock } from './ports.js';
/**
 * Builds a context for one request.
 *
 * Call it per request, with the viewer resolved from the host's own session.
 * The store and the ports are configuration and are built once at startup;
 * only the viewer changes.
 */
export function lmsContext(input) {
    const ports = input.ports ?? {};
    return {
        store: input.store,
        viewer: input.viewer,
        ports,
        clock: ports.clock ?? systemClock,
    };
}
/**
 * Raises an event without letting it break the thing that raised it.
 *
 * Every caller is a write that has already succeeded. A notifier that throws,
 * hangs or is simply absent must not turn a recorded lesson completion into
 * an error the learner sees.
 */
export function emit(context, event) {
    const notifier = context.ports.notifier;
    if (!notifier)
        return;
    try {
        void Promise.resolve(notifier.notify(event)).catch(() => { });
    }
    catch {
        /* A notifier is never worth failing a write for. */
    }
}
