#!/usr/bin/env node
/* =============================================================================
 * import-remaining-vcsf-images.js
 * One-off follow-up to seed-vcsf-website.js: uploads the website-files/images
 * assets that the original seeder's IMAGES map didn't reference, so they're
 * available in the shared media library (media_files) for any module to use.
 *
 * Skips files that are byte-identical to something already in the library
 * (checked by SHA-256), since those are just renamed duplicates.
 *
 * Run: cd server && node scripts/import-remaining-vcsf-images.js
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db } = require('../src/db');
const storage = require('../src/services/storage');
let sharp; try { sharp = require('sharp'); } catch { sharp = null; }

const IMG_DIR = path.join(__dirname, '..', '..', 'website-files', 'images');

// Files not already covered by seed-vcsf-website.js's IMAGES map.
// raw: true -> keep original format (logos/icons where exact bytes matter).
const CANDIDATES = [
  { file: 'logo-full.png',     alt: 'VCSF full logo lockup',        raw: true },
  { file: 'logo-navy.png',     alt: 'VCSF logo (navy)',             raw: true },
  { file: 'logo-navy-text.jpg',alt: 'VCSF logo with navy wordmark', raw: true },
  { file: 'favicon.svg',       alt: 'VCSF favicon (vector)',        raw: true },
  // Included for completeness; expected to be skipped as duplicates of
  // logo.png/apple-touch-icon.png/favicon-32.png/favicon-512.png already seeded.
  { file: 'logo.png',              alt: 'VCSF logo emblem', raw: true },
  { file: 'apple-touch-icon.png',  alt: 'VCSF apple touch icon', raw: true },
  { file: 'favicon-32.png',        alt: 'VCSF favicon 32', raw: true },
  { file: 'favicon-512.png',       alt: 'VCSF favicon 512', raw: true },
  { file: 'logo-reversed.png',     alt: 'VCSF logo (reversed)', raw: true },
];

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function url(key) {
  return storage.getPublicUrl(key) || `/api/website/media/file/${key}`;
}

async function main() {
  console.log(`Storage driver: ${storage.driver || process.env.STORAGE_DRIVER || 'local'}`);

  const [[folderRow]] = await db.query("SELECT id FROM media_folders WHERE name = 'VCSF Website' LIMIT 1");
  let folderId = folderRow?.id;
  if (!folderId) {
    const [r] = await db.query("INSERT INTO media_folders (name, parent_id) VALUES ('VCSF Website', NULL)");
    folderId = r.insertId;
  }

  // Build a hash index of everything already in the library so we can skip
  // byte-identical renames without re-downloading/re-hashing existing files.
  const [existingRows] = await db.query('SELECT id, filename, original_name FROM media_files');
  const existingHashes = new Set();
  for (const row of existingRows) {
    try {
      const got = await storage.getReadable({ driver: storage.driver, key: row.filename });
      if (got.type === 'redirect') continue; // remote driver — can't cheaply hash, fall through to re-check by size later
      const chunks = [];
      for await (const chunk of got.stream) chunks.push(chunk);
      existingHashes.add(sha256(Buffer.concat(chunks)));
    } catch { /* file missing on disk — ignore */ }
  }

  let added = 0, skipped = 0;
  for (const meta of CANDIDATES) {
    const src = path.join(IMG_DIR, meta.file);
    if (!fs.existsSync(src)) { console.warn(`  ! missing ${meta.file} — skipped`); continue; }

    const buffer = fs.readFileSync(src);
    const hash = sha256(buffer);
    if (existingHashes.has(hash)) {
      console.log(`  = ${meta.file} — identical to an existing library file, skipped`);
      skipped++;
      continue;
    }

    const [[dup]] = await db.query('SELECT id FROM media_files WHERE folder_id = ? AND original_name = ?', [folderId, meta.file]);
    if (dup) { console.log(`  = ${meta.file} — already imported by name, skipped`); skipped++; continue; }

    const ext = path.extname(meta.file).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    let width = null, height = null;
    if (sharp && mime !== 'image/svg+xml') {
      try { const m = await sharp(buffer).metadata(); width = m.width; height = m.height; } catch {}
    }

    const { key } = await storage.put({
      entity_type: 'media', entity_id: 'library',
      originalName: meta.file, contentType: mime, buffer,
    });

    const file_url = url(key);
    await db.query(
      `INSERT INTO media_files (filename, original_name, file_url, mime_type, file_size, width, height, alt_text, folder_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [key, meta.file, file_url, mime, buffer.length, width, height, meta.alt, folderId]
    );
    existingHashes.add(hash);
    console.log(`  + ${meta.file} -> ${file_url}`);
    added++;
  }

  console.log(`\nDone. ${added} added, ${skipped} skipped as duplicates.`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
