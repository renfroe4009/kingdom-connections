// =============================================================================
// H-11 — upload validation trusted the client-declared Content-Type with no
// real content check, and allowed image/svg+xml (active content — can
// embed <script>), served with no explicit Content-Type at all (browser
// sniffing decided how to render it).
//
// Fixed: real magic-byte validation via `file-type` after multer buffers
// the file, SVG dropped from both media.js's and cmsData.js's allowlists,
// and /file/* now sets an explicit Content-Type (from the DB-registered
// value, never sniffed) plus X-Content-Type-Options: nosniff.
//
// Run:  node server/tests/security/H-11.upload-validation.test.js
// =============================================================================
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ORIGIN_HEADER = { Origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim() };
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'sectest-admin@localcrm.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SecTest123!';

// A real 1x1 PNG (has genuine PNG magic bytes).
const REAL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
  '01f15c4890000000a49444154789c630001000005000105' +
  '0d2db4' + '0000000049454e44ae426082', 'hex'
);
// HTML/script content, but will be uploaded declaring Content-Type: image/png.
const FAKE_PNG = Buffer.from('<html><body><script>alert(document.cookie)</script></body></html>');

function loginAndUpload({ filename, mimetype, buffer }) {
  return new Promise(async (resolve, reject) => {
    const loginData = JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const loginReq = http.request(new URL(API_BASE + '/api/auth/login'), {
      method: 'POST',
      headers: { ...ORIGIN_HEADER, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData) },
    }, (loginRes) => {
      const chunks = [];
      loginRes.on('data', (c) => chunks.push(c));
      loginRes.on('end', () => {
        const token = JSON.parse(Buffer.concat(chunks).toString('utf8')).token;

        const boundary = '----sectesth11boundary';
        const parts = [
          `--${boundary}\r\n`,
          `Content-Disposition: form-data; name="files"; filename="${filename}"\r\n`,
          `Content-Type: ${mimetype}\r\n\r\n`,
        ].join('');
        const body = Buffer.concat([Buffer.from(parts), buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);

        const uploadReq = http.request(new URL(API_BASE + '/api/website/media/upload'), {
          method: 'POST',
          headers: { ...ORIGIN_HEADER,
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
          },
        }, (uploadRes) => {
          const uChunks = [];
          uploadRes.on('data', (c) => uChunks.push(c));
          uploadRes.on('end', () => resolve({ status: uploadRes.statusCode, body: Buffer.concat(uChunks).toString('utf8') }));
        });
        uploadReq.on('error', reject);
        uploadReq.write(body);
        uploadReq.end();
      });
    });
    loginReq.on('error', reject);
    loginReq.write(loginData);
    loginReq.end();
  });
}

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get(API_BASE + pathname, { headers: ORIGIN_HEADER }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
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

  console.log('== H-11 upload validation ==');

  await check('SVG is rejected outright by the declared-type allowlist', async () => {
    const r = await loginAndUpload({ filename: 'x.svg', mimetype: 'image/svg+xml', buffer: Buffer.from('<svg onload="alert(1)"></svg>') });
    if (r.status < 400) throw new Error(`expected a 4xx got ${r.status}: ${r.body}`);
  });

  await check('a script disguised with a PNG Content-Type is rejected by the magic-byte check', async () => {
    const r = await loginAndUpload({ filename: 'fake.png', mimetype: 'image/png', buffer: FAKE_PNG });
    if (r.status !== 400) throw new Error(`expected 400 got ${r.status}: ${r.body}`);
  });

  let realUploadId;
  await check('a real PNG still uploads successfully (no regression)', async () => {
    const r = await loginAndUpload({ filename: 'real.png', mimetype: 'image/png', buffer: REAL_PNG });
    if (r.status !== 201) throw new Error(`expected 201 got ${r.status}: ${r.body}`);
    const json = JSON.parse(r.body);
    realUploadId = json[0]?.id;
    if (!realUploadId) throw new Error('no upload id returned');
  });

  await check('the served file has an explicit Content-Type + nosniff (no browser sniffing)', async () => {
    const [[row]] = await db.query('SELECT filename FROM media_files WHERE id = :id', { id: realUploadId });
    const r = await get(`/api/website/media/file/${row.filename}`);
    if (r.status !== 200) throw new Error(`expected 200 got ${r.status}`);
    if (!r.headers['content-type']) throw new Error('no Content-Type header set at all');
    if (r.headers['x-content-type-options'] !== 'nosniff') throw new Error('missing X-Content-Type-Options: nosniff');
  });

  // cleanup
  if (realUploadId) {
    await db.query('DELETE FROM media_files WHERE id = :id', { id: realUploadId }).catch(() => {});
  }

  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
