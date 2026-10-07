# Probes

Each probe runs against a real Postgres and checks one area. They are not
unit tests of functions; they are checks that the rules hold in the database,
because the rules *are* joins, unique indexes and upserts.

    createdb lms_probe
    DATABASE_URL=postgres://localhost/lms_probe npm run probe

Every probe creates a stand-in `users` table first and applies
`migrations/0001_lms.sql` to the database it is pointed at. **Point it at a
scratch database, not at anything you care about** — they delete their own
rows by tag on the way in and out, but the migration is applied for real.

## Why `probe-entitlement.ts` is the one to read

It checks the rule the whole module turns on: a learner reaches course
material only through a cohort they belong to, which that course has been
released to, on or after its release date. Four conditions, and leaving any
one of them out shows somebody else's coursework.

It checks that rule through **every** door into the material — the course
page, the lesson, the progress write, the quiz paper, the quiz submission —
because an access rule enforced on four screens out of five is not enforced.
Adding a sixth read of the material without adding it here is how that gets
lost, so add the door to the list in that file.
