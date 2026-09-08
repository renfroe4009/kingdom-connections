// =============================================================================
// H-12 (dependency hardening) — multer stayed pinned to the 1.4.x line,
// which had known DoS advisories in its multipart parser. Migrated to 2.x
// (a public-API-compatible upgrade for this app's usage — all 5 call sites
// use the simple memoryStorage() + .single('file') pattern with no
// version-specific error handling to update).
//
// Structural check only — the real regression coverage is functional:
// H-11.upload-validation.test.js exercises a full multipart upload through
// media.js under whatever multer version is actually installed, and this
// session additionally smoke-tested attachments.js and import.js live
// (multipart body + extra form fields parsed correctly) before this change
// was committed.
//
// Run:  node server/tests/security/H-12.multer-version.test.js
// =============================================================================
const path = require('path');

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}

console.log('== H-12 multer version ==');

check('multer is on the 2.x line, not the 1.4.x line with known DoS advisories', () => {
  const { version } = require(path.join(__dirname, '..', '..', 'node_modules', 'multer', 'package.json'));
  const major = Number(version.split('.')[0]);
  if (major < 2) throw new Error(`expected multer >= 2.0.0, got ${version}`);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
