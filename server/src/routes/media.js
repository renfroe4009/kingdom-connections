const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }
const { db }      = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const storage     = require('../services/storage');

const router = express.Router();

// Keep local uploads dir for the local driver
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Accept files into memory so we can pass buffers to the storage service
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ALLOWED = [
      'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
      'application/pdf','video/mp4','video/webm',
    ];
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`File type not allowed: ${file.mimetype}`));
  },
});

const IMAGE_TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif']);

async function processAndStore(file, req) {
  let buffer    = file.buffer;
  let mime_type = file.mimetype;
  let width     = null;
  let height    = null;
  let originalName = file.originalname;

  if (IMAGE_TYPES.has(file.mimetype) && sharp) {
    try {
      const result = await sharp(file.buffer)
        .rotate()
        .resize({ width: 2400, withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer({ resolveWithObject: true });

      buffer    = result.data;
      mime_type = 'image/webp';
      width     = result.info.width;
      height    = result.info.height;
      originalName = path.basename(file.originalname, path.extname(file.originalname)) + '.webp';
    } catch (_e) {
      // sharp failed — fall through and store raw
    }
  }

  const { key } = await storage.put({
    entity_type:  'media',
    entity_id:    'library',
    originalName,
    contentType:  mime_type,
    buffer,
  });

  // S3/R2 gives a stable public URL directly; local disk has none, so we
  // serve it ourselves through the unauthenticated /file/* route below.
  const file_url = storage.getPublicUrl(key)
    || `${req.protocol}://${req.get('host')}/api/website/media/file/${key}`;

  return {
    filename:  key,
    mime_type,
    file_size: buffer.length,
    width,
    height,
    file_url,
  };
}

// Media-library keys are always shaped by buildKey() in services/storage.js:
// entity_type/entity_id/YYYY-MM-DD/<40 hex><ext>. Anything else was never
// produced by this app's own upload flow.
const KEY_RE = /^[a-z0-9_-]+\/[a-z0-9_-]+\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{40}(\.[a-z0-9]{1,8})?$/i;

// ── GET /file/* ─── public read for media library files ─────────────────────
// Unauthenticated on purpose — media library assets (page/blog images) are
// meant to render on public pages via plain <img src>. Only reachable path
// for the local storage driver, which has no public URL of its own; S3/R2
// files bypass this entirely and link straight to the bucket.
router.get('/file/*', async (req, res) => {
  try {
    const key = req.params[0];
    // Reject anything not shaped like a real generated key before it ever
    // reaches the filesystem layer (defense in depth on top of storage.js's
    // own path-containment check).
    if (!KEY_RE.test(key)) return res.status(400).end();
    // Only ever serve keys this app itself registered in the media library —
    // removes attacker control over the path entirely, regardless of shape.
    const [[registered]] = await db.query(
      'SELECT id FROM media_files WHERE filename = :key LIMIT 1',
      { key }
    );
    if (!registered) return res.status(404).end();

    const got = await storage.getReadable({ driver: storage.driver, key });
    if (got.type === 'redirect') return res.redirect(got.url);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    got.stream.on('error', () => res.status(404).end());
    got.stream.pipe(res);
  } catch (err) {
    res.status(err?.status || 404).end();
  }
});

// ── POST /upload ─────────────────────────────────────────────────────────────
router.post('/upload', requireAuth, requirePermission('settings.manage'), upload.array('files', 20), async (req, res) => {
  try {
    const userId   = req.user?.id || null;
    const folderId = req.body.folder_id ? parseInt(req.body.folder_id, 10) : null;
    const inserted = [];

    for (const file of req.files) {
      const saved = await processAndStore(file, req);

      const [result] = await db.query(
        `INSERT INTO media_files (filename, original_name, file_url, mime_type, file_size, width, height, folder_id, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [saved.filename, file.originalname, saved.file_url, saved.mime_type,
         saved.file_size, saved.width, saved.height, folderId, userId]
      );
      inserted.push({ id: result.insertId, ...saved, original_name: file.originalname, folder_id: folderId });
    }

    res.status(201).json(inserted);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET / ─── list files (optionally filtered by folder) ─────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search = '', type = '', folder_id = '' } = req.query;
    let sql = `SELECT m.*, u.first_name, u.last_name
               FROM media_files m
               LEFT JOIN users u ON u.id = m.uploaded_by
               WHERE 1=1`;
    const params = [];

    if (folder_id === 'root') {
      sql += ' AND m.folder_id IS NULL';
    } else if (folder_id) {
      sql += ' AND m.folder_id = ?'; params.push(parseInt(folder_id, 10));
    }
    if (search) {
      sql += ' AND (m.original_name LIKE ? OR m.alt_text LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (type === 'image')      sql += " AND m.mime_type LIKE 'image/%'";
    else if (type === 'video') sql += " AND m.mime_type LIKE 'video/%'";
    else if (type === 'doc')   sql += " AND m.mime_type NOT LIKE 'image/%' AND m.mime_type NOT LIKE 'video/%'";

    sql += ' ORDER BY m.created_at DESC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /folders ─── folder tree ─────────────────────────────────────────────
router.get('/folders', requireAuth, async (req, res) => {
  try {
    const [folders] = await db.query(
      `SELECT f.*, COUNT(m.id) AS file_count
       FROM media_folders f
       LEFT JOIN media_files m ON m.folder_id = f.id
       GROUP BY f.id
       ORDER BY f.name ASC`
    );
    res.json(folders);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /folders ─── create folder ──────────────────────────────────────────
router.post('/folders', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const { name, parent_id = null } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const [result] = await db.query(
      'INSERT INTO media_folders (name, parent_id) VALUES (?, ?)',
      [name.trim(), parent_id || null]
    );
    res.status(201).json({ id: result.insertId, name: name.trim(), parent_id: parent_id || null, file_count: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /folders/:id ─── rename folder ─────────────────────────────────────
router.patch('/folders/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    await db.query('UPDATE media_folders SET name = ? WHERE id = ?', [name.trim(), req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /folders/:id ───────────────────────────────────────────────────────
router.delete('/folders/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    await db.query('UPDATE media_files SET folder_id = NULL WHERE folder_id = ?', [req.params.id]);
    await db.query('DELETE FROM media_folders WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /:id ─── update alt text and/or move to folder ─────────────────────
router.patch('/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    const { alt_text, folder_id } = req.body;
    const sets = []; const vals = [];
    if (alt_text !== undefined) { sets.push('alt_text = ?'); vals.push(alt_text || ''); }
    if (folder_id !== undefined) { sets.push('folder_id = ?'); vals.push(folder_id === null || folder_id === '' ? null : parseInt(folder_id, 10)); }
    if (sets.length) {
      vals.push(id);
      await db.query(`UPDATE media_files SET ${sets.join(', ')} WHERE id = ?`, vals);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    const [[file]] = await db.query('SELECT filename FROM media_files WHERE id = ?', [id]);
    if (!file) return res.status(404).json({ error: 'Not found' });

    // New-format keys contain path separators (e.g. "media/library/2024-07-01/abc.webp").
    // Old flat filenames were stored directly in uploads/ — fall back to disk delete for those.
    if (file.filename.includes('/')) {
      await storage.remove({ driver: storage.driver, key: file.filename });
    } else {
      const filePath = path.join(UPLOADS_DIR, file.filename);
      try { fs.unlinkSync(filePath); } catch (_e) { /* already gone */ }
    }

    await db.query('DELETE FROM media_files WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
