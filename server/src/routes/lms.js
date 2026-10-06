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
const { eq } = require('drizzle-orm');
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

module.exports = router;
