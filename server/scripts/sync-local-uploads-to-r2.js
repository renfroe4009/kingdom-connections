#!/usr/bin/env node
/* =============================================================================
 * sync-local-uploads-to-r2.js
 * One-off migration: uploads every file under server/uploads/ to R2, preserving
 * its relative path as the object key. Needed because existing media_files /
 * business_settings rows already reference these exact keys (via the local
 * driver's /file/* proxy route) — switching STORAGE_DRIVER to s3 only works if
 * the same keys also exist in the bucket, since storage.driver is one global
 * setting, not tracked per-file.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs   = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else out.push(full);
  }
  return out;
}

async function main() {
  if ((process.env.STORAGE_DRIVER || 'local').toLowerCase() !== 's3') {
    console.error('STORAGE_DRIVER is not "s3" — set it in server/.env before running this.');
    process.exit(1);
  }
  const files = walk(UPLOADS_DIR);
  console.log(`Found ${files.length} local files under uploads/`);

  const s3 = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId:     process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  let ok = 0, fail = 0;
  for (const full of files) {
    const key = path.relative(UPLOADS_DIR, full).split(path.sep).join('/');
    const ext = path.extname(full).toLowerCase();
    try {
      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: fs.readFileSync(full),
        ContentType: MIME[ext] || 'application/octet-stream',
      }));
      ok++;
      console.log(`  uploaded: ${key}`);
    } catch (e) {
      fail++;
      console.error(`  FAILED: ${key} — ${e.message}`);
    }
  }
  console.log(`Done. ${ok} uploaded, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
}

main();
