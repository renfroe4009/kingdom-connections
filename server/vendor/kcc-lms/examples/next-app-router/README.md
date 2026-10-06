# Reference: Next.js App Router

**Copy these, don't import them.** They are here to show the shape of an
integration, not to be a dependency — the module itself has no framework in it
and should stay that way.

Three files:

- `lms.ts` — builds a context per request from your own session. This is the
  only file you really need; the rest follows from it.
- `page.tsx` — a server component rendering a learner's shelf.
- `route.ts` — a POST handler recording progress, and how to map the module's
  errors onto status codes.

If you are not on Next.js, `lms.ts` still shows the pattern: resolve the
viewer from your session, build the context, call the service.
