// =============================================================================
// /api/attachments — file uploads for contacts / organizations / deals
//
// GET  /api/attachments?entity_type=&entity_id=
// POST /api/attachments    (multipart: file + entity_type + entity_id)
// GET  /api/attachments/:id/download
// DELETE /api/attachments/:id
// =============================================================================
const router = require('express').Router();
const multer = require('multer');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const storage = require('../services/storage');
const { logActivity } = require('../services/activity');
const { assertOwnerEntityInScope } = require('../services/scope');

router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

const VALID_ENTITIES = new Set(['contact', 'organization', 'deal', 'volunteer_compliance_item']);
// Parent table for each entity type that HAS an owner_id to scope by.
// volunteer_compliance_item is deliberately absent — that table has no
// owner_id column (compliance tracking isn't per-sales-rep scoped), so
// those attachments are visible to anyone holding the coarse read
// permission, unchanged from before this fix.
const ENTITY_TABLE = { contact: 'contacts', organization: 'organizations', deal: 'deals' };

// A per-entity permission map keeps this consistent with the rest of the API
const ENTITY_WRITE_PERM = {
  contact:      'contacts.write',
  organization: 'organizations.write',
  deal:         'deals.write',
  volunteer_compliance_item: 'volunteers.write',
};
const ENTITY_READ_PERM = {
  contact:      'contacts.read',
  organization: 'organizations.read',
  deal:         'deals.read',
  volunteer_compliance_item: 'volunteers.read',
};

function ensureEntity(type) {
  if (!VALID_ENTITIES.has(type)) throw Object.assign(new Error('Invalid entity_type'), { status: 400 });
}
function permFor(user, key) {
  if (user?.roles?.includes?.('admin')) return true;
  return user?.permissions?.includes?.(key);
}

// List
router.get('/', async (req, res, next) => {
  try {
    const { entity_type } = req.query;
    const entity_id = Number(req.query.entity_id);
    ensureEntity(entity_type);
    if (!permFor(req.user, ENTITY_READ_PERM[entity_type])) return res.status(403).json({ error: 'Forbidden' });
    if (ENTITY_TABLE[entity_type]) {
      await assertOwnerEntityInScope(req.user, ENTITY_TABLE[entity_type], entity_id);
    }

    const [rows] = await db.query(
      `SELECT a.id, a.entity_type, a.entity_id, a.file_name, a.content_type,
              a.size_bytes, a.storage_driver, a.created_at,
              CONCAT_WS(' ', u.first_name, u.last_name) AS uploaded_by_name
         FROM attachments a
         LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE a.entity_type = :et AND a.entity_id = :eid
        ORDER BY a.created_at DESC`,
      { et: entity_type, eid: entity_id }
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// Upload
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const entity_type = req.body.entity_type;
    const entity_id = Number(req.body.entity_id);
    ensureEntity(entity_type);
    if (!entity_id) return res.status(400).json({ error: 'entity_id required' });
    if (!permFor(req.user, ENTITY_WRITE_PERM[entity_type])) return res.status(403).json({ error: 'Forbidden' });
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const stored = await storage.put({
      entity_type,
      entity_id,
      originalName: req.file.originalname,
      contentType: req.file.mimetype,
      buffer: req.file.buffer,
    });

    const [ins] = await db.query(
      `INSERT INTO attachments (entity_type, entity_id, file_name, content_type, size_bytes,
                                storage_key, storage_bucket, storage_driver, uploaded_by)
       VALUES (:et, :eid, :fn, :ct, :sz, :key, :bucket, :driver, :uid)`,
      {
        et: entity_type, eid: entity_id,
        fn: req.file.originalname,
        ct: req.file.mimetype || null,
        sz: req.file.size,
        key: stored.key,
        bucket: stored.bucket,
        driver: stored.driver,
        uid: req.user.id,
      }
    );

    await logActivity({
      userId: req.user.id,
      entityType: entity_type,
      entityId: entity_id,
      action: 'file_uploaded',
      description: `Uploaded ${req.file.originalname}`,
    });

    res.status(201).json({ id: ins.insertId, file_name: req.file.originalname, size_bytes: req.file.size });
  } catch (err) {
    if (err?.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Download
router.get('/:id/download', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM attachments WHERE id = :id LIMIT 1', { id: req.params.id });
    const a = rows[0];
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!permFor(req.user, ENTITY_READ_PERM[a.entity_type])) return res.status(403).json({ error: 'Forbidden' });
    // Row-level scope check (security remediation H-03) — the permission
    // check above is coarse (does the caller hold contacts.read at all?);
    // this confirms the specific parent entity is actually in their scope,
    // so a scoped sales agent can't enumerate :id to reach someone else's
    // contact's attachments.
    if (ENTITY_TABLE[a.entity_type]) {
      await assertOwnerEntityInScope(req.user, ENTITY_TABLE[a.entity_type], a.entity_id);
    }

    const got = await storage.getReadable({ driver: a.storage_driver, key: a.storage_key, filename: a.file_name });
    if (got.type === 'redirect') return res.redirect(got.url);
    // Always serve as octet-stream regardless of the stored content_type.
    // Trusting a caller-supplied MIME type could allow a malicious uploader to
    // serve HTML/SVG with script content inline rather than as a download (Finding 13).
    const safeName = a.file_name.replace(/[^\w.\-]/g, '_'); // strip header-injection chars
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    got.stream.on('error', (e) => next(e));
    got.stream.pipe(res);
  } catch (err) { next(err); }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM attachments WHERE id = :id LIMIT 1', { id: req.params.id });
    const a = rows[0];
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!permFor(req.user, ENTITY_WRITE_PERM[a.entity_type])) return res.status(403).json({ error: 'Forbidden' });
    if (ENTITY_TABLE[a.entity_type]) {
      await assertOwnerEntityInScope(req.user, ENTITY_TABLE[a.entity_type], a.entity_id);
    }

    await storage.remove({ driver: a.storage_driver, key: a.storage_key });
    await db.query('DELETE FROM attachments WHERE id = :id', { id: a.id });

    await logActivity({
      userId: req.user.id,
      entityType: a.entity_type,
      entityId: a.entity_id,
      action: 'file_deleted',
      description: `Deleted ${a.file_name}`,
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
