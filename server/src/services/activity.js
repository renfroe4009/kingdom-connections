// =============================================================================
// Activity logger — writes to `activities` table
// =============================================================================
const { db } = require('../db');

async function logActivity({ userId = null, entityType, entityId, action, description = null, meta = null }) {
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
    // eslint-disable-next-line no-console
    console.warn('[activity] log failed:', err.message);
  }
}

module.exports = { logActivity };
