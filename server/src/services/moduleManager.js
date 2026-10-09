// =============================================================================
// moduleManager — admin-controlled visibility for nav sections, submodules,
// and optional integrations (e.g. hiding ConnectWise for a business that
// doesn't use it). Stored as one JSON blob in the settings KV table, same
// pattern as moduleSettings.js's "module.<name>" keys.
//
// This is a UI-visibility gate only — it hides nav items / settings tabs for
// everyone, it does not revoke backend permissions. Permission checks
// (requirePermission in middleware/auth.js) remain the actual authorization
// boundary; a disabled module/integration still has its API routes reachable
// by someone who already has the permission and the URL, same as a
// perm-gated nav item does today.
//
// Shape:
//   { sections: { <sectionKey>: boolean }, items: { <navItem.to>: boolean },
//     integrations: { <integrationKey>: boolean } }
// Unlisted keys default to enabled (true) so a fresh install (or a newly
// added section/item/integration) is visible until an admin opts to hide it.
// =============================================================================
const { db } = require('../db');

const KEY = 'module_manager';

const DEFAULT_CONFIG = { sections: {}, items: {}, integrations: {} };

async function get() {
  const [[row]] = await db.query(
    'SELECT value_json FROM settings WHERE `key` = :k', { k: KEY }
  );
  const stored = row?.value_json || {};
  return {
    sections:     { ...DEFAULT_CONFIG.sections,     ...(stored.sections     || {}) },
    items:        { ...DEFAULT_CONFIG.items,        ...(stored.items        || {}) },
    integrations: { ...DEFAULT_CONFIG.integrations, ...(stored.integrations || {}) },
  };
}

async function set(values) {
  const next = {
    sections:     (values?.sections     && typeof values.sections     === 'object') ? values.sections     : {},
    items:        (values?.items        && typeof values.items        === 'object') ? values.items        : {},
    integrations: (values?.integrations && typeof values.integrations === 'object') ? values.integrations : {},
  };
  await db.query(
    `INSERT INTO settings (\`key\`, value_json) VALUES (:k, CAST(:v AS JSON))
       ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)`,
    { k: KEY, v: JSON.stringify(next) }
  );
  return next;
}

module.exports = { get, set };
