#!/usr/bin/env node
// Seeds one realistic demo course + cohort for local testing of the
// Learning module's admin console and Portal learner view. Idempotent by
// slug/name — matches an existing row rather than duplicating it, so it's
// safe to re-run after tweaking.
//
//   node scripts/seed-lms-demo.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadRuntime, contextFor } = require('../src/lms/runtime');
const { db } = require('../src/db');

const ADMIN_VIEWER_ID = 'staff:seed-script';

async function findCourseBySlug(store, slug) {
  return store.findCourseBySlug(slug);
}

(async () => {
  const { lms } = await loadRuntime();
  const admin = await contextFor(ADMIN_VIEWER_ID, 'admin');

  console.log('--- Course ---');
  let course = await findCourseBySlug(admin.store, 'foundations-of-church-membership');
  if (!course) {
    const created = await lms.createCourse(admin, {
      title: 'Foundations of Church Membership',
      subtitle: 'A short orientation for anyone exploring membership',
      summary: 'What we believe, how we serve, and what it means to belong here.',
      level: 'foundation',
      language: 'English',
      audience: 'New and prospective members',
      outcomes: ['Understand our core beliefs', 'Know how to get plugged into a serving team', 'Meet the next steps toward membership'],
      estimatedMinutes: 45,
    });
    course = await admin.store.findCourseById(created.id);
    console.log(`Created course "${course.title}" (${course.id})`);
  } else {
    console.log(`Course already exists: "${course.title}" (${course.id})`);
  }

  console.log('--- Modules & lessons ---');
  async function ensureModule(title, summary) {
    const existing = (await admin.store.outlineFor(course.id, ADMIN_VIEWER_ID))
      .find((r) => r.moduleTitle === title);
    if (existing) return existing.moduleId;
    const { id } = await lms.createModule(admin, { courseId: course.id, title, summary });
    console.log(`  Created module "${title}"`);
    return id;
  }

  async function ensureLesson(moduleId, input) {
    const outline = await admin.store.outlineFor(course.id, ADMIN_VIEWER_ID);
    const existing = outline.find((r) => r.moduleId === moduleId && r.lessonTitle === input.title);
    if (existing) return existing.lessonId;
    const created = await lms.createLesson(admin, { moduleId, ...input });
    await lms.updateLesson(admin, created.id, { isPublished: true });
    console.log(`    Created + published lesson "${input.title}"`);
    return created.id;
  }

  const welcomeId = await ensureModule('Welcome', 'Who we are and why we exist.');
  const ourStoryId = await ensureLesson(welcomeId, {
    title: 'Our Story',
    kind: 'reading',
    bodyFormat: 'markdown',
    estimatedMinutes: 8,
    body: [
      '# Our Story',
      '',
      "We started as a handful of families meeting in a living room, convinced that church should feel like **family** before it feels like an institution.",
      '',
      "Today we gather across several campuses, but the heart is the same: real relationships, honest faith, and a place for everyone to belong.",
    ].join('\n'),
    keyPoints: ['Founded by a small group of families', 'Relationship over institution', 'Now meeting across multiple campuses'],
    reflectionQuestions: ['What first brought you here?', 'What would "belonging" look like for you this year?'],
  });

  const beliefId = await ensureLesson(welcomeId, {
    title: 'What We Believe',
    kind: 'reading',
    bodyFormat: 'markdown',
    estimatedMinutes: 12,
    body: [
      '# What We Believe',
      '',
      'A short orientation to our core convictions — not an exhaustive statement of faith, but enough to know where we stand.',
      '',
      '- Scripture as our guide',
      '- Grace, not performance',
      '- Community as the normal Christian life',
    ].join('\n'),
    keyPoints: ['Scripture-centered', 'Grace over performance', 'Community is not optional'],
  });

  console.log('--- Quiz ---');
  const existingQuiz = await admin.store.findQuizByLesson(beliefId);
  if (!existingQuiz) {
    await lms.upsertQuiz(admin, {
      lessonId: beliefId,
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
    console.log('  Added quiz to "What We Believe"');
  } else {
    console.log('  Quiz already exists on "What We Believe"');
  }

  const involvedId = await ensureModule('Getting Involved', 'Finding your place and your people.');
  await ensureLesson(involvedId, {
    title: 'Finding Your Place',
    kind: 'reading',
    bodyFormat: 'markdown',
    estimatedMinutes: 10,
    body: '# Finding Your Place\n\nServing teams, small groups, and the next class you can take — a map of where to go next.',
    keyPoints: ['Small groups meet weekly, year-round', 'Every serving team has a trial month, no long commitment up front'],
  });
  await ensureLesson(involvedId, {
    title: 'Next Steps',
    kind: 'assignment',
    bodyFormat: 'markdown',
    estimatedMinutes: 5,
    body: '# Next Steps\n\nTalk to a staff member about joining a small group this month, and mark this lesson complete once you have.',
  });

  console.log('--- Publish course ---');
  if (course.status !== 'published') {
    await lms.setCourseStatus(admin, course.id, 'published');
    console.log('  Published course');
  } else {
    console.log('  Course already published');
  }

  console.log('--- Cohort ---');
  let cohorts = await lms.listCohorts(admin);
  let cohort = cohorts.find((c) => c.name === '2026 New Members Class');
  if (!cohort) {
    const created = await lms.createCohort(admin, { name: '2026 New Members Class', description: 'Everyone working through orientation this year.' });
    cohort = { id: created.id };
    console.log(`Created cohort (${created.id})`);
  } else {
    console.log(`Cohort already exists (${cohort.id})`);
  }

  console.log('--- Enroll contacts ---');
  const [contacts] = await db.query(
    'SELECT id, first_name, last_name FROM contacts WHERE id IN (1, 2, 6, 7, 8) ORDER BY id'
  );
  for (const c of contacts) {
    await lms.addMember(admin, cohort.id, String(c.id));
    console.log(`  Enrolled ${c.first_name} ${c.last_name} (contact ${c.id})`);
  }

  console.log('--- Release course to cohort ---');
  await lms.releaseCourse(admin, { cohortId: cohort.id, courseId: course.id });
  console.log('  Released');

  console.log('\nDone. Visit /admin/lms/courses and /admin/lms/cohorts, or /portal/learning as an enrolled contact.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
