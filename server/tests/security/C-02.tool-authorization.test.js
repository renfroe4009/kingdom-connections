// =============================================================================
// C-02 (full fix) — the AI assistant's ~22 database tools ran with only the
// Phase 0 interim gate (block portal, require SOME real CRM permission) at
// the /api/ai/chat endpoint level. Every individual tool then executed with
// no per-tool permission check and no row-level scope check of its own — a
// 'sales'-role rep (scoped to their own records everywhere else in the app)
// could use the assistant to read/list/complete records belonging to other
// reps, and any staff account holding as little as one real permission
// (e.g. tasks.read only) could use financial-reporting tools it has no
// permission for anywhere else in the app.
//
// Fixed: services/ai.js gained a deny-by-default TOOL_POLICY map (permission
// per tool, mirroring requirePermission()'s own admin-bypass + AND-of-all
// logic via hasPermission()), a getToolsForUser() filter applied to what's
// actually advertised to the model, a second authorization check re-run at
// tool-EXECUTION time (not just advertisement time), and resolveOwnerScope()
// row-scoping added to every tool whose underlying query already has a
// scoped equivalent elsewhere in the app (contacts, deals, tasks, invoices,
// payments, subscriptions) — matching what the same account can already see
// through the regular UI, not a new restriction invented for the assistant.
//
// Fixtures used (created alongside this test, see the remediation log):
//   - sectest-staff@localcrm.local (id 6, 'sales' role — scoped to own
//     records; holds contacts/tasks/deals/invoices/payments/subscriptions
//     permissions but NOT campaigns.*/settings.manage/comms.templates.manage)
//   - sectest-admin@localcrm.local (id 11, 'admin' role — unrestricted)
//   - contacts #15 (owner_id=6, "SecTest OwnedByStaff") and #16
//     (owner_id=11, "SecTest OwnedByOther") — pre-existing fixtures from
//     earlier phases, reused here.
//   - a task (created fresh by this test's setup, see below) owned by the
//     admin fixture, outside the staff fixture's scope.
//
// This exercises services/ai.js's exported building blocks directly
// (hasPermission, getToolsForUser, TOOL_POLICY, executeTool) against the
// real local DB — no Anthropic API key needed, since none of what's being
// verified here involves the model itself.
//
// Run:  node server/tests/security/C-02.tool-authorization.test.js
// =============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');
const {
  hasPermission, getToolsForUser, TOOL_POLICY, executeTool,
} = require(path.join(__dirname, '..', '..', 'src', 'services', 'ai.js'));

const STAFF = {
  id: 6, email: 'sectest-staff@localcrm.local', roles: ['sales'],
  permissions: [
    'contacts.read', 'contacts.write', 'deals.read', 'deals.write', 'import.csv',
    'invoices.read', 'invoices.send', 'invoices.write', 'maps.view', 'notes.read',
    'notes.write', 'organizations.read', 'organizations.write', 'payments.read',
    'reports.view', 'subscriptions.read', 'tasks.read', 'tasks.write',
  ],
};
const ADMIN = { id: 11, email: 'sectest-admin@localcrm.local', roles: ['admin'], permissions: [] };

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

  console.log('== C-02 (full fix) AI tool authorization ==');

  // --- hasPermission() building block ---
  await check('hasPermission: admin role bypasses regardless of permissions list', () => {
    if (!hasPermission(ADMIN, ['settings.manage', 'comms.templates.manage'])) {
      throw new Error('admin should bypass every permission check');
    }
  });

  await check('hasPermission: a held permission passes', () => {
    if (!hasPermission(STAFF, ['contacts.read'])) throw new Error('staff holds contacts.read, should pass');
  });

  await check('hasPermission: a missing permission is denied', () => {
    if (hasPermission(STAFF, ['settings.manage'])) throw new Error('staff does not hold settings.manage, should be denied');
  });

  // --- Tool list filtering (advertisement-time) ---
  await check('getToolsForUser: staff (sales) does NOT see settings.manage-gated blog tools', () => {
    const names = getToolsForUser(STAFF).map((t) => t.name);
    if (names.includes('save_blog_draft') || names.includes('get_blog_posts') || names.includes('update_blog_post')) {
      throw new Error(`staff should not be offered blog tools, got: ${names.join(', ')}`);
    }
    if (!names.includes('search_contacts')) throw new Error('staff SHOULD be offered search_contacts (holds contacts.read)');
  });

  await check('getToolsForUser: admin sees every tool', () => {
    const names = getToolsForUser(ADMIN).map((t) => t.name);
    if (names.length !== Object.keys(TOOL_POLICY).length) {
      throw new Error(`admin should see all ${Object.keys(TOOL_POLICY).length} tools, got ${names.length}`);
    }
  });

  // --- Deny-by-default (execution-time re-check, mirrors streamChat's logic) ---
  await check('an unrecognized tool name has no TOOL_POLICY entry (deny-by-default)', () => {
    if (TOOL_POLICY['not_a_real_tool'] !== undefined) throw new Error('expected no policy for a made-up tool name');
  });

  // --- Row-level scope: search_contacts ---
  await check('search_contacts: a scoped staff user sees only their OWN contact, not another rep\'s', async () => {
    const result = await executeTool('search_contacts', { query: 'SecTest' }, STAFF);
    const names = result.contacts.map((c) => `${c.first_name} ${c.last_name}`);
    if (!names.includes('SecTest OwnedByStaff')) throw new Error(`expected to see own contact, got: ${JSON.stringify(names)}`);
    if (names.includes('SecTest OwnedByOther')) throw new Error(`scope leak — saw another rep's contact: ${JSON.stringify(names)}`);
  });

  await check('search_contacts: admin (unrestricted scope) sees BOTH (no regression)', async () => {
    const result = await executeTool('search_contacts', { query: 'SecTest' }, ADMIN);
    const names = result.contacts.map((c) => `${c.first_name} ${c.last_name}`);
    if (!names.includes('SecTest OwnedByStaff') || !names.includes('SecTest OwnedByOther')) {
      throw new Error(`admin should see both fixtures, got: ${JSON.stringify(names)}`);
    }
  });

  // --- Row-level scope: get_contact_stats (aggregate) ---
  await check('get_contact_stats: staff\'s total is scoped, strictly less than admin\'s org-wide total', async () => {
    const staffStats = await executeTool('get_contact_stats', {}, STAFF);
    const adminStats  = await executeTool('get_contact_stats', {}, ADMIN);
    if (!(staffStats.total < adminStats.total)) {
      throw new Error(`expected staff.total (${staffStats.total}) < admin.total (${adminStats.total})`);
    }
  });

  // --- complete_task IDOR ---
  let fixtureTaskId;
  await check('setup: create a task owned by admin, outside the staff fixture\'s scope', async () => {
    const [ins] = await db.query(
      `INSERT INTO tasks (title, status, priority, created_by, assigned_to)
       VALUES ('C-02 test task (admin-owned)', 'open', 'normal', :adminId, :adminId)`,
      { adminId: ADMIN.id }
    );
    fixtureTaskId = ins.insertId;
  });

  await check('complete_task: a scoped staff user CANNOT complete another user\'s task via id', async () => {
    const result = await executeTool('complete_task', { id: fixtureTaskId }, STAFF);
    if (!result.error) throw new Error(`expected an error, task was completed: ${JSON.stringify(result)}`);
    const [[row]] = await db.query('SELECT status FROM tasks WHERE id = :id', { id: fixtureTaskId });
    if (row.status !== 'open') throw new Error(`task status changed to "${row.status}" — IDOR succeeded`);
  });

  await check('complete_task: the admin (owner, unrestricted scope) CAN complete it (no regression)', async () => {
    const result = await executeTool('complete_task', { id: fixtureTaskId }, ADMIN);
    if (result.error) throw new Error(`admin should be able to complete their own task: ${result.error}`);
    const [[row]] = await db.query('SELECT status FROM tasks WHERE id = :id', { id: fixtureTaskId });
    if (row.status !== 'completed') throw new Error(`expected status "completed", got "${row.status}"`);
  });

  await check('cleanup: remove the fixture task', async () => {
    if (fixtureTaskId) await db.query('DELETE FROM tasks WHERE id = :id', { id: fixtureTaskId });
  });

  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
