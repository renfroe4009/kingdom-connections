// =============================================================================
// /api/settings — SMTP + KV + permissions lookup (auth is via requireAuth)
// CW Manage settings live at /api/connectwise/settings
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission, requirePermissionNoMfaGate } = require('../middleware/auth');
const multer = require('multer');
const storage = require('../services/storage');

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter(_req, file, cb) {
    if (/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error('Only image files are allowed (PNG, JPG, GIF, WebP, SVG)'), { status: 400 }));
  },
});

// -------- Public theme — colors for dynamic CSS vars (no auth needed) --------
router.get('/public/theme', async (_req, res, next) => {
  try {
    const [[row]] = await db.query(
      'SELECT primary_color, secondary_color, logo_web_url FROM business_settings WHERE id = 1'
    );
    res.json({
      primary_color:   row?.primary_color   || '#F05523',
      secondary_color: row?.secondary_color || '#1A1A1A',
      logo_web_url:    row?.logo_web_url    || '',
    });
  } catch (err) { next(err); }
});

// -------- Logo serve (public — used in invoices, emails, portal) --------
// Must be defined BEFORE router.use(requireAuth) so invoices/emails can load it.
router.get('/business/logo/:slot', async (req, res, next) => {
  try {
    const slot = req.params.slot;
    if (slot !== 'web' && slot !== 'print') return res.status(400).json({ error: 'Invalid slot' });

    const [[row]] = await db.query(
      `SELECT logo_${slot}_storage_key AS storage_key, logo_${slot}_storage_driver AS driver
         FROM business_settings WHERE id = 1`
    );
    if (!row?.storage_key) return res.status(404).json({ error: 'No uploaded logo' });

    const got = await storage.getReadable({ driver: row.driver || 'local', key: row.storage_key });
    if (got.type === 'redirect') return res.redirect(got.url);

    const ext = row.storage_key.split('.').pop().toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                   gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/png';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    got.stream.on('error', next);
    got.stream.pipe(res);
  } catch (err) { next(err); }
});

router.use(requireAuth);

// -------- SMTP --------
router.get('/smtp', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM smtp_settings ORDER BY id DESC LIMIT 1');
    const r = rows[0] ? {
      ...rows[0],
      // MySQL TINYINT(1) comes back as 0/1 — convert so the form & zod schema see real booleans.
      secure:    !!rows[0].secure,
      is_active: !!rows[0].is_active,
      password:  rows[0].password ? '********' : '',
    } : null;
    res.json(r);
  } catch (err) { next(err); }
});

const smtpSchema = z.object({
  host: z.string().min(1),
  port: z.number().int(),
  secure: z.boolean().optional(),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  from_email: z.string().email(),
  from_name: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
});

router.put('/smtp', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const d = smtpSchema.parse(req.body);
    const [rows] = await db.query('SELECT id, password FROM smtp_settings ORDER BY id DESC LIMIT 1');
    const existing = rows[0];
    // Don't overwrite with masked password
    const password = d.password === '********' ? existing?.password || '' : (d.password || '');
    if (existing) {
      await db.query(
        `UPDATE smtp_settings SET host=:host, port=:port, secure=:secure,
                username=:username, password=:password,
                from_email=:from_email, from_name=:from_name, is_active=:is_active
          WHERE id=:id`,
        {
          id: existing.id,
          host: d.host, port: d.port, secure: d.secure ? 1 : 0,
          username: d.username || null, password,
          from_email: d.from_email, from_name: d.from_name || null,
          is_active: d.is_active === false ? 0 : 1,
        }
      );
    } else {
      await db.query(
        `INSERT INTO smtp_settings (host, port, secure, username, password, from_email, from_name, is_active)
         VALUES (:host,:port,:secure,:username,:password,:from_email,:from_name,:is_active)`,
        {
          host: d.host, port: d.port, secure: d.secure ? 1 : 0,
          username: d.username || null, password,
          from_email: d.from_email, from_name: d.from_name || null,
          is_active: d.is_active === false ? 0 : 1,
        }
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// -------- Business Settings --------
router.get('/business', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM business_settings WHERE id = 1 LIMIT 1');
    if (!rows[0]) {
      // Should never happen (migration inserts the row), but be safe.
      await db.query('INSERT IGNORE INTO business_settings (id) VALUES (1)');
      return res.json({
        business_name: '', address: '', city: '', state: '', zip: '', country: '',
        phone: '', email: '', website: '',
        primary_color: '#F05523', secondary_color: '#1A1A1A',
        logo_web_url: '', logo_print_url: '',
        alert_emails: [],
      });
    }
    const row = rows[0];
    // Ensure alert_emails is always an array.
    let alert_emails = [];
    try {
      alert_emails = Array.isArray(row.alert_emails)
        ? row.alert_emails
        : (row.alert_emails ? JSON.parse(row.alert_emails) : []);
    } catch (_) { alert_emails = []; }
    res.json({ ...row, alert_emails });
  } catch (err) { next(err); }
});

router.put('/business', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const b = req.body;
    // Normalise alert_emails: accept array or comma-separated string.
    let alert_emails = [];
    if (Array.isArray(b.alert_emails)) {
      alert_emails = b.alert_emails.filter(Boolean);
    } else if (typeof b.alert_emails === 'string') {
      alert_emails = b.alert_emails.split(',').map((e) => e.trim()).filter(Boolean);
    }
    await db.query(
      `UPDATE business_settings SET
        business_name   = :business_name,
        address         = :address,
        city            = :city,
        state           = :state,
        zip             = :zip,
        country         = :country,
        phone           = :phone,
        email           = :email,
        website         = :website,
        primary_color   = :primary_color,
        secondary_color = :secondary_color,
        logo_web_url    = :logo_web_url,
        logo_print_url  = :logo_print_url,
        alert_emails     = CAST(:alert_emails AS JSON),
        default_tax_rate = :default_tax_rate,
        tax_state        = :tax_state,
        tax_id_number    = :tax_id_number
      WHERE id = 1`,
      {
        business_name:    b.business_name    || '',
        address:          b.address          || '',
        city:             b.city             || '',
        state:            b.state            || '',
        zip:              b.zip              || '',
        country:          b.country          || '',
        phone:            b.phone            || '',
        email:            b.email            || '',
        website:          b.website          || '',
        primary_color:    b.primary_color    || '#F05523',
        secondary_color:  b.secondary_color  || '#1A1A1A',
        logo_web_url:     b.logo_web_url     || '',
        logo_print_url:   b.logo_print_url   || '',
        alert_emails:     JSON.stringify(alert_emails),
        default_tax_rate: b.default_tax_rate != null ? Number(b.default_tax_rate) : 0,
        tax_state:        b.tax_state        || '',
        tax_id_number:    b.tax_id_number    || '',
      }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// -------- Logo upload / serve / delete --------

const LOGO_SLOTS = new Set(['web', 'print']);

// POST /settings/business/logo/:slot  — upload web or print logo
router.post('/business/logo/:slot', requirePermission('settings.manage'),
  logoUpload.single('file'),
  async (req, res, next) => {
    try {
      const slot = req.params.slot;
      if (!LOGO_SLOTS.has(slot)) return res.status(400).json({ error: 'slot must be "web" or "print"' });
      if (!req.file) return res.status(400).json({ error: 'file is required' });

      // Delete old stored file if one exists
      const [[row]] = await db.query(
        `SELECT logo_${slot}_storage_key AS storage_key, logo_${slot}_storage_driver AS driver
           FROM business_settings WHERE id = 1`
      );
      if (row?.storage_key) {
        await storage.remove({ driver: row.driver || 'local', key: row.storage_key }).catch(() => {});
      }

      const stored = await storage.put({
        entity_type: 'business_logo',
        entity_id:   slot,
        originalName: req.file.originalname,
        contentType:  req.file.mimetype,
        buffer:       req.file.buffer,
      });

      const serveUrl = `/api/settings/business/logo/${slot}`;
      await db.query(
        `UPDATE business_settings
            SET logo_${slot}_url             = :url,
                logo_${slot}_storage_key     = :key,
                logo_${slot}_storage_driver  = :driver
          WHERE id = 1`,
        { url: serveUrl, key: stored.key, driver: stored.driver }
      );

      res.json({ url: serveUrl, driver: stored.driver });
    } catch (err) {
      if (err?.status === 400) return res.status(400).json({ error: err.message });
      next(err);
    }
  }
);

// DELETE /settings/business/logo/:slot
router.delete('/business/logo/:slot', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const slot = req.params.slot;
    if (!LOGO_SLOTS.has(slot)) return res.status(400).json({ error: 'Invalid slot' });

    const [[row]] = await db.query(
      `SELECT logo_${slot}_storage_key AS storage_key, logo_${slot}_storage_driver AS driver
         FROM business_settings WHERE id = 1`
    );
    if (row?.storage_key) {
      await storage.remove({ driver: row.driver || 'local', key: row.storage_key }).catch(() => {});
    }

    await db.query(
      `UPDATE business_settings
          SET logo_${slot}_url             = '',
              logo_${slot}_storage_key     = '',
              logo_${slot}_storage_driver  = ''
        WHERE id = 1`
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// -------- Module settings --------
const moduleSettings = require('../services/moduleSettings');
const VALID_MODULES  = new Set(['invoices', 'payments', 'contacts', 'organizations', 'deals', 'tasks', 'subscriptions', 'security']);

// Security remediation H-01 — the 'security' module (the org-wide MFA
// toggle) deliberately uses requirePermissionNoMfaGate, not
// requirePermission: settings.manage is itself an MFA-mandatory
// permission, so gating this specific route the normal way would mean an
// admin who enables org MFA without having enrolled first could never
// reach the one route that turns it back off. Every other module stays
// behind the normal (MFA-gated) check.
function moduleGate(module) {
  return module === 'security' ? requirePermissionNoMfaGate('settings.manage') : requirePermission('settings.manage');
}

router.get('/module/:module', (req, res, next) => moduleGate(req.params.module)(req, res, next), async (req, res, next) => {
  try {
    const { module } = req.params;
    if (!VALID_MODULES.has(module)) return res.status(400).json({ error: 'Unknown module' });
    res.json(await moduleSettings.get(module));
  } catch (err) { next(err); }
});

router.put('/module/:module', (req, res, next) => moduleGate(req.params.module)(req, res, next), async (req, res, next) => {
  try {
    const { module } = req.params;
    if (!VALID_MODULES.has(module)) return res.status(400).json({ error: 'Unknown module' });
    await moduleSettings.set(module, req.body);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// -------- Generic KV --------
router.get('/kv/:key', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM settings WHERE `key` = :k', { k: req.params.key });
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

router.put('/kv/:key', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    await db.query(
      `INSERT INTO settings (\`key\`, value_json) VALUES (:k, CAST(:v AS JSON))
         ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)`,
      { k: req.params.key, v: JSON.stringify(req.body?.value ?? null) }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// -------- SMS / Twilio --------
router.get('/sms', requirePermission('settings.manage'), async (_req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM sms_settings ORDER BY id DESC LIMIT 1');
    if (!rows[0]) return res.json(null);
    res.json({
      ...rows[0],
      is_active:  !!rows[0].is_active,
      auth_token: rows[0].auth_token ? '••••••••' : '',
    });
  } catch (err) { next(err); }
});

const smsSchema = z.object({
  provider:    z.enum(['twilio', 'dryrun']),
  account_sid: z.string().optional().nullable(),
  api_key_sid: z.string().optional().nullable(),
  auth_token:  z.string().optional().nullable(),
  from_number: z.string().optional().nullable(),
  is_active:   z.boolean().optional(),
  text_to_give_enabled:       z.boolean().optional(),
  text_to_give_keyword:       z.string().max(20).optional(),
  text_to_give_landing_path:  z.string().max(255).optional().nullable(),
  text_to_give_reply_template: z.string().optional().nullable(),
  text_to_give_help_template:  z.string().optional().nullable(),
});

router.put('/sms', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const d = smsSchema.parse(req.body);
    const [rows] = await db.query('SELECT id, auth_token FROM sms_settings ORDER BY id DESC LIMIT 1');
    const existing = rows[0];
    const authToken = (d.auth_token && !d.auth_token.startsWith('•'))
      ? d.auth_token
      : existing?.auth_token || null;
    const ttgFields = {
      ttgEnabled:  d.text_to_give_enabled ? 1 : 0,
      ttgKeyword:  (d.text_to_give_keyword || 'GIVE').trim().toUpperCase().slice(0, 20),
      ttgPath:     d.text_to_give_landing_path || null,
      ttgReply:    d.text_to_give_reply_template || null,
      ttgHelp:     d.text_to_give_help_template  || null,
    };
    if (existing) {
      await db.query(
        `UPDATE sms_settings SET provider=:prov, account_sid=:sid, api_key_sid=:key,
                auth_token=:tok, from_number=:num, is_active=:active,
                text_to_give_enabled=:ttgEnabled, text_to_give_keyword=:ttgKeyword,
                text_to_give_landing_path=:ttgPath, text_to_give_reply_template=:ttgReply,
                text_to_give_help_template=:ttgHelp
          WHERE id=:id`,
        { id: existing.id, prov: d.provider, sid: d.account_sid || null,
          key: d.api_key_sid || null, tok: authToken,
          num: d.from_number || null, active: d.is_active === false ? 0 : 1,
          ...ttgFields }
      );
    } else {
      await db.query(
        `INSERT INTO sms_settings
           (provider, account_sid, api_key_sid, auth_token, from_number, is_active,
            text_to_give_enabled, text_to_give_keyword, text_to_give_landing_path,
            text_to_give_reply_template, text_to_give_help_template)
         VALUES (:prov, :sid, :key, :tok, :num, :active,
                 :ttgEnabled, :ttgKeyword, :ttgPath, :ttgReply, :ttgHelp)`,
        { prov: d.provider, sid: d.account_sid || null, key: d.api_key_sid || null,
          tok: authToken, num: d.from_number || null, active: d.is_active === false ? 0 : 1,
          ...ttgFields }
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/sms/test', requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const { to } = req.body || {};
    if (!to) return res.status(400).json({ error: 'to number required' });
    const { sendSms } = require('../services/sms');
    // Build status callback URL so Twilio can report actual delivery outcome.
    const proto   = req.headers['x-forwarded-proto'] || req.protocol;
    const host    = req.headers['x-forwarded-host']  || req.get('host');
    const statusCallbackUrl = `${proto}://${host}/api/sms/webhook/twilio/status`;
    const result = await sendSms({
      to,
      body: 'Test message from localCRM — Twilio connection verified.',
      userId: req.user.id,
      statusCallbackUrl,
    });
    // If errorCode is present Twilio rejected the message immediately.
    if (result.errorCode) {
      return res.status(400).json({
        ok: false,
        error: `Twilio rejected the message (error ${result.errorCode}). Common causes: unverified toll-free number, trial account restrictions, or invalid recipient.`,
        errorCode: result.errorCode,
      });
    }
    res.json({ ok: true, ...result, statusCallbackUrl });
  } catch (err) { next(err); }
});

module.exports = router;
