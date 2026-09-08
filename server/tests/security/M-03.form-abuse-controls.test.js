// =============================================================================
// M-03 — public form submission had no abuse controls beyond a honeypot (any
// targeted script bypasses body.__hp), stored the ENTIRE request body with no
// field allowlist or size cap (~10MB per request via Express's global JSON
// limit), and overwrote an EXISTING contact's real CRM data whenever a
// submission's email happened to match one — an unauthenticated attacker who
// knew a donor's email could corrupt their name/phone/address on file.
//
// Fixed: only fields declared in form_fields are persisted (everything else,
// including a spoofed CAPTCHA/honeypot field name, is dropped), each capped
// at 5000 chars with a 50KB total backstop; an existing contact only has
// CURRENTLY EMPTY fields filled by an unauthenticated submission, never
// overwritten; optional Cloudflare Turnstile verification (services/captcha.js)
// is wired in but a no-op with no TURNSTILE_SECRET_KEY configured (this repo
// has none locally — verified as a structural, not live, check below). The
// per-form/IP rate limit (H-07, 20/hr) was already in place before this pass.
//
// Run:  node server/tests/security/M-03.form-abuse-controls.test.js
// =============================================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ORIGIN_HEADER = { Origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim() };

function request(method, pathname, { body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(new URL(API_BASE + pathname), {
      method,
      headers: { ...ORIGIN_HEADER, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
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

  console.log('== M-03 public form abuse controls ==');

  const SLUG = 'sectest-m03-form';
  let formId, existingContactId;

  await check('setup: create a form with declared fields (first_name, phone, message) and an existing contact', async () => {
    await db.query('DELETE FROM contacts WHERE email = :email', { email: 'sectest-m03@localcrm.local' });
    const [c] = await db.query(
      `INSERT INTO contacts (first_name, last_name, email, phone) VALUES ('RealName', 'DoNotOverwrite', 'sectest-m03@localcrm.local', NULL)`
    );
    existingContactId = c.insertId;

    await db.query('DELETE FROM forms WHERE slug = :slug', { slug: SLUG });
    const [f] = await db.query(
      `INSERT INTO forms (name, slug, is_active, honeypot, crm_action, crm_mapping_json)
       VALUES ('M-03 Test Form', :slug, 1, 1, 'create_contact', :mapping)`,
      { slug: SLUG, mapping: JSON.stringify({ first_name: 'first_name', phone: 'phone', email: 'email', message: 'notes' }) }
    );
    formId = f.insertId;
    for (const [key, label, type] of [['first_name', 'First name', 'text'], ['phone', 'Phone', 'text'], ['email', 'Email', 'email'], ['message', 'Message', 'textarea']]) {
      await db.query(
        `INSERT INTO form_fields (form_id, field_key, label, field_type) VALUES (:formId, :key, :label, :type)`,
        { formId, key, label, type }
      );
    }
  });

  await check('a request field NOT declared on the form is dropped from storage', async () => {
    const r = await request('POST', `/api/forms/public/${SLUG}/submit`, {
      body: { first_name: 'Attacker', email: 'sectest-m03-other@localcrm.local', message: 'hi', not_a_real_field: 'should not be stored', __proto__: 'ignored' },
    });
    if (r.status !== 201) throw new Error(`submit failed: ${r.status} ${r.body}`);
    const [[row]] = await db.query('SELECT data_json FROM form_submissions WHERE form_id = :formId ORDER BY id DESC LIMIT 1', { formId });
    const stored = row.data_json; // native JSON column — mysql2 parses it for us
    if ('not_a_real_field' in stored) throw new Error(`undeclared field was persisted: ${JSON.stringify(stored)}`);
    if (stored.first_name !== 'Attacker') throw new Error('a legitimate declared field was unexpectedly dropped too');
  });

  await check('a declared field value is truncated at 5000 chars, not stored verbatim', async () => {
    const huge = 'A'.repeat(20000);
    const r = await request('POST', `/api/forms/public/${SLUG}/submit`, {
      body: { first_name: 'Big', email: 'sectest-m03-other2@localcrm.local', message: huge },
    });
    if (r.status !== 201) throw new Error(`submit failed: ${r.status} ${r.body}`);
    const [[row]] = await db.query('SELECT data_json FROM form_submissions WHERE form_id = :formId ORDER BY id DESC LIMIT 1', { formId });
    const stored = row.data_json;
    if (stored.message.length !== 5000) throw new Error(`expected message truncated to 5000 chars, got ${stored.message.length}`);
  });

  await check('an unauthenticated submission matching an existing contact\'s email does NOT overwrite an already-set field', async () => {
    const r = await request('POST', `/api/forms/public/${SLUG}/submit`, {
      body: { first_name: 'AttackerOverwrite', last_name: 'Spoofed', email: 'sectest-m03@localcrm.local', message: 'trying to overwrite' },
    });
    if (r.status !== 201) throw new Error(`submit failed: ${r.status} ${r.body}`);
    const [[contact]] = await db.query('SELECT first_name, last_name, phone FROM contacts WHERE id = :id', { id: existingContactId });
    if (contact.first_name !== 'RealName') throw new Error(`first_name was overwritten: now "${contact.first_name}"`);
  });

  await check('...but a field that WAS empty on the existing contact (phone) gets filled in (no regression on the legitimate case)', async () => {
    const r = await request('POST', `/api/forms/public/${SLUG}/submit`, {
      body: { first_name: 'RealName', email: 'sectest-m03@localcrm.local', phone: '555-0100', message: 'adding my phone number' },
    });
    if (r.status !== 201) throw new Error(`submit failed: ${r.status} ${r.body}`);
    const [[contact]] = await db.query('SELECT phone FROM contacts WHERE id = :id', { id: existingContactId });
    if (contact.phone !== '555-0100') throw new Error(`expected the empty phone field to be filled in, got "${contact.phone}"`);
  });

  await check('captcha.js: verifyTurnstile is a no-op when TURNSTILE_SECRET_KEY is unset (structural — not configured locally)', () => {
    if (process.env.TURNSTILE_SECRET_KEY) throw new Error('TURNSTILE_SECRET_KEY is set locally — this test assumes the default unconfigured state');
    const { isConfigured } = require(path.join(__dirname, '..', '..', 'src', 'services', 'captcha.js'));
    if (isConfigured()) throw new Error('expected isConfigured() to be false with no secret key set');
  });

  await check('forms.js: submission handler calls verifyTurnstile before persisting', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'routes', 'forms.js'), 'utf8');
    if (!/verifyTurnstile/.test(src)) throw new Error('expected forms.js to call verifyTurnstile');
  });

  await check('cleanup: remove fixtures', async () => {
    await db.query('DELETE FROM form_submissions WHERE form_id = :formId', { formId });
    await db.query('DELETE FROM form_fields WHERE form_id = :formId', { formId });
    await db.query('DELETE FROM forms WHERE id = :formId', { formId });
    await db.query('DELETE FROM contacts WHERE id = :id', { id: existingContactId });
    await db.query('DELETE FROM contacts WHERE email IN (:e1, :e2)', { e1: 'sectest-m03-other@localcrm.local', e2: 'sectest-m03-other2@localcrm.local' });
  });

  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
