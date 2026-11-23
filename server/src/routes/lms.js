// =============================================================================
// /api/lms — staff admin console for the Learning module (courses & cohorts)
//
// Wraps the vendored module at server/vendor/kcc-lms (see its VENDORED.md).
// Every route here is staff-only (requireAuth + requirePermission), so the
// acting viewer is always built with the 'admin' tier — the module's own
// instructor/admin split isn't exposed at this layer; this console gates
// read vs. write with this app's own lms.read/lms.write permissions instead.
//
// A staff viewer's id is their own users.contact_id when they have one
// (lets them also appear in a cohort's member list like any other learner),
// falling back to a 'staff:<id>' marker otherwise — see runtime.js and
// vendor/kcc-lms/VENDORED.md for why that's safe (it only ever lands in the
// unconstrained lms_courses.created_by column for admin-only actions).
//
// Member/release listings (GET .../members, GET .../courses) read the
// module's tables directly via its exported Drizzle schema rather than a
// service call — the module itself draws the line at entitlement questions
// ("may this person see this"), not roster questions ("who is enrolled"),
// and has no service wrapper for the latter. See vendor/kcc-lms/src/store.ts.
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { eq, inArray } = require('drizzle-orm');
const multer = require('multer');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const { loadRuntime, contextFor, statusForLmsError } = require('../lms/runtime');
const storage = require('../services/storage');
const { validateUploadedFile } = require('../services/uploadValidation');

router.use(requireAuth);

function viewerIdFor(user) {
  return user.contact_id ? String(user.contact_id) : `staff:${user.id}`;
}

function handleLmsError(err, res, next) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  const status = statusForLmsError(err);
  if (status) return res.status(status).json({ error: err.message });
  next(err);
}

// Same allowlist reasoning as routes/media.js: fileFilter only ever sees the
// client-DECLARED type, so uploadVideo/uploadAttachment below re-validate
// against the real bytes via validateUploadedFile() before anything is
// stored. Video gets its own, much larger limit — a teaching video easily
// runs past the Media Library's 50MB image/PDF cap.
const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'];
const ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, VIDEO_MIME_TYPES.includes(file.mimetype)),
});
const uploadAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ATTACHMENT_MIME_TYPES.includes(file.mimetype)),
});

// Dev-only fallback for the local storage driver — see runtime.js's
// storagePort. Production always has STORAGE_DRIVER=s3 (R2), where
// signedUrl() returns a real presigned URL and this route never runs.
// Gated on requireAuth only (any logged-in staff or portal session): by the
// time a key reaches a client at all, the LMS module has already checked
// entitlement to generate it, and local-driver keys are unguessable random
// hex, so this isn't a second entitlement check — it's a dev convenience.
router.get('/files/*', async (req, res, next) => {
  try {
    const key = req.params[0];
    const result = await storage.getReadable({ driver: storage.driver, key });
    if (result.type === 'redirect') return res.redirect(result.url);
    result.stream.on('error', () => res.status(404).end());
    result.stream.pipe(res);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- courses */

router.get('/courses', requirePermission('lms.read'), async (_req, res, next) => {
  try {
    const { schema, db: lmsDb } = await loadRuntime();
    const rows = await lmsDb.select().from(schema.courses).orderBy(schema.courses.title);
    res.json(rows);
  } catch (err) { next(err); }
});

const courseSchema = z.object({
  title: z.string().min(2),
  subtitle: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  level: z.enum(['foundation', 'intermediate', 'advanced']).optional(),
  language: z.string().optional(),
  audience: z.string().optional().nullable(),
  outcomes: z.array(z.string()).optional(),
  prerequisites: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
  estimatedMinutes: z.number().int().positive().optional().nullable(),
});

router.post('/courses', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const input = courseSchema.parse(req.body);
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    const created = await lms.createCourse(context, input);
    await logActivity({ userId: req.user.id, entityType: 'lms_course', entityId: created.id, action: 'created', description: `Created course "${input.title}"` });
    res.status(201).json(created);
  } catch (err) { handleLmsError(err, res, next); }
});

router.put('/courses/:id', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const input = courseSchema.partial().parse(req.body);
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    await lms.updateCourse(context, req.params.id, input);
    await logActivity({ userId: req.user.id, entityType: 'lms_course', entityId: req.params.id, action: 'updated', description: `Updated course "${input.title || req.params.id}"` });
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

const statusSchema = z.object({ status: z.enum(['draft', 'published', 'archived']) });
router.post('/courses/:id/status', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const { status } = statusSchema.parse(req.body);
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    await lms.setCourseStatus(context, req.params.id, status);
    await logActivity({ userId: req.user.id, entityType: 'lms_course', entityId: req.params.id, action: 'updated', description: `Set course status to ${status}` });
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

// Full content tree for one course — modules, lessons, publish state. Staff
// are exempt from entitlement by the module's own design (see
// vendor/kcc-lms/src/services/enrolment.ts), so getCourse() returns
// unpublished lessons too when called with an admin/instructor viewer.
router.get('/courses/:id', requirePermission('lms.read'), async (req, res, next) => {
  try {
    const { store, lms } = await loadRuntime();
    const course = await store.findCourseById(req.params.id);
    if (!course) return res.status(404).json({ error: 'No such course.' });
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const detail = await lms.getCourse(context, course.slug);
    res.json(detail);
  } catch (err) { handleLmsError(err, res, next); }
});

/* ------------------------------------------------------------- pricing */
//
// Self-serve paid enrollment is a separate, app-owned table (lms_course_pricing
// — see scripts/ensure-lms-pricing-table.js), not part of the vendored
// module's own schema. The one thing that touches the vendor package here is
// the auto-created "self-enrolled" cohort: the first time a course is marked
// non-free, this route creates one dedicated cohort via the vendor's own
// createCohort()/releaseCourse() — the exact same calls this file's own
// POST /cohorts and POST /cohorts/:id/courses make for a staff-managed
// cohort — and every self-serve signup (routes/lmsCheckout.js) just adds the
// buyer to it. Reverting to 'free' never deletes that cohort or its members;
// it only stops new checkouts (lmsCheckout.js refuses when access_type is
// 'free'), so existing buyers keep access.

router.get('/courses/:id/pricing', requirePermission('lms.read'), async (req, res, next) => {
  try {
    const [[row]] = await db.query('SELECT * FROM lms_course_pricing WHERE course_id = :id', { id: req.params.id });
    res.json(row || { access_type: 'free' });
  } catch (err) { next(err); }
});

const pricingSchema = z.object({
  accessType: z.enum(['free', 'one_time', 'recurring']),
  price: z.number().positive().optional().nullable(),
  intervalUnit: z.enum(['month', 'year']).optional(),
  intervalCount: z.number().int().positive().optional(),
  allowBuyerChoice: z.boolean().optional(),
});
router.put('/courses/:id/pricing', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const input = pricingSchema.parse(req.body);
    if (input.accessType !== 'free' && !(input.price > 0)) {
      return res.status(400).json({ error: 'A price is required for a paid course.' });
    }

    const { store } = await loadRuntime();
    const course = await store.findCourseById(req.params.id);
    if (!course) return res.status(404).json({ error: 'No such course.' });

    const [[existing]] = await db.query('SELECT * FROM lms_course_pricing WHERE course_id = :id', { id: req.params.id });

    let cohortId = existing?.cohort_id || null;
    if (input.accessType !== 'free' && !cohortId) {
      const context = await contextFor(viewerIdFor(req.user), 'admin');
      const { lms } = await loadRuntime();
      const cohort = await lms.createCohort(context, { name: `${course.title} — Self-Enrolled` });
      await lms.releaseCourse(context, { cohortId: cohort.id, courseId: req.params.id, availableFrom: new Date() });
      cohortId = cohort.id;
    }

    const fields = {
      course_id: req.params.id,
      access_type: input.accessType,
      price: input.accessType === 'free' ? null : input.price,
      interval_unit: input.intervalUnit || 'month',
      interval_count: input.intervalCount || 1,
      allow_buyer_choice: input.allowBuyerChoice ? 1 : 0,
      cohort_id: cohortId,
    };
    if (existing) {
      await db.query(
        `UPDATE lms_course_pricing
            SET access_type = :access_type, price = :price, interval_unit = :interval_unit,
                interval_count = :interval_count, allow_buyer_choice = :allow_buyer_choice, cohort_id = :cohort_id
          WHERE course_id = :course_id`,
        fields
      );
    } else {
      const { randomUUID } = require('crypto');
      await db.query(
        `INSERT INTO lms_course_pricing (id, course_id, access_type, price, interval_unit, interval_count, allow_buyer_choice, cohort_id)
         VALUES (:id, :course_id, :access_type, :price, :interval_unit, :interval_count, :allow_buyer_choice, :cohort_id)`,
        { id: randomUUID(), ...fields }
      );
    }
    await logActivity({ userId: req.user.id, entityType: 'lms_course', entityId: req.params.id, action: 'updated', description: `Set pricing to ${input.accessType}` });
    const [[row]] = await db.query('SELECT * FROM lms_course_pricing WHERE course_id = :id', { id: req.params.id });
    res.json(row);
  } catch (err) { handleLmsError(err, res, next); }
});

/* ------------------------------------------------------------- modules */

const moduleSchema = z.object({ courseId: z.string().min(1), title: z.string().min(2), summary: z.string().optional().nullable() });
router.post('/modules', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const input = moduleSchema.parse(req.body);
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    const created = await lms.createModule(context, input);
    res.status(201).json(created);
  } catch (err) { handleLmsError(err, res, next); }
});

const moduleUpdateSchema = z.object({ title: z.string().min(2).optional(), summary: z.string().optional().nullable(), position: z.number().int().optional() });
router.put('/modules/:id', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const input = moduleUpdateSchema.parse(req.body);
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    await lms.updateModule(context, req.params.id, input);
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

router.delete('/modules/:id', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    await lms.deleteModule(context, req.params.id);
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

/* -------------------------------------------------------------- lessons */

const lessonSchema = z.object({
  moduleId: z.string().min(1),
  title: z.string().min(2),
  summary: z.string().optional().nullable(),
  kind: z.enum(['video', 'reading', 'assignment']).optional(),
  body: z.string().optional().nullable(),
  bodyFormat: z.enum(['html', 'markdown']).optional(),
  keyPoints: z.array(z.string()).optional(),
  reflectionQuestions: z.array(z.string()).optional(),
  estimatedMinutes: z.number().int().positive().optional().nullable(),
  videoRef: z.string().optional().nullable(),
});
router.post('/lessons', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const input = lessonSchema.parse(req.body);
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    const created = await lms.createLesson(context, input);
    res.status(201).json(created);
  } catch (err) { handleLmsError(err, res, next); }
});

const lessonUpdateSchema = lessonSchema.omit({ moduleId: true }).partial().extend({ isPublished: z.boolean().optional() });
router.put('/lessons/:id', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const input = lessonUpdateSchema.parse(req.body);
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    await lms.updateLesson(context, req.params.id, input);
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

router.delete('/lessons/:id', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    await lms.deleteLesson(context, req.params.id);
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

// The course outline (GET /courses/:id) deliberately mirrors what a learner
// sees plus publish state — it doesn't carry video/attachment state, which
// only the lesson's own media-management UI needs. Roster question again,
// not an entitlement one — same reasoning as the cohort member/course
// listings above.
router.get('/lessons/:id', requirePermission('lms.read'), async (req, res, next) => {
  try {
    const { store } = await loadRuntime();
    const found = await store.findLessonById(req.params.id);
    if (!found) return res.status(404).json({ error: 'No such lesson.' });
    res.json(found.lesson);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- video */

router.post('/lessons/:id/video', requirePermission('lms.write'), uploadVideo.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded, or its type is not allowed.' });
    const validation = await validateUploadedFile(req.file, VIDEO_MIME_TYPES);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { store, lms } = await loadRuntime();
    const existing = await store.findLessonById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No such lesson.' });

    const { key } = await storage.put({
      entity_type: 'lms_lesson_video', entity_id: req.params.id,
      originalName: req.file.originalname, contentType: validation.detectedMime, buffer: req.file.buffer,
    });

    if (existing.lesson.videoRef) {
      await storage.remove({ driver: storage.driver, key: existing.lesson.videoRef }).catch(() => {});
    }
    await lms.updateLesson(context, req.params.id, { videoRef: key });
    // updateLesson always sets a fresh videoRef to 'processing' — the status
    // an async transcoding provider (Cloudflare Stream, Mux) would start at,
    // then flip via its own webhook (recordVideoState). Direct file storage
    // has no transcoding step, so it's ready the moment the upload lands.
    await lms.recordVideoState(context, { videoRef: key, status: 'ready' });
    await logActivity({ userId: req.user.id, entityType: 'lms_lesson', entityId: req.params.id, action: 'updated', description: 'Uploaded lesson video' });
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

router.delete('/lessons/:id/video', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { store, lms } = await loadRuntime();
    const existing = await store.findLessonById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No such lesson.' });
    if (existing.lesson.videoRef) {
      await storage.remove({ driver: storage.driver, key: existing.lesson.videoRef }).catch(() => {});
    }
    await lms.updateLesson(context, req.params.id, { videoRef: null });
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

/* ------------------------------------------------------------- attachments */

router.get('/lessons/:id/attachments', requirePermission('lms.read'), async (req, res, next) => {
  try {
    const { store } = await loadRuntime();
    const rows = await store.attachmentsFor(req.params.id);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/lessons/:id/attachments', requirePermission('lms.write'), uploadAttachment.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded, or its type is not allowed.' });
    const validation = await validateUploadedFile(req.file, ATTACHMENT_MIME_TYPES);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    const label = (req.body.label || req.file.originalname || 'Attachment').slice(0, 120);
    const { key } = await storage.put({
      entity_type: 'lms_lesson_attachment', entity_id: req.params.id,
      originalName: req.file.originalname, contentType: validation.detectedMime, buffer: req.file.buffer,
    });

    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    const created = await lms.addAttachment(context, {
      lessonId: req.params.id, label, objectKey: key,
      contentType: validation.detectedMime, sizeBytes: req.file.buffer.length,
    });
    res.status(201).json(created);
  } catch (err) { handleLmsError(err, res, next); }
});

router.delete('/attachments/:id', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    await lms.removeAttachment(context, req.params.id);
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

/* ---------------------------------------------------------------- quiz */

// The full answer key — staff only, enforced again inside getQuizForEditing
// itself (requireRole('instructor')), not just by this route's permission.
router.get('/lessons/:id/quiz', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    const quiz = await lms.getQuizForEditing(context, req.params.id);
    res.json(quiz);
  } catch (err) { handleLmsError(err, res, next); }
});

const quizSchema = z.object({
  title: z.string().min(2),
  instructions: z.string().optional().nullable(),
  passingScore: z.number().int().min(1).max(100).optional(),
  maxAttempts: z.number().int().min(0).optional(),
  // Null, absent or 0 means "ask every question". A number means draw that
  // many at random per attempt; the module refuses a draw bigger than the bank.
  drawSize: z.number().int().min(0).optional().nullable(),
  questions: z.array(z.object({
    prompt: z.string().min(2),
    explanation: z.string().optional().nullable(),
    options: z.array(z.object({ label: z.string().min(1), isCorrect: z.boolean() })).min(2),
  })).min(1),
});
router.put('/lessons/:id/quiz', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const input = quizSchema.parse(req.body);
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    const result = await lms.upsertQuiz(context, { ...input, lessonId: req.params.id });
    res.json(result);
  } catch (err) { handleLmsError(err, res, next); }
});

router.delete('/quizzes/:id', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    await lms.deleteQuiz(context, req.params.id);
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

/* ------------------------------------------------------------- cohorts */

router.get('/cohorts', requirePermission('lms.read'), async (req, res, next) => {
  try {
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    const rows = await lms.listCohorts(context);
    res.json(rows);
  } catch (err) { handleLmsError(err, res, next); }
});

const cohortSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  startsOn: z.string().datetime().optional().nullable(),
  endsOn: z.string().datetime().optional().nullable(),
});
router.post('/cohorts', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const input = cohortSchema.parse(req.body);
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    const created = await lms.createCohort(context, {
      name: input.name,
      description: input.description,
      startsOn: input.startsOn ? new Date(input.startsOn) : null,
      endsOn: input.endsOn ? new Date(input.endsOn) : null,
    });
    await logActivity({ userId: req.user.id, entityType: 'lms_cohort', entityId: created.id, action: 'created', description: `Created cohort "${input.name}"` });
    res.status(201).json(created);
  } catch (err) { handleLmsError(err, res, next); }
});

// Who's enrolled — the module only knows member ids (contacts.id, as
// strings); names/emails come from this app's own contacts table.
router.get('/cohorts/:id/members', requirePermission('lms.read'), async (req, res, next) => {
  try {
    const { store } = await loadRuntime();
    const ids = await store.cohortMemberIds(req.params.id);
    const numericIds = ids.map(Number).filter((n) => Number.isInteger(n));
    if (numericIds.length === 0) return res.json([]);
    const [rows] = await db.query(
      'SELECT id, first_name, last_name, email FROM contacts WHERE id IN (:ids)',
      { ids: numericIds }
    );
    res.json(rows);
  } catch (err) { next(err); }
});

const addMemberSchema = z.object({ contactId: z.number().int().positive() });
router.post('/cohorts/:id/members', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const { contactId } = addMemberSchema.parse(req.body);
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    await lms.addMember(context, req.params.id, String(contactId));
    await logActivity({ userId: req.user.id, entityType: 'lms_cohort', entityId: req.params.id, action: 'updated', description: `Enrolled contact ${contactId}` });

    // Same enrollment notifications as a paid signup (routes/lmsCheckout.js) —
    // a staff-manual add is still a real enrollment. Cohort name stands in
    // for a specific course title here since a cohort can carry several
    // courses and this endpoint grants cohort-wide access, not one course.
    const [[cohort]] = await db.query('SELECT name FROM lms_cohorts WHERE id = :id', { id: req.params.id });
    const { notifyLmsEvent } = require('../services/constituents');
    const { notifyLmsChange } = require('../services/ppWebhooks');
    await notifyLmsEvent('course.enrolled', contactId, { courseName: cohort?.name });
    await notifyLmsChange('course.enrolled', contactId, { cohort_name: cohort?.name, cohort_id: req.params.id });

    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

router.delete('/cohorts/:id/members/:contactId', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    await lms.removeMember(context, req.params.id, req.params.contactId);
    await logActivity({ userId: req.user.id, entityType: 'lms_cohort', entityId: req.params.id, action: 'updated', description: `Removed contact ${req.params.contactId}` });
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

// Courses released to a cohort — same roster-not-entitlement reasoning as
// the members list above.
router.get('/cohorts/:id/courses', requirePermission('lms.read'), async (req, res, next) => {
  try {
    const { schema, db: lmsDb } = await loadRuntime();
    const rows = await lmsDb
      .select({
        courseId: schema.cohortCourses.courseId,
        availableFrom: schema.cohortCourses.availableFrom,
        position: schema.cohortCourses.position,
        title: schema.courses.title,
        slug: schema.courses.slug,
        status: schema.courses.status,
      })
      .from(schema.cohortCourses)
      .innerJoin(schema.courses, eq(schema.courses.id, schema.cohortCourses.courseId))
      .where(eq(schema.cohortCourses.cohortId, req.params.id));
    res.json(rows);
  } catch (err) { next(err); }
});

const releaseSchema = z.object({ courseId: z.string().min(1), availableFrom: z.string().datetime().optional().nullable() });
router.post('/cohorts/:id/courses', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const { courseId, availableFrom } = releaseSchema.parse(req.body);
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    await lms.releaseCourse(context, { cohortId: req.params.id, courseId, availableFrom: availableFrom ? new Date(availableFrom) : null });
    await logActivity({ userId: req.user.id, entityType: 'lms_cohort', entityId: req.params.id, action: 'updated', description: `Released course ${courseId}` });
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

router.delete('/cohorts/:id/courses/:courseId', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    await lms.withdrawCourse(context, req.params.id, req.params.courseId);
    await logActivity({ userId: req.user.id, entityType: 'lms_cohort', entityId: req.params.id, action: 'updated', description: `Withdrew course ${req.params.courseId}` });
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

/* ------------------------------------------------------------ gradebook */
//
// Read-only: the vendor package has no "reset a learner's quiz attempts"
// function (attemptsFor() only reads), so this stays a progress/score view,
// not a full CRUD surface on attempts — reaching past the vendor's service
// layer to delete lms_quiz_attempts rows directly would break the
// "never touch vendor internals" rule the rest of this build follows.
router.get('/cohorts/:id/progress', requirePermission('lms.read'), async (req, res, next) => {
  try {
    const { store, schema, db: lmsDb } = await loadRuntime();
    const ids = await store.cohortMemberIds(req.params.id);
    const numericIds = ids.map(Number).filter((n) => Number.isInteger(n));
    const [members] = numericIds.length
      ? await db.query('SELECT id, first_name, last_name, email FROM contacts WHERE id IN (:ids)', { ids: numericIds })
      : [[]];

    const releases = await lmsDb
      .select({ courseId: schema.cohortCourses.courseId, title: schema.courses.title })
      .from(schema.cohortCourses)
      .innerJoin(schema.courses, eq(schema.courses.id, schema.cohortCourses.courseId))
      .where(eq(schema.cohortCourses.cohortId, req.params.id));
    const courseIds = releases.map((r) => r.courseId);

    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    const progress = {};
    for (const m of members) {
      const stats = await lms.courseProgress(context, String(m.id), courseIds);
      progress[m.id] = Object.fromEntries(stats);
    }

    // Graded assignment marks, keyed the same way as `progress` so the
    // client can show them in the same cell — joined in from the app-owned
    // lms_lesson_submissions table (the vendor engine has no marks concept).
    const marks = {};
    if (numericIds.length) {
      const lessonIds = await lmsDb.select({ id: schema.lessons.id, moduleId: schema.lessons.moduleId }).from(schema.lessons);
      const moduleIds = await lmsDb.select({ id: schema.modules.id, courseId: schema.modules.courseId }).from(schema.modules);
      const courseByModule = new Map(moduleIds.map((m) => [m.id, m.courseId]));
      const courseByLesson = new Map(lessonIds.map((l) => [l.id, courseByModule.get(l.moduleId)]));
      const [submissionRows] = await db.query(
        `SELECT lesson_id, contact_id, score FROM lms_lesson_submissions
          WHERE status = 'graded' AND contact_id IN (:ids)`,
        { ids: numericIds }
      );
      for (const s of submissionRows) {
        const courseId = courseByLesson.get(s.lesson_id);
        if (!courseId || !courseIds.includes(courseId)) continue;
        marks[s.contact_id] = marks[s.contact_id] || {};
        if (!marks[s.contact_id][courseId]) marks[s.contact_id][courseId] = [];
        marks[s.contact_id][courseId].push(s.score);
      }
    }

    res.json({ members, courses: releases, progress, marks });
  } catch (err) { handleLmsError(err, res, next); }
});

/* ------------------------------------------------------------- marking */
//
// Assignment submission/grading — a data model the vendor engine has no
// concept of at all (see scripts/ensure-lms-submissions-table.js's header
// comment). Grading is the one write path here: it both records the mark
// AND completes the lesson for that learner via the vendor's own
// completeLesson(), called with a context acting as the learner (not the
// grading staff member), since lms_lesson_progress is keyed to a real
// contact id — see the Phase 2 plan's §3 for why.
router.get('/submissions', requirePermission('lms.read'), async (req, res, next) => {
  try {
    const status = req.query.status === 'graded' ? 'graded' : 'pending';
    const [rows] = await db.query(
      `SELECT s.*, CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name, c.email AS contact_email
         FROM lms_lesson_submissions s
         LEFT JOIN contacts c ON c.id = s.contact_id
        WHERE s.status = :status
        ORDER BY s.submitted_at ASC`,
      { status }
    );
    const { schema, db: lmsDb } = await loadRuntime();

    /*
     * Only the lessons this queue is actually about.
     *
     * `lessonIds` was already being built here and then used for nothing but
     * a length check — the select had no `where`, so opening the marking
     * queue read every lesson, every module and every course in the system,
     * and then matched them up with a `.find()` inside a `.map()`, which is
     * quadratic. With a handful of courses that is invisible; it gets slower
     * every time somebody publishes one, and the marking queue is a page
     * staff sit on.
     *
     * Three narrowed reads and two maps instead. Same output.
     */
    const lessonIds = [...new Set(rows.map((r) => r.lesson_id))];
    const lessons = lessonIds.length
      ? await lmsDb
          .select({ id: schema.lessons.id, title: schema.lessons.title, moduleId: schema.lessons.moduleId })
          .from(schema.lessons)
          .where(inArray(schema.lessons.id, lessonIds))
      : [];
    const moduleIds = [...new Set(lessons.map((l) => l.moduleId))];
    const modules = moduleIds.length
      ? await lmsDb
          .select({ id: schema.modules.id, courseId: schema.modules.courseId })
          .from(schema.modules)
          .where(inArray(schema.modules.id, moduleIds))
      : [];
    const courseIds = [...new Set(modules.map((m) => m.courseId))];
    const courses = courseIds.length
      ? await lmsDb
          .select({ id: schema.courses.id, title: schema.courses.title })
          .from(schema.courses)
          .where(inArray(schema.courses.id, courseIds))
      : [];

    const courseTitleById = new Map(courses.map((c) => [c.id, c.title]));
    const courseTitleByModule = new Map(modules.map((m) => [m.id, courseTitleById.get(m.courseId)]));
    const lessonById = new Map(lessons.map((l) => [l.id, l]));

    res.json(rows.map((r) => {
      const lesson = lessonById.get(r.lesson_id);
      return { ...r, lesson_title: lesson?.title || null, course_title: lesson ? courseTitleByModule.get(lesson.moduleId) : null };
    }));
  } catch (err) { next(err); }
});

router.get('/submissions/:id', requirePermission('lms.read'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      `SELECT s.*, CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name, c.email AS contact_email
         FROM lms_lesson_submissions s
         LEFT JOIN contacts c ON c.id = s.contact_id
        WHERE s.id = :id`,
      { id: req.params.id }
    );
    if (!row) return res.status(404).json({ error: 'No such submission.' });
    res.json(row);
  } catch (err) { next(err); }
});

const gradeSchema = z.object({ score: z.number().int().min(0).max(100), feedback: z.string().optional().nullable() });
router.post('/submissions/:id/grade', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const { score, feedback } = gradeSchema.parse(req.body);
    const [[submission]] = await db.query('SELECT * FROM lms_lesson_submissions WHERE id = :id', { id: req.params.id });
    if (!submission) return res.status(404).json({ error: 'No such submission.' });

    await db.query(
      `UPDATE lms_lesson_submissions
          SET status = 'graded', score = :score, feedback = :feedback, graded_at = NOW(), graded_by_user_id = :uid
        WHERE id = :id`,
      { score, feedback: feedback || null, uid: req.user.id, id: req.params.id }
    );

    // Distinct from 'lesson.completed' below — this is the moment a staff
    // member actually marked an assignment, which a lesson-completion
    // workflow can't distinguish from a self-paced video/reading lesson.
    // Internal automation only — not a Praying Planet event; grading is a
    // staff/CRM-side detail, not something a partner mobile app needs.
    const { notifyLmsEvent } = require('../services/constituents');
    await notifyLmsEvent('assignment.graded', submission.contact_id, { score });

    const { lms, store } = await loadRuntime();
    const learnerContext = await contextFor(String(submission.contact_id), 'learner');
    const result = await lms.completeLesson(learnerContext, submission.lesson_id);

    // A graded assignment can be the thing that pushes a course to 100% —
    // check and auto-issue a certificate the same way lmsPortal.js's own
    // lesson-complete route does. LessonInContext (store.findLessonById's
    // return shape) carries courseId directly — see vendor/kcc-lms/src/store.ts.
    if (result?.courseCompleted) {
      const found = await store.findLessonById(submission.lesson_id);
      if (found?.courseId) {
        const { issueCertificateIfComplete } = require('../services/lmsCertificates');
        await issueCertificateIfComplete({ courseId: found.courseId, contactId: submission.contact_id });
      }
    }

    await logActivity({
      userId: req.user.id, entityType: 'lms_submission', entityId: submission.id,
      action: 'graded', description: `Graded submission — score ${score}` });
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

/* ------------------------------------------------------- curriculum drafts */
//
// "Draft with AI" — see services/ai.js's draftCurriculum(). The draft is
// staging only; accepting it calls the vendor's own createCourse/
// createModule/createLesson in sequence, exactly as a human typing it in by
// hand would, never a shortcut around those functions.
const curriculumPromptSchema = z.object({
  topic: z.string().min(2),
  audience: z.string().optional().nullable(),
  goals: z.string().optional().nullable(),
});
router.post('/curriculum-drafts', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const input = curriculumPromptSchema.parse(req.body);
    const { draftCurriculum } = require('../services/ai');
    const draft = await draftCurriculum(input);
    const [ins] = await db.query(
      `INSERT INTO lms_curriculum_drafts (prompt_input, draft_json, created_by_user_id)
       VALUES (CAST(:input AS JSON), CAST(:draft AS JSON), :uid)`,
      { input: JSON.stringify(input), draft: JSON.stringify(draft), uid: req.user.id }
    );
    res.status(201).json({ id: ins.insertId, draft });
  } catch (err) { next(err); }
});

router.get('/curriculum-drafts/:id', requirePermission('lms.read'), async (req, res, next) => {
  try {
    const [[row]] = await db.query('SELECT * FROM lms_curriculum_drafts WHERE id = :id', { id: req.params.id });
    if (!row) return res.status(404).json({ error: 'No such draft.' });
    res.json(row);
  } catch (err) { next(err); }
});

router.put('/curriculum-drafts/:id', requirePermission('lms.write'), async (req, res, next) => {
  try {
    await db.query(
      'UPDATE lms_curriculum_drafts SET draft_json = CAST(:draft AS JSON) WHERE id = :id AND status = \'draft\'',
      { draft: JSON.stringify(req.body?.draft || {}), id: req.params.id }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/curriculum-drafts/:id/accept', requirePermission('lms.write'), async (req, res, next) => {
  try {
    const [[row]] = await db.query('SELECT * FROM lms_curriculum_drafts WHERE id = :id', { id: req.params.id });
    if (!row) return res.status(404).json({ error: 'No such draft.' });
    if (row.status !== 'draft') return res.status(409).json({ error: 'This draft was already accepted or discarded.' });
    const draft = row.draft_json;

    const context = await contextFor(viewerIdFor(req.user), 'admin');
    const { lms } = await loadRuntime();
    const created = await lms.createCourse(context, {
      title: draft.title, subtitle: draft.subtitle || null, summary: draft.summary || null,
    });
    for (const mod of (draft.modules || [])) {
      const createdModule = await lms.createModule(context, { courseId: created.id, title: mod.title, summary: mod.summary || null });
      for (const lesson of (mod.lessons || [])) {
        await lms.createLesson(context, {
          moduleId: createdModule.id, title: lesson.title, summary: lesson.summary || null,
          kind: ['video', 'reading', 'assignment'].includes(lesson.kind) ? lesson.kind : 'reading',
          estimatedMinutes: lesson.estimatedMinutes || null,
          keyPoints: Array.isArray(lesson.keyPoints) ? lesson.keyPoints : [],
        });
      }
    }

    await db.query(
      `UPDATE lms_curriculum_drafts SET status = 'accepted', created_course_id = :cid WHERE id = :id`,
      { cid: created.id, id: req.params.id }
    );
    await logActivity({ userId: req.user.id, entityType: 'lms_course', entityId: created.id, action: 'created', description: `Created from AI curriculum draft #${req.params.id}` });
    res.json({ ok: true, courseId: created.id });
  } catch (err) { handleLmsError(err, res, next); }
});

/* ---------------------------------------------------------- enrollments */
//
// One row per LMS-linked invoice (both one-time and recurring purchases
// carry invoices.lms_course_pricing_id — see scripts/ensure-lms-invoice-column.js
// for why one-time needs it too). Raw joins across the app's own tables plus
// a second query against the vendor's course schema, merged in JS — same
// split this file's own GET /courses uses, and the same reasoning as
// routes/lmsCheckout.js's catalog route: lms_course_pricing lives in the
// app's `db` pool, course titles live in the vendor's dedicated pool.
router.get('/enrollments', requirePermission('lms.read'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT i.id AS invoice_id, i.invoice_number, i.total, i.status AS invoice_status, i.issue_date,
             i.lms_course_pricing_id, i.contact_id,
             CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name, c.email AS contact_email,
             p.id AS payment_id, p.status AS payment_status, p.method
        FROM invoices i
        LEFT JOIN contacts c ON c.id = i.contact_id
        LEFT JOIN payments p ON p.invoice_id = i.id
       WHERE i.lms_course_pricing_id IS NOT NULL
       ORDER BY i.id DESC
    `);
    const pricingIds = [...new Set(rows.map((r) => r.lms_course_pricing_id))];
    const [pricingRows] = pricingIds.length
      ? await db.query('SELECT id, course_id, access_type, cohort_id FROM lms_course_pricing WHERE id IN (:ids)', { ids: pricingIds })
      : [[]];
    const pricingById = new Map(pricingRows.map((p) => [p.id, p]));

    const { schema, db: lmsDb } = await loadRuntime();
    const courseIds = [...new Set(pricingRows.map((p) => p.course_id))];
    const courses = courseIds.length
      ? await lmsDb.select({ id: schema.courses.id, title: schema.courses.title }).from(schema.courses)
      : [];
    const titleByCourseId = new Map(courses.map((c) => [c.id, c.title]));

    res.json(rows.map((r) => {
      const pricing = pricingById.get(r.lms_course_pricing_id);
      return {
        ...r,
        course_title: pricing ? titleByCourseId.get(pricing.course_id) : null,
        access_type: pricing?.access_type || null,
        cohort_id: pricing?.cohort_id || null,
      };
    }));
  } catch (err) { next(err); }
});

module.exports = router;
