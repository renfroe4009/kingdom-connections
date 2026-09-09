// =============================================================================
// PHASE5-02 — two more findings from Phase 5's SSRF/unsafe-URL variant
// analysis (dispatched after PHASE5-01 found the ada.js bug), both against
// the same vulnerability class.
//
// 1. services/automations.js's 'webhook' action — config.url (unvalidated
//    JSON from a stored workflow's flow_definition) was fetched server-side
//    with no restriction on target. Triggerable indirectly by an
//    UNAUTHENTICATED public form submission (routes/forms.js's automation
//    trigger), so whatever host an automations.write-holding user
//    configured is reachable by anyone who can find the trigger, not just
//    staff — blind SSRF (response body isn't reflected, only the HTTP
//    status is logged) but full request-body exfiltration of CRM entity
//    data to an attacker-chosen host, plus internal-network reach. Fixed
//    with the same services/urlSafety.js helper written for ada.js.
//
// 2. routes/payments.js's POST /public/checkout/:invoiceId — a client-
//    supplied returnUrl was accepted whenever it "started with" the
//    configured CLIENT_ORIGIN, a prefix check bypassable with
//    `${origin}.evil.com`, `${origin}@evil.com`, or `${origin}evil.com`
//    (no trailing slash). returnUrl feeds directly into the gateway
//    call — Authorize.net's hosted-payment iframe-communicator origin AND
//    Valor's redirect/callback URLs — so a bypass could redirect the
//    gateway's own transaction-response hand-off to an attacker-controlled
//    host. Fixed by parsing with `new URL()` and comparing the resulting
//    origin (scheme+host+port) exactly against the allowed origin list,
//    the same one index.js's CORS check uses.
//
// Run:  node server/tests/security/PHASE5-02.ssrf-webhook-and-return-url.test.js
// =============================================================================
const path = require('path');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ORIGIN_HEADER = { Origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim() };
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'sectest-admin@localcrm.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SecTest123!';

function request(method, pathname, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(new URL(API_BASE + pathname), {
      method,
      headers: { ...ORIGIN_HEADER,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function login(email, password) {
  const r = await request('POST', '/api/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${r.body}`);
  return JSON.parse(r.body).token;
}

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

  console.log('== PHASE5-02 SSRF in automations webhook + returnUrl origin bypass ==');

  // --- 1. automations.js webhook SSRF ---
  const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  let wfId;

  async function runWebhookWorkflow(url) {
    const flow_definition = {
      nodes: [
        { id: 't1', type: 'triggerNode', data: {} },
        { id: 'a1', type: 'actionNode', data: { actionType: 'webhook', config: { url } } },
      ],
      edges: [{ source: 't1', target: 'a1' }],
    };
    const created = await request('POST', '/api/automations', {
      token, body: { name: `PHASE5-02 test ${Date.now()}`, trigger_type: 'contact.created', flow_definition },
    });
    if (created.status !== 201) throw new Error(`create workflow failed: ${created.status} ${created.body}`);
    wfId = JSON.parse(created.body).id;

    const [[contact]] = await db.query('SELECT id FROM contacts LIMIT 1');
    const fired = await request('POST', `/api/automations/${wfId}/test`, {
      token, body: { entity_type: 'contact', entity_id: contact.id },
    });
    if (fired.status !== 200) throw new Error(`test-fire failed: ${fired.status} ${fired.body}`);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const [[log]] = await db.query(
      `SELECT status, output FROM automation_execution_log
        WHERE workflow_id = :wid AND node_id = 'a1' ORDER BY id DESC LIMIT 1`,
      { wid: wfId }
    );
    if (!log) throw new Error(`no execution_log row found for workflow ${wfId}`);
    await request('DELETE', `/api/automations/${wfId}`, { token });
    await db.query('DELETE FROM automation_execution_log WHERE workflow_id = :wid', { wid: wfId });
    await db.query('DELETE FROM automation_enrollments WHERE workflow_id = :wid', { wid: wfId });
    await db.query('DELETE FROM automation_workflows WHERE id = :wid', { wid: wfId });
    return log;
  }

  await check('automations webhook action: a LOOPBACK target is blocked (skipped, not fetched)', async () => {
    const log = await runWebhookWorkflow('http://127.0.0.1:4220/api/health');
    const output = log.output; // native JSON column
    if (!output.skipped) throw new Error(`expected the webhook to be skipped, got: ${JSON.stringify(output)}`);
  });

  await check('automations webhook action: a real public URL still completes (no regression)', async () => {
    const log = await runWebhookWorkflow('http://example.com');
    if (log.status !== 'completed') throw new Error(`expected completed, got ${log.status}: ${JSON.stringify(log.output)}`);
  });

  await check('services/automations.js calls isSafeTargetUrl before fetching the webhook URL', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'services', 'automations.js'), 'utf8');
    if (!/isSafeTargetUrl\(config\.url\)/.test(src)) throw new Error('expected a isSafeTargetUrl(config.url) guard before the webhook fetch');
  });

  // --- 2. payments.js returnUrl origin bypass ---
  // The vulnerable value isn't observable through the API response shape
  // for the locally-configured Valor gateway (the Valor branch returns
  // early with just fee info), so this replicates the EXACT logic now in
  // routes/payments.js against the classic startsWith() bypass strings,
  // proving the fix's actual decision function rejects them.
  await check("returnUrl origin check: 'startsWith' bypass strings are all rejected", () => {
    const allowedOrigins = [ORIGIN_HEADER.Origin];
    function computeReturnUrl(requested, invoiceId) {
      const origin = allowedOrigins[0];
      let requestedOrigin = null;
      try { requestedOrigin = new URL(requested).origin; } catch { /* not absolute */ }
      return (requested && requestedOrigin && allowedOrigins.includes(requestedOrigin))
        ? requested : `${origin}/pay/${invoiceId}?paid=1`;
    }
    const bypasses = [
      `${ORIGIN_HEADER.Origin}.evil.com/steal`,
      `${ORIGIN_HEADER.Origin}@evil.com/steal`,
      `${ORIGIN_HEADER.Origin.replace('http://', 'http://x@')}evil.com/steal`,
    ];
    for (const bypass of bypasses) {
      const result = computeReturnUrl(bypass, 1);
      if (result === bypass) throw new Error(`bypass string "${bypass}" was NOT rejected — got it back verbatim`);
    }
    const legit = `${ORIGIN_HEADER.Origin}/pay/1?foo=bar`;
    if (computeReturnUrl(legit, 1) !== legit) throw new Error('a legitimate same-origin returnUrl with a path/query was incorrectly rejected');
  });

  await check('routes/payments.js no longer uses the vulnerable startsWith() origin check', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'routes', 'payments.js'), 'utf8');
    if (/\(requested && requested\.startsWith\(origin\)\)/.test(src)) throw new Error('found the old (requested && requested.startsWith(origin)) prefix check still in place');
    if (!/new URL\(requested\)\.origin/.test(src)) throw new Error('expected the new exact-origin comparison via new URL().origin');
  });

  // --- 3. receipts.js logo fetch SSRF (lower priority — admin-only write,
  // fetch result is embedded as image bytes, never reflected as text) ---
  const { logoUrlToBuffer } = require(path.join(__dirname, '..', '..', 'src', 'services', 'receipts.js'));

  await check('receipts.js logoUrlToBuffer: a LOOPBACK target returns null (not fetched)', async () => {
    const buf = await logoUrlToBuffer('http://127.0.0.1:4220/api/health');
    if (buf !== null) throw new Error(`expected null, got a ${buf?.length}-byte buffer`);
  });

  await check('receipts.js logoUrlToBuffer: a data: URI still works (no regression — not a network fetch at all)', async () => {
    const buf = await logoUrlToBuffer('data:text/plain;base64,aGVsbG8=');
    if (buf?.toString() !== 'hello') throw new Error(`expected "hello", got: ${buf?.toString()}`);
  });

  await check('receipts.js logoUrlToBuffer: a real public URL still fetches bytes (no regression)', async () => {
    const buf = await logoUrlToBuffer('http://example.com');
    if (!buf || buf.length === 0) throw new Error('expected a non-empty buffer for a real public URL');
  });

  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
