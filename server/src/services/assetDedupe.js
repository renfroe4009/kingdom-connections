// =============================================================================
// assetDedupe — registers an imported page's images into the real Media
// Library (media_files + storage.js), reusing an existing file byte-for-byte
// instead of storing a duplicate.
//
// media_files has no content-hash column, and adding one is a schema
// migration — a DB write this pipeline shouldn't make unasked. Instead the
// deduper makes the STORAGE KEY ITSELF the hash: every asset is stored at
// `media/library/import/<sha256>.<ext>`, so uploading byte-identical content
// twice — whether from the same ZIP re-imported, or two different pages that
// happened to ship the same image — always produces the same key. Checking
// "does a media_files row already have this exact filename" is then enough
// to detect a duplicate; no new column needed. (Contrast with storage.js's
// normal buildKey(), which folds in today's date specifically so unrelated
// uploads never collide — this deliberately bypasses that for the opposite
// reason: identical content MUST collide.)
// =============================================================================
const crypto = require('crypto');
const path = require('path');
const { db } = require('../db');
const storage = require('../services/storage');

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg)$/i;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Register one asset (already-validated buffer) into the Media Library.
 * Returns { reused: boolean, id, file_url, filename }.
 *
 * `folderId` places a genuinely NEW file into that folder; a reused file
 * keeps wherever it already lives — moving it out from under whatever page
 * is already using it would be a surprise, not a convenience.
 */
async function registerAsset({ buffer, originalName, mimeType, folderId, uploadedBy }) {
  const ext = (path.extname(originalName || '').toLowerCase().replace(/[^a-z0-9.]/g, '')) || guessExt(mimeType);
  const key = `media/library/import/${sha256(buffer)}${ext}`;

  const [[existing]] = await db.query(
    'SELECT id, file_url, filename FROM media_files WHERE filename = :key LIMIT 1',
    { key }
  );
  if (existing) return { reused: true, ...existing };

  await storage.put({ entity_type: 'media', entity_id: 'library', originalName, contentType: mimeType, buffer, key });
  const file_url = storage.getPublicUrl(key) || `/api/website/media/file/${key}`;

  const [result] = await db.query(
    `INSERT INTO media_files (filename, original_name, file_url, mime_type, file_size, folder_id, uploaded_by)
     VALUES (:filename, :original_name, :file_url, :mime_type, :file_size, :folder_id, :uploaded_by)`,
    {
      filename: key, original_name: originalName || key, file_url,
      mime_type: mimeType || 'application/octet-stream', file_size: buffer.length,
      folder_id: folderId || null, uploaded_by: uploadedBy || null,
    }
  );
  return { reused: false, id: result.insertId, file_url, filename: key };
}

function guessExt(mimeType) {
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' };
  return map[mimeType] || '';
}

/**
 * Find or create the Media Library folder new imported assets should land
 * in — one folder per imported page, so a client's "where did my images go"
 * has an obvious answer. Existing (reused) assets are left in place.
 */
async function ensureImportFolder(pageSlug) {
  const name = `Imports / ${pageSlug}`;
  const [[existing]] = await db.query('SELECT id FROM media_folders WHERE name = :name', { name });
  if (existing) return existing.id;
  const [result] = await db.query('INSERT INTO media_folders (name, parent_id) VALUES (:name, NULL)', { name });
  return result.insertId;
}

module.exports = { registerAsset, ensureImportFolder, sha256 };
