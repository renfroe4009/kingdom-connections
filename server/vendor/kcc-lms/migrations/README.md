# Migrations

Two directories, one per engine. They create the same thirteen tables.

    migrations/postgres/0001_lms.sql     PostgreSQL 13+
    migrations/mysql/0001_lms.sql        MySQL 8.0.4+ (or MariaDB 10.6+)

Both are plain SQL and idempotent, so they can be applied by whatever the
host already uses — Drizzle, Prisma's `migrate --create-only`, Flyway,
Liquibase, Rails, `psql`, `mysql` — or from a boot hook.

    psql "$DATABASE_URL" -f migrations/postgres/0001_lms.sql
    mysql "$DATABASE" < migrations/mysql/0001_lms.sql

Or through the bundled runner, which does the same and nothing else:

    ENGINE=mysql DATABASE_URL=mysql://... npm run db:migrate

**If you apply the MySQL file with your own tooling, check how it splits
statements.** MySQL will not take several in one call unless the connection
asks for it, and a naive split on `;` puts the opening comment block and the
first `create table` in the same chunk — which, if chunks starting with `--`
are skipped as comments, silently skips the first table. That failure then
surfaces four tables later as a foreign key pointing at something that does
not exist. `scripts/split-sql.ts` does it correctly and is five lines to copy.

## What to change if your schema differs

### Your user table

Three columns reference the host's user table as `users (id)`:

    lms_cohort_members.user_id
    lms_lesson_progress.user_id
    lms_quiz_attempts.user_id

If your table has another name, or keys people by `bigint`/`text` rather
than a UUID, edit those three columns and their `references` clauses — and
the matching `user_id` columns in `src/schema/{pg,mysql}.ts` if you use the
Drizzle definitions. Nothing else in the module reaches outside itself.

Dropping those three foreign keys also works and keeps the module running.
The cost is that deleting a person leaves their progress and attempts behind,
which is a real problem under most privacy regimes — so prefer keeping them.

### MySQL only: the connection must be in UTC

`TIMESTAMP` converts to and from the session's time zone, so a connection in
any other zone reads back a different instant than it wrote. For mysql2 that
is `timezone: 'Z'`. This is not a preference: it is the difference between a
course release date that opens a course when it should and one that opens it
hours early, with nothing in the data to show why.

### MySQL only: version floors

`JSON_TABLE` needs MySQL 8.0.4+ or MariaDB 10.6+, and only the topic facet
(`catalogueFacets`) uses it. On MySQL 5.7 there is no way to unnest a JSON
array in SQL, so that one filter control has to go rather than be worked
around — everything else in the module runs on 5.7.

## Rolling back

There is no down migration, on purpose: the only honest one drops thirteen
tables and everybody's coursework with them. To remove the module from a
database, write that drop deliberately, against a backup you have restored
once to prove it works.
