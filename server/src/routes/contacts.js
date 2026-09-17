// =============================================================================
// /api/contacts
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const { resolveOwnerScope, ownerClause } = require('../services/scope');
const { triggerWorkflow } = require('../services/automations');
const { mergeContacts, getContactMergePreview, MergeConflictError } = require('../services/merge');
const { notifyMemberChange } = require('../services/ppWebhooks');

router.use(requireAuth);

// ---- List w/ search, filter, pagination ----
router.get('/', requirePermission('contacts.read'), async (req, res, next) => {
  try {
    const {
      q, organization_id, owner_id, lifecycle_stage, tag_id, tag_ids, match,
      page = 1, pageSize = 25,
    } = req.query;

    const where = ['c.merged_into_id IS NULL'];
    const params = {};

    // Row-level scope: restrict to records owned by the caller (or their reports)
    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = ownerClause(scopeIds, 'c.owner_id');
    if (scopeClause) where.push(scopeClause);
    if (q) {
      where.push(`(c.first_name LIKE :q OR c.last_name LIKE :q OR c.email LIKE :q OR c.phone LIKE :q)`);
      params.q = `%${q}%`;
    }
    if (organization_id) { where.push('c.organization_id = :organization_id'); params.organization_id = organization_id; }
    if (owner_id)        { where.push('c.owner_id = :owner_id');               params.owner_id = owner_id; }
    if (lifecycle_stage) { where.push('c.lifecycle_stage = :lifecycle_stage'); params.lifecycle_stage = lifecycle_stage; }
    if (tag_id) {
      where.push('c.id IN (SELECT contact_id FROM contact_tags WHERE tag_id = :tag_id)');
      params.tag_id = tag_id;
    }
    // Multi-tag filtering — accepts ?tag_ids=1,2,3 plus optional ?match=any|all (default: any).
    // Used by the Lists "Add by tags" panel and the campaigns audience picker.
    // We inline-expand the IN list because mysql2 named placeholders don't expand
    // arrays; values are hard-coerced to ints to keep this injection-safe.
    if (tag_ids) {
      const idsRaw = Array.isArray(tag_ids) ? tag_ids : String(tag_ids).split(',');
      const ids = idsRaw.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);
      if (ids.length) {
        const inList = ids.join(',');
        if (match === 'all') {
          // Contact must have *every* tag in the list — group + count distinct tags.
          where.push(
            `c.id IN (SELECT contact_id FROM contact_tags
                       WHERE tag_id IN (${inList})
                    GROUP BY contact_id
                      HAVING COUNT(DISTINCT tag_id) = ${ids.length})`
          );
        } else {
          where.push(`c.id IN (SELECT contact_id FROM contact_tags WHERE tag_id IN (${inList}))`);
        }
      }
    }

    const offset = (Number(page) - 1) * Number(pageSize);
    params.limit = Number(pageSize);
    params.offset = offset;

    const [rows] = await db.query(
      `SELECT c.*, o.name AS organization_name,
              CONCAT_WS(' ', u.first_name, u.last_name) AS owner_name
         FROM contacts c
         LEFT JOIN organizations o ON o.id = c.organization_id
         LEFT JOIN users u         ON u.id = c.owner_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.updated_at DESC
        LIMIT :limit OFFSET :offset`,
      params
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM contacts c WHERE ${where.join(' AND ')}`,
      params
    );
    res.json({ rows, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (err) { next(err); }
});

// Duplicate finder — groups active (not already merged) contacts by
// normalized email first, then by normalized full name for any contacts
// not already surfaced via an email match. Registered ahead of GET /:id
// since Express would otherwise match "duplicates" as the :id param.
router.get('/duplicates', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    const [emailGroups] = await db.query(`
      SELECT LOWER(TRIM(email)) AS dupe_key
        FROM contacts
       WHERE merged_into_id IS NULL AND email IS NOT NULL AND TRIM(email) <> ''
       GROUP BY dupe_key
      HAVING COUNT(*) > 1
    `);
    const [nameGroups] = await db.query(`
      SELECT LOWER(TRIM(CONCAT_WS(' ', first_name, last_name))) AS dupe_key
        FROM contacts
       WHERE merged_into_id IS NULL
         AND TRIM(CONCAT_WS(' ', first_name, last_name)) <> ''
         AND (email IS NULL OR TRIM(email) = '')
       GROUP BY dupe_key
      HAVING COUNT(*) > 1
    `);

    async function loadGroup(key, byEmail) {
      const [rows] = await db.query(
        byEmail
          ? `SELECT c.id, CONCAT_WS(' ', c.first_name, c.last_name) AS name, c.email, c.phone,
                    o.name AS organization_name, c.created_at
               FROM contacts c LEFT JOIN organizations o ON o.id = c.organization_id
              WHERE c.merged_into_id IS NULL AND LOWER(TRIM(c.email)) = :key`
          : `SELECT c.id, CONCAT_WS(' ', c.first_name, c.last_name) AS name, c.email, c.phone,
                    o.name AS organization_name, c.created_at
               FROM contacts c LEFT JOIN organizations o ON o.id = c.organization_id
              WHERE c.merged_into_id IS NULL
                AND LOWER(TRIM(CONCAT_WS(' ', c.first_name, c.last_name))) = :key`,
        { key }
      );
      return { key, contacts: rows };
    }

    const groups = [
      ...(await Promise.all(emailGroups.map((g) => loadGroup(g.dupe_key, true)))),
      ...(await Promise.all(nameGroups.map((g) => loadGroup(g.dupe_key, false)))),
    ];
    res.json(groups);
  } catch (err) { next(err); }
});

router.get('/:id/merge-preview', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    const preview = await getContactMergePreview(Number(req.params.id));
    res.json(preview);
  } catch (err) { next(err); }
});

const mergeSchema = z.object({
  survivor_id: z.number().int(),
  loser_id: z.number().int(),
  fields: z.record(z.any()).optional(),
  confirm_login_deactivation: z.boolean().optional(),
});

router.post('/merge', requirePermission('contacts.write', 'contacts.delete'), async (req, res, next) => {
  try {
    const d = mergeSchema.parse(req.body);

    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null) {
      const [rows] = await db.query(
        'SELECT id, owner_id FROM contacts WHERE id IN (:ids)', { ids: [d.survivor_id, d.loser_id] }
      );
      const outOfScope = rows.some((r) => !scopeIds.includes(r.owner_id));
      if (rows.length < 2 || outOfScope) return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await mergeContacts({
      survivorId: d.survivor_id, loserId: d.loser_id, fields: d.fields || {},
      confirmLoginDeactivation: d.confirm_login_deactivation, userId: req.user.id,
    });
    await logActivity({
      userId: req.user.id, entityType: 'contact', entityId: d.survivor_id,
      action: 'merged', description: 'Contact merged',
      meta: { merged_from: d.loser_id, login_deactivated: result.loginDeactivated },
    });
    res.json({ ok: true, survivor_id: result.survivorId });
  } catch (err) {
    if (err instanceof MergeConflictError) return res.status(409).json({ error: err.message, ...err.payload });
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/:id', requirePermission('contacts.read'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, o.name AS organization_name
         FROM contacts c
         LEFT JOIN organizations o ON o.id = c.organization_id
        WHERE c.id = :id`,
      { id: req.params.id }
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    // Scope check: scoped users may only view contacts they own (or their reports own)
    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null && !scopeIds.includes(rows[0].owner_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [tags] = await db.query(
      `SELECT t.* FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = :id`,
      { id: req.params.id }
    );
    const [notes] = await db.query(
      `SELECT n.*, CONCAT_WS(' ', u.first_name, u.last_name) AS user_name
         FROM notes n LEFT JOIN users u ON u.id = n.user_id
        WHERE n.entity_type = 'contact' AND n.entity_id = :id
        ORDER BY n.created_at DESC`,
      { id: req.params.id }
    );
    const [activities] = await db.query(
      `SELECT a.*, CONCAT_WS(' ', u.first_name, u.last_name) AS user_name
         FROM activities a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity_type = 'contact' AND a.entity_id = :id
        ORDER BY a.created_at DESC LIMIT 100`,
      { id: req.params.id }
    );
    const [tasks] = await db.query(
      `SELECT t.*, CONCAT_WS(' ', u.first_name, u.last_name) AS assignee_name
         FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.entity_type = 'contact' AND t.entity_id = :id
        ORDER BY t.due_date ASC`,
      { id: req.params.id }
    );
    const [cfv] = await db.query(
      `SELECT cf.field_key, cf.label, cf.field_type, v.value_text
         FROM custom_fields cf
         LEFT JOIN custom_field_values v
                ON v.custom_field_id = cf.id AND v.entity_type='contact' AND v.entity_id = :id
        WHERE cf.entity_type='contact'
        ORDER BY cf.display_order, cf.id`,
      { id: req.params.id }
    );
    const [deals] = await db.query(
      `SELECT * FROM deals WHERE primary_contact_id = :id ORDER BY created_at DESC`,
      { id: req.params.id }
    );

    res.json({ contact: rows[0], tags, notes, activities, tasks, custom_fields: cfv, deals });
  } catch (err) { next(err); }
});

router.get('/:id/household', requirePermission('contacts.read'), async (req, res, next) => {
  try {
    const [[link]] = await db.query(
      'SELECT household_id FROM household_members WHERE contact_id = :id LIMIT 1',
      { id: req.params.id }
    );
    if (!link) return res.json(null);
    const { loadHousehold } = require('./households');
    res.json(await loadHousehold(link.household_id));
  } catch (err) { next(err); }
});

router.get('/:id/soft-credits', requirePermission('contacts.read'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT d.id, d.created_at, d.dedication_note,
              f.name AS fund_name, p.amount, p.currency,
              CONCAT_WS(' ', c.first_name, c.last_name) AS donor_name, c.id AS donor_contact_id
         FROM donations d
         JOIN payments p ON p.id = d.payment_id
         LEFT JOIN funds f ON f.id = d.fund_id
         LEFT JOIN contacts c ON c.id = d.contact_id
        WHERE d.soft_credit_contact_id = :id AND p.status IN ('captured','authorized')
        ORDER BY d.created_at DESC`,
      { id: req.params.id }
    );
    res.json({ rows });
  } catch (err) { next(err); }
});

// Whether the viewing user can see a given module's records in the timeline
// — same admin-bypass + permission-set check requirePermission() uses, just
// callable inline since donations/events/orders each need an independent,
// optional check rather than an all-or-nothing route gate.
function canView(req, perm) {
  return req.user.roles?.includes('admin') || (req.user.permissions || []).includes(perm);
}

// Unified constituent timeline — merges generic CRM activity with donations,
// membership/recurring-giving starts, event registrations, ecom orders, and
// form submissions, since those live in their own tables rather than the
// activities log. Built as separate queries + JS merge/sort rather than one
// SQL UNION — the sources have too little in common structurally (different
// date columns, different "what happened" text) to union cleanly in SQL.
// Donation/event/order sections are only included if the viewer holds the
// matching <module>.read permission — same module-visibility rule the nav
// sidebar already uses (see AppLayout.jsx).
router.get('/:id/timeline', requirePermission('contacts.read'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const [[contact]] = await db.query('SELECT email FROM contacts WHERE id = :id', { id });

    const [activities] = await db.query(
      `SELECT a.action, a.description, a.created_at AS date,
              CONCAT_WS(' ', u.first_name, u.last_name) AS user_name
         FROM activities a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity_type = 'contact' AND a.entity_id = :id`,
      { id }
    );

    let donations = [], memberships = [];
    if (canView(req, 'donations.read')) {
      [donations] = await db.query(
        `SELECT d.created_at AS date, d.is_in_kind, p.amount, p.status AS payment_status,
                f.name AS fund_name
           FROM donations d
           JOIN payments p ON p.id = d.payment_id
           LEFT JOIN funds f ON f.id = d.fund_id
          WHERE d.contact_id = :id`,
        { id }
      );
      [memberships] = await db.query(
        `SELECT s.created_at AS date, s.status,
                t.name AS tier_name, fnd.name AS fund_name
           FROM subscriptions s
           LEFT JOIN membership_tiers t ON t.id = s.membership_tier_id
           LEFT JOIN funds fnd ON fnd.id = s.fund_id
          WHERE s.contact_id = :id AND (s.membership_tier_id IS NOT NULL OR s.fund_id IS NOT NULL)`,
        { id }
      );
    }

    let registrations = [];
    if (canView(req, 'events.read')) {
      [registrations] = await db.query(
        `SELECT r.created_at AS date, r.quantity, r.status, e.name AS event_name, t.name AS ticket_name, t.price
           FROM event_registrations r
           JOIN events e ON e.id = r.event_id
           JOIN event_ticket_types t ON t.id = r.ticket_type_id
          WHERE r.contact_id = :id`,
        { id }
      );
    }

    let orders = [];
    if (canView(req, 'orders.read')) {
      [orders] = await db.query(
        `SELECT o.created_at AS date, o.order_number, o.total, o.status, o.payment_status
           FROM orders o WHERE o.contact_id = :id`,
        { id }
      );
    }

    // form_submissions has no CRM link column — match by whatever email value
    // the submission carries (field keys are staff-defined per form, so we
    // search JSON values rather than a fixed key path).
    let submissions = [];
    if (contact?.email) {
      [submissions] = await db.query(
        `SELECT fs.created_at AS date, f.name AS form_name
           FROM form_submissions fs JOIN forms f ON f.id = fs.form_id
          WHERE JSON_SEARCH(fs.data_json, 'one', :email) IS NOT NULL`,
        { email: contact.email }
      );
    }

    const events = [
      ...activities.map((a) => ({
        type: 'activity', date: a.date, icon: 'solar:clock-circle-line-duotone',
        title: a.action.replace(/_/g, ' '), description: a.description, meta: a.user_name,
      })),
      ...donations.map((d) => ({
        type: 'donation', date: d.date, icon: 'solar:hand-heart-line-duotone',
        title: d.is_in_kind ? 'In-kind gift' : 'Donation',
        description: `${d.fund_name || 'Undesignated'} — $${Number(d.amount).toFixed(2)} (${d.payment_status})`,
      })),
      ...memberships.map((m) => ({
        type: 'membership', date: m.date, icon: 'solar:medal-ribbons-star-line-duotone',
        title: m.tier_name ? 'Membership started' : 'Recurring gift started',
        description: m.tier_name ? `${m.tier_name} tier (${m.status})` : `${m.fund_name || 'Undesignated'} (${m.status})`,
      })),
      ...registrations.map((r) => ({
        type: 'event_registration', date: r.date, icon: 'solar:ticket-line-duotone',
        title: 'Event registration',
        description: `${r.event_name} — ${r.ticket_name} x${r.quantity} (${r.status})`,
      })),
      ...orders.map((o) => ({
        type: 'order', date: o.date, icon: 'solar:bag-check-line-duotone',
        title: 'Shop order',
        description: `${o.order_number} — $${Number(o.total).toFixed(2)} (${o.payment_status})`,
      })),
      ...submissions.map((s) => ({
        type: 'form_submission', date: s.date, icon: 'solar:document-text-line-duotone',
        title: 'Form submission', description: s.form_name,
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ events });
  } catch (err) { next(err); }
});

// Bulk edit — registered ahead of the /:id routes below since Express
// matches path segments literally; "bulk" would otherwise be swallowed by
// :id on a PUT, though PATCH has no such competing route today regardless.
const bulkSchema = z.object({
  ids: z.array(z.number().int()).min(1),
  set: z.object({
    owner_id: z.number().int().nullable().optional(),
    lifecycle_stage: z.enum(['lead', 'mql', 'sql', 'customer', 'evangelist', 'other']).optional(),
  }).optional(),
  add_tag_ids: z.array(z.number().int()).optional(),
  remove_tag_ids: z.array(z.number().int()).optional(),
});

router.patch('/bulk', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    const d = bulkSchema.parse(req.body);

    const scopeIds = await resolveOwnerScope(req.user);
    const [rows] = await db.query('SELECT id, owner_id FROM contacts WHERE id IN (:ids)', { ids: d.ids });
    const inScopeIds = rows
      .filter((r) => scopeIds === null || scopeIds.includes(r.owner_id))
      .map((r) => r.id);
    const skipped = d.ids.length - inScopeIds.length;
    if (!inScopeIds.length) return res.json({ updated: 0, skipped });

    if (d.set && Object.keys(d.set).length) {
      const setClause = Object.keys(d.set).map((k) => `${k} = :${k}`).join(', ');
      await db.query(
        `UPDATE contacts SET ${setClause} WHERE id IN (:ids)`,
        { ...d.set, ids: inScopeIds }
      );
    }
    if (d.add_tag_ids?.length) {
      const values = inScopeIds.flatMap((id) => d.add_tag_ids.map((tagId) => [id, tagId]));
      await db.query('INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES ?', [values]);
    }
    if (d.remove_tag_ids?.length) {
      await db.query(
        'DELETE FROM contact_tags WHERE contact_id IN (:ids) AND tag_id IN (:tagIds)',
        { ids: inScopeIds, tagIds: d.remove_tag_ids }
      );
    }
    await Promise.all(inScopeIds.map((id) => logActivity({
      userId: req.user.id, entityType: 'contact', entityId: id,
      action: 'bulk_updated', description: 'Contact bulk-updated', meta: d,
    })));
    res.json({ updated: inScopeIds.length, skipped });
  } catch (err) { next(err); }
});

const saveSchema = z.object({
  organization_id: z.number().int().nullable().optional(),
  first_name: z.string().optional(),
  last_name:  z.string().optional(),
  email:      z.string().email().optional().nullable(),
  phone:      z.string().optional().nullable(),
  mobile:     z.string().optional().nullable(),
  title:      z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  address_line1: z.string().optional().nullable(),
  address_line2: z.string().optional().nullable(),
  city:        z.string().optional().nullable(),
  state:       z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  country:     z.string().optional().nullable(),
  linkedin_url: z.string().optional().nullable(),
  lifecycle_stage: z.enum(['lead','mql','sql','customer','evangelist','other']).optional(),
  lead_source: z.string().optional().nullable(),
  owner_id:    z.number().int().nullable().optional(),
  notes:       z.string().optional().nullable(),
  tag_ids:     z.array(z.number().int()).optional(),
  tax_exempt:  z.number().int().min(0).max(1).optional(),
});

router.post('/', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    const data = saveSchema.parse(req.body);
    // Default owner to the creating user so scoped users always see their own records.
    if (!data.owner_id) data.owner_id = req.user.id;
    const { tag_ids, ...fields } = data;
    const cols = Object.keys(fields);
    if (!cols.length) return res.status(400).json({ error: 'Empty payload' });
    const placeholders = cols.map((c) => `:${c}`).join(', ');
    const [ins] = await db.query(
      `INSERT INTO contacts (${cols.join(', ')}) VALUES (${placeholders})`,
      fields
    );
    const id = ins.insertId;
    if (tag_ids?.length) {
      const values = tag_ids.map((t) => [id, t]);
      await db.query('INSERT INTO contact_tags (contact_id, tag_id) VALUES ?', [values]);
    }
    await logActivity({ userId: req.user.id, entityType: 'contact', entityId: id,
      action: 'created', description: `Contact created` });
    const [[newContact]] = await db.query('SELECT * FROM contacts WHERE id = :id', { id });
    triggerWorkflow('contact.created', 'contact', newContact).catch(() => {});
    notifyMemberChange('member.created', newContact).catch(() => {});
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

// Dedicated tag-only endpoint — kept separate from PUT /:id so a tag edit
// never has to also satisfy/resend the rest of the record's fields.
const tagsOnlySchema = z.object({ tag_ids: z.array(z.number().int()) });
router.patch('/:id/tags', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    const { tag_ids } = tagsOnlySchema.parse(req.body);
    const id = Number(req.params.id);

    const [[existing]] = await db.query('SELECT owner_id FROM contacts WHERE id = :id', { id });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null && !scopeIds.includes(existing.owner_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await db.query('DELETE FROM contact_tags WHERE contact_id = :id', { id });
    if (tag_ids.length) {
      const values = tag_ids.map((t) => [id, t]);
      await db.query('INSERT INTO contact_tags (contact_id, tag_id) VALUES ?', [values]);
    }
    await logActivity({ userId: req.user.id, entityType: 'contact', entityId: id,
      action: 'updated', description: 'Tags updated' });
    const [tags] = await db.query(
      `SELECT t.* FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.contact_id = :id`, { id }
    );
    res.json({ tags });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    const data = saveSchema.parse(req.body);
    const { tag_ids, ...fields } = data;
    const id = Number(req.params.id);

    const [[existing]] = await db.query('SELECT owner_id FROM contacts WHERE id = :id', { id });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null && !scopeIds.includes(existing.owner_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const set = Object.keys(fields).map((k) => `${k} = :${k}`).join(', ');
    if (set) await db.query(`UPDATE contacts SET ${set} WHERE id = :id`, { ...fields, id });
    if (tag_ids) {
      await db.query('DELETE FROM contact_tags WHERE contact_id = :id', { id });
      if (tag_ids.length) {
        const values = tag_ids.map((t) => [id, t]);
        await db.query('INSERT INTO contact_tags (contact_id, tag_id) VALUES ?', [values]);
      }
    }
    await logActivity({ userId: req.user.id, entityType: 'contact', entityId: id,
      action: 'updated', description: 'Contact updated' });
    const [[updatedContact]] = await db.query('SELECT * FROM contacts WHERE id = :id', { id });
    notifyMemberChange('member.updated', updatedContact).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('contacts.delete'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM contacts WHERE id = :id', { id: req.params.id });
    await logActivity({ userId: req.user.id, entityType: 'contact', entityId: Number(req.params.id),
      action: 'deleted', description: 'Contact deleted' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- Custom field values ----
router.put('/:id/custom-fields', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const values = req.body?.values || {};   // { field_key: value }
    const [fields] = await db.query(
      'SELECT id, field_key FROM custom_fields WHERE entity_type = "contact"'
    );
    for (const f of fields) {
      const val = values[f.field_key];
      if (val === undefined) continue;
      await db.query(
        `INSERT INTO custom_field_values (custom_field_id, entity_type, entity_id, value_text)
         VALUES (:cf, 'contact', :id, :val)
         ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)`,
        { cf: f.id, id, val: val === null ? null : String(val) }
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
