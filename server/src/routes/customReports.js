// =============================================================================
// /api/custom-reports — Report Builder: saved report CRUD + run/export
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { publicRegistry, getDynamicOptions } = require('../services/reportRegistry');
const { runReport } = require('../services/reportQuery');

router.use(requireAuth);
router.use(requirePermission('reports.view'));

// GET /api/custom-reports/modules — registry metadata for the builder UI
router.get('/modules', (_req, res) => {
  res.json(publicRegistry());
});

// GET /api/custom-reports/options/:module/:column — live option list for an
// enum column whose values aren't a fixed set (e.g. active fund names) —
// resolved through the same registry-controlled query as everything else,
// gated by reports.view rather than whatever permission the source table
// normally requires (e.g. donations.read), since this is report-builder UI.
router.get('/options/:module/:column', async (req, res, next) => {
  try {
    const options = await getDynamicOptions(req.params.module, req.params.column);
    res.json(options);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// GET /api/custom-reports — list reports visible to this user (own + shared)
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT r.id, r.name, r.module, r.visibility, r.created_by, r.created_at, r.updated_at,
              TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS created_by_name
         FROM custom_reports r
         LEFT JOIN users u ON u.id = r.created_by
        WHERE r.visibility = 'shared' OR r.created_by = :uid
        ORDER BY r.updated_at DESC`,
      { uid: req.user.id },
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/custom-reports/:id — one saved report definition
router.get('/:id', async (req, res, next) => {
  try {
    const [[row]] = await db.query('SELECT * FROM custom_reports WHERE id = :id', { id: req.params.id });
    if (!row) return res.status(404).json({ error: 'Report not found' });
    if (row.visibility !== 'shared' && row.created_by !== req.user.id) {
      return res.status(403).json({ error: 'You do not have access to this report' });
    }
    res.json({
      ...row,
      columns_json: typeof row.columns_json === 'string' ? JSON.parse(row.columns_json) : row.columns_json,
      filters_json: typeof row.filters_json === 'string' ? JSON.parse(row.filters_json) : row.filters_json,
      sort_json:    typeof row.sort_json === 'string' ? JSON.parse(row.sort_json) : row.sort_json,
    });
  } catch (err) { next(err); }
});

const reportSchema = z.object({
  name:       z.string().min(1).max(150),
  module:     z.string().min(1),
  columns:    z.array(z.string()).min(1),
  filters:    z.array(z.object({ field: z.string(), operator: z.string(), value: z.any().optional() })).default([]),
  sort:       z.object({ field: z.string(), dir: z.enum(['asc', 'desc']) }).optional().nullable(),
  visibility: z.enum(['private', 'shared']).default('private'),
});

// POST /api/custom-reports — save a new report
router.post('/', async (req, res, next) => {
  try {
    const d = reportSchema.parse(req.body);
    const [result] = await db.query(
      `INSERT INTO custom_reports (name, module, columns_json, filters_json, sort_json, visibility, created_by)
       VALUES (:name, :module, :columns, :filters, :sort, :visibility, :uid)`,
      {
        name: d.name, module: d.module,
        columns: JSON.stringify(d.columns), filters: JSON.stringify(d.filters),
        sort: d.sort ? JSON.stringify(d.sort) : null,
        visibility: d.visibility, uid: req.user.id,
      },
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', issues: err.issues });
    next(err);
  }
});

// PUT /api/custom-reports/:id — update (creator or admin only)
router.put('/:id', async (req, res, next) => {
  try {
    const [[existing]] = await db.query('SELECT created_by FROM custom_reports WHERE id = :id', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    const isAdmin = req.user.roles?.includes('admin');
    if (!isAdmin && existing.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Only the creator can edit this report' });
    }
    const d = reportSchema.parse(req.body);
    await db.query(
      `UPDATE custom_reports
          SET name = :name, module = :module, columns_json = :columns,
              filters_json = :filters, sort_json = :sort, visibility = :visibility
        WHERE id = :id`,
      {
        name: d.name, module: d.module,
        columns: JSON.stringify(d.columns), filters: JSON.stringify(d.filters),
        sort: d.sort ? JSON.stringify(d.sort) : null,
        visibility: d.visibility, id: req.params.id,
      },
    );
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', issues: err.issues });
    next(err);
  }
});

// DELETE /api/custom-reports/:id — creator or admin only
router.delete('/:id', async (req, res, next) => {
  try {
    const [[existing]] = await db.query('SELECT created_by FROM custom_reports WHERE id = :id', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Report not found' });
    const isAdmin = req.user.roles?.includes('admin');
    if (!isAdmin && existing.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Only the creator can delete this report' });
    }
    await db.query('DELETE FROM custom_reports WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// POST /api/custom-reports/run — run an ad-hoc or saved definition
// Body: { module, columns, filters, sort, limit, offset } OR { reportId }
// Query: ?format=csv to download instead of JSON
router.post('/run', async (req, res, next) => {
  try {
    let definition = req.body;
    if (req.body.reportId) {
      const [[saved]] = await db.query('SELECT * FROM custom_reports WHERE id = :id', { id: req.body.reportId });
      if (!saved) return res.status(404).json({ error: 'Report not found' });
      if (saved.visibility !== 'shared' && saved.created_by !== req.user.id) {
        return res.status(403).json({ error: 'You do not have access to this report' });
      }
      definition = {
        module: saved.module,
        columns: typeof saved.columns_json === 'string' ? JSON.parse(saved.columns_json) : saved.columns_json,
        filters: typeof saved.filters_json === 'string' ? JSON.parse(saved.filters_json) : saved.filters_json,
        sort:    typeof saved.sort_json === 'string' ? JSON.parse(saved.sort_json) : saved.sort_json,
      };
    }

    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const { rows, total, columns } = await runReport(definition, req.user, { format });

    if (format === 'csv') {
      const header = columns.join(',');
      const lines = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(','));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="report.csv"`);
      return res.send([header, ...lines].join('\r\n'));
    }

    res.json({ rows, total, columns });
  } catch (err) { next(err); }
});

module.exports = router;
