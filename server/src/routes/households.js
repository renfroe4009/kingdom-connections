// =============================================================================
// /api/households — joint-giving households (db/migrations/040)
// =============================================================================
const router = require('express').Router();
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');

router.use(requireAuth);

async function loadHousehold(id) {
  const [[household]] = await db.query('SELECT * FROM households WHERE id = :id', { id });
  if (!household) return null;
  const [members] = await db.query(
    `SELECT hm.contact_id, hm.relationship,
            CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name, c.email
       FROM household_members hm
       JOIN contacts c ON c.id = hm.contact_id
      WHERE hm.household_id = :id
      ORDER BY c.first_name, c.last_name`,
    { id }
  );
  return { ...household, members };
}

router.get('/:id', requirePermission('contacts.read'), async (req, res, next) => {
  try {
    const household = await loadHousehold(req.params.id);
    if (!household) return res.status(404).json({ error: 'Not found' });
    res.json(household);
  } catch (err) { next(err); }
});

router.post('/', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name is required' });
    const [ins] = await db.query(
      `INSERT INTO households (name, primary_contact_id, address_line1, address_line2, city, state, postal_code, country)
       VALUES (:name, :primary_contact_id, :address_line1, :address_line2, :city, :state, :postal_code, :country)`,
      {
        name: b.name, primary_contact_id: b.primary_contact_id || null,
        address_line1: b.address_line1 || null, address_line2: b.address_line2 || null,
        city: b.city || null, state: b.state || null, postal_code: b.postal_code || null, country: b.country || null,
      }
    );
    const householdId = ins.insertId;
    if (b.primary_contact_id) {
      await db.query(
        `INSERT IGNORE INTO household_members (household_id, contact_id, relationship) VALUES (:hid, :cid, 'primary')`,
        { hid: householdId, cid: b.primary_contact_id }
      );
    }
    res.status(201).json(await loadHousehold(householdId));
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const [[existing]] = await db.query('SELECT id FROM households WHERE id = :id', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await db.query(
      `UPDATE households SET
         name = :name, primary_contact_id = :primary_contact_id,
         address_line1 = :address_line1, address_line2 = :address_line2,
         city = :city, state = :state, postal_code = :postal_code, country = :country
       WHERE id = :id`,
      {
        id: req.params.id, name: b.name, primary_contact_id: b.primary_contact_id || null,
        address_line1: b.address_line1 || null, address_line2: b.address_line2 || null,
        city: b.city || null, state: b.state || null, postal_code: b.postal_code || null, country: b.country || null,
      }
    );
    res.json(await loadHousehold(req.params.id));
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    await db.query('DELETE FROM households WHERE id = :id', { id: req.params.id });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.post('/:id/members', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    const contactId = Number(req.body?.contact_id);
    if (!contactId) return res.status(400).json({ error: 'contact_id is required' });
    await db.query(
      `INSERT IGNORE INTO household_members (household_id, contact_id, relationship) VALUES (:hid, :cid, :rel)`,
      { hid: req.params.id, cid: contactId, rel: req.body?.relationship || null }
    );
    res.status(201).json(await loadHousehold(req.params.id));
  } catch (err) { next(err); }
});

router.delete('/:id/members/:contactId', requirePermission('contacts.write'), async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM household_members WHERE household_id = :hid AND contact_id = :cid',
      { hid: req.params.id, cid: req.params.contactId }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.loadHousehold = loadHousehold;
