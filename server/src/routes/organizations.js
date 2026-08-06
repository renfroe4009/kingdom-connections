// =============================================================================
// /api/organizations
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../services/activity');
const moduleSettings = require('../services/moduleSettings');
const { resolveOwnerScope, ownerClause } = require('../services/scope');
const { mergeOrganizations, getOrganizationMergePreview } = require('../services/merge');

function validateOrgPayload(d, cfg, { isCreate = false } = {}) {
  const errors = [];
  // Website is never enforced as required — it's optional by design.
  if (cfg.require_phone    && !d.phone?.trim())         errors.push('Phone number is required.');
  if (cfg.require_industry && !d.industry?.trim())      errors.push('Industry is required.');
  // Address is only enforced on full edits, not on create — quick-create flows
  // (e.g. adding an org from a contact form) may not have address data yet.
  if (!isCreate && cfg.require_address && !d.address_line1?.trim()) errors.push('Street address is required.');
  return errors;
}

router.use(requireAuth);

router.get('/', requirePermission('organizations.read'), async (req, res, next) => {
  try {
    const { q, owner_id, page = 1, pageSize = 25 } = req.query;
    const where = ['o.merged_into_id IS NULL']; const params = {};

    const scopeIds = await resolveOwnerScope(req.user);
    const scopeClause = ownerClause(scopeIds, 'o.owner_id');
    if (scopeClause) where.push(scopeClause);

    if (q) { where.push('(o.name LIKE :q OR o.website LIKE :q OR o.phone LIKE :q)'); params.q = `%${q}%`; }
    if (owner_id) { where.push('o.owner_id = :owner_id'); params.owner_id = owner_id; }

    params.limit = Number(pageSize);
    params.offset = (Number(page) - 1) * Number(pageSize);

    const [rows] = await db.query(
      `SELECT o.*,
              (SELECT COUNT(*) FROM contacts c WHERE c.organization_id = o.id) AS contact_count,
              (SELECT COUNT(*) FROM deals d WHERE d.organization_id = o.id)   AS deal_count,
              CONCAT_WS(' ', u.first_name, u.last_name) AS owner_name
         FROM organizations o
         LEFT JOIN users u ON u.id = o.owner_id
        WHERE ${where.join(' AND ')}
        ORDER BY o.updated_at DESC
        LIMIT :limit OFFSET :offset`,
      params
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM organizations o WHERE ${where.join(' AND ')}`, params
    );
    res.json({ rows, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (err) { next(err); }
});

// Duplicate finder — orgs have no email column, so this groups purely by
// normalized name. Registered ahead of GET /:id for the same reason as
// contacts.js's /duplicates route.
router.get('/duplicates', requirePermission('organizations.write'), async (req, res, next) => {
  try {
    const [nameGroups] = await db.query(`
      SELECT LOWER(TRIM(name)) AS dupe_key
        FROM organizations
       WHERE merged_into_id IS NULL
       GROUP BY dupe_key
      HAVING COUNT(*) > 1
    `);
    const groups = await Promise.all(nameGroups.map(async (g) => {
      const [rows] = await db.query(
        `SELECT id, name, website, phone, city, state, created_at
           FROM organizations
          WHERE merged_into_id IS NULL AND LOWER(TRIM(name)) = :key`,
        { key: g.dupe_key }
      );
      return { key: g.dupe_key, organizations: rows };
    }));
    res.json(groups);
  } catch (err) { next(err); }
});

router.get('/:id/merge-preview', requirePermission('organizations.write'), async (req, res, next) => {
  try {
    const preview = await getOrganizationMergePreview(Number(req.params.id));
    res.json(preview);
  } catch (err) { next(err); }
});

const mergeSchema = z.object({
  survivor_id: z.number().int(),
  loser_id: z.number().int(),
  fields: z.record(z.any()).optional(),
});

router.post('/merge', requirePermission('organizations.write', 'organizations.delete'), async (req, res, next) => {
  try {
    const d = mergeSchema.parse(req.body);

    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null) {
      const [rows] = await db.query(
        'SELECT id, owner_id FROM organizations WHERE id IN (:ids)', { ids: [d.survivor_id, d.loser_id] }
      );
      const outOfScope = rows.some((r) => !scopeIds.includes(r.owner_id));
      if (rows.length < 2 || outOfScope) return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await mergeOrganizations({ survivorId: d.survivor_id, loserId: d.loser_id, fields: d.fields || {} });
    await logActivity({
      userId: req.user.id, entityType: 'organization', entityId: d.survivor_id,
      action: 'merged', description: 'Organization merged',
      meta: { merged_from: d.loser_id },
    });
    res.json({ ok: true, survivor_id: result.survivorId });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/:id', requirePermission('organizations.read'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM organizations WHERE id = :id', { id: req.params.id });
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null && !scopeIds.includes(rows[0].owner_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const [tags] = await db.query(
      `SELECT t.* FROM tags t JOIN organization_tags ot ON ot.tag_id = t.id WHERE ot.organization_id = :id`,
      { id: req.params.id }
    );
    const [contacts]   = await db.query('SELECT * FROM contacts WHERE organization_id = :id', { id: req.params.id });
    const [deals]      = await db.query('SELECT * FROM deals WHERE organization_id = :id', { id: req.params.id });
    const [activities] = await db.query(
      `SELECT a.*, CONCAT_WS(' ', u.first_name, u.last_name) AS user_name
         FROM activities a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity_type='organization' AND a.entity_id=:id
        ORDER BY a.created_at DESC LIMIT 100`, { id: req.params.id }
    );

    // Invoices billed to this organization (either direct billing or via a
    // contact whose employer is this org).
    const [invoices] = await db.query(
      `SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.status,
              i.currency, i.total, i.amount_paid, i.balance_due,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
         FROM invoices i
         LEFT JOIN contacts c ON c.id = i.contact_id
        WHERE i.organization_id = :id
           OR i.contact_id IN (SELECT id FROM contacts WHERE organization_id = :id)
        ORDER BY i.issue_date DESC, i.id DESC`,
      { id: req.params.id }
    );

    // Payments across those invoices, newest first. We join once via invoices
    // to inherit the same org-scope logic.
    const [payments] = await db.query(
      `SELECT p.id, p.invoice_id, p.gateway, p.method, p.amount, p.currency,
              p.status, p.card_brand, p.card_last4, p.external_txn_id,
              p.received_at, p.created_at,
              i.invoice_number
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
        WHERE i.organization_id = :id
           OR i.contact_id IN (SELECT id FROM contacts WHERE organization_id = :id)
        ORDER BY COALESCE(p.received_at, p.created_at) DESC, p.id DESC`,
      { id: req.params.id }
    );

    // Roll-ups for the header card. We expose them separately so the client
    // can show totals even if the row lists are paginated in the future.
    const totals = invoices.reduce((acc, r) => {
      acc.invoiced += Number(r.total || 0);
      acc.paid     += Number(r.amount_paid || 0);
      acc.balance  += Number(r.balance_due || 0);
      return acc;
    }, { invoiced: 0, paid: 0, balance: 0 });

    res.json({ organization: rows[0], tags, contacts, deals, activities, invoices, payments, totals });
  } catch (err) { next(err); }
});

// Same admin-bypass + permission-set check requirePermission() uses,
// callable inline since donations/events/orders are each independently
// optional in the timeline rather than an all-or-nothing route gate.
function canView(req, perm) {
  return req.user.roles?.includes('admin') || (req.user.permissions || []).includes(perm);
}

// Unified activity timeline for an organization — same shape/merge approach
// as GET /contacts/:id/timeline, extended to org-level donations/event
// registrations (both have organization_id directly) and orders/form
// submissions placed by any contact under this org (orders has no
// organization_id column, so it's scoped via contacts.organization_id).
router.get('/:id/timeline', requirePermission('organizations.read'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const [activities] = await db.query(
      `SELECT a.action, a.description, a.created_at AS date,
              CONCAT_WS(' ', u.first_name, u.last_name) AS user_name
         FROM activities a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity_type = 'organization' AND a.entity_id = :id`,
      { id }
    );

    let donations = [];
    if (canView(req, 'donations.read')) {
      [donations] = await db.query(
        `SELECT d.created_at AS date, d.is_in_kind, p.amount, p.status AS payment_status, f.name AS fund_name
           FROM donations d
           JOIN payments p ON p.id = d.payment_id
           LEFT JOIN funds f ON f.id = d.fund_id
          WHERE d.organization_id = :id`,
        { id }
      );
    }

    let registrations = [];
    if (canView(req, 'events.read')) {
      [registrations] = await db.query(
        `SELECT r.created_at AS date, r.quantity, r.status, e.name AS event_name, t.name AS ticket_name
           FROM event_registrations r
           JOIN events e ON e.id = r.event_id
           JOIN event_ticket_types t ON t.id = r.ticket_type_id
          WHERE r.organization_id = :id`,
        { id }
      );
    }

    let orders = [];
    if (canView(req, 'orders.read')) {
      [orders] = await db.query(
        `SELECT o.created_at AS date, o.order_number, o.total, o.payment_status
           FROM orders o
          WHERE o.contact_id IN (SELECT id FROM contacts WHERE organization_id = :id)`,
        { id }
      );
    }

    const [submissions] = await db.query(
      `SELECT fs.created_at AS date, f.name AS form_name
         FROM form_submissions fs
         JOIN forms f ON f.id = fs.form_id
        WHERE EXISTS (
          SELECT 1 FROM contacts c
           WHERE c.organization_id = :id AND c.email IS NOT NULL
             AND JSON_SEARCH(fs.data_json, 'one', c.email) IS NOT NULL
        )`,
      { id }
    );

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

// Bulk edit — registered ahead of the /:id routes below, same reasoning as
// contacts.js's bulk route.
const bulkSchema = z.object({
  ids: z.array(z.number().int()).min(1),
  set: z.object({
    owner_id: z.number().int().nullable().optional(),
  }).optional(),
  add_tag_ids: z.array(z.number().int()).optional(),
  remove_tag_ids: z.array(z.number().int()).optional(),
});

router.patch('/bulk', requirePermission('organizations.write'), async (req, res, next) => {
  try {
    const d = bulkSchema.parse(req.body);

    const scopeIds = await resolveOwnerScope(req.user);
    const [rows] = await db.query('SELECT id, owner_id FROM organizations WHERE id IN (:ids)', { ids: d.ids });
    const inScopeIds = rows
      .filter((r) => scopeIds === null || scopeIds.includes(r.owner_id))
      .map((r) => r.id);
    const skipped = d.ids.length - inScopeIds.length;
    if (!inScopeIds.length) return res.json({ updated: 0, skipped });

    if (d.set && Object.keys(d.set).length) {
      const setClause = Object.keys(d.set).map((k) => `${k} = :${k}`).join(', ');
      await db.query(
        `UPDATE organizations SET ${setClause} WHERE id IN (:ids)`,
        { ...d.set, ids: inScopeIds }
      );
    }
    if (d.add_tag_ids?.length) {
      const values = inScopeIds.flatMap((id) => d.add_tag_ids.map((tagId) => [id, tagId]));
      await db.query('INSERT IGNORE INTO organization_tags (organization_id, tag_id) VALUES ?', [values]);
    }
    if (d.remove_tag_ids?.length) {
      await db.query(
        'DELETE FROM organization_tags WHERE organization_id IN (:ids) AND tag_id IN (:tagIds)',
        { ids: inScopeIds, tagIds: d.remove_tag_ids }
      );
    }
    await Promise.all(inScopeIds.map((id) => logActivity({
      userId: req.user.id, entityType: 'organization', entityId: id,
      action: 'bulk_updated', description: 'Organization bulk-updated', meta: d,
    })));
    res.json({ updated: inScopeIds.length, skipped });
  } catch (err) { next(err); }
});

const saveSchema = z.object({
  name: z.string().min(1),
  website: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  sic_code: z.string().max(10).optional().nullable(),
  employee_count: z.number().int().optional().nullable(),
  annual_revenue: z.number().optional().nullable(),
  address_line1: z.string().optional().nullable(),
  address_line2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  owner_id: z.number().int().nullable().optional(),
  tax_exempt: z.number().int().min(0).max(1).optional(),
  tag_ids: z.array(z.number().int()).optional(),
});

router.post('/', requirePermission('organizations.write'), async (req, res, next) => {
  try {
    const data = saveSchema.parse(req.body);
    const { tag_ids, ...fields } = data;

    const cfg = await moduleSettings.get('organizations');

    // Enforce required fields — address is skipped on create (can be filled later)
    const errors = validateOrgPayload(fields, cfg, { isCreate: true });
    if (errors.length) return res.status(422).json({ error: errors[0], errors });

    // Duplicate detection
    if (cfg.duplicate_detection_enabled) {
      const [[dupe]] = await db.query(
        'SELECT id FROM organizations WHERE LOWER(name) = LOWER(:name) LIMIT 1',
        { name: fields.name }
      );
      if (dupe) return res.status(409).json({ error: `An organization named "${fields.name}" already exists.`, duplicate_id: dupe.id });
    }

    // Apply defaults from settings; always fall back to the creating user so
    // scoped users can see the record they just created.
    if (!fields.owner_id && cfg.default_owner_id) fields.owner_id = cfg.default_owner_id;
    if (!fields.owner_id) fields.owner_id = req.user.id;
    if (!fields.country  && cfg.default_country)  fields.country  = cfg.default_country;

    const cols = Object.keys(fields);
    const ph = cols.map((c) => `:${c}`).join(', ');
    const [ins] = await db.query(
      `INSERT INTO organizations (${cols.join(', ')}) VALUES (${ph})`, fields
    );
    const id = ins.insertId;
    if (tag_ids?.length) {
      const values = tag_ids.map((t) => [id, t]);
      await db.query('INSERT INTO organization_tags (organization_id, tag_id) VALUES ?', [values]);
    }
    await logActivity({ userId: req.user.id, entityType: 'organization', entityId: id,
      action: 'created', description: 'Organization created' });
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('organizations.write'), async (req, res, next) => {
  try {
    const data = saveSchema.parse(req.body);
    const { tag_ids, ...fields } = data;
    const id = Number(req.params.id);

    const [[existing]] = await db.query('SELECT owner_id FROM organizations WHERE id = :id', { id });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null && !scopeIds.includes(existing.owner_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const cfg = await moduleSettings.get('organizations');
    const errors = validateOrgPayload(fields, cfg);
    if (errors.length) return res.status(422).json({ error: errors[0], errors });

    const set = Object.keys(fields).map((k) => `${k} = :${k}`).join(', ');
    if (set) await db.query(`UPDATE organizations SET ${set} WHERE id = :id`, { ...fields, id });
    if (tag_ids) {
      await db.query('DELETE FROM organization_tags WHERE organization_id = :id', { id });
      if (tag_ids.length) {
        const values = tag_ids.map((t) => [id, t]);
        await db.query('INSERT INTO organization_tags (organization_id, tag_id) VALUES ?', [values]);
      }
    }
    await logActivity({ userId: req.user.id, entityType: 'organization', entityId: id,
      action: 'updated', description: 'Organization updated' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Dedicated tag-only endpoint — kept separate from PUT /:id so a tag edit
// never has to also satisfy/resend the rest of the record's required fields
// (PUT's saveSchema requires `name`).
const tagsOnlySchema = z.object({ tag_ids: z.array(z.number().int()) });
router.patch('/:id/tags', requirePermission('organizations.write'), async (req, res, next) => {
  try {
    const { tag_ids } = tagsOnlySchema.parse(req.body);
    const id = Number(req.params.id);

    const [[existing]] = await db.query('SELECT owner_id FROM organizations WHERE id = :id', { id });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const scopeIds = await resolveOwnerScope(req.user);
    if (scopeIds !== null && !scopeIds.includes(existing.owner_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await db.query('DELETE FROM organization_tags WHERE organization_id = :id', { id });
    if (tag_ids.length) {
      const values = tag_ids.map((t) => [id, t]);
      await db.query('INSERT INTO organization_tags (organization_id, tag_id) VALUES ?', [values]);
    }
    await logActivity({ userId: req.user.id, entityType: 'organization', entityId: id,
      action: 'updated', description: 'Tags updated' });
    const [tags] = await db.query(
      `SELECT t.* FROM tags t JOIN organization_tags ot ON ot.tag_id = t.id WHERE ot.organization_id = :id`, { id }
    );
    res.json({ tags });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('organizations.delete'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM organizations WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
