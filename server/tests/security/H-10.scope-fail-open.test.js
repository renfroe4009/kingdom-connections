// =============================================================================
// H-10 — resolveOwnerScope's fallback for any role it doesn't explicitly
// recognize used to be `return null` (UNRESTRICTED — see every other
// contact/deal/task/invoice/subscription in the system). Since POST
// /api/roles lets any roles.manage holder create arbitrary new roles,
// every custom role silently got blanket visibility the moment it was
// created, regardless of what permissions it was actually meant to carry.
//
// Pure function-level test — the fallback path does no DB query, so no
// fixtures are needed; a synthetic user object with an unrecognized role
// name is enough to exercise it directly.
//
// Run:  node server/tests/security/H-10.scope-fail-open.test.js
// =============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

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
  console.log('== H-10 scope fail-open ==');

  const { resolveOwnerScope } = require(path.join(__dirname, '..', '..', 'src', 'services', 'scope.js'));

  await check('an uncategorised custom role gets least-privilege scope, not unrestricted', async () => {
    const fakeUser = { id: 999, roles: ['volunteer_coordinator'] }; // matches the audit's own example
    const scope = await resolveOwnerScope(fakeUser);
    if (scope === null) throw new Error('scope is null (unrestricted) — the fail-open bug is still present');
    if (!Array.isArray(scope) || scope.length !== 1 || scope[0] !== 999) {
      throw new Error(`expected [999] (own records only), got ${JSON.stringify(scope)}`);
    }
  });

  await check('admin role is still genuinely unrestricted (no regression)', async () => {
    const fakeAdmin = { id: 1, roles: ['admin'] };
    const scope = await resolveOwnerScope(fakeAdmin);
    if (scope !== null) throw new Error(`expected null (unrestricted) for admin, got ${JSON.stringify(scope)}`);
  });

  await check('sales role is still scoped to self only (no regression)', async () => {
    const fakeSales = { id: 42, roles: ['sales'] };
    const scope = await resolveOwnerScope(fakeSales);
    if (JSON.stringify(scope) !== JSON.stringify([42])) {
      throw new Error(`expected [42], got ${JSON.stringify(scope)}`);
    }
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
