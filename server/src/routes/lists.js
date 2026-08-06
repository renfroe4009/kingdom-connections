// =============================================================================
// /api/lists — saved recipient lists
// -----------------------------------------------------------------------------
//   GET  /                          → all lists w/ member counts
//   GET  /:id                       → one list w/ members
//   POST /                          → create
//   PUT  /:id                       → update meta
//   DEL  /:id                       → delete (cascades members)
//   POST /:id/members               → add by contact_ids (idempotent)
//   POST /:id/members/from-org/:org → add every contact in an org
//   DEL  /:id/members/:contactId    → remove single member
//   GET  /:id/resolve               → array of {id,email,mobile,full_name}
//                                     for the bulk-send fan-out path
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', requirePermission('lists.read'), async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT l.id, l.name, l.description, l.type, l.kind, l.is_active,
              l.created_at, l.updated_at,
              CONCAT_WS(' ', u.first_name, u.last_name) AS created_by_name,
              (SELECT COUNT(*) FROM contact_list_members m WHERE m.list_id = l.id) AS member_count
         FROM contact_lists l
         LEFT JOIN users u ON u.id = l.created_by
        ORDER BY l.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * Preview how many contacts match a given set of tags. Used by the Lists UI
 * "Add by tags" panel to show "this will add N contacts" before the user
 * commits — keeps them from accidentally fanning thousands of recipients in.
 *
 * Declared *before* GET /:id so "preview-tags" doesn't get caught by the
 * id route (Express matches in declaration order).
 */
router.get('/preview-tags', requirePermission('lists.read'), async (req, res, next) => {
  try {
    const idsRaw = String(req.query.tag_ids || '').split(',');
    const ids = idsRaw.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) return res.json({ count: 0 });

    const inList = ids.join(','); // ints only — safe to inline
    const sql = req.query.match === 'all'
      ? `SELECT COUNT(*) AS count FROM (
           SELECT contact_id FROM contact_tags
            WHERE tag_id IN (${inList})
         GROUP BY contact_id
           HAVING COUNT(DISTINCT tag_id) = ${ids.length}
         ) x`
      : `SELECT COUNT(DISTINCT contact_id) AS count
           FROM contact_tags WHERE tag_id IN (${inList})`;
    const [[row]] = await db.query(sql);
    res.json({ count: row.count });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('lists.read'), async (req, res, next) => {
  try {
    const [[list]] = await db.query(
      `SELECT * FROM contact_lists WHERE id = :id`,
      { id: req.params.id },
    );
    if (!list) return res.status(404).json({ error: 'List not found' });

    const [members] = await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.mobile, c.phone,
              CONCAT_WS(' ', c.first_name, c.last_name) AS full_name,
              o.id AS organization_id, o.name AS organization_name,
              m.added_at
         FROM contact_list_members m
         JOIN contacts c ON c.id = m.contact_id
         LEFT JOIN organizations o ON o.id = c.organization_id
        WHERE m.list_id = :id
        ORDER BY c.last_name, c.first_name`,
      { id: req.params.id },
    );
    res.json({ list, members });
  } catch (err) { next(err); }
});

const saveSchema = z.object({
  name:        z.string().min(1).max(150),
  description: z.string().max(500).optional().nullable(),
  type:        z.enum(['static','dynamic']).optional(),
  kind:        z.enum(['alerts','newsletter','product','marketing','other']).optional(),
  is_active:   z.boolean().optional(),
});

router.post('/', requirePermission('lists.write'), async (req, res, next) => {
  try {
    const d = saveSchema.parse(req.body);
    const [ins] = await db.query(
      `INSERT INTO contact_lists (name, description, type, kind, is_active, created_by)
       VALUES (:name, :description, :type, :kind, :is_active, :created_by)`,
      {
        name: d.name,
        description: d.description || null,
        type: d.type || 'static',
        kind: d.kind || 'other',
        is_active: d.is_active === false ? 0 : 1,
        created_by: req.user.id,
      },
    );
    res.status(201).json({ id: ins.insertId });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('lists.write'), async (req, res, next) => {
  try {
    const d = saveSchema.parse(req.body);
    await db.query(
      `UPDATE contact_lists SET
         name        = :name,
         description = :description,
         type        = :type,
         kind        = :kind,
         is_active   = :is_active
       WHERE id = :id`,
      {
        id: req.params.id,
        name: d.name,
        description: d.description || null,
        type: d.type || 'static',
        kind: d.kind || 'other',
        is_active: d.is_active === false ? 0 : 1,
      },
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('lists.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM contact_lists WHERE id = :id', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

const memberSchema = z.object({
  contact_ids: z.array(z.number().int()).min(1),
});

router.post('/:id/members', requirePermission('lists.write'), async (req, res, next) => {
  try {
    const { contact_ids } = memberSchema.parse(req.body);
    // Bulk insert with INSERT IGNORE so re-adding existing members is a no-op
    // (the UNIQUE on PK enforces dedupe at the DB level either way).
    const values = contact_ids.map((cid) => [Number(req.params.id), cid, req.user.id]);
    if (values.length) {
      await db.query(
        'INSERT IGNORE INTO contact_list_members (list_id, contact_id, added_by) VALUES ?',
        [values],
      );
    }
    res.json({ ok: true, added: values.length });
  } catch (err) { next(err); }
});

const fromTagsSchema = z.object({
  tag_ids: z.array(z.number().int().positive()).min(1),
  match:   z.enum(['any','all']).optional(),
});

router.post('/:id/members/from-tags', requirePermission('lists.write'), async (req, res, next) => {
  try {
    const d = fromTagsSchema.parse(req.body);
    const inList = d.tag_ids.join(','); // numeric — safe to inline
    const sql = d.match === 'all'
      ? `SELECT contact_id FROM contact_tags
          WHERE tag_id IN (${inList})
       GROUP BY contact_id
         HAVING COUNT(DISTINCT tag_id) = ${d.tag_ids.length}`
      : `SELECT DISTINCT contact_id FROM contact_tags WHERE tag_id IN (${inList})`;
    const [contacts] = await db.query(sql);
    if (!contacts.length) return res.json({ ok: true, added: 0 });

    const values = contacts.map((c) => [Number(req.params.id), c.contact_id, req.user.id]);
    await db.query(
      'INSERT IGNORE INTO contact_list_members (list_id, contact_id, added_by) VALUES ?',
      [values],
    );
    res.json({ ok: true, added: values.length });
  } catch (err) { next(err); }
});

router.post('/:id/members/from-org/:orgId', requirePermission('lists.write'), async (req, res, next) => {
  try {
    // Pull every contact in the org and add them in one shot. We don't reuse
    // the regular /members route because that path requires the caller to know
    // the contact ids — and "add everyone in this org" is the common wish.
    const [contacts] = await db.query(
      'SELECT id FROM contacts WHERE organization_id = :orgId',
      { orgId: req.params.orgId },
    );
    if (!contacts.length) return res.json({ ok: true, added: 0 });
    const values = contacts.map((c) => [Number(req.params.id), c.id, req.user.id]);
    await db.query(
      'INSERT IGNORE INTO contact_list_members (list_id, contact_id, added_by) VALUES ?',
      [values],
    );
    res.json({ ok: true, added: values.length });
  } catch (err) { next(err); }
});

router.delete('/:id/members/:contactId', requirePermission('lists.write'), async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM contact_list_members WHERE list_id = :id AND contact_id = :cid',
      { id: req.params.id, cid: req.params.contactId },
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:id/resolve', requirePermission('lists.read'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT c.id, c.email, c.mobile, c.phone,
              c.first_name, c.last_name,
              CONCAT_WS(' ', c.first_name, c.last_name) AS full_name,
              c.organization_id
         FROM contact_list_members m
         JOIN contacts c ON c.id = m.contact_id
        WHERE m.list_id = :id`,
      { id: req.params.id },
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
