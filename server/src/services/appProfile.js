// =============================================================================
// contact_app_profiles read/write helpers — extracted out of routes/mobileApi.js
// so the erasure boundary (the compliance-critical part: this table is the
// ONLY thing a "delete my data" request touches, never the core `contacts`
// row or its donation/membership history) is one tested unit, not inline SQL.
// =============================================================================
const { db } = require('../db');

async function upsertAppProfile(contactId, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return;
  const insertCols = ['contact_id', ...cols].join(', ');
  const insertPlaceholders = ['contact_id', ...cols].map((c) => `:${c}`).join(', ');
  const updateSet = cols.map((c) => `${c} = VALUES(${c})`).join(', ');
  await db.query(
    `INSERT INTO contact_app_profiles (${insertCols}) VALUES (${insertPlaceholders})
       ON DUPLICATE KEY UPDATE ${updateSet}`,
    { contact_id: contactId, ...fields }
  );
}

// The only operation a mobile "delete my data" request performs — erases the
// app-owned profile row (avatar, bio, push token, consent) and marks it
// deleted. Never touches `contacts` or anything donation/membership-related.
async function eraseAppProfile(contactId) {
  await db.query(
    `INSERT INTO contact_app_profiles (contact_id, app_account_status, deleted_at, avatar_url, bio, display_name_override, push_token, notification_consent)
     VALUES (:id, 'deleted', NOW(), NULL, NULL, NULL, NULL, 0)
     ON DUPLICATE KEY UPDATE
       app_account_status = 'deleted', deleted_at = NOW(),
       avatar_url = NULL, bio = NULL, display_name_override = NULL,
       push_token = NULL, notification_consent = 0`,
    { id: contactId }
  );
}

module.exports = { upsertAppProfile, eraseAppProfile };
