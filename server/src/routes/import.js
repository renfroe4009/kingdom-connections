// =============================================================================
// /api/import — CSV import for contacts / organizations
// =============================================================================
const router = require('express').Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(requireAuth);

const ALLOWED_CONTACT_FIELDS = new Set([
  'first_name','last_name','email','phone','mobile','title','department',
  'address_line1','address_line2','city','state','postal_code','country',
  'linkedin_url','lifecycle_stage','lead_source','notes',
]);

const ALLOWED_ORG_FIELDS = new Set([
  'name','website','phone','industry','employee_count','annual_revenue',
  'address_line1','address_line2','city','state','postal_code','country','notes',
]);

/**
 * POST /api/import/csv
 *   multipart/form-data:
 *     file:        CSV
 *     entity_type: 'contact' | 'organization'
 *     mapping:     JSON string { csv_column: contact_column }
 *     organization_match_field: optional (e.g. 'name') to auto-link contacts to orgs
 */
router.post('/csv', requirePermission('import.csv'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing file' });
    const entityType = req.body.entity_type;
    const mapping = req.body.mapping ? JSON.parse(req.body.mapping) : {};
    if (!['contact','organization'].includes(entityType)) {
      return res.status(400).json({ error: 'Invalid entity_type' });
    }
    const allowed = entityType === 'contact' ? ALLOWED_CONTACT_FIELDS : ALLOWED_ORG_FIELDS;

    const records = parse(req.file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const [jobIns] = await db.query(
      `INSERT INTO csv_import_jobs (user_id, entity_type, filename, mapping_json, total_rows, status)
       VALUES (:uid, :et, :fn, CAST(:map AS JSON), :total, 'running')`,
      { uid: req.user.id, et: entityType, fn: req.file.originalname, map: JSON.stringify(mapping), total: records.length }
    );
    const jobId = jobIns.insertId;

    let success = 0, failed = 0;
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const data = {};
      for (const [csvCol, dbCol] of Object.entries(mapping)) {
        if (!allowed.has(dbCol)) continue;
        const v = row[csvCol];
        if (v !== undefined && v !== '') data[dbCol] = v;
      }
      if (!Object.keys(data).length) { failed++; continue; }

      try {
        if (entityType === 'contact' && req.body.organization_match_field && row[req.body.organization_match_field]) {
          const orgName = row[req.body.organization_match_field];
          const [orgRows] = await db.query(
            'SELECT id FROM organizations WHERE name = :name LIMIT 1', { name: orgName });
          if (orgRows[0]) data.organization_id = orgRows[0].id;
        }
        const cols = Object.keys(data);
        const ph   = cols.map((c) => `:${c}`).join(', ');
        const table = entityType === 'contact' ? 'contacts' : 'organizations';
        await db.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph})`, data);
        success++;
      } catch (e) {
        failed++;
        errors.push({ row: i + 1, message: e.message });
      }
    }

    await db.query(
      `UPDATE csv_import_jobs
          SET success_rows = :s, failed_rows = :f, status = 'completed',
              completed_at = NOW(), error_log = :err
        WHERE id = :id`,
      { s: success, f: failed, id: jobId, err: errors.length ? JSON.stringify(errors.slice(0, 200)) : null }
    );

    res.json({ ok: true, job_id: jobId, total: records.length, success, failed, errors: errors.slice(0, 50) });
  } catch (err) { next(err); }
});

router.get('/jobs', requirePermission('import.csv'), async (_req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM csv_import_jobs ORDER BY id DESC LIMIT 50');
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
