// =============================================================================
// /api/activities
// =============================================================================
const router = require('express').Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { resolveOwnerScope } = require('../services/scope');

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    // Portal users have no scoped access implemented for this endpoint (unlike
    // invoices/subscriptions, which are scoped via contact_id) — there's no
    // legitimate portal use case for raw activity history, so deny outright
    // rather than trust an entity_id the caller supplies.
    if (req.user.roles?.includes('portal')) return res.json([]);

    const { entity_type, entity_id, user_id, limit = 100 } = req.query;
    const where = ['1=1']; const params = { limit: Number(limit) };
    if (entity_type) { where.push('a.entity_type = :entity_type'); params.entity_type = entity_type; }
    if (entity_id)   { where.push('a.entity_id = :entity_id');   params.entity_id = entity_id; }
    if (user_id)     { where.push('a.user_id = :user_id');       params.user_id = user_id; }

    // Row-level scope: sales agents see only activity they or their contacts'
    // records generated; managers see their whole team's activity.
    // When viewing activity on a specific entity (entity_id provided), scope
    // is enforced by the caller's ability to reach that entity — skip the
    // user_id filter so the full history for that record is visible.
    if (!entity_id) {
      const scopeIds = await resolveOwnerScope(req.user);
      if (scopeIds !== null) {
        const ids = scopeIds.map((n) => parseInt(n, 10));
        if (ids.length === 0) {
          return res.json([]); // no scope → no results
        }
        where.push(`a.user_id IN (${ids.join(', ')})`);
      }
    }

    const [rows] = await db.query(
      `SELECT a.*, CONCAT_WS(' ', u.first_name, u.last_name) AS user_name
         FROM activities a LEFT JOIN users u ON u.id = a.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.created_at DESC LIMIT :limit`, params);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
