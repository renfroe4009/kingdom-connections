// =============================================================================
// Forms Builder routes
// Admin CRUD: requirePermission('settings.manage')
// Public endpoints: no auth required
// =============================================================================
const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');
const { triggerWorkflow } = require('../services/automations');
const { ensureConstituentTag } = require('../services/constituents');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toSlug(str) {
  return str
    .toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 140);
}

const ALL_FIELD_TYPES = [
  'text','email','phone','textarea','select','checkbox','radio','date','number','file',
  'url','time','rating','range','checkboxes','heading','divider','paragraph','hidden','terms',
];

const fieldSchema = z.object({
  id:              z.number().int().positive().optional(),
  field_key:       z.string().min(1),
  label:           z.string().min(1),
  field_type:      z.enum(ALL_FIELD_TYPES).optional(),
  placeholder:     z.string().optional().nullable(),
  help_text:       z.string().optional().nullable(),
  default_value:   z.string().optional().nullable(),
  col_width:       z.enum(['full','half','third','two-thirds']).optional().nullable(),
  options_json:    z.any().optional().nullable(),
  validation_json: z.any().optional().nullable(),
  is_required:     z.preprocess(v => (v == null ? false : Boolean(v)), z.boolean().optional()),
  sort_order:      z.number().int().optional(),
  show_if_json:    z.any().optional().nullable(),
});

const formSchema = z.object({
  name:             z.string().min(1),
  slug:             z.string().optional(),
  description:      z.string().optional().nullable(),
  submit_text:      z.string().optional(),
  success_msg:      z.string().optional().nullable(),
  notify_email:     z.preprocess(v => (v === '' ? null : v), z.string().email().optional().nullable()),
  is_active:        z.boolean().optional(),
  crm_action:       z.enum(['none','create_contact','create_contact_deal','volunteer_signup']).optional().nullable(),
  crm_mapping_json: z.any().optional().nullable(),
  redirect_url:     z.string().optional().nullable(),
  html_id:          z.string().optional().nullable(),
  css_class:        z.string().optional().nullable(),
  submit_class:     z.string().optional().nullable(),
  honeypot:         z.boolean().optional(),
  fields:           z.array(fieldSchema).optional(),
});

// Allowed CRM contact column names (whitelist prevents injection)
const ALLOWED_CRM_FIELDS = new Set([
  'first_name','last_name','email','phone','mobile','title','department',
  'address_line1','address_line2','city','state','postal_code','country',
  'linkedin_url','lifecycle_stage','lead_source','notes',
]);

// ---------------------------------------------------------------------------
// IMPORTANT: specific sub-paths must be registered BEFORE /:id
// ---------------------------------------------------------------------------

// GET /api/forms/public/:slug  — public, no auth
router.get('/public/:slug', async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const [[form]] = await db.query(
      `SELECT id, name, slug, description, submit_text, success_msg, redirect_url,
              html_id, css_class, submit_class, honeypot
       FROM forms WHERE slug = :slug AND is_active = 1`,
      { slug }
    );
    if (!form) return res.status(404).json({ error: 'Form not found' });
    const [fields] = await db.query(
      `SELECT id, field_key, label, field_type, placeholder, help_text, default_value,
              col_width, options_json, validation_json, is_required, sort_order, show_if_json
       FROM form_fields WHERE form_id = :form_id ORDER BY sort_order, id`,
      { form_id: form.id }
    );
    res.json({ ...form, fields });
  } catch (err) { next(err); }
});

// POST /api/forms/public/:slug/submit  — public, no auth
router.post('/public/:slug/submit', async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const [[form]] = await db.query(
      `SELECT id, name, notify_email, crm_action, crm_mapping_json, redirect_url, honeypot
       FROM forms WHERE slug = :slug AND is_active = 1`,
      { slug }
    );
    if (!form) return res.status(404).json({ error: 'Form not found' });

    const body = req.body || {};

    // Honeypot spam check — bot-filled invisible field
    if (form.honeypot && body.__hp) {
      return res.status(201).json({ ok: true }); // silently discard
    }
    delete body.__hp;

    const data_json = JSON.stringify(body);
    const ip_address = req.ip || null; // security remediation H-06

    await db.query(
      `INSERT INTO form_submissions (form_id, data_json, ip_address, user_agent)
       VALUES (:form_id, :data_json, :ip_address, :user_agent)`,
      { form_id: form.id, data_json, ip_address, user_agent: req.headers['user-agent'] || null }
    );

    // ── CRM mapping ──────────────────────────────────────────────────────────
    const crmAction  = form.crm_action;
    const crmMapping = form.crm_mapping_json; // { formFieldKey: crmColumnName }
    let contactId = null; // hoisted so automation trigger can see it
    if (crmAction && crmAction !== 'none' && crmMapping && typeof crmMapping === 'object') {
      const contactData = {};
      for (const [formKey, crmField] of Object.entries(crmMapping)) {
        if (!ALLOWED_CRM_FIELDS.has(crmField)) continue;
        const val = body[formKey];
        if (val !== undefined && val !== '') contactData[crmField] = String(val).substring(0, 255);
      }

      if (Object.keys(contactData).length > 0) {
        if (contactData.email) {
          const [[existing]] = await db.query(
            'SELECT id FROM contacts WHERE email = ? LIMIT 1', [contactData.email]
          );
          if (existing) {
            const sets = Object.keys(contactData).map(k => `\`${k}\` = ?`).join(', ');
            await db.query(
              `UPDATE contacts SET ${sets}, updated_at = NOW() WHERE id = ?`,
              [...Object.values(contactData), existing.id]
            );
            contactId = existing.id;
          } else {
            const cols = Object.keys(contactData).map(k => `\`${k}\``).join(', ');
            const vals = Object.values(contactData);
            const [r] = await db.query(
              `INSERT INTO contacts (${cols}) VALUES (${vals.map(() => '?').join(', ')})`,
              vals
            );
            contactId = r.insertId;
          }
        }

        if (crmAction === 'create_contact_deal' && contactId) {
          await db.query(
            `INSERT INTO deals (name, primary_contact_id, pipeline_id, stage_id, created_at, updated_at)
             SELECT ?, ?, pipeline_id, MIN(id), NOW(), NOW() FROM stages GROUP BY pipeline_id ORDER BY pipeline_id LIMIT 1`,
            [`Web inquiry – ${form.name}`, contactId]
          ).catch(() => {}); // non-fatal
        }

        // Volunteer signup: tag the contact "Volunteer" (same tags/contact_tags
        // engine donors/attendees use), and if the form carries an event_slug
        // (e.g. a hidden field staff set to a specific event when building this
        // form), create an "invited" assignment for that event too.
        if (crmAction === 'volunteer_signup' && contactId) {
          await ensureConstituentTag(contactId, 'Volunteer');
          const eventSlug = body.event_slug;
          if (eventSlug) {
            const [[event]] = await db.query('SELECT id FROM events WHERE slug = ?', [eventSlug]);
            if (event) {
              await db.query(
                `INSERT INTO event_volunteer_assignments (event_id, contact_id, status)
                 VALUES (?, ?, 'invited')
                 ON DUPLICATE KEY UPDATE updated_at = NOW()`,
                [event.id, contactId]
              ).catch(() => {}); // non-fatal — signup already recorded via the contact tag
            }
          }
        }
      }
    }

    // ── Automation trigger ────────────────────────────────────────────────────
    if (contactId) {
      const [[triggerContact]] = await db.query('SELECT * FROM contacts WHERE id = ?', [contactId]).catch(() => [[null]]);
      if (triggerContact) {
        triggerWorkflow('form.submitted', 'contact', triggerContact, {
          form_id:   form.id,
          form_slug: slug,
          form_name: form.name,
          submission: body,
        }).catch(() => {});
      }
    }

    // ── Notification email ────────────────────────────────────────────────────
    if (form.notify_email) {
      const entries = Object.entries(body)
        .map(([k, v]) => `<tr><td style="padding:4px 8px;font-weight:600">${k}</td><td style="padding:4px 8px">${v}</td></tr>`)
        .join('');
      sendMail({
        to: form.notify_email,
        subject: `New form submission: ${form.name}`,
        html: `<h2>New submission: ${form.name}</h2>
               <table border="0" cellpadding="0" cellspacing="0">${entries}</table>
               <p style="color:#666;font-size:12px">Submitted at ${new Date().toUTCString()}<br>IP: ${ip_address}</p>`,
      }).catch(e => console.warn('[forms] notify email failed:', e.message));
    }

    res.status(201).json({ ok: true, redirect_url: form.redirect_url || null });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Admin — all require auth + settings.manage
// ---------------------------------------------------------------------------

// GET /api/forms  — list
router.get('/', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT f.id, f.name, f.slug, f.is_active, f.created_at,
              COUNT(s.id) AS submission_count
       FROM forms f
       LEFT JOIN form_submissions s ON s.form_id = f.id
       GROUP BY f.id ORDER BY f.created_at DESC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/forms/:id
router.get('/:id', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[form]] = await db.query('SELECT * FROM forms WHERE id = :id', { id });
    if (!form) return res.status(404).json({ error: 'Form not found' });
    const [fields] = await db.query(
      'SELECT * FROM form_fields WHERE form_id = :form_id ORDER BY sort_order, id',
      { form_id: id }
    );
    res.json({ ...form, fields });
  } catch (err) { next(err); }
});

// Helper: upsert fields for a form
async function upsertFields(formId, fields) {
  await db.query('DELETE FROM form_fields WHERE form_id = ?', [formId]);
  for (const [idx, f] of fields.entries()) {
    await db.query(
      `INSERT INTO form_fields
        (form_id, field_key, label, field_type, placeholder, help_text, default_value,
         col_width, options_json, validation_json, is_required, sort_order, show_if_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        formId,
        f.field_key,
        f.label,
        f.field_type || 'text',
        f.placeholder ?? null,
        f.help_text ?? null,
        f.default_value ?? null,
        f.col_width || 'full',
        f.options_json != null ? JSON.stringify(f.options_json) : null,
        f.validation_json != null ? JSON.stringify(f.validation_json) : null,
        f.is_required ? 1 : 0,
        f.sort_order ?? idx,
        f.show_if_json != null ? JSON.stringify(f.show_if_json) : null,
      ]
    );
  }
}

// POST /api/forms  — create
router.post('/', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const body = formSchema.parse(req.body);
    if (!body.slug) body.slug = toSlug(body.name);
    const [r] = await db.query(
      `INSERT INTO forms
        (name, slug, description, submit_text, success_msg, notify_email,
         is_active, crm_action, crm_mapping_json, redirect_url,
         html_id, css_class, submit_class, honeypot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.name, body.slug, body.description ?? null,
        body.submit_text ?? 'Submit', body.success_msg ?? null,
        body.notify_email || null, body.is_active !== false ? 1 : 0,
        body.crm_action || 'none',
        body.crm_mapping_json != null ? JSON.stringify(body.crm_mapping_json) : null,
        body.redirect_url || null,
        body.html_id || null, body.css_class || null, body.submit_class || null,
        body.honeypot !== false ? 1 : 0,
      ]
    );
    if (body.fields?.length) await upsertFields(r.insertId, body.fields);
    res.status(201).json({ id: r.insertId });
  } catch (err) { next(err); }
});

// PUT /api/forms/:id  — update
router.put('/:id', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[existing]] = await db.query('SELECT id FROM forms WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Form not found' });

    const body = formSchema.partial().parse(req.body);
    if (body.name && !body.slug) body.slug = toSlug(body.name);

    const META = ['name','slug','description','submit_text','success_msg','notify_email',
                  'is_active','crm_action','crm_mapping_json','redirect_url',
                  'html_id','css_class','submit_class','honeypot'];
    const sets = [], params = [];
    for (const key of META) {
      if (!(key in body)) continue;
      sets.push(`\`${key}\` = ?`);
      if (key === 'is_active' || key === 'honeypot') params.push(body[key] ? 1 : 0);
      else if (key === 'crm_mapping_json') params.push(body[key] != null ? JSON.stringify(body[key]) : null);
      else if (key === 'notify_email') params.push(body[key] || null);
      else params.push(body[key] ?? null);
    }
    if (sets.length) await db.query(`UPDATE forms SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);

    if (Array.isArray(body.fields)) await upsertFields(id, body.fields);

    res.json({ updated: 1 });
  } catch (err) { next(err); }
});

// DELETE /api/forms/:id
router.delete('/:id', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM forms WHERE id = ?', [Number(req.params.id)]);
    res.json({ deleted: 1 });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

router.get('/:id/submissions', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const id       = Number(req.params.id);
    const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize, 10) || 25);
    const offset   = (page - 1) * pageSize;

    const conditions = ['form_id = ?'];
    const params = [id];

    if (req.query.is_read !== undefined) {
      conditions.push('is_read = ?');
      params.push(req.query.is_read === '1' || req.query.is_read === 'true' ? 1 : 0);
    }

    const where = conditions.join(' AND ');
    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM form_submissions WHERE ${where}`, params);
    const [rows] = await db.query(
      `SELECT id, form_id, data_json, ip_address, is_read, created_at
       FROM form_submissions WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    res.json({ rows, total, page, pageSize });
  } catch (err) { next(err); }
});

router.put('/:id/submissions/:subId/read', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    await db.query(
      'UPDATE form_submissions SET is_read = 1 WHERE id = ? AND form_id = ?',
      [Number(req.params.subId), Number(req.params.id)]
    );
    res.json({ updated: 1 });
  } catch (err) { next(err); }
});

router.delete('/:id/submissions/:subId', requireAuth, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM form_submissions WHERE id = ? AND form_id = ?',
      [Number(req.params.subId), Number(req.params.id)]
    );
    res.json({ deleted: 1 });
  } catch (err) { next(err); }
});

module.exports = router;
