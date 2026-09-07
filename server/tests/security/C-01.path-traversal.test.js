// =============================================================================
// C-01 — path traversal via GET /api/website/media/file/*
//
// Exercises the exploit against a REAL running dev server (not a mock),
// per the audit's own methodology note that this class of bug must be
// empirically reproduced, not reasoned about — Express's router normalises
// an *unencoded* `../` away before the handler ever sees it, but the
// percent-encoded form (`%2e%2e%2f`) survives intact.
//
// Requires: the local dev server running on API_BASE (default :4220), and
// a real registered media_files row at TEST_KEY with a matching file on
// disk (see the setup this test's companion shell commands created).
//
// Run:  node server/tests/security/C-01.path-traversal.test.js
// =============================================================================
const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const TEST_KEY = 'media/library/2026-09-07/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(API_BASE + path, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

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
  console.log('== C-01 path traversal ==');

  // Empirically confirmed against the unpatched route on 2026-09-07: this
  // exact payload returned 200 with the real server/.env body, including
  // JWT_SECRET and DB_PASSWORD — the audit's C-01 chain reproduced live.
  await check('encoded traversal to server/.env returns 400, no env contents', async () => {
    const r = await get('/api/website/media/file/%2e%2e%2f%2e%2e%2fserver%2f.env');
    if (r.status !== 400) throw new Error(`expected 400 got ${r.status}`);
    const body = r.body.toString('utf8');
    if (/JWT_SECRET|DB_PASSWORD/.test(body)) throw new Error('response body leaked env contents');
  });

  await check('encoded traversal ..%2f..%2fserver%2f.env returns 400', async () => {
    const r = await get('/api/website/media/file/..%2f..%2fserver%2f.env');
    if (r.status !== 400) throw new Error(`expected 400 got ${r.status}`);
  });

  await check('double-encoded traversal %252e%252e%252f returns 400 (not silently double-decoded)', async () => {
    const r = await get('/api/website/media/file/%252e%252e%252f%252e%252e%252fserver%252f.env');
    if (r.status === 200) throw new Error('double-encoded traversal returned 200');
  });

  await check('well-shaped but unregistered key returns 404, not disk contents', async () => {
    const r = await get('/api/website/media/file/media/library/2020-01-01/deadbeefdeadbeefdeadbeefdeadbeefdeadbeef.png');
    if (r.status !== 404) throw new Error(`expected 404 got ${r.status}`);
  });

  await check('valid registered key still returns 200 (no regression)', async () => {
    const r = await get('/api/website/media/file/' + TEST_KEY);
    if (r.status !== 200) throw new Error(`expected 200 got ${r.status}`);
    if (r.body.length === 0) throw new Error('expected non-empty file body');
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
