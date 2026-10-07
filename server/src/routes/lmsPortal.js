// =============================================================================
// /api/portal/lms — the learner-facing side of the Learning module
//
// Mounted separately from routes/portal.js (which owns /api/portal/* for
// everything else) rather than folded into that already-1300-line file.
// Express tries routers in registration order and falls through on no
// match, so two routers sharing the /api/portal prefix is safe as long as
// this one is registered — see index.js.
//
// The acting viewer is always 'learner': this file has no staff path. Every
// entitlement question (may this person see this course/lesson/quiz) is
// answered inside the vendored module itself (requireEntitlement), not
// re-decided here — this layer only resolves who's asking.
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { requirePortal } = require('./portal');
const { loadRuntime, contextFor, statusForLmsError } = require('../lms/runtime');

router.use(requirePortal);

function handleLmsError(err, res, next) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  const status = statusForLmsError(err);
  if (status) return res.status(status).json({ error: err.message });
  next(err);
}

async function learnerContext(req) {
  if (!req.user.contact_id) {
    const err = new Error('Your account has no linked member record, so there is nothing to show here.');
    err.status = 409;
    throw err;
  }
  return contextFor(String(req.user.contact_id), 'learner');
}

router.get('/courses', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const shelf = await lms.myCourses(context);
    res.json(shelf);
  } catch (err) { handleLmsError(err, res, next); }
});

router.get('/courses/:slug', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const course = await lms.getCourse(context, req.params.slug);
    if (!course) return res.status(404).json({ error: 'No such course.' });
    res.json(course);
  } catch (err) { handleLmsError(err, res, next); }
});

router.get('/courses/:courseSlug/lessons/:lessonSlug', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const lesson = await lms.getLesson(context, req.params.courseSlug, req.params.lessonSlug);
    if (!lesson) return res.status(404).json({ error: 'No such lesson.' });
    res.json(lesson);
  } catch (err) { handleLmsError(err, res, next); }
});

router.post('/lessons/:id/complete', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const result = await lms.completeLesson(context, req.params.id);
    res.json(result);
  } catch (err) { handleLmsError(err, res, next); }
});

router.post('/lessons/:id/uncomplete', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    await lms.uncompleteLesson(context, req.params.id);
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

router.get('/lessons/:id/quiz', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const paper = await lms.getQuizPaper(context, req.params.id);
    if (!paper) return res.status(404).json({ error: 'No such quiz.' });
    res.json(paper);
  } catch (err) { handleLmsError(err, res, next); }
});

const attemptSchema = z.object({ answers: z.record(z.string(), z.string()) });
router.post('/quizzes/:id/attempts', async (req, res, next) => {
  try {
    const { answers } = attemptSchema.parse(req.body);
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const result = await lms.submitAttempt(context, { quizId: req.params.id, answers });
    res.json(result);
  } catch (err) { handleLmsError(err, res, next); }
});

module.exports = router;
