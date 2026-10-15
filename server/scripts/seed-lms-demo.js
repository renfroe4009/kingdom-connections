#!/usr/bin/env node
// Seeds realistic demo data across the Learning module so every screen has
// something to show: a draft course nobody's released yet, a published
// course with a full spread of learner progress (not started / in progress
// / completed, plus a quiz that's been failed once and passed, and one
// that's been failed and left that way), a second published course with its
// own cohort and a video-kind lesson, and a learner enrolled in two cohorts
// at once (so the portal's "my courses" list has more than one row).
//
// Idempotent by slug/name/title — matches existing rows rather than
// duplicating them, so it's safe to re-run after tweaking.
//
//   node scripts/seed-lms-demo.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadRuntime, contextFor } = require('../src/lms/runtime');
const { db } = require('../src/db');

const ADMIN_VIEWER_ID = 'staff:seed-script';

// Mirrors the vendored module's own slugify() (server/vendor/kcc-lms/src/slug.ts)
// closely enough for this script's plain-ASCII titles — good enough to predict
// the slug a title will get, so re-running finds the same course instead of
// erroring on a duplicate.
function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function ensureCourse(admin, lms, input) {
  const slug = slugify(input.title);
  let course = await admin.store.findCourseBySlug(slug);
  if (!course) {
    const created = await lms.createCourse(admin, input);
    course = await admin.store.findCourseById(created.id);
    console.log(`Created course "${course.title}" (${course.id})`);
  } else {
    console.log(`Course already exists: "${course.title}" (${course.id})`);
  }
  return course;
}

async function ensureModule(admin, lms, course, title, summary) {
  const existing = (await admin.store.outlineFor(course.id, ADMIN_VIEWER_ID))
    .find((r) => r.moduleTitle === title);
  if (existing) return existing.moduleId;
  const { id } = await lms.createModule(admin, { courseId: course.id, title, summary });
  console.log(`  Created module "${title}"`);
  return id;
}

async function ensureLesson(admin, lms, course, moduleId, input) {
  const outline = await admin.store.outlineFor(course.id, ADMIN_VIEWER_ID);
  const existing = outline.find((r) => r.moduleId === moduleId && r.lessonTitle === input.title);
  if (existing) return existing.lessonId;
  const created = await lms.createLesson(admin, { moduleId, ...input });
  await lms.updateLesson(admin, created.id, { isPublished: true });
  console.log(`    Created + published lesson "${input.title}"`);
  return created.id;
}

async function ensureQuiz(admin, lms, lessonId, input) {
  const existing = await admin.store.findQuizByLesson(lessonId);
  if (existing) {
    console.log(`  Quiz already exists on lesson (${lessonId})`);
    return existing.id;
  }
  const { id } = await lms.upsertQuiz(admin, { lessonId, ...input });
  console.log(`  Added quiz "${input.title}"`);
  return id;
}

async function ensureCohort(admin, lms, name, description) {
  const cohorts = await lms.listCohorts(admin);
  let cohort = cohorts.find((c) => c.name === name);
  if (!cohort) {
    const created = await lms.createCohort(admin, { name, description });
    cohort = { id: created.id, name };
    console.log(`Created cohort "${name}" (${created.id})`);
  } else {
    console.log(`Cohort already exists: "${name}" (${cohort.id})`);
  }
  return cohort;
}

async function enrollContacts(admin, lms, cohort, contactIds) {
  const [contacts] = await db.query(
    `SELECT id, first_name, last_name FROM contacts WHERE id IN (${contactIds.map(() => '?').join(',')}) ORDER BY FIELD(id, ${contactIds.map(() => '?').join(',')})`,
    [...contactIds, ...contactIds]
  );
  for (const c of contacts) {
    await lms.addMember(admin, cohort.id, String(c.id));
    console.log(`  Enrolled ${c.first_name} ${c.last_name} (contact ${c.id}) in "${cohort.name}"`);
  }
  return contacts;
}

// Answers a quiz "correctly" or "incorrectly" as a given learner, using
// getQuizPaper to discover the real question/option ids (the module never
// hands out which option is correct — see services/assessment.ts's own
// comment on QuizPaper). This script knows which option it listed first for
// each question when it built the quiz, and always lists the correct one
// first, so "first option" = pass and "second option" = fail.
//
// Skips if this learner already has at least one attempt — submitAttempt
// isn't idempotent (every call spends one of a limited number of attempts),
// so re-running this script would eventually hit "no attempts left" instead
// of leaving the already-seeded state alone.
async function answerQuiz(learnerCtx, lms, lessonId, { pass }) {
  const paper = await lms.getQuizPaper(learnerCtx, lessonId);
  if (paper.attemptsTaken > 0) return null;
  const answers = {};
  for (const q of paper.questions) {
    answers[q.id] = pass ? q.options[0].id : (q.options[1]?.id || q.options[0].id);
  }
  return lms.submitAttempt(learnerCtx, { quizId: paper.id, answers });
}

(async () => {
  const { lms } = await loadRuntime();
  const admin = await contextFor(ADMIN_VIEWER_ID, 'admin');

  // ===========================================================================
  // Course 1 — "Foundations of Church Membership" (published, full progress spread)
  // ===========================================================================
  console.log('=== Course 1: Foundations of Church Membership ===');
  const course1 = await ensureCourse(admin, lms, {
    title: 'Foundations of Church Membership',
    subtitle: 'A short orientation for anyone exploring membership',
    summary: 'What we believe, how we serve, and what it means to belong here.',
    level: 'foundation',
    language: 'English',
    audience: 'New and prospective members',
    outcomes: ['Understand our core beliefs', 'Know how to get plugged into a serving team', 'Meet the next steps toward membership'],
    estimatedMinutes: 45,
  });

  const welcomeId = await ensureModule(admin, lms, course1, 'Welcome', 'Who we are and why we exist.');
  const ourStoryId = await ensureLesson(admin, lms, course1, welcomeId, {
    title: 'Our Story',
    kind: 'reading',
    bodyFormat: 'markdown',
    estimatedMinutes: 8,
    body: [
      "We started as a handful of families meeting in a living room, convinced that church should feel like **family** before it feels like an institution.",
      '',
      "Today we gather across several campuses, but the heart is the same: real relationships, honest faith, and a place for everyone to belong.",
    ].join('\n'),
    keyPoints: ['Founded by a small group of families', 'Relationship over institution', 'Now meeting across multiple campuses'],
    reflectionQuestions: ['What first brought you here?', 'What would "belonging" look like for you this year?'],
  });

  const beliefId = await ensureLesson(admin, lms, course1, welcomeId, {
    title: 'What We Believe',
    kind: 'reading',
    bodyFormat: 'markdown',
    estimatedMinutes: 12,
    body: [
      'A short orientation to our core convictions — not an exhaustive statement of faith, but enough to know where we stand.',
      '',
      '- Scripture as our guide',
      '- Grace, not performance',
      '- Community as the normal Christian life',
    ].join('\n'),
    keyPoints: ['Scripture-centered', 'Grace over performance', 'Community is not optional'],
  });

  await ensureQuiz(admin, lms, beliefId, {
    title: 'What We Believe — Check-in',
    instructions: 'Just a quick check that the key ideas landed.',
    passingScore: 70,
    maxAttempts: 3,
    questions: [
      {
        prompt: 'What do we use as our guide for faith and practice?',
        options: [
          { label: 'Scripture', isCorrect: true },
          { label: 'Tradition alone', isCorrect: false },
          { label: 'Whatever feels right', isCorrect: false },
        ],
      },
      {
        prompt: 'Is church membership here based on earning your place?',
        options: [
          { label: 'No — it\'s grace, not performance', isCorrect: true },
          { label: 'Yes, you have to prove yourself first', isCorrect: false },
        ],
      },
    ],
  });

  const involvedId = await ensureModule(admin, lms, course1, 'Getting Involved', 'Finding your place and your people.');
  const findingPlaceId = await ensureLesson(admin, lms, course1, involvedId, {
    title: 'Finding Your Place',
    kind: 'reading',
    bodyFormat: 'markdown',
    estimatedMinutes: 10,
    body: 'Serving teams, small groups, and the next class you can take — a map of where to go next.',
    keyPoints: ['Small groups meet weekly, year-round', 'Every serving team has a trial month, no long commitment up front'],
  });
  const nextStepsId = await ensureLesson(admin, lms, course1, involvedId, {
    title: 'Next Steps',
    kind: 'assignment',
    bodyFormat: 'markdown',
    estimatedMinutes: 5,
    body: 'Talk to a staff member about joining a small group this month, and mark this lesson complete once you have.',
  });

  if (course1.status !== 'published') {
    await lms.setCourseStatus(admin, course1.id, 'published');
    console.log('  Published course');
  }

  const cohort1 = await ensureCohort(admin, lms, '2026 New Members Class', 'Everyone working through orientation this year.');
  // Alice overlaps into cohort 2 below — shows up with two courses on her
  // portal "my learning" list instead of just one.
  const [alice, brian, maan, testDonor, tim] = await enrollContacts(admin, lms, cohort1, [1, 2, 6, 7, 8]);
  await lms.releaseCourse(admin, { cohortId: cohort1.id, courseId: course1.id });

  console.log('--- Simulating learner progress (course 1) ---');
  // Alice: finishes everything and passes the quiz first try. The "100%
  // complete, quiz passed" state.
  if (alice) {
    const ctx = await contextFor(String(alice.id), 'learner');
    for (const lessonId of [ourStoryId, beliefId, findingPlaceId, nextStepsId]) await lms.completeLesson(ctx, lessonId);
    await answerQuiz(ctx, lms, beliefId, { pass: true });
    console.log(`  Alice: completed all 4 lessons, passed the quiz`);
  }
  // Brian: partway through, hasn't touched the quiz yet. The "in progress,
  // quiz not attempted" state.
  if (brian) {
    const ctx = await contextFor(String(brian.id), 'learner');
    for (const lessonId of [ourStoryId, findingPlaceId]) await lms.completeLesson(ctx, lessonId);
    console.log(`  Brian: completed 2 of 4 lessons, quiz not attempted`);
  }
  // Maan: just started. The "barely begun" state.
  if (maan) {
    const ctx = await contextFor(String(maan.id), 'learner');
    await lms.completeLesson(ctx, ourStoryId);
    console.log(`  Maan: completed 1 of 4 lessons`);
  }
  // Test Donor: left completely untouched — the "not started" state, which
  // is also what a brand-new enrollment looks like with nothing seeded.
  if (testDonor) console.log(`  Test Donor: left at 0% (not started)`);
  // tim: finishes the readings, fails the quiz once, then passes on the
  // second attempt. The "multiple attempts, attempts remaining" state.
  if (tim) {
    const ctx = await contextFor(String(tim.id), 'learner');
    for (const lessonId of [ourStoryId, beliefId, findingPlaceId, nextStepsId]) await lms.completeLesson(ctx, lessonId);
    await answerQuiz(ctx, lms, beliefId, { pass: false });
    await answerQuiz(ctx, lms, beliefId, { pass: true });
    console.log(`  tim: completed all 4 lessons, failed the quiz once then passed`);
  }

  // ===========================================================================
  // Course 2 — "Growing in Prayer" (published, second cohort, a video lesson)
  // ===========================================================================
  console.log('\n=== Course 2: Growing in Prayer ===');
  const course2 = await ensureCourse(admin, lms, {
    title: 'Growing in Prayer',
    subtitle: 'Building a simple, sustainable prayer life',
    summary: 'Practical habits for praying regularly, alone and with others.',
    level: 'foundation',
    language: 'English',
    audience: 'Anyone wanting to grow in prayer',
    outcomes: ['Build a daily prayer habit', 'Learn to pray with a group'],
    estimatedMinutes: 30,
  });

  const whyPrayId = await ensureModule(admin, lms, course2, 'Why Pray', 'The posture before the habit.');
  const prayerHabitId = await ensureLesson(admin, lms, course2, whyPrayId, {
    title: 'Starting a Prayer Habit',
    kind: 'reading',
    bodyFormat: 'markdown',
    estimatedMinutes: 10,
    body: 'Five minutes a day, same time, same place — the habit matters more than the method at first.',
    keyPoints: ['Consistency beats duration', 'Pick a time you already protect (coffee, commute, before bed)'],
  });
  await ensureLesson(admin, lms, course2, whyPrayId, {
    title: 'Prayer Journal Challenge',
    kind: 'assignment',
    bodyFormat: 'markdown',
    estimatedMinutes: 5,
    body: 'Keep a one-line prayer journal for a week, then mark this complete.',
  });
  await ensureQuiz(admin, lms, prayerHabitId, {
    title: 'Prayer Basics Check-in',
    instructions: 'A quick check on the main idea.',
    passingScore: 70,
    maxAttempts: 3,
    questions: [
      {
        prompt: 'What matters more when starting a prayer habit?',
        options: [
          { label: 'Consistency, not duration', isCorrect: true },
          { label: 'Praying for exactly 30 minutes every time', isCorrect: false },
        ],
      },
    ],
  });

  const prayTogetherId = await ensureModule(admin, lms, course2, 'Prayer Together', 'Praying with other people.');
  // A video-kind lesson with no real file behind it — videoStatus lands on
  // 'processing' and stays there (see authoring.ts's createLesson: it only
  // ever sets 'processing' on create, and nothing in this seed script calls
  // the webhook-only markVideoReady). That's a legitimate, demonstrable UI
  // state on its own (every freshly-uploaded video looks like this for a
  // while) — just don't expect it to actually play.
  await ensureLesson(admin, lms, course2, prayTogetherId, {
    title: 'Joining a Prayer Group',
    kind: 'video',
    videoRef: 'demo/placeholder-prayer-group.mp4',
    bodyFormat: 'markdown',
    estimatedMinutes: 6,
    body: 'A short welcome from one of our prayer group leaders. (Demo lesson — no real video file behind this, so playback will show the processing state rather than actually play.)',
  });

  if (course2.status !== 'published') {
    await lms.setCourseStatus(admin, course2.id, 'published');
    console.log('  Published course');
  }

  const cohort2 = await ensureCohort(admin, lms, 'Prayer Team Training', 'New and current prayer-team volunteers.');
  const [aliceAgain, carla, derek] = await enrollContacts(admin, lms, cohort2, [1, 3, 4]);
  await lms.releaseCourse(admin, { cohortId: cohort2.id, courseId: course2.id });

  console.log('--- Simulating learner progress (course 2) ---');
  if (aliceAgain) {
    const ctx = await contextFor(String(aliceAgain.id), 'learner');
    await lms.completeLesson(ctx, prayerHabitId);
    await answerQuiz(ctx, lms, prayerHabitId, { pass: true });
    console.log(`  Alice: completed the reading lesson, passed the quiz (now in 2 courses)`);
  }
  // Carla: fails the quiz and leaves it failed — the "failed, attempts
  // still left" state, distinct from tim's "failed then passed" above.
  if (carla) {
    const ctx = await contextFor(String(carla.id), 'learner');
    await lms.completeLesson(ctx, prayerHabitId);
    await answerQuiz(ctx, lms, prayerHabitId, { pass: false });
    console.log(`  Carla: completed the reading lesson, failed the quiz (left failed)`);
  }
  if (derek) console.log(`  Derek: left at 0% (not started)`);

  // ===========================================================================
  // Course 3 — "Leadership Track" (draft, never released — the empty/draft state)
  // ===========================================================================
  console.log('\n=== Course 3: Leadership Track (draft, unreleased) ===');
  const course3 = await ensureCourse(admin, lms, {
    title: 'Leadership Track',
    subtitle: 'Still being written — not yet released to anyone',
    summary: 'For future small group and ministry leaders.',
    level: 'advanced',
    language: 'English',
    audience: 'Prospective leaders',
    outcomes: ['Understand what leadership looks like here'],
    estimatedMinutes: 20,
  });
  const orientationId = await ensureModule(admin, lms, course3, 'Orientation', 'What leadership looks like here.');
  await ensureLesson(admin, lms, course3, orientationId, {
    title: 'What Leadership Looks Like Here',
    kind: 'reading',
    bodyFormat: 'markdown',
    estimatedMinutes: 15,
    body: 'A draft lesson — deliberately left in draft/unreleased so the admin course list has an example of an in-progress course.',
  });
  console.log(`  Left as draft (status: ${course3.status}), not released to any cohort — this is intentional.`);

  console.log('\nDone. Visit /admin/lms/courses and /admin/lms/cohorts, or /portal/learning as an enrolled contact (try contact 1, 2, 6, 7, 8, 3, or 4).');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
