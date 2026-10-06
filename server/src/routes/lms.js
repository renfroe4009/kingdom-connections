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
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const { loadRuntime, contextFor, statusForLmsError } = require('../lms/runtime');

router.use(requireAuth);

function viewerIdFor(user) {
  return user.contact_id ? String(user.contact_id) : `staff:${user.id}`;
}

function handleLmsError(err, res, next) {
  const status = statusForLmsError(err);
  if (status) return res.status(status).json({ error: err.message });
  next(err);
}

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
