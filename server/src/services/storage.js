// =============================================================================
// storage — single abstraction over local disk + S3-compatible object storage.
//
// Driver is chosen from env:
//   STORAGE_DRIVER=local                           (default)
//   STORAGE_DRIVER=s3
//     S3_ENDPOINT=https://s3.us-east-1.amazonaws.com  (optional; for AWS, omit)
//     S3_REGION=us-east-1
//     S3_BUCKET=my-bucket
//     S3_ACCESS_KEY_ID=...
//     S3_SECRET_ACCESS_KEY=...
//     S3_FORCE_PATH_STYLE=true                     (set true for MinIO / R2 / Wasabi)
//
// The service intentionally avoids requiring @aws-sdk until S3 is selected,
// so the server can run without AWS deps installed when driver=local.
// =============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
const LOCAL_ROOT = process.env.LOCAL_STORAGE_DIR
  ? path.resolve(process.env.LOCAL_STORAGE_DIR)
  : path.resolve(__dirname, '../../uploads');

function randomKey(originalName) {
  const ext = path.extname(originalName || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  return `${crypto.randomBytes(20).toString('hex')}${ext}`;
}

function buildKey({ entity_type, entity_id, originalName }) {
  const date = new Date().toISOString().slice(0, 10);
  return `${entity_type}/${entity_id}/${date}/${randomKey(originalName)}`;
}

// ---------- LOCAL DRIVER ----------
// Resolves `key` under LOCAL_ROOT and refuses anything that would escape it
// (traversal sequences, absolute-path keys, symlink-free `..` segments).
// path.relative is the reliable containment test here — path.join alone
// happily walks a `../../etc/passwd`-shaped key straight out of LOCAL_ROOT.
function safeLocalPath(key) {
  if (typeof key !== 'string' || !key) {
    throw Object.assign(new Error('Invalid storage key'), { status: 400 });
  }
  const dest = path.resolve(LOCAL_ROOT, key);
  const rel = path.relative(LOCAL_ROOT, dest);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('Invalid storage key'), { status: 400 });
  }
  return dest;
}

async function localPut({ key, buffer }) {
  const dest = safeLocalPath(key);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffer);
}
function localStream(key) {
  return fs.createReadStream(safeLocalPath(key));
}
async function localDelete(key) {
  try { fs.unlinkSync(safeLocalPath(key)); } catch (_e) { /* ignore missing or invalid */ }
}

// ---------- S3 DRIVER (lazy-loaded) ----------
let _s3 = null;
function s3Client() {
  if (_s3) return _s3;
  const { S3Client } = require('@aws-sdk/client-s3');
  _s3 = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId:     process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
  return _s3;
}

async function s3Put({ key, buffer, contentType }) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await s3Client().send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
  }));
}

async function s3SignedUrl(key, { filename, expiresIn = 300 } = {}) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const cmd = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    ResponseContentDisposition: filename
      ? `attachment; filename="${filename.replace(/"/g, '')}"`
      : undefined,
  });
  return await getSignedUrl(s3Client(), cmd, { expiresIn });
}

async function s3Delete(key) {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await s3Client().send(new DeleteObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
  }));
}

// ---------- PUBLIC API ----------
/**
 * Save a buffer. Returns { key, driver, bucket }.
 */
async function put({ entity_type, entity_id, originalName, contentType, buffer }) {
  const key = buildKey({ entity_type, entity_id, originalName });
  if (DRIVER === 's3') {
    await s3Put({ key, buffer, contentType });
    return { key, driver: 's3', bucket: process.env.S3_BUCKET };
  }
  await localPut({ key, buffer });
  return { key, driver: 'local', bucket: null };
}

/**
 * Either returns a signed URL (s3) or a Node readable stream (local).
 */
async function getReadable({ driver, key, filename, expiresIn }) {
  if (driver === 's3') {
    const url = await s3SignedUrl(key, { filename, expiresIn });
    return { type: 'redirect', url };
  }
  return { type: 'stream', stream: localStream(key) };
}

async function remove({ driver, key }) {
  if (driver === 's3') return s3Delete(key);
  return localDelete(key);
}

/**
 * Returns a stable, directly-fetchable public URL for an object — or null if
 * the driver can't produce one (local disk has no public URL of its own; the
 * caller must expose it through its own unauthenticated route instead).
 */
function getPublicUrl(key) {
  if (DRIVER === 's3') {
    const base = process.env.S3_PUBLIC_URL
      || `${(process.env.S3_ENDPOINT || '').replace(/\/$/, '')}/${process.env.S3_BUCKET}`;
    return `${base.replace(/\/$/, '')}/${key}`;
  }
  return null;
}

module.exports = {
  driver: DRIVER,
  put,
  getReadable,
  remove,
  getPublicUrl,
};
