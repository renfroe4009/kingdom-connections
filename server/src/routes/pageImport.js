// =============================================================================
// /api/website/import — turn an uploaded design ZIP (HTML/CSS/JS/assets) into
// a page, the same way scripts/import-design.js turns a folder into one —
// but as an admin-facing upload instead of a CLI command run against a
// checked-out copy of the design folder.
//
// Shares its actual conversion logic with the CLI script via
// scripts/lib/html-import-utils.js and scripts/lib/convert-sections.js —
// this route is the upload/diff/review layer on top, not a second
// implementation of the parser.
//
// Mounted at its own path (`/api/website/import`), not nested under
// `/pages/*`, so there's no risk of it ever being shadowed by or colliding
// with website.js's `/pages/:id` routes regardless of require() order.
//
// SAFETY MODEL — nothing here silently overwrites a live page:
//   • Importing as a NEW page creates it with status='draft'.
//   • Importing as an UPDATE to an existing page writes a website_versions
//     snapshot (the same table/shape the page editor's own "Save" already
//     writes for undo) and does NOT touch that page's live puck_data. The
//     admin reviews the diff, then applies it via the existing version-
//     restore button in the page editor (POST /api/website/versions/:vid/restore)
//     — no new "apply" endpoint needed, that machinery already exists.
//   • CSS: only rules that don't already exist anywhere in site_custom_css
//     are appended, and only after this call succeeds — additive-only, so it
//     can never change how an existing page already renders. A rule whose
//     SELECTOR already exists with DIFFERENT declarations is a conflict:
//     reported, never auto-applied anywhere. Resolving one is a manual step
//     in Website → Header & Footer → CSS (site-wide) or the page's own
//     Custom CSS field (this page only) — both already exist; seeing which
//     one is intended is exactly the human judgement call.
//   • Assets are deduplicated by content hash (services/assetDedupe.js) — a
//     re-import of the same design, or two pages sharing an image, reuses
//     the same Media Library file instead of storing it again.
// =============================================================================
const express = require('express');
const multer = require('multer');
const path = require('path');
const AdmZip = require('adm-zip');
const { parse } = require('node-html-parser');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { validateUploadedFile } = require('../services/uploadValidation');
const { registerAsset, ensureImportFolder } = require('../services/assetDedupe');
const { diffStylesheets } = require('../services/cssRuleDiff');
const {
  absolutizeUrls, rewriteInternalLinks, slugFor, parsePageHtml, buildTree,
} = require('../../scripts/lib/html-import-utils');

const router = express.Router();
router.use(requireAuth);

// Junk that ships with hand-assembled/exported folders — same list
// import-design.js excludes, kept in sync deliberately.
const JUNK_SEGMENTS = ['__MACOSX', '.DS_Store', 'Thumbs.db', '.git', 'node_modules', '_backup', '_original', '_snapshot', '_old'];
const isJunk = (entryName) => entryName.split('/').some((seg) => JUNK_SEGMENTS.some((j) => seg === j || seg.startsWith(j)));

const ASSET_EXT = /\.(jpe?g|png|gif|svg|webp|avif|ico|bmp)$/i; // fonts/video/pdf intentionally out of scope for v1 — see human-action note in the PR
const ASSET_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.zip$/i.test(file.originalname) || /zip/i.test(file.mimetype)) return cb(null, true);
    cb(new Error('Please upload a .zip file'));
  },
});

/** Find the single HTML page inside the zip — at the top level, or one
 *  folder down (the common result of "Compress" on a folder). Multiple
 *  top-level HTML files is ambiguous for a one-page import and rejected
 *  with the list, rather than silently picking one. */
function findPageHtml(entries) {
  const html = entries.filter((e) => !e.isDirectory && !isJunk(e.entryName) && /\.html?$/i.test(e.entryName));
  const topLevel = html.filter((e) => !e.entryName.includes('/'));
  if (topLevel.length === 1) return { entry: topLevel[0], prefix: '' };
  if (topLevel.length > 1) return { error: `Found ${topLevel.length} HTML files at the top level (${topLevel.map((e) => e.entryName).join(', ')}) — this importer takes one page at a time.` };

  // Nested one level (zip of a folder rather than its contents).
  const byDir = new Map();
  for (const e of html) {
    const dir = e.entryName.split('/')[0];
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(e);
  }
  if (byDir.size === 1) {
    const [dir, list] = [...byDir.entries()][0];
    if (list.length === 1) return { entry: list[0], prefix: `${dir}/` };
    return { error: `Found ${list.length} HTML files inside "${dir}/" — this importer takes one page at a time.` };
  }
  return { error: 'No HTML file found. Expected one .html file, plus css/, js/ and assets/ folders alongside it (or one level down, inside a single folder).' };
}

function stripPrefix(entryName, prefix) {
  return prefix && entryName.startsWith(prefix) ? entryName.slice(prefix.length) : entryName;
}

// POST /api/website/import/design-zip
// multipart/form-data: file=<zip>, mode=new|update, title, slug (mode=new),
// page_id (mode=update)
router.post('/design-zip', requirePermission('settings.manage'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const mode = req.body.mode === 'update' ? 'update' : 'new';

    let targetPage = null;
    if (mode === 'update') {
      const pageId = Number(req.body.page_id);
      if (!pageId) return res.status(400).json({ error: 'page_id is required when mode=update' });
      const [[page]] = await db.query('SELECT id, slug, title, custom_css FROM website_pages WHERE id = :id', { id: pageId });
      if (!page) return res.status(404).json({ error: 'Target page not found' });
      targetPage = page;
    }

    // ── 1. Unzip ─────────────────────────────────────────────────────────
    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch (_e) {
      return res.status(400).json({ error: 'Could not read that file as a ZIP archive.' });
    }
    const entries = zip.getEntries();
    const found = findPageHtml(entries);
    if (found.error) return res.status(400).json({ error: found.error });
    const { entry: pageEntry, prefix } = found;

    const cssEntries = entries.filter((e) => !e.isDirectory && !isJunk(e.entryName) && /\.css$/i.test(e.entryName));
    const assetEntries = entries.filter((e) => !e.isDirectory && !isJunk(e.entryName) && ASSET_EXT.test(e.entryName));

    // ── 2. Assets — validate real content, dedupe, register into the Media
    //    Library, and build a map from the zip's own relative paths (as the
    //    HTML/CSS reference them) to the final, permanent URL. ────────────
    // Only create the "Imports / <slug>" folder when there are images to put in it.
    const folderId = assetEntries.length
      ? await ensureImportFolder(mode === 'update' ? targetPage.slug : (req.body.slug || 'new-page'))
      : null;
    const assetUrlByRelPath = new Map();
    const assetsReport = { reused: 0, added: 0, rejected: [] };

    for (const e of assetEntries) {
      const buffer = e.getData();
      const originalName = path.basename(e.entryName);
      const declaredMime = ASSET_MIME[path.extname(originalName).toLowerCase()] || 'application/octet-stream';
      // Real content check (same as the manual Media Library upload) — never
      // trust the file extension for what actually gets served.
      const validation = await validateUploadedFile({ buffer, mimetype: declaredMime }, Object.values(ASSET_MIME).filter((v, i, a) => a.indexOf(v) === i));
      if (!validation.ok) {
        assetsReport.rejected.push({ file: stripPrefix(e.entryName, prefix), reason: validation.error });
        continue;
      }
      const registered = await registerAsset({
        buffer, originalName, mimeType: validation.detectedMime, folderId, uploadedBy: req.user?.id,
      });
      assetsReport[registered.reused ? 'reused' : 'added'] += 1;
      // Keyed by the path as it appears relative to the HTML file, and also
      // relative to the zip root, so either style of reference in the
      // markup/CSS resolves.
      const relToHtml = stripPrefix(e.entryName, prefix);
      assetUrlByRelPath.set(relToHtml, registered.file_url);
      assetUrlByRelPath.set(e.entryName, registered.file_url);
      assetUrlByRelPath.set(originalName, registered.file_url);
    }

    /** Swap every asset reference this import actually found to its final
     *  Media Library URL. Absolute/external/data/anchor references are left
     *  untouched — same exemptions as import-design.js's absolutizeUrls. */
    function rewriteAssetRefs(text) {
      let out = text;
      for (const [relPath, finalUrl] of assetUrlByRelPath) {
        const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out
          .replace(new RegExp(`(["'\\(])(\\./)?${escaped}(["'\\)])`, 'g'), `$1${finalUrl}$3`)
          .replace(new RegExp(`(["'\\(])/?assets/${escaped.split('/').pop()}(["'\\)])`, 'g'), `$1${finalUrl}$2`);
      }
      return out;
    }

    // ── 3. Parse the page HTML → sections → (optionally) real components,
    //    with asset references already pointed at their final URLs. ───────
    const rawHtml = pageEntry.getData().toString('utf8');
    const htmlWithRefs = rewriteAssetRefs(absolutizeUrls(rewriteInternalLinks(rawHtml)));
    const fallbackTitle = path.basename(pageEntry.entryName, path.extname(pageEntry.entryName));
    const parsed = parsePageHtml(htmlWithRefs, fallbackTitle, { convert: true });
    const puckData = buildTree(parsed.chunks);

    const convertedCount = parsed.chunks.filter((c) => c.stats).reduce((n, c) => n + c.stats.converted, 0);
    const totalCount = parsed.chunks.filter((c) => c.stats).reduce((n, c) => n + c.stats.total, 0);

    // ── 4. CSS — diff against the live site stylesheet, append only what's
    //    genuinely new, report the rest. ─────────────────────────────────
    const newCss = cssEntries.map((e) => absolutizeUrls(rewriteAssetRefs(e.getData().toString('utf8')))).join('\n\n');
    let cssReport = { reused: [], added: [], conflicts: [] };
    if (newCss.trim()) {
      const [[row]] = await db.query("SELECT setting_value FROM website_global_settings WHERE setting_key = 'site_custom_css'");
      const existingCss = row?.setting_value || '';
      const diff = diffStylesheets(newCss, existingCss);
      cssReport = { reused: diff.reused, added: diff.added.map((a) => a.selector), conflicts: diff.conflicts };
      if (diff.appendCss) {
        const merged = `${existingCss}\n\n/* ── imported ${new Date().toISOString().slice(0, 10)} ── */\n${diff.appendCss}`;
        await db.query(
          "UPDATE website_global_settings SET setting_value = :css WHERE setting_key = 'site_custom_css'",
          { css: merged }
        );
      }
    }

    // ── 5. Land the page/section tree — draft page, or a review-only
    //    version snapshot of an existing one. Never overwrites live content. ─
    let result;
    if (mode === 'update') {
      const [ins] = await db.query(
        `INSERT INTO website_versions (page_id, puck_data, snapshot_label, created_by, user_name)
         VALUES (:page_id, :puck_data, :snapshot_label, :created_by, :user_name)`,
        {
          page_id: targetPage.id, puck_data: JSON.stringify(puckData),
          snapshot_label: `Design import (${new Date().toISOString().slice(0, 10)}) — pending review`,
          created_by: req.user?.id || null,
          user_name: req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email : null,
        }
      );
      result = { mode, page_id: targetPage.id, version_id: ins.insertId, slug: targetPage.slug };
    } else {
      const title = req.body.title || parsed.title || fallbackTitle;
      const slug = (req.body.slug || slugFor(pageEntry.entryName)).toLowerCase();
      const [[dup]] = await db.query('SELECT id FROM website_pages WHERE slug = :slug', { slug });
      if (dup) return res.status(409).json({ error: `A page already exists at /${slug} — import as an update to it instead, or choose a different slug.` });
      const [ins] = await db.query(
        `INSERT INTO website_pages (title, slug, status, puck_data, page_mode, meta_desc, created_by)
         VALUES (:title, :slug, 'draft', :puck_data, 'visual', :meta_desc, :created_by)`,
        { title, slug, puck_data: JSON.stringify(puckData), meta_desc: parsed.metaDesc || '', created_by: req.user?.id || null }
      );
      result = { mode, page_id: ins.insertId, slug };
    }

    res.status(201).json({
      ...result,
      conversion: { converted: convertedCount, total: totalCount, sections: parsed.chunks.length },
      skippedChrome: [...new Set(parsed.skipped)],
      assets: assetsReport,
      css: cssReport,
    });
  } catch (err) {
    res.status(err?.status || 500).json({ error: err.message });
  }
});

module.exports = router;
