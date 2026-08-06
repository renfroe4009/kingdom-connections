// =============================================================================
// merge.js — contact/organization duplicate-merge engine
//
// Reassigns every table that references contacts.id/organizations.id onto a
// survivor record, then retires the loser via merged_into_id (never a hard
// delete, so history/audit trail stays intact and old links can redirect).
// Table list confirmed against the live schema, not guessed — see
// FUNDRAISING-MODULE-GAP-REVIEW.md Phase G for the audit this was built from.
// =============================================================================
const { db } = require('../db');

class MergeConflictError extends Error {
  constructor(message, payload) {
    super(message);
    this.status = 409;
    this.payload = payload;
  }
}

const CONTACT_FIELD_ALLOWLIST = [
  'organization_id', 'first_name', 'last_name', 'email', 'phone', 'mobile', 'title', 'department',
  'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country', 'linkedin_url',
  'lifecycle_stage', 'lead_source', 'owner_id', 'notes', 'tax_exempt',
];

const ORG_FIELD_ALLOWLIST = [
  'name', 'website', 'phone', 'industry', 'sic_code', 'employee_count', 'annual_revenue',
  'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'country', 'notes',
  'owner_id', 'tax_exempt',
];

function pickAllowed(fields, allowlist) {
  const out = {};
  for (const k of allowlist) if (k in fields) out[k] = fields[k];
  return out;
}

async function mergeContacts({ survivorId, loserId, fields = {}, confirmLoginDeactivation, userId }) {
  if (survivorId === loserId) throw Object.assign(new Error('Cannot merge a record with itself'), { status: 400 });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[survivor]] = await conn.query('SELECT id, merged_into_id FROM contacts WHERE id = :id FOR UPDATE', { id: survivorId });
    const [[loser]] = await conn.query('SELECT id, merged_into_id FROM contacts WHERE id = :id FOR UPDATE', { id: loserId });
    if (!survivor || !loser) throw Object.assign(new Error('Contact not found'), { status: 404 });
    if (survivor.merged_into_id || loser.merged_into_id) {
      throw Object.assign(new Error('One of these contacts has already been merged into another record'), { status: 409 });
    }

    const [[loginRow]] = await conn.query('SELECT id, email, is_active FROM users WHERE contact_id = :id', { id: loserId });
    if (loginRow?.is_active && !confirmLoginDeactivation) {
      throw new MergeConflictError('This contact has an active portal login that will be deactivated', {
        conflict: 'active_login', email: loginRow.email,
      });
    }

    const setFields = pickAllowed(fields, CONTACT_FIELD_ALLOWLIST);
    if (Object.keys(setFields).length) {
      const setClause = Object.keys(setFields).map((k) => `${k} = :${k}`).join(', ');
      await conn.query(`UPDATE contacts SET ${setClause} WHERE id = :id`, { ...setFields, id: survivorId });
    }

    // Plain nullable FK, no other uniqueness constraint — reassign directly.
    const simpleFkTables = [
      ['deals', 'primary_contact_id'],
      ['subscriptions', 'contact_id'],
      ['invoices', 'contact_id'],
      ['donations', 'contact_id'],
      ['donations', 'soft_credit_contact_id'],
      ['orders', 'contact_id'],
      ['event_registrations', 'contact_id'],
      ['payment_intents', 'contact_id'],
      ['recurring_invoices', 'contact_id'],
      ['vault_profiles', 'contact_id'],
      ['email_scheduled_sends', 'contact_id'],
      ['carts', 'contact_id'],
      ['households', 'primary_contact_id'],
    ];
    for (const [table, col] of simpleFkTables) {
      await conn.query(`UPDATE ${table} SET ${col} = :survivorId WHERE ${col} = :loserId`, { survivorId, loserId });
    }

    // FK also covered by a uniqueness constraint alongside another column —
    // UPDATE IGNORE so the rare case (both records already share the same
    // event/list/campaign/household) just leaves that one row attached to
    // the retired loser record instead of aborting the whole merge.
    const uniqueFkTables = [
      ['event_volunteer_assignments', 'contact_id'],
      ['contact_list_members', 'contact_id'],
      ['email_campaign_enrollments', 'contact_id'],
      ['household_members', 'contact_id'],
    ];
    for (const [table, col] of uniqueFkTables) {
      await conn.query(`UPDATE IGNORE ${table} SET ${col} = :survivorId WHERE ${col} = :loserId`, { survivorId, loserId });
    }

    // contact_tags — composite PK; union the tag sets rather than UPDATE
    // IGNORE, which would silently drop the loser's unique tags.
    await conn.query(
      'INSERT IGNORE INTO contact_tags (contact_id, tag_id) SELECT :survivorId, tag_id FROM contact_tags WHERE contact_id = :loserId',
      { survivorId, loserId }
    );
    await conn.query('DELETE FROM contact_tags WHERE contact_id = :loserId', { loserId });

    // Polymorphic tables — no real FK, matched by entity_type/entity_id.
    for (const table of ['activities', 'notes', 'tasks', 'sms_logs']) {
      await conn.query(
        `UPDATE ${table} SET entity_id = :survivorId WHERE entity_type = 'contact' AND entity_id = :loserId`,
        { survivorId, loserId }
      );
    }

    // Portal/staff login — never reassign to the survivor (would let two
    // separate credentials sign in as the same contact); detach + deactivate.
    if (loginRow) {
      await conn.query('UPDATE users SET contact_id = NULL, is_active = 0 WHERE id = :id', { id: loginRow.id });
    }

    await conn.query('UPDATE contacts SET merged_into_id = :survivorId WHERE id = :loserId', { survivorId, loserId });

    await conn.commit();
    return { survivorId, loginDeactivated: !!loginRow };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function mergeOrganizations({ survivorId, loserId, fields = {} }) {
  if (survivorId === loserId) throw Object.assign(new Error('Cannot merge a record with itself'), { status: 400 });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[survivor]] = await conn.query('SELECT id, merged_into_id FROM organizations WHERE id = :id FOR UPDATE', { id: survivorId });
    const [[loser]] = await conn.query('SELECT id, merged_into_id FROM organizations WHERE id = :id FOR UPDATE', { id: loserId });
    if (!survivor || !loser) throw Object.assign(new Error('Organization not found'), { status: 404 });
    if (survivor.merged_into_id || loser.merged_into_id) {
      throw Object.assign(new Error('One of these organizations has already been merged into another record'), { status: 409 });
    }

    const setFields = pickAllowed(fields, ORG_FIELD_ALLOWLIST);
    if (Object.keys(setFields).length) {
      const setClause = Object.keys(setFields).map((k) => `${k} = :${k}`).join(', ');
      await conn.query(`UPDATE organizations SET ${setClause} WHERE id = :id`, { ...setFields, id: survivorId });
    }

    const simpleFkTables = [
      ['deals', 'organization_id'],
      ['subscriptions', 'organization_id'],
      ['invoices', 'organization_id'],
      ['donations', 'organization_id'],
      ['event_registrations', 'organization_id'],
      ['payment_intents', 'organization_id'],
      ['recurring_invoices', 'organization_id'],
      ['vault_profiles', 'organization_id'],
      ['contacts', 'organization_id'], // member contacts follow the org
    ];
    for (const [table, col] of simpleFkTables) {
      await conn.query(`UPDATE ${table} SET ${col} = :survivorId WHERE ${col} = :loserId`, { survivorId, loserId });
    }

    // organization_tags — composite PK; union rather than overwrite.
    await conn.query(
      'INSERT IGNORE INTO organization_tags (organization_id, tag_id) SELECT :survivorId, tag_id FROM organization_tags WHERE organization_id = :loserId',
      { survivorId, loserId }
    );
    await conn.query('DELETE FROM organization_tags WHERE organization_id = :loserId', { loserId });

    for (const table of ['activities', 'notes', 'tasks', 'sms_logs']) {
      await conn.query(
        `UPDATE ${table} SET entity_id = :survivorId WHERE entity_type = 'organization' AND entity_id = :loserId`,
        { survivorId, loserId }
      );
    }

    await conn.query('UPDATE organizations SET merged_into_id = :survivorId WHERE id = :loserId', { survivorId, loserId });

    await conn.commit();
    return { survivorId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Quick counts of what will move if `loserId` is merged away — shown to the
// user before they confirm. Kept to the handful of tables most meaningful in
// a fundraising CRM rather than every table in the full reassignment list.
async function getContactMergePreview(id) {
  const [[row]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM donations WHERE contact_id = :id) AS donations,
       (SELECT COUNT(*) FROM orders WHERE contact_id = :id) AS orders,
       (SELECT COUNT(*) FROM subscriptions WHERE contact_id = :id) AS subscriptions,
       (SELECT COUNT(*) FROM invoices WHERE contact_id = :id) AS invoices,
       (SELECT COUNT(*) FROM event_registrations WHERE contact_id = :id) AS event_registrations,
       (SELECT COUNT(*) FROM contact_tags WHERE contact_id = :id) AS tags,
       (SELECT id FROM users WHERE contact_id = :id AND is_active = 1 LIMIT 1) AS active_login_user_id`,
    { id }
  );
  return row;
}

async function getOrganizationMergePreview(id) {
  const [[row]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM donations WHERE organization_id = :id) AS donations,
       (SELECT COUNT(*) FROM invoices WHERE organization_id = :id) AS invoices,
       (SELECT COUNT(*) FROM subscriptions WHERE organization_id = :id) AS subscriptions,
       (SELECT COUNT(*) FROM contacts WHERE organization_id = :id) AS contacts,
       (SELECT COUNT(*) FROM organization_tags WHERE organization_id = :id) AS tags`,
    { id }
  );
  return row;
}

module.exports = {
  MergeConflictError,
  mergeContacts,
  mergeOrganizations,
  getContactMergePreview,
  getOrganizationMergePreview,
};
