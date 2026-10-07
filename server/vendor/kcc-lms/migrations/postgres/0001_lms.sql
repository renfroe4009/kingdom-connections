-- The LMS module's tables.
--
-- Every table and type is prefixed `lms_` so this can be applied to a
-- database that already has an application in it without colliding with
-- anything. Idempotent throughout: applying it twice is a no-op, so it is
-- safe to run from a boot hook rather than a separate release step.
--
-- ONE THING TO CHECK BEFORE APPLYING. Three tables reference the host's own
-- user table, named here as `users (id)`:
--
--   lms_cohort_members.user_id
--   lms_lesson_progress.user_id
--   lms_quiz_attempts.user_id
--
-- If the host's table is called something else, or keys users by bigint or
-- text rather than uuid, change those three columns and their references.
-- They are the only lines in this file that touch anything outside the
-- module. See HOST_USERS_TABLE in src/schema.ts for the full note.

create extension if not exists "pgcrypto";

do $$ begin
  create type lms_cohort_status as enum ('planned', 'active', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lms_course_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lms_course_level as enum ('foundation', 'intermediate', 'advanced');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lms_lesson_kind as enum ('video', 'reading', 'assignment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lms_body_format as enum ('html', 'markdown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lms_progress_status as enum ('in_progress', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lms_video_status as enum ('none', 'uploading', 'processing', 'ready', 'error');
exception when duplicate_object then null; end $$;

create table if not exists lms_cohorts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null,
  description text,
  status      lms_cohort_status not null default 'planned',
  starts_on   timestamptz,
  ends_on     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists lms_cohorts_slug_key on lms_cohorts (slug);

create table if not exists lms_cohort_members (
  cohort_id uuid not null references lms_cohorts (id) on delete cascade,
  user_id   uuid not null references users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (cohort_id, user_id)
);
create index if not exists lms_cohort_members_user_idx on lms_cohort_members (user_id);

create table if not exists lms_courses (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null,
  title             text not null,
  subtitle          text,
  summary           text,
  description       text,
  cover_image_url   text,
  status            lms_course_status not null default 'draft',
  estimated_minutes integer,
  level             lms_course_level not null default 'foundation',
  language          text not null default 'English',
  audience          text,
  outcomes          jsonb not null default '[]'::jsonb,
  prerequisites     jsonb not null default '[]'::jsonb,
  topics            jsonb not null default '[]'::jsonb,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists lms_courses_slug_key on lms_courses (slug);
create index if not exists lms_courses_status_idx on lms_courses (status);

-- The entitlement edge. A learner reaches a course only through a row here.
create table if not exists lms_cohort_courses (
  cohort_id      uuid not null references lms_cohorts (id) on delete cascade,
  course_id      uuid not null references lms_courses (id) on delete cascade,
  available_from timestamptz,
  position       integer not null default 0,
  primary key (cohort_id, course_id)
);
create index if not exists lms_cohort_courses_course_idx on lms_cohort_courses (course_id);

create table if not exists lms_modules (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references lms_courses (id) on delete cascade,
  title      text not null,
  summary    text,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lms_modules_course_idx on lms_modules (course_id, position);

create table if not exists lms_lessons (
  id                      uuid primary key default gen_random_uuid(),
  module_id               uuid not null references lms_modules (id) on delete cascade,
  slug                    text not null,
  title                   text not null,
  summary                 text,
  kind                    lms_lesson_kind not null default 'video',
  body                    text,
  body_format             lms_body_format not null default 'markdown',
  key_points              jsonb not null default '[]'::jsonb,
  reflection_questions    jsonb not null default '[]'::jsonb,
  estimated_minutes       integer,
  video_ref               text,
  video_status            lms_video_status not null default 'none',
  video_duration_seconds  integer,
  video_thumbnail_url     text,
  position                integer not null default 0,
  is_published            boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists lms_lessons_module_idx on lms_lessons (module_id, position);
create unique index if not exists lms_lessons_module_slug_key on lms_lessons (module_id, slug);
-- Video callbacks arrive keyed by the provider's own reference.
create index if not exists lms_lessons_video_ref_idx on lms_lessons (video_ref);

create table if not exists lms_lesson_attachments (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references lms_lessons (id) on delete cascade,
  label        text not null,
  object_key   text not null,
  content_type text,
  size_bytes   integer,
  created_at   timestamptz not null default now()
);
create index if not exists lms_lesson_attachments_lesson_idx on lms_lesson_attachments (lesson_id);

create table if not exists lms_lesson_progress (
  user_id               uuid not null references users (id) on delete cascade,
  lesson_id             uuid not null references lms_lessons (id) on delete cascade,
  status                lms_progress_status not null default 'in_progress',
  seconds_watched       integer not null default 0,
  last_position_seconds integer not null default 0,
  completed_at          timestamptz,
  updated_at            timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index if not exists lms_lesson_progress_lesson_idx on lms_lesson_progress (lesson_id);

create table if not exists lms_quizzes (
  id            uuid primary key default gen_random_uuid(),
  lesson_id     uuid not null references lms_lessons (id) on delete cascade,
  title         text not null,
  instructions  text,
  passing_score integer not null default 80,
  max_attempts  integer not null default 3,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists lms_quizzes_lesson_key on lms_quizzes (lesson_id);

create table if not exists lms_quiz_questions (
  id          uuid primary key default gen_random_uuid(),
  quiz_id     uuid not null references lms_quizzes (id) on delete cascade,
  prompt      text not null,
  explanation text,
  position    integer not null default 0
);
create index if not exists lms_quiz_questions_quiz_idx on lms_quiz_questions (quiz_id, position);

create table if not exists lms_quiz_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references lms_quiz_questions (id) on delete cascade,
  label       text not null,
  is_correct  boolean not null default false,
  position    integer not null default 0
);
create index if not exists lms_quiz_options_question_idx on lms_quiz_options (question_id, position);

create table if not exists lms_quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references lms_quizzes (id) on delete cascade,
  user_id      uuid not null references users (id) on delete cascade,
  score        integer not null,
  passed       boolean not null,
  answers      jsonb not null,
  submitted_at timestamptz not null default now()
);
create index if not exists lms_quiz_attempts_user_idx on lms_quiz_attempts (user_id, quiz_id);
