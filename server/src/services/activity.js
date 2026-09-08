// =============================================================================
// Activity logger — writes to `activities` table
// =============================================================================
const { db } = require('../db');

// `required` (security remediation M-07) — most callers (a note added, a
// file uploaded) are fine best-effort: the activity feed entry is a nice-
// to-have, and a logging hiccup must never block the real action. But for
// security-relevant events (role changes, permission denials, admin
// actions on other users' accounts) a silently-dropped log entry means the
// event leaves no trace at all — pass `required: true` to let a write
// failure here propagate instead of being swallowed, so the caller's own
// route fails loudly (via its normal catch → next(err)) rather than
// succeeding with no audit trail.
async function logActivity({ userId = null, entityType, entityId, action, description = null, meta = null, required = false }) {
  try {
    await db.query(
      `INSERT INTO activities (user_id, entity_type, entity_id, action, description, meta_json)
       VALUES (:userId, :entityType, :entityId, :action, :description, CAST(:meta AS JSON))`,
      {
        userId,
        entityType,
        entityId,
        action,
        description,
        meta: meta ? JSON.stringify(meta) : null,
      }
    );
  } catch (err) {
    if (required) throw err;
    // eslint-disable-next-line no-console
    console.warn('[activity] log failed:', err.message);
  }
}

module.exports = { logActivity };
