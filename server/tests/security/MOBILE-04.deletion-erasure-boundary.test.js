// =============================================================================
// MOBILE-04 — the App Store/compliance "delete my data" boundary
// (server/src/services/appProfile.js's eraseAppProfile())
//
// This is the single most compliance-sensitive behavior in the whole
// integration: a mobile deletion request must erase the app-owned profile
// (avatar, bio, push token, consent) WITHOUT touching the underlying CRM
// contact record or anything donation/membership-related — nonprofits are
// legally required to retain that history even after a user asks the app to
// forget them.
//
// Run:  node server/tests/security/MOBILE-04.deletion-erasure-boundary.test.js
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

(async () => {
  db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    namedPlaceholders: true,
  });

  console.log('== MOBILE-04 deletion erasure boundary ==');

  const { upsertAppProfile, eraseAppProfile } = require(path.join(__dirname, '..', '..', 'src', 'services', 'appProfile.js'));

  await db.query(`DELETE FROM contacts WHERE email = 'sectest-mobile04@example.com'`);
  const [insContact] = await db.query(
    `INSERT INTO contacts (first_name, last_name, email, notes, lifecycle_stage)
     VALUES ('SecTest', 'Mobile04', 'sectest-mobile04@example.com', 'Major donor, do not solicit by phone', 'customer')`
  );
  const contactId = insContact.insertId;

  await upsertAppProfile(contactId, {
    avatar_url: 'https://example.com/avatar.png',
    bio: 'Hello from the app',
    push_token: 'abc123devicetoken',
    notification_consent: true,
  });

  await check('app profile fields are actually set before the deletion request', async () => {
    const [[row]] = await db.query('SELECT * FROM contact_app_profiles WHERE contact_id = :id', { id: contactId });
    if (!row || row.app_account_status !== 'active') throw new Error('expected an active app profile row before erasure');
    if (!row.avatar_url || !row.bio || !row.push_token) throw new Error('setup did not populate expected fields');
  });

  await eraseAppProfile(contactId);

  await check('after erasure, all app-owned PII fields are cleared and status is deleted', async () => {
    const [[row]] = await db.query('SELECT * FROM contact_app_profiles WHERE contact_id = :id', { id: contactId });
    if (!row) throw new Error('contact_app_profiles row disappeared entirely (should be soft-erased, not deleted)');
    if (row.app_account_status !== 'deleted') throw new Error(`expected status 'deleted', got '${row.app_account_status}'`);
    if (row.avatar_url !== null) throw new Error('avatar_url was not cleared');
    if (row.bio !== null) throw new Error('bio was not cleared');
    if (row.push_token !== null) throw new Error('push_token was not cleared');
    if (Number(row.notification_consent) !== 0) throw new Error('notification_consent was not cleared');
    if (!row.deleted_at) throw new Error('deleted_at was not set');
  });

  await check('the underlying CRM contact record — including donor notes — is completely untouched', async () => {
    const [[row]] = await db.query('SELECT notes, lifecycle_stage, email FROM contacts WHERE id = :id', { id: contactId });
    if (!row) throw new Error('the contact record itself was deleted — this must never happen from an app data-deletion request');
    if (row.notes !== 'Major donor, do not solicit by phone') throw new Error('donor notes were altered by an app-profile erasure');
    if (row.lifecycle_stage !== 'customer') throw new Error('lifecycle_stage was altered by an app-profile erasure');
  });

  await check('eraseAppProfile() is idempotent — calling it again on an already-deleted profile does not error', async () => {
    await eraseAppProfile(contactId); // should not throw
    const [[row]] = await db.query('SELECT app_account_status FROM contact_app_profiles WHERE contact_id = :id', { id: contactId });
    if (row.app_account_status !== 'deleted') throw new Error('status regressed on a repeat erasure call');
  });

  await check('eraseAppProfile() on a contact with NO prior app profile creates a deleted stub rather than erroring', async () => {
    const [insContact2] = await db.query(
      `INSERT INTO contacts (first_name, last_name, email) VALUES ('SecTest', 'Mobile04b', 'sectest-mobile04b@example.com')`
    );
    const id2 = insContact2.insertId;
    await eraseAppProfile(id2); // no prior upsertAppProfile call
    const [[row]] = await db.query('SELECT app_account_status FROM contact_app_profiles WHERE contact_id = :id', { id: id2 });
    if (!row || row.app_account_status !== 'deleted') throw new Error('expected a deleted stub row to be created');
    await db.query('DELETE FROM contacts WHERE id = :id', { id: id2 });
  });

  await db.query('DELETE FROM contact_app_profiles WHERE contact_id = :id', { id: contactId });
  await db.query('DELETE FROM contacts WHERE id = :id', { id: contactId });
  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
