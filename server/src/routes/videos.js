const router = require('express').Router();
const { db }  = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

// GET /api/videos/public — unauthenticated, for the public Video Gallery block.
// Must be registered before requireAuth below. Filters: ?tags=a,b (any match),
// ?platform=youtube|vimeo.
router.get('/public', async (req, res, next) => {
  try {
    const { tags, platform } = req.query;
    const where = ['is_active = 1'];
    const params = [];
    if (platform && platform !== 'all') { where.push('platform = ?'); params.push(platform); }

    const [rows] = await db.query(
      `SELECT id, title, description, platform, video_id, thumbnail_url, tags
         FROM videos WHERE ${where.join(' AND ')} ORDER BY sort_order ASC, id ASC`,
      params
    );
    const parsed = rows.map((r) => ({ ...r, tags: parseTags(r.tags) }));

    const wanted = (tags || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    const filtered = wanted.length
      ? parsed.filter((v) => v.tags.some((t) => wanted.includes(String(t).toLowerCase())))
      : parsed;

    res.json(filtered);
  } catch (e) { next(e); }
});

router.use(requireAuth);
router.use(requirePermission('settings.manage'));

// Extract platform + video ID from a URL or bare ID string
function parseVideoInput(raw, platformHint) {
  const s = (raw || '').trim();

  const ytMatch = s.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([A-Za-z0-9_-]{11})/
  );
  if (ytMatch) return { platform: 'youtube', videoId: ytMatch[1] };

  const vimeoMatch = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeoMatch) return { platform: 'vimeo', videoId: vimeoMatch[1] };

  // Raw 11-char YouTube ID
  if (/^[A-Za-z0-9_-]{11}$/.test(s) && platformHint !== 'vimeo')
    return { platform: 'youtube', videoId: s };

  // Bare numeric Vimeo ID
  if (/^\d+$/.test(s) || platformHint === 'vimeo')
    return { platform: 'vimeo', videoId: s };

  return { platform: platformHint || 'youtube', videoId: s };
}

async function youtubeThumb(videoId) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

async function vimeoThumb(videoId) {
  try {
    const r = await fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${videoId}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d.thumbnail_url || null;
  } catch { return null; }
}

async function resolveThumbnail(platform, videoId) {
  if (platform === 'youtube') return youtubeThumb(videoId);
  if (platform === 'vimeo')   return vimeoThumb(videoId);
  return null;
}

function parseTags(val) {
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string') {
    try { const p = JSON.parse(val); if (Array.isArray(p)) return p.filter(Boolean); } catch {}
    return val.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

// GET /api/videos — list all
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM videos ORDER BY sort_order ASC, id ASC');
    res.json(rows);
  } catch (e) { next(e); }
});

// POST /api/videos — create
router.post('/', async (req, res, next) => {
  try {
    const { title, description = '', video_url, platform: platformHint, tags: tagsRaw = [], is_active = 1, sort_order = 0 } = req.body;
    if (!title || !video_url) return res.status(400).json({ error: 'title and video_url are required' });

    const { platform, videoId } = parseVideoInput(video_url, platformHint);
    const thumbnail_url = await resolveThumbnail(platform, videoId);
    const tags = JSON.stringify(parseTags(tagsRaw));

    const [result] = await db.query(
      'INSERT INTO videos (title, description, platform, video_id, thumbnail_url, tags, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title, description, platform, videoId, thumbnail_url, tags, is_active ? 1 : 0, sort_order]
    );
    const [[row]] = await db.query('SELECT * FROM videos WHERE id = ?', [result.insertId]);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// PUT /api/videos/:id — update
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [[existing]] = await db.query('SELECT * FROM videos WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { title, description, video_url, platform: platformHint, tags: tagsRaw, is_active, sort_order } = req.body;

    let platform  = existing.platform;
    let videoId   = existing.video_id;
    let thumbnail = existing.thumbnail_url;

    if (video_url) {
      const parsed = parseVideoInput(video_url, platformHint || existing.platform);
      if (parsed.videoId !== existing.video_id || parsed.platform !== existing.platform) {
        platform  = parsed.platform;
        videoId   = parsed.videoId;
        thumbnail = await resolveThumbnail(platform, videoId);
      }
    }

    const tags = tagsRaw !== undefined ? JSON.stringify(parseTags(tagsRaw)) : existing.tags;

    await db.query(
      'UPDATE videos SET title=?, description=?, platform=?, video_id=?, thumbnail_url=?, tags=?, is_active=?, sort_order=? WHERE id=?',
      [
        title       ?? existing.title,
        description ?? existing.description,
        platform,
        videoId,
        thumbnail,
        tags,
        is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
        sort_order  ?? existing.sort_order,
        id,
      ]
    );
    const [[row]] = await db.query('SELECT * FROM videos WHERE id = ?', [id]);
    res.json(row);
  } catch (e) { next(e); }
});

// DELETE /api/videos/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const [[row]] = await db.query('SELECT id FROM videos WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await db.query('DELETE FROM videos WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// PUT /api/videos/reorder/batch
router.put('/reorder/batch', async (req, res, next) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
    await Promise.all(order.map(({ id, sort_order }) =>
      db.query('UPDATE videos SET sort_order = ? WHERE id = ?', [sort_order, id])
    ));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
