// =============================================================================
// scope.js — Row-level access scoping
// =============================================================================
// resolveOwnerScope(user) → number[] | null
//
//   null          = unrestricted  (admin, readonly, portal)
//   number[]      = array of user IDs whose records this caller may read/write
//
// Role behaviour (confirmed decisions — Part 10 of Roles.docx):
//   admin / readonly  → null (unrestricted)
//   sales / sales_agent      → [user.id]
//   manager / sales_manager  → recursive CTE walk: self + all direct/indirect reports
//   portal           → null (scoped separately per-route by contact_id)
// =============================================================================
const { db } = require('../db');

/**
 * Returns the set of user IDs whose owned records the caller is allowed to see.
 * Returns null for unrestricted access (admin/readonly/portal).
 *
 * Multi-level: walks the full org chart so a manager can see a
 * manager-report's agents' records too.
 */
async function resolveOwnerScope(user) {
  if (!user) return [];

  const roles = user.roles || [];

  // Unrestricted roles (admin, readonly) see all records via null scope.
  // Portal users are intentionally NOT listed here — they must be scoped by
  // contact_id/organization_id at the route level via requirePortal + getScope().
  // Returning [] (no matching owner IDs) for portal users here means if a portal
  // user ever reaches a standard route that calls resolveOwnerScope, they'll get
  // an empty result set rather than all records (defensive programming, Finding 17).
  if (roles.includes('admin') || roles.includes('readonly')) {
    return null;
  }
  if (roles.includes('portal')) {
    return []; // portal routes use their own getScope() — fall back to empty
  }

  // Manager roles: self + all recursive direct/indirect reports
  if (roles.includes('manager') || roles.includes('sales_manager')) {
    const [rows] = await db.query(
      `WITH RECURSIVE reports AS (
         SELECT id FROM users WHERE id = :me AND is_active = 1
         UNION ALL
         SELECT u.id
           FROM users u
           JOIN reports r ON u.manager_id = r.id
          WHERE u.is_active = 1
       )
       SELECT id FROM reports`,
      { me: user.id }
    );
    return rows.map((r) => r.id);
  }

  // Agent / sales roles: own records only
  if (roles.includes('sales') || roles.includes('sales_agent')) {
    return [user.id];
  }

  // Fallback: no restriction (e.g. future roles not yet categorised)
  return null;
}

/**
 * Builds a SQL fragment for owner_id scoping.
 * IDs are inlined as integers (always integers from our own DB — injection-safe).
 *
 * Usage:
 *   const clause = ownerClause(scopeIds, 'c.owner_id');
 *   if (clause) where.push(clause);
 *
 * Returns null when unrestricted (null scope).
 */
function ownerClause(scopeIds, column = 'owner_id') {
  if (scopeIds === null) return null;
  if (scopeIds.length === 0) return '1=0'; // no access at all
  const ids = scopeIds.map((n) => parseInt(n, 10)).join(', ');
  return `${column} IN (${ids})`;
}

/**
 * Builds a SQL fragment for contact-based scoping (invoices, subscriptions).
 * Scopes via: column IN (SELECT id FROM contacts WHERE owner_id IN (...))
 *
 * Usage:
 *   const clause = contactOwnerClause(scopeIds, 'i.contact_id');
 *   if (clause) where.push(clause);
 */
function contactOwnerClause(scopeIds, column = 'contact_id') {
  if (scopeIds === null) return null;
  if (scopeIds.length === 0) return '1=0';
  const ids = scopeIds.map((n) => parseInt(n, 10)).join(', ');
  return `${column} IN (SELECT id FROM contacts WHERE owner_id IN (${ids}))`;
}

/**
 * Builds a SQL fragment for tasks scoping:
 *   (assigned_to IN (...) OR created_by IN (...))
 *
 * Usage:
 *   const clause = taskClause(scopeIds);
 *   if (clause) where.push(clause);
 */
function taskClause(scopeIds) {
  if (scopeIds === null) return null;
  if (scopeIds.length === 0) return '1=0';
  const ids = scopeIds.map((n) => parseInt(n, 10)).join(', ');
  return `(assigned_to IN (${ids}) OR created_by IN (${ids}))`;
}

/**
 * Row-level scope check for routes that operate on a *child* record (a
 * note, an attachment, a household, a saved list) by loading its *parent*
 * entity and confirming the caller's scope actually covers it — mirrors the
 * pattern already correct at contacts.js's GET /:id (security remediation
 * H-02/H-03). Throws a { status, message } error rather than returning a
 * boolean, so route handlers can just `await` it inside their existing
 * try/catch and forward err.status straight to res.status().
 *
 * @param {object} user - req.user
 * @param {string} table - parent table name (must be a hardcoded string
 *   from the caller, e.g. via a fixed entity_type -> table map — never
 *   pass request-derived input directly, this does no escaping)
 * @param {number} entityId
 * @param {string} [ownerColumn] - defaults to 'owner_id'
 */
async function assertOwnerEntityInScope(user, table, entityId, ownerColumn = 'owner_id') {
  const [[row]] = await db.query(
    `SELECT ${ownerColumn} AS owner_id FROM ${table} WHERE id = :id`,
    { id: entityId }
  );
  if (!row) throw Object.assign(new Error('Not found'), { status: 404 });
  const scopeIds = await resolveOwnerScope(user);
  if (scopeIds !== null && !scopeIds.includes(row.owner_id)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
}

module.exports = {
  resolveOwnerScope, ownerClause, contactOwnerClause, taskClause, assertOwnerEntityInScope,
};
