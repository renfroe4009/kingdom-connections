// =============================================================================
// /api/social — Social Media Accounts + Posts
// -----------------------------------------------------------------------------
// Phase 7: manage connected social accounts and compose/schedule posts.
// Real platform API calls are a future enhancement — publish stub simulates
// the action and returns a descriptive note.
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

// ---- helpers ----------------------------------------------------------------
function safeJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

// ---- schemas ----------------------------------------------------------------
const accountSchema = z.object({
  platform:     z.enum(['facebook', 'instagram', 'linkedin']),
  account_name: z.string().min(1).max(150),
  account_id:   z.string().min(1).max(255),
  access_token: z.string().optional().nullable(),
  page_id:      z.string().max(255).optional().nullable(),
  page_name:    z.string().max(255).optional().nullable(),
  token_expiry: z.string().optional().nullable(),
});

const postSchema = z.object({
  account_id:   z.number().int().positive().optional().nullable(),
  platform:     z.enum(['facebook', 'instagram', 'linkedin']),
  content:      z.string().min(1),
  media_urls:   z.array(z.string().url()).max(4).optional().nullable(),
  scheduled_at: z.string().optional().nullable(),
});

// GET /api/social/stats — post counts by platform/status + connected accounts,
// for the Reports dashboard Social tab
router.get('/stats', requirePermission('campaigns.read'), async (_req, res, next) => {
  try {
    const [accounts] = await db.query(
      `SELECT platform, account_name, page_name, is_active FROM social_accounts ORDER BY platform ASC`,
    );
    const [byPlatform] = await db.query(
      `SELECT platform,
              SUM(status = 'published') AS published,
              SUM(status = 'scheduled') AS scheduled,
              SUM(status = 'draft')     AS draft,
              SUM(status = 'failed')    AS failed,
              COUNT(*)                  AS total
         FROM social_posts
        GROUP BY platform`,
    );
    res.json({
      accounts,
      by_platform: byPlatform.map((r) => ({
        platform:  r.platform,
        published: Number(r.published),
        scheduled: Number(r.scheduled),
        draft:     Number(r.draft),
        failed:    Number(r.failed),
        total:     Number(r.total),
      })),
    });
  } catch (err) { next(err); }
});

// =============================================================================
// ACCOUNTS
// =============================================================================

// GET /api/social/accounts — list all connected accounts
router.get('/accounts', requirePermission('campaigns.read'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id, platform, account_name, account_id, page_id, page_name,
              is_active, token_expiry, connected_at
         FROM social_accounts
        ORDER BY platform ASC, account_name ASC`,
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/social/accounts — add account (manual token entry)
router.post('/accounts', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const d = accountSchema.parse(req.body);
    const [result] = await db.query(
      `INSERT INTO social_accounts
         (platform, account_name, account_id, access_token, token_expiry, page_id, page_name)
       VALUES
         (:platform, :account_name, :account_id, :access_token, :token_expiry, :page_id, :page_name)`,
      {
        platform:     d.platform,
        account_name: d.account_name,
        account_id:   d.account_id,
        access_token: d.access_token || null,
        token_expiry: d.token_expiry ? new Date(d.token_expiry) : null,
        page_id:      d.page_id || null,
        page_name:    d.page_name || null,
      },
    );
    const [[row]] = await db.query(
      'SELECT id, platform, account_name, account_id, page_id, page_name, is_active, connected_at FROM social_accounts WHERE id = :id',
      { id: result.insertId },
    );
    res.status(201).json(row);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with this platform + account ID is already connected.' });
    }
    next(err);
  }
});

// DELETE /api/social/accounts/:id — disconnect account
router.delete('/accounts/:id', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM social_accounts WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================================================
// POSTS
// =============================================================================

// GET /api/social/posts — list posts with optional filters
router.get('/posts', requirePermission('campaigns.read'), async (req, res, next) => {
  try {
    const { status, platform, page = 1, pageSize = 25 } = req.query;
    const where = [];
    const params = {
      limit:  Math.min(Number(pageSize) || 25, 100),
      offset: (Math.max(Number(page) || 1, 1) - 1) * Math.min(Number(pageSize) || 25, 100),
    };

    if (status)   { where.push('p.status = :status');     params.status   = status; }
    if (platform) { where.push('p.platform = :platform'); params.platform = platform; }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT p.id, p.account_id, p.platform, p.content, p.media_urls,
              p.status, p.scheduled_at, p.published_at, p.platform_post_id,
              p.error_msg, p.created_at, p.updated_at,
              a.account_name, a.page_name,
              CONCAT_WS(' ', u.first_name, u.last_name) AS created_by_name
         FROM social_posts p
         LEFT JOIN social_accounts a ON a.id = p.account_id
         LEFT JOIN users u ON u.id = p.created_by
        ${whereClause}
        ORDER BY p.created_at DESC
        LIMIT :limit OFFSET :offset`,
      params,
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM social_posts p ${whereClause}`,
      params,
    );

    res.json({
      rows: rows.map((r) => ({ ...r, media_urls: safeJson(r.media_urls) })),
      total: Number(total),
      page:  Number(page),
      pageSize: params.limit,
    });
  } catch (err) { next(err); }
});

// GET /api/social/posts/:id — single post
router.get('/posts/:id', requirePermission('campaigns.read'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      `SELECT p.*, a.account_name, a.page_name,
              CONCAT_WS(' ', u.first_name, u.last_name) AS created_by_name
         FROM social_posts p
         LEFT JOIN social_accounts a ON a.id = p.account_id
         LEFT JOIN users u ON u.id = p.created_by
        WHERE p.id = :id`,
      { id: req.params.id },
    );
    if (!row) return res.status(404).json({ error: 'Post not found' });
    res.json({ ...row, media_urls: safeJson(row.media_urls) });
  } catch (err) { next(err); }
});

// POST /api/social/posts — create post
router.post('/posts', requirePermission('campaigns.write'), async (req, res, next) => {
  try {
    const d = postSchema.parse(req.body);
    const scheduledAt = d.scheduled_at ? new Date(d.scheduled_at) : null;
    const status = scheduledAt && scheduledAt > new Date() ? 'scheduled' : 'draft';

    const [result] = await db.query(
      `INSERT INTO social_posts
         (account_id, platform, content, media_urls, status, scheduled_at, created_by)
       VALUES
         (:account_id, :platform, :content, CAST(:media_urls AS JSON), :status, :scheduled_at, :created_by)`,
      {
        account_id:   d.account_id || null,
        platform:     d.platform,
        content:      d.content,
        media_urls:   JSON.stringify(d.media_urls || []),
        status,
        scheduled_at: scheduledAt,
        created_by:   req.user.id,
      },
    );

    // Add to queue if scheduled
    if (status === 'scheduled') {
      await db.query(
        'INSERT INTO social_queue (post_id, attempt, next_attempt) VALUES (:post_id, 0, :next_attempt)',
        { post_id: result.insertId, next_attempt: scheduledAt },
      );
    }

    const [[row]] = await db.query(
      'SELECT * FROM social_posts WHERE id = :id',
      { id: result.insertId },
    );
    res.status(201).json({ ...row, media_urls: safeJson(row.media_urls) });
  } catch (err) { next(err); }
});

// PUT /api/social/posts/:id — update draft or scheduled post
router.put('/posts/:id', requirePermission('campaigns.write'), async (req, res, next) => {
  try {
    const [[existing]] = await db.query(
      'SELECT * FROM social_posts WHERE id = :id',
      { id: req.params.id },
    );
    if (!existing) return res.status(404).json({ error: 'Post not found' });
    if (!['draft', 'scheduled'].includes(existing.status)) {
      return res.status(400).json({ error: `Cannot edit a ${existing.status} post` });
    }

    const d = postSchema.parse(req.body);
    const scheduledAt = d.scheduled_at ? new Date(d.scheduled_at) : null;
    const status = scheduledAt && scheduledAt > new Date() ? 'scheduled' : 'draft';

    await db.query(
      `UPDATE social_posts SET
         account_id = :account_id, platform = :platform, content = :content,
         media_urls = CAST(:media_urls AS JSON), status = :status, scheduled_at = :scheduled_at
       WHERE id = :id`,
      {
        id:           req.params.id,
        account_id:   d.account_id || null,
        platform:     d.platform,
        content:      d.content,
        media_urls:   JSON.stringify(d.media_urls || []),
        status,
        scheduled_at: scheduledAt,
      },
    );

    // Sync queue entry
    if (status === 'scheduled') {
      await db.query(
        `INSERT INTO social_queue (post_id, attempt, next_attempt) VALUES (:post_id, 0, :next_attempt)
         ON DUPLICATE KEY UPDATE next_attempt = :next_attempt, attempt = 0`,
        { post_id: req.params.id, next_attempt: scheduledAt },
      );
    } else {
      await db.query('DELETE FROM social_queue WHERE post_id = :post_id', { post_id: req.params.id });
    }

    const [[row]] = await db.query('SELECT * FROM social_posts WHERE id = :id', { id: req.params.id });
    res.json({ ...row, media_urls: safeJson(row.media_urls) });
  } catch (err) { next(err); }
});

// DELETE /api/social/posts/:id
router.delete('/posts/:id', requirePermission('campaigns.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM social_posts WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/social/posts/:id/publish — immediate publish stub
router.post('/posts/:id/publish', requirePermission('campaigns.write'), async (req, res, next) => {
  try {
    const [[existing]] = await db.query(
      'SELECT * FROM social_posts WHERE id = :id',
      { id: req.params.id },
    );
    if (!existing) return res.status(404).json({ error: 'Post not found' });

    await db.query(
      `UPDATE social_posts SET status = 'published', published_at = NOW(), scheduled_at = NULL
       WHERE id = :id`,
      { id: req.params.id },
    );
    // Remove from queue if present
    await db.query('DELETE FROM social_queue WHERE post_id = :post_id', { post_id: req.params.id });

    res.json({
      ok: true,
      note: 'Simulated publish — wire API credentials to enable real posting',
    });
  } catch (err) { next(err); }
});

module.exports = router;
