// =============================================================================
// MOBILE-05 — PII minimization + app_enabled org scoping
// (server/src/routes/mobileApi.js's MEMBER_FIELDS/shapeMember, and the
// app_enabled gate every member route joins against)
//
// Covers:
//   - The member query never selects donation/financial/internal CRM fields
//     (owner_id, notes, lifecycle_stage, lead_source, annual_revenue, etc.)
//     even though those columns exist on `contacts`/`organizations`.
//   - shapeMember() only ever surfaces the documented public shape.
//   - A contact belonging to an org with app_enabled = 0 is invisible to the
//     exact query the mobile API uses (the least-privilege gate actually
//     works, not just documented).
//
// Run:  node server/tests/security/MOBILE-05.pii-minimization-and-org-scope.test.js
// =============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

let db;
let pass = 0, fail = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}

const FORBIDDEN_SUBSTRINGS = [
  'annual_revenue', 'tax_id', 'tax_exempt', 'notes', 'owner_id',
  'lifecycle_stage', 'lead_source', 'merged_into_id', 'cw_contact_id', 'cw_company_id',
];

(async () => {
  db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    namedPlaceholders: true,
  });

  console.log('== MOBILE-05 PII minimization + org scope ==');

  const { MEMBER_FIELDS, shapeMember } = require(path.join(__dirname, '..', '..', 'src', 'routes', 'mobileApi.js'));

  await check('MEMBER_FIELDS never references a donation/financial/internal-CRM column', () => {
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      if (MEMBER_FIELDS.includes(forbidden)) {
        throw new Error(`MEMBER_FIELDS selects "${forbidden}" — this must never reach the mobile API`);
      }
    }
  });

  await check('shapeMember() only ever returns the documented public shape, even given a "dirty" row', () => {
    const dirtyRow = {
      id: 1, organization_id: 2, first_name: 'A', last_name: 'B', email: 'a@b.com', updated_at: '2026-01-01',
      avatar_url: 'x', bio: 'y', display_name_override: null, notification_consent: 1, app_account_status: 'active',
      // Simulates a future accidental SELECT * / join leak:
      notes: 'SHOULD NEVER APPEAR', owner_id: 999, annual_revenue: 5000000, tax_id: '12-3456789',
    };
    const shaped = shapeMember(dirtyRow);
    const json = JSON.stringify(shaped);
    for (const forbidden of ['SHOULD NEVER APPEAR', 'annual_revenue', 'tax_id', '5000000']) {
      if (json.includes(forbidden)) throw new Error(`shapeMember() leaked "${forbidden}" into the response`);
    }
  });

  // ---- app_enabled scoping, exercised against a real DB ----
  await db.query(`DELETE FROM organizations WHERE name = 'SecTest MOBILE-05 Org'`);
  const [insOrg] = await db.query(
    `INSERT INTO organizations (name, app_enabled) VALUES ('SecTest MOBILE-05 Org', 0)`
  );
  const orgId = insOrg.insertId;
  const [insContact] = await db.query(
    `INSERT INTO contacts (first_name, last_name, email, organization_id)
     VALUES ('SecTest', 'Mobile05', 'sectest-mobile05@example.com', :orgId)`,
    { orgId }
  );
  const contactId = insContact.insertId;

  await check('a contact in a NON-app_enabled org is invisible to the member-detail query', async () => {
    const [[row]] = await db.query(
      `SELECT ${MEMBER_FIELDS}
         FROM contacts c
         JOIN organizations o ON o.id = c.organization_id AND o.app_enabled = 1
         LEFT JOIN contact_app_profiles p ON p.contact_id = c.id
        WHERE c.id = :id`,
      { id: contactId }
    );
    if (row) throw new Error('contact from a disabled org was returned — app_enabled gate is not working');
  });

  await db.query('UPDATE organizations SET app_enabled = 1 WHERE id = :id', { id: orgId });

  await check('the same contact becomes visible once its org is app_enabled', async () => {
    const [[row]] = await db.query(
      `SELECT ${MEMBER_FIELDS}
         FROM contacts c
         JOIN organizations o ON o.id = c.organization_id AND o.app_enabled = 1
         LEFT JOIN contact_app_profiles p ON p.contact_id = c.id
        WHERE c.id = :id`,
      { id: contactId }
    );
    if (!row) throw new Error('contact did not become visible after enabling its org');
  });

  await db.query('DELETE FROM contacts WHERE id = :id', { id: contactId });
  await db.query('DELETE FROM organizations WHERE id = :id', { id: orgId });
  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
