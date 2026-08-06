// Generic CMS data table routes — powers the builder Data panel for list pages.
// Each "data type" maps to a DB table + allowed fields (whitelist prevents injection).

const router    = require('express').Router();
const multer    = require('multer');
const { db }    = require('../db');
const storage   = require('../services/storage');
const { requireAuth, requirePermission } = require('../middleware/auth');

// ── Data type registry ──────────────────────────────────────────────────────
// Add new list-page data types here. Fields must match the DB table columns.
const DATA_TYPES = {
  'panther_completions': {
    table:       'panther_completions',
    labelField:  'builder_name',
    permission:  'settings.manage',
    fields: [
      'builder_name','title','aircraft','ac_type',
      'home_base','engine','engine_family','propeller','prop_family',
      'image_url','image_storage_key','image_storage_driver','sort_order',
    ],
  },
  'service_bulletins': {
    table:      'service_bulletins',
    labelField: 'bulletin_number',
    permission: 'settings.manage',
    fields: [
      'bulletin_number','title','category','aircraft',
      'issue_date','affected_serials','summary','pdf_url','sort_order',
    ],
  },
};

function getType(req, res) {
  const cfg = DATA_TYPES[req.params.type];
  if (!cfg) { res.status(404).json({ error: 'Unknown data type' }); return null; }
  return cfg;
}

// ── Multer (memory) ──────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error('Images only (PNG, JPG, GIF, WebP)'), { status: 400 }));
  },
});

router.use(requireAuth);
router.use(requirePermission('settings.manage'));

// ── GET /api/cms/data/:type ─── list all ────────────────────────────────────
router.get('/:type', async (req, res, next) => {
  try {
    const cfg = getType(req, res); if (!cfg) return;
    const [rows] = await db.query(
      `SELECT * FROM ${cfg.table} ORDER BY sort_order ASC, id ASC`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// ── POST /api/cms/data/:type ─── create ─────────────────────────────────────
router.post('/:type', async (req, res, next) => {
  try {
    const cfg = getType(req, res); if (!cfg) return;
    const body = req.body;
    const allowed = cfg.fields.filter(f => body[f] !== undefined);
    if (!allowed.length) return res.status(400).json({ error: 'No valid fields' });
    const cols = allowed.join(', ');
    const vals = allowed.map(f => body[f]);
    const placeholders = allowed.map(() => '?').join(', ');
    const [result] = await db.query(
      `INSERT INTO ${cfg.table} (${cols}) VALUES (${placeholders})`, vals
    );
    const [[row]] = await db.query(`SELECT * FROM ${cfg.table} WHERE id = ?`, [result.insertId]);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// ── PUT /api/cms/data/:type/:id ─── update ───────────────────────────────────
router.put('/:type/:id', async (req, res, next) => {
  try {
    const cfg = getType(req, res); if (!cfg) return;
    const body = req.body;
    const allowed = cfg.fields.filter(f => body[f] !== undefined);
    if (!allowed.length) return res.status(400).json({ error: 'No valid fields' });
    const sets = allowed.map(f => `${f} = ?`).join(', ');
    const vals = [...allowed.map(f => body[f]), req.params.id];
    await db.query(`UPDATE ${cfg.table} SET ${sets} WHERE id = ?`, vals);
    const [[row]] = await db.query(`SELECT * FROM ${cfg.table} WHERE id = ?`, [req.params.id]);
    res.json(row);
  } catch (e) { next(e); }
});

// ── DELETE /api/cms/data/:type/:id ─── delete ───────────────────────────────
router.delete('/:type/:id', async (req, res, next) => {
  try {
    const cfg = getType(req, res); if (!cfg) return;
    const [[row]] = await db.query(`SELECT * FROM ${cfg.table} WHERE id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    // Remove stored image if present
    if (row.image_storage_key && row.image_storage_driver) {
      await storage.remove({ driver: row.image_storage_driver, key: row.image_storage_key }).catch(() => {});
    }
    await db.query(`DELETE FROM ${cfg.table} WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── POST /api/cms/data/:type/:id/photo ─── upload photo ─────────────────────
router.post('/:type/:id/photo', upload.single('file'), async (req, res, next) => {
  try {
    const cfg = getType(req, res); if (!cfg) return;
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const [[existing]] = await db.query(`SELECT * FROM ${cfg.table} WHERE id = ?`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    // Remove old stored image
    if (existing.image_storage_key && existing.image_storage_driver) {
      await storage.remove({ driver: existing.image_storage_driver, key: existing.image_storage_key }).catch(() => {});
    }

    const { key, driver } = await storage.put({
      entity_type: cfg.table,
      entity_id:   req.params.id,
      originalName: req.file.originalname,
      contentType:  req.file.mimetype,
      buffer:       req.file.buffer,
    });

    const imageUrl = `/api/cms/data/${req.params.type}/${req.params.id}/photo/file`;
    await db.query(
      `UPDATE ${cfg.table} SET image_url = ?, image_storage_key = ?, image_storage_driver = ? WHERE id = ?`,
      [imageUrl, key, driver, req.params.id]
    );
    // Register in media library so it appears in the media browser
    await db.query(
      `INSERT INTO media_files (filename, original_name, file_url, mime_type, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE file_url = VALUES(file_url)`,
      [key, req.file.originalname, imageUrl, req.file.mimetype, req.file.size, req.user?.id || null]
    ).catch(() => {});
    res.json({ image_url: imageUrl, key, driver });
  } catch (e) { next(e); }
});

// ── GET /api/cms/data/:type/:id/photo/file ─── serve photo ──────────────────
router.get('/:type/:id/photo/file', async (req, res, next) => {
  try {
    const cfg = getType(req, res); if (!cfg) return;
    const [[row]] = await db.query(
      `SELECT image_storage_key, image_storage_driver FROM ${cfg.table} WHERE id = ?`,
      [req.params.id]
    );
    if (!row?.image_storage_key) return res.status(404).json({ error: 'No photo' });
    const got = await storage.getReadable({ driver: row.image_storage_driver, key: row.image_storage_key });
    if (got.type === 'redirect') return res.redirect(got.url);
    const ext = row.image_storage_key.split('.').pop().toLowerCase();
    const mime = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp' }[ext] || 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    got.stream.on('error', next);
    got.stream.pipe(res);
  } catch (e) { next(e); }
});

// ── PUT /api/cms/data/:type/reorder ─── save sort_order ─────────────────────
router.put('/:type/reorder/batch', async (req, res, next) => {
  try {
    const cfg = getType(req, res); if (!cfg) return;
    const { order } = req.body; // [{ id, sort_order }, ...]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
    await Promise.all(order.map(({ id, sort_order }) =>
      db.query(`UPDATE ${cfg.table} SET sort_order = ? WHERE id = ?`, [sort_order, id])
    ));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
