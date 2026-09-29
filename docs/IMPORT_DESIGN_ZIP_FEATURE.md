# Feature Spec: Import Design (ZIP) + Version History

> **For Claude:** read this whole file before writing any code. It describes a feature that was built, tested and shipped in the **Kingdom Connections** project (Craft.js page builder + Express/MySQL CMS, cloned from the localCRM boilerplate). Your job is to reproduce the **same functionality** in the current project. Section 12 has the exact source code as it runs in Kingdom Connections. Copy it, but first do the **Section 3 compatibility check**, and adapt anything that is named differently in this project. Don't guess: if something in Section 3 is missing, stop and tell the user.

---

## 1. What the feature does (user view)

On **Admin → Website → Pages** there are two new things:

1. **"Import Design (ZIP)" button** in the page header, next to "+ New Page".
   - The admin uploads a ZIP containing **one page's design**: one `.html` file plus its `css/`, `js/` and `assets/` folders. This is the typical export from Grok, v0, a designer, etc.
   - Two modes:
     - **Create new page**: enter title and slug. The page is created as a **draft** and nothing goes public.
     - **Update an existing page**: pick the page from a dropdown. The imported content is saved as a **Version History snapshot**, and the live page is **not** changed yet. The result screen then shows **"Apply later"** and **"Apply now"**. Apply now puts the content on the page, and the old content is saved to history first, so it can be undone.
   - The result screen shows:
     - how many blocks were converted into editable builder components (for example `3/4`, "4 sections")
     - how many images were added to the Media Library, and how many were reused as duplicates
     - how many CSS rules were added, and how many already existed and were reused
     - any rejected files (content that isn't really an image)
     - **CSS conflicts**: the same selector already exists on the site with different styles. It is shown side by side ("Currently on the site" vs "In the imported design") and is **never applied automatically**.
     - for new pages, an **"Open in Builder →"** link; for updates, the same link after Apply now
2. **"History" button** on every page row. It opens a Version History modal that lists that page's saved snapshots (newest first, 30 max) with a **Restore** button on each.
   - The confirm dialog title is **"Restore this version?"** with a **Restore** button. It must **NOT** say "Delete?". That was a real bug: the shared `useConfirm` hook defaults to "Delete?" unless `danger:false` + title + confirmLabel are passed.
   - A restore **first snapshots the page's current content** (label `Before restoring "<label>"`), so a restore can always be undone.

**No AI and no API key are involved.** Everything is deterministic: postcss parses CSS, sha256 dedupes images, and the existing rule-based HTML→component converter builds the blocks. Do **not** add any Anthropic/OpenAI call. The same ZIP always gives the same result, and it costs nothing per import.

---

## 2. Architecture overview

```
Admin UI (React)
  WebsitePagesPage.jsx ──► ImportDesignModal.jsx ──POST multipart──► /api/website/import/design-zip
                      └──► VersionHistoryModal.jsx ──GET──► /api/website/pages/:id/versions      (already existed)
                                                    └─POST─► /api/website/versions/:vid/restore  (existed; now snapshots first)
  ImportDesignModal "Apply now" ──POST──► /api/website/versions/:vid/restore  (same endpoint)

Server (Express)
  routes/pageImport.js      NEW   upload → unzip → assets → parse HTML → CSS diff → save page/version
  services/assetDedupe.js   NEW   sha256 storage key, reuse existing media_files row, "Imports / <slug>" folder
  services/cssRuleDiff.js   NEW   postcss rule-level diff: reused / added / conflicts + appendCss
  scripts/lib/html-import-utils.js NEW  shared parser helpers (moved out of scripts/import-design.js)
  scripts/lib/convert-sections.js  EXISTING, unchanged  (rule-based section → components converter)
  services/storage.js       MODIFIED put() accepts an explicit `key`
  services/uploadValidation.js EXISTING validateUploadedFile (magic-byte check via file-type)
  routes/website.js         MODIFIED restore endpoint snapshots current content first
  index.js                  MODIFIED mount /api/website/import BEFORE /api/website

Builder / theme
  builder/nodes/Section.jsx  MODIFIED new prop importedDesign → class bx-section--imported
  frontend/theme/site.css    MODIFIED .bx-section--imported: blank padding = 0 (not 64px/40px)
```

### Pipeline inside `POST /api/website/import/design-zip`
1. **Auth**: `requireAuth` (router-level) + `requirePermission('settings.manage')`.
2. **Upload**: multer memory storage, 60 MB limit, only `.zip`.
3. **Find the page**: exactly **one** `.html` at the top level of the zip, or exactly one inside a single top-level folder (the zip-of-a-folder case). Otherwise return 400 with a readable message. Ignore junk entries: `__MACOSX`, `.DS_Store`, `Thumbs.db`, `.git`, `node_modules`, `_backup`, `_original`, `_snapshot`, `_old`.
4. **Assets** (images only: jpg/jpeg/png/gif/svg/webp/avif/ico/bmp):
   - Validate the real content with `validateUploadedFile` (allowed: jpeg/png/gif/webp/svg MIME). Rejected files go to `assets.rejected`.
   - `registerAsset` stores the file at `media/library/import/<sha256><ext>`. If a `media_files` row already has that `filename`, reuse it.
   - New files go into the Media Library folder `Imports / <slug>`. The folder is only created when the zip has images.
   - Build a map from relative path → final URL, then rewrite references in the HTML and CSS.
5. **HTML**: `rewriteInternalLinks` (`about.html` → `/about`) → `absolutizeUrls` → `rewriteAssetRefs` → `parsePageHtml(..., { convert: true })`:
   - picks `<main>`, else `<body>`
   - skips chrome (header/footer/nav/script/style…)
   - one chunk per top-level section, each run through `convertSection`
   
   Then `buildTree(chunks)` → Craft.js node map (`ROOT` → Section → Row → Column → components, or Section → HtmlBlock).
6. **CSS**: join all `.css` files in the zip (with asset refs rewritten) → `diffStylesheets(newCss, site_custom_css)`:
   - same key (at-rule chain + selector) and same normalised declarations → **reused**
   - key not present → **added**, appended to `site_custom_css` under the comment `/* ── imported YYYY-MM-DD ── */`
   - same key, different declarations → **conflict**: reported only, never written
7. **Save**:
   - `mode=new`: return 409 if the slug exists; otherwise `INSERT website_pages` with `status='draft'`, `page_mode='visual'`, `meta_desc` from the HTML.
   - `mode=update`: `INSERT website_versions` with label `Design import (YYYY-MM-DD) — pending review`. The live page is untouched.
8. **Respond 201**:
```json
{ "mode":"new|update", "page_id":1, "version_id":2, "slug":"about",
  "conversion":{"converted":3,"total":4,"sections":4},
  "skippedChrome":["header","footer"],
  "assets":{"reused":0,"added":2,"rejected":[{"file":"x.png","reason":"..."}]},
  "css":{"reused":[{"selector":".a"}],"added":[".b"],"conflicts":[{"selector":".c","existing":"...","incoming":"..."}]} }
```

---

## 3. Compatibility check — do this FIRST in the target project

Verify each item. If a name differs, adapt the code in Section 12; don't create duplicates.

| # | Must exist | How KC has it | Check |
|---|---|---|---|
| 1 | Express server with `server/src/index.js` mounting `/api/website` | `app.use('/api/website', websiteRoutes)` | `grep -n "api/website" server/src/index.js` |
| 2 | DB helper with **named placeholders** | `const { db } = require('../db'); db.query('... :id', { id })` returns `[rows]` | open `server/src/db` |
| 3 | Auth middleware | `requireAuth`, `requirePermission('settings.manage')` in `server/src/middleware/auth.js` | grep |
| 4 | Upload content validator | `server/src/services/uploadValidation.js` → `validateUploadedFile(file, allowedMimes)` → `{ok, detectedMime}` / `{ok:false,error}` (uses `file-type`) | if missing, create it (Section 12.10) |
| 5 | Storage service | `server/src/services/storage.js` with `put({entity_type, entity_id, originalName, contentType, buffer})` → `{key}` and `getPublicUrl(key)`; drivers `local` / `s3` (R2) | read it |
| 6 | Craft.js builder converter | `server/scripts/lib/convert-sections.js` exporting `convertSection` | **required**; if the project only has `scripts/import-design.js` with inline helpers, do the Section 5 refactor |
| 7 | `node-html-parser` in server deps | yes | `grep node-html-parser server/package.json` |
| 8 | Tables `website_pages`, `website_versions`, `website_global_settings`, `media_files`, `media_folders` | see Section 4 | query `information_schema` (read-only) |
| 9 | Site stylesheet stored in DB | `website_global_settings` row `setting_key='site_custom_css'` | query |
| 10 | Page tree column | `website_pages.puck_data` (LONGTEXT JSON of a Craft.js node map) | query |
| 11 | Existing versions API | `GET /api/website/pages/:id/versions`, `POST /api/website/versions/:vid/restore` in `routes/website.js` | grep; if missing, add them (Section 12.9) |
| 12 | Admin pages list | `client/src/vb/admin/WebsitePagesPage.jsx` | find |
| 13 | Client helpers | `client/src/api/client.js` (axios, default export `api`, baseURL `/api`), `components/Toast.jsx` (`toast(msg,type)`), `utils/apiError.js` (`parseApiError(e, fallback)`), `hooks/useConfirm.jsx` (`useConfirm()` → `{confirm, dialog}`; `confirm(message, {title, confirmLabel, danger})`) | find; adapt imports |
| 14 | Builder Section node | `client/src/builder/nodes/Section.jsx` with `paddingTop/paddingBottom/paddingX` props, and `px()` in `nodeUtils.js` returning `''` for null/'' | read |
| 15 | Theme CSS | `client/src/frontend/theme/site.css` with `.bx-section { padding-top: var(--bx-section-pt, 64px) … }` and a mobile media query using `--bx-section-pt-sm` (40px) | read |
| 16 | UI kit | Bootstrap 5 classes + `iconify-icon` web component | match the project's existing modals |

> ⚠️ **Database warning:** in KC the local `server/.env` pointed at the **production** DB and the R2 bucket. Before running any test that writes, check `DB_HOST` and the storage driver. Clean up every test page, version, media row and folder you create. Hand schema changes to the user instead of running them unasked.

---

## 4. Database — tables used (no new tables, no migration needed)

The feature needs **no schema change** if these already exist, as they did in KC. Asset dedup deliberately uses the storage **key** (`filename` column) as the hash, so no hash column is needed.

```sql
-- website_pages (relevant columns)
--   id, title, slug (unique), status ('draft'|'published'), puck_data LONGTEXT,
--   page_mode ('visual'), meta_desc, custom_css, created_by, updated_at

CREATE TABLE IF NOT EXISTS website_versions (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  page_id        INT UNSIGNED NOT NULL,
  puck_data      LONGTEXT,
  snapshot_label VARCHAR(255) NULL,
  created_by     INT UNSIGNED NULL,
  user_name      VARCHAR(255) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY idx_versions_page (page_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- website_global_settings: key/value (setting_key, setting_value); row 'site_custom_css' must exist.

CREATE TABLE IF NOT EXISTS media_folders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT, name VARCHAR(255) NOT NULL, parent_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), KEY idx_media_folders_parent (parent_id),
  CONSTRAINT fk_media_folders_parent FOREIGN KEY (parent_id) REFERENCES media_folders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS media_files (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT, filename VARCHAR(255) NOT NULL, original_name VARCHAR(255) NOT NULL,
  file_url VARCHAR(1024) NOT NULL, mime_type VARCHAR(127) NULL, file_size BIGINT UNSIGNED NULL,
  width INT NULL, height INT NULL, alt_text VARCHAR(512) NOT NULL DEFAULT '',
  folder_id INT UNSIGNED NULL, uploaded_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id),
  KEY idx_media_files_folder (folder_id), KEY idx_media_files_created (created_at),
  CONSTRAINT fk_media_files_folder FOREIGN KEY (folder_id) REFERENCES media_folders (id) ON DELETE SET NULL,
  CONSTRAINT fk_media_files_user FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
Only create a table if it's actually missing, and show the SQL to the user first.

---

## 5. Implementation steps (in order)

1. **Install server dependencies** (in `server/`):
   ```bash
   npm install adm-zip@^0.6.1 postcss@^8.5.28 postcss-safe-parser@^7.1.0
   ```
   `multer`, `node-html-parser` and `file-type` should already be there. Install them if not.
2. **Create `server/scripts/lib/html-import-utils.js`** (12.4). If `server/scripts/import-design.js` still has inline copies of `absolutizeUrls`, `rewriteInternalLinks`, `slugFor`, `isChrome`, `buildTree` and the page-parsing logic, **delete those copies** and `require('./lib/html-import-utils')` instead (12.8). Verify with `node scripts/import-design.js --dry-run` (and `--only <page> --convert`) that the output is **identical** before and after. Compare the dry-run output from before the change with the output after it.
   - If the target project's `buildTree`/`parsePageHtml` differs from KC's (different Section props, different chunk labels), keep the **project's** behaviour and only apply the Section-prop change from step 8.
3. **Create `server/src/services/cssRuleDiff.js`** (12.3).
4. **Modify `server/src/services/storage.js`**: `put()` accepts an optional explicit `key` (12.7).
5. **Create `server/src/services/assetDedupe.js`** (12.2).
6. **Create `server/src/routes/pageImport.js`** (12.1), and mount it in `server/src/index.js` **before** `app.use('/api/website', websiteRoutes)` (12.6).
7. **Modify the restore endpoint** in `server/src/routes/website.js` to snapshot the current content first (12.9).
8. **Imported Section padding**:
   - In `buildTree`, the Section props must be `paddingTop: null, paddingBottom: null, paddingX: null, paddingTopMobile: '', paddingBottomMobile: '', fullBleed: true, importedDesign: true`. They must NOT be `0`: with `0` the builder panel shows "0px" and adds an inline override.
   - `Section.jsx` gets the `importedDesign` prop (default `false`) → class `bx-section--imported`.
   - `site.css` makes blank padding mean `0` for that class, on desktop and mobile (12.11, 12.12).
9. **Create `client/src/vb/admin/VersionHistoryModal.jsx`** (12.5b) and **`ImportDesignModal.jsx`** (12.5a).
10. **Modify `WebsitePagesPage.jsx`** (12.13): the header button, the per-row History button, both modals, and `reloadPages`.
11. **Local-storage fix** (recommended; this was a known gap in KC). If the project's media file route (`server/src/routes/media.js`, or wherever `/api/website/media/file/*` is served) validates keys with a regex like
    `KEY_RE = /^[a-z0-9_-]+\/[a-z0-9_-]+\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{40}(\.[a-z0-9]{1,8})?$/i`,
    extend it to also accept import keys, or imported images will 404/400 when `STORAGE_DRIVER=local`:
    ```js
    const KEY_RE = /^(?:[a-z0-9_-]+\/[a-z0-9_-]+\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{40}|media\/library\/import\/[a-f0-9]{64})(\.[a-z0-9]{1,8})?$/i;
    ```
    Keep the existing `safeLocalPath` containment check. With S3/R2 and a public URL this isn't needed, because `getPublicUrl` returns the CDN URL.
12. **Build and verify** (Section 7).

---

## 6. Rules / gotchas that must be preserved

- **Never overwrite a live page on import.** New = draft. Update = version snapshot plus an explicit Apply now.
- **CSS conflicts are never applied.** Only rules whose key is absent get appended, so appending can't change how existing pages render. Rule key = at-rule chain + normalised selector. The same selector inside `@media (...)` is a **different** key from the one outside it. `@font-face` / `@keyframes` are keyed as `@name params`. Rules inside `@keyframes` are skipped as selector rules.
- **Declaration comparison** is order-independent, whitespace/case-normalised, and keeps `!important`. It does no unit or colour normalisation; that's left to the human.
- **Unparseable CSS** (`postcss-safe-parser`) must not crash the import. An empty index means everything is "added".
- **Asset dedupe key** = `media/library/import/<sha256 of bytes><sanitised ext>`. A reused asset **stays in its original folder**. Only new files go to `Imports / <slug>`.
- **Always validate real image content** (magic bytes). Store it with the **detected** MIME, not the extension's. `file-type` can't detect SVG, so SVGs get rejected. That's acceptable and safer.
- **Only create the `Imports / <slug>` folder when the zip has images.** In KC it first created empty folders, which was a bug that got fixed.
- **Mount order:** `/api/website/import` before `/api/website`.
- **Restore confirm dialog:** pass `{ title: 'Restore this version?', confirmLabel: 'Restore', danger: false }` or it shows "Delete?".
- **Restore must snapshot first**, labelled `Before restoring "<label>"` and truncated to 255 chars.
- **Duplicate slug on new import** → 409 with the message "A page already exists at /slug — import as an update to it instead, or choose a different slug."
- **The `customId` of the Section wrapper stays blank.** The imported markup already has its own `id`, and duplicate ids break anchors and `#id` CSS.
- **Error responses** are `{ error: "<message>" }`. The client shows them with `parseApiError`.
- **Scope of v1** (same as KC): images only (fonts/video/PDF in the zip are ignored), one HTML page per zip, JS files in the zip are **not** imported.

---

## 7. Verification checklist (what was tested in KC; repeat it)

**Server unit checks** (node one-liners, no DB writes):
- `diffStylesheets('.a{color:red}', '.a{color:red}')` → reused 1, added 0, conflicts 0.
- `diffStylesheets('.a{color:blue}', '.a{color:red}')` → 1 conflict with `existing` and `incoming` source.
- `diffStylesheets('@media (min-width:768px){.a{color:red}}', '.a{color:red}')` → **added** (different scope).
- Self-diff of the real `site_custom_css` against itself → 0 added, 0 conflicts. In KC: 752 reused, ~166ms.
- `buildTree([{html:'<section><h2>x</h2></section>',label:'hero',sectionType:''}])` → the Section props have `paddingTop:null, paddingBottom:null, paddingX:null, importedDesign:true`.
- `node scripts/import-design.js --dry-run`: output unchanged from before the refactor.

**End-to-end** (with a real admin token; use a test slug like `zz-import-test` and clean up afterwards). Build a test zip with adm-zip:
```js
const AdmZip = require('adm-zip');
const html = `<!DOCTYPE html><html><head><title>New Prayer Wall</title>
<meta name="description" content="Imported from a design ZIP."></head><body>
<header class="site-header">chrome</header>
<main>
<section id="hero-new" class="ns-section"><div class="wrap"><h1>New Prayer Wall</h1><p>Share your requests.</p><img src="assets/hero.png" alt="hero"></div></section>
<section id="cards-new" class="ns-section"><div class="ns-grid">
<div class="ns-block stat"><div class="stat-num">100</div><div class="stat-label">Prayers</div></div>
<div class="ns-block stat"><div class="stat-num">200</div><div class="stat-label">Answered</div></div></div></section>
</main><footer>chrome</footer></body></html>`;
const css = `.brand-new-selector-xyz{padding:4rem 0}\n.eyebrow{color:#123456}`; // one new rule, one likely conflict
const PNG_1x1 = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63600000020001005edcfd7e0000000049454e44ae426082','hex');
const zip = new AdmZip();
zip.addFile('prayer-wall.html', Buffer.from(html));
zip.addFile('css/site.css', Buffer.from(css));
zip.addFile('assets/hero.png', PNG_1x1);
zip.addFile('__MACOSX/._prayer-wall.html', Buffer.from('junk'));
zip.writeZip('test-design.zip');
```
- **New mode:** `curl -H "Authorization: Bearer $TOKEN" -F file=@test-design.zip -F mode=new -F title="ZZ Test" -F slug=zz-import-test http://localhost:<port>/api/website/import/design-zip`
  - expect 201
  - the page is created as `draft`
  - the image `src` is rewritten to the storage/CDN URL
  - `assets.added=1`
  - `.brand-new-selector-xyz` is in `css.added` and appended to `site_custom_css`
  - `.eyebrow` is in `css.conflicts` if the site has it
  - the header/footer are skipped
- **Re-import the same zip** as another slug → `assets.reused=1, added=0`, and the new selector is now **reused**.
- **Update mode** (`-F mode=update -F page_id=<id>`) → the live `puck_data` is unchanged, a new `website_versions` row is created with label "Design import (…) — pending review", and `version_id` is returned.
- **Restore** that version → the page `puck_data` is replaced, and there's a new "Before restoring …" version holding the old content.
- **Errors:**
  - a zip with 2 top-level html files → 400
  - a non-zip file → 400
  - a duplicate slug → 409
  - no `settings.manage` → 403
- **UI** (browser, logged in as admin):
  - The Import Design (ZIP) button opens the modal; the mode toggle switches the fields; the dropdown lists pages.
  - Picking a file pre-fills the title/slug from the filename.
  - Import shows the result summary. For update, "Apply later" / "Apply now" appear; after Apply now the message changes and "Open in Builder →" shows.
  - The History button lists versions; Restore opens a dialog titled **"Restore this version?"** (not Delete).
  - In the builder, an imported Section shows **blank** Side padding / Padding top / Padding bottom, not `0`.
  - On the public page, an imported section has 0 top/bottom padding on desktop (1280px) and mobile (375px) when blank, and applies a typed value such as 30/20. Normal builder sections still get 64px (desktop) / 40px (mobile).
- **Cleanup:** delete the test pages, their `website_versions`, test `media_files` rows and objects (optional), the empty `Imports / zz-…` folders, and the appended test CSS. **Restore `site_custom_css` to its exact original length.**
- **Build:** `cd client && npm run build` succeeds. The server starts without errors.

---

## 8. Deployment notes

- The deploy must run `npm install` in `server/` so `adm-zip`, `postcss` and `postcss-safe-parser` get installed. Railway does this automatically from `package.json`.
- Storage credentials (S3/R2 keys) must be valid in production, or asset upload fails with `Access Denied` and the whole import returns 500.
- **No new env vars. No API key.**
- Reverse proxy / body limit: the route accepts up to **60 MB**. If nginx or another proxy sits in front, make sure `client_max_body_size` allows it.

---

## 9. Security review result (from KC; keep these properties)

- The route requires auth + `settings.manage` (plus whatever MFA step-up `requirePermission` applies). Auth is a Bearer token, not a cookie, so there's no CSRF.
- No zip-slip: entries are only read into memory (`getData()`), never `extractAllTo`. Storage keys come from the sha256 + sanitised extension, never from entry names.
- All SQL is parameterised.
- Imported CSS goes into `site_custom_css`, which the client injects via `textContent` into a `<style>`, so there's no `</style>` breakout.
- The new modals render all values as React text, with no `dangerouslySetInnerHTML`.
- Known and accepted: imported HTML lands in `HtmlBlock` markup (innerHTML), so inline handlers in an **untrusted** designer's ZIP would run in the admin builder. That's the same trust level as the existing manual HTML block and CLI importer, so only import ZIPs from trusted sources.
- Known and accepted: in update mode, the new CSS rules are appended to the live stylesheet immediately. They're additive only, so existing rules don't change.

---

## 10. Files touched (KC commit `1f58b98`, merged in `bbd3fec`)

| File | Change |
|---|---|
| `server/package.json`, `server/package-lock.json` | + adm-zip, postcss, postcss-safe-parser |
| `server/scripts/lib/html-import-utils.js` | **new** (shared helpers) |
| `server/scripts/import-design.js` | now requires the shared helpers (−270 lines) |
| `server/src/services/cssRuleDiff.js` | **new** |
| `server/src/services/assetDedupe.js` | **new** |
| `server/src/services/storage.js` | `put()` explicit `key` |
| `server/src/routes/pageImport.js` | **new** |
| `server/src/index.js` | mount `/api/website/import` |
| `server/src/routes/website.js` | restore snapshots first |
| `client/src/vb/admin/ImportDesignModal.jsx` | **new** |
| `client/src/vb/admin/VersionHistoryModal.jsx` | **new** |
| `client/src/vb/admin/WebsitePagesPage.jsx` | buttons + modals |
| `client/src/builder/nodes/Section.jsx` | `importedDesign` prop/class |
| `client/src/frontend/theme/site.css` | `.bx-section--imported` padding rules |

---

## 11. Definition of done

- [ ] Section 3 compatibility check done; differences noted and adapted.
- [ ] Dependencies installed; the server starts; `client` builds.
- [ ] CLI `import-design.js --dry-run` output is unchanged after the refactor.
- [ ] Every item in the Section 7 checklist passes; test data is cleaned up and `site_custom_css` is back to its original length.
- [ ] No AI/API-key code added.
- [ ] The restore dialog says "Restore this version?", and a restore creates a "Before restoring…" snapshot.
- [ ] Imported sections show blank padding fields and render with no extra padding.
- [ ] Nothing committed or pushed unless the user asks.

---

## 12. Reference source code (exactly as it runs in Kingdom Connections)

Adapt import paths and names where Section 3 found differences. Everything else should stay the same.

### 12.1 `server/src/routes/pageImport.js` (NEW)
````js
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
        const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, '\\{{CODE}}');
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
````

---

### 12.2 `server/src/services/assetDedupe.js` (NEW)
````js
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
````

---

### 12.3 `server/src/services/cssRuleDiff.js` (NEW)
````js
// =============================================================================
// cssRuleDiff — rule-level comparison between an imported page's stylesheet
// and the site's existing CSS (website_global_settings.site_custom_css).
//
// Deliberately NOT string-diffing whole files, and deliberately NOT an AI
// judgment call: the import pipeline reuses rules that already exist,
// appends only genuinely new ones, and flags real conflicts for a human —
// the same rule, run twice, must always produce the same result.
//
// A rule is identified by its selector PLUS its enclosing at-rule chain
// (e.g. inside `@media (min-width: 768px)`), because the same selector means
// something different inside and outside a media query — that's not a
// duplicate, and must not be treated as one.
//
// @font-face and @keyframes carry no selector at all, so they're compared
// separately, keyed by their at-rule name + params (e.g. "keyframes fadeIn").
// =============================================================================
const postcss = require('postcss');
const safeParser = require('postcss-safe-parser');

/** Declarations, order-independent, whitespace/case-insensitive — comparing
 *  intent, not formatting. Not attempting deeper CSS equivalence (unit
 *  conversion, colour-format normalisation) — that's a judgment call better
 *  left to the human reviewing a flagged conflict than guessed at silently. */
function declarationSignature(container) {
  const decls = [];
  container.walkDecls((d) => {
    if (d.parent !== container) return; // this container's own decls only, not a nested rule's
    decls.push(`${d.prop.trim().toLowerCase()}:${d.value.trim().replace(/\s+/g, ' ').toLowerCase()}${d.important ? '!important' : ''}`);
  });
  return decls.sort().join(';');
}

/** The chain of enclosing at-rules, outermost first, e.g. ['media (min-width: 768px)']. */
function scopeChain(rule) {
  const chain = [];
  let p = rule.parent;
  while (p && p.type !== 'root') {
    if (p.type === 'atrule') chain.unshift(`${p.name} ${p.params}`.trim());
    p = p.parent;
  }
  return chain;
}

function ruleKey(rule) {
  return `${scopeChain(rule).join(' > ')} :: ${rule.selector.trim().replace(/\s+/g, ' ')}`;
}

/**
 * Index every selector rule and every @font-face/@keyframes block in a
 * stylesheet by its key, with a normalised signature for comparison and the
 * raw source text for re-emitting untouched.
 */
function indexStylesheet(css) {
  const index = new Map();
  let root;
  try {
    root = postcss.parse(css || '', { parser: safeParser });
  } catch (_e) {
    // Malformed input shouldn't crash the whole import — treat as empty, so
    // every rule in the OTHER stylesheet reports as new/added rather than
    // the pipeline throwing.
    return index;
  }

  root.walkRules((rule) => {
    // Skip rules whose own container is itself inside @font-face/@keyframes —
    // those are walked separately below and aren't "selector" rules.
    if (rule.parent?.type === 'atrule' && /^(-\w+-)?keyframes$/.test(rule.parent.name)) return;
    const key = ruleKey(rule);
    const sig = declarationSignature(rule);
    // A selector can legally repeat in one stylesheet (progressive enhancement
    // blocks); last one wins, matching how a real cascade would resolve it.
    index.set(key, { key, selector: rule.selector, scope: scopeChain(rule), signature: sig, source: rule.toString() });
  });

  root.walkAtRules((at) => {
    if (/^(-\w+-)?keyframes$/.test(at.name) || at.name === 'font-face') {
      const key = `@${at.name} ${at.params}`.trim();
      index.set(key, { key, selector: key, scope: [], signature: at.toString().replace(/\s+/g, ' ').toLowerCase(), source: at.toString() });
    }
  });

  return index;
}

/**
 * Compare a new page's CSS against the site's existing CSS.
 *
 * @param {string} newCss      the imported page's stylesheet text
 * @param {string} existingCss the current site_custom_css
 * @returns {{
 *   reused:    Array<{selector: string}>,
 *   added:     Array<{selector: string, source: string}>,
 *   conflicts: Array<{selector: string, existing: string, incoming: string}>,
 *   appendCss: string,   CSS text of only the `added` rules, ready to append
 * }}
 */
function diffStylesheets(newCss, existingCss) {
  const existingIndex = indexStylesheet(existingCss);
  const newIndex = indexStylesheet(newCss);

  const reused = [];
  const added = [];
  const conflicts = [];

  for (const rule of newIndex.values()) {
    const match = existingIndex.get(rule.key);
    if (!match) {
      added.push({ selector: rule.selector, source: rule.source });
    } else if (match.signature === rule.signature) {
      reused.push({ selector: rule.selector });
    } else {
      conflicts.push({ selector: rule.selector, existing: match.source, incoming: rule.source });
    }
  }

  const appendCss = added.map((a) => a.source).join('\n\n');

  return { reused, added, conflicts, appendCss };
}

module.exports = { diffStylesheets, indexStylesheet, declarationSignature };
````

---

### 12.4 `server/scripts/lib/html-import-utils.js` (NEW — shared helpers; depends on existing `./convert-sections` and `node-html-parser`)
````js
// =============================================================================
// html-import-utils — the pure, page-agnostic helpers shared by every design
// import path: the CLI script (import-design.js, whole folders) and the
// admin-facing ZIP importer (routes/pageImport.js, one design at a time).
//
// Moved out of import-design.js verbatim (no behaviour change) so both
// callers share one implementation instead of two copies that drift.
// convertSection lives in its own file (convert-sections.js) already and
// needs no changes — it operates on a parsed node, not on file paths.
// =============================================================================

/**
 * Rewrite relative asset references to absolute ones.
 *
 * `src="assets/x.png"` resolves against the current URL, so it breaks the
 * moment a page lives at a nested path. Everything becomes `/assets/x.png`.
 */
function absolutizeUrls(text) {
  return text
    .replace(/(\s(?:src|href|poster)\s*=\s*")(?!https?:|\/\/|\/|#|data:|mailto:|tel:)([^"]+)"/gi, '$1/$2"')
    .replace(/(\s(?:src|href|poster)\s*=\s*')(?!https?:|\/\/|\/|#|data:|mailto:|tel:)([^']+)'/gi, "$1/$2'")
    .replace(/(srcset\s*=\s*")([^"]+)"/gi, (m, p, list) => p + list
      .split(',')
      .map((part) => {
        const [url, ...rest] = part.trim().split(/\s+/);
        const fixed = /^(https?:|\/\/|\/|data:)/i.test(url) ? url : `/${url}`;
        return [fixed, ...rest].join(' ');
      })
      .join(', ') + '"')
    .replace(/url\((\s*['"]?)(?!https?:|\/\/|\/|data:|#)([^'")]+)(['"]?\s*)\)/gi, 'url($1/$2$3)');
}

/**
 * Rewrite links between the design's own pages onto CMS routes.
 *
 * A mockup links page-to-page by filename (`about.html`), but the CMS serves
 * pages at clean slugs (`/about`). Left alone, every internal link on the site
 * 404s — and it isn't obvious, because the links look fine in the markup.
 * `index.html` maps to `/`, and `#anchors` are preserved.
 */
function rewriteInternalLinks(text) {
  const rewrite = (quote) => new RegExp(`(\\shref\\s*=\\s*${quote})([^${quote}]+)${quote}`, 'gi');
  const replacer = (match, prefix, url, quote) => {
    if (/^(https?:|\/\/|mailto:|tel:|#|data:|javascript:)/i.test(url)) return match;
    const [pathPart, hash] = url.split('#');
    if (!/\.html?$/i.test(pathPart)) return match;
    const base = pathPart.replace(/^\.?\//, '').replace(/\.html?$/i, '');
    const route = base.toLowerCase() === 'index' ? '/' : `/${base.toLowerCase()}`;
    return `${prefix}${route}${hash ? `#${hash}` : ''}${quote}`;
  };
  return text
    .replace(rewrite('"'), (m, p, u) => replacer(m, p, u, '"'))
    .replace(rewrite("'"), (m, p, u) => replacer(m, p, u, "'"));
}

/** filename → slug. `index.html` becomes the site root page, `home`. */
function slugFor(file) {
  const path = require('path');
  const base = path.basename(file, path.extname(file)).toLowerCase();
  const slug = base === 'index' ? 'home' : base;
  return slug.replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
}

// Chrome that belongs to Web Settings, not to a page.
const CHROME_TAGS = new Set(['header', 'footer', 'nav', 'script', 'noscript', 'style']);

// Pages without a <main> fall back to <body>, where the header and footer are
// often plain <div>s. Match those by class/id so they don't become sections.
const CHROME_PATTERN = /(^|\s|-)(nav|navbar|mobile-menu|site-header|site-footer|header|footer|cookie|consent|skip-link|backdrop|overlay-menu)(\s|-|$)/i;

function isChrome(node) {
  const tag = (node.rawTagName || '').toLowerCase();
  if (CHROME_TAGS.has(tag)) return true;
  const cls = node.getAttribute('class') || '';
  const id = node.getAttribute('id') || '';
  return CHROME_PATTERN.test(cls) || CHROME_PATTERN.test(id);
}

/**
 * Parse one HTML document's body into import chunks (one per top-level
 * section, header/footer/nav skipped) and run each through convertSection
 * when `convert` is true. Page-agnostic — takes raw HTML text, not a file
 * path, so both the folder-walking CLI and the single-ZIP importer can call
 * it the same way.
 *
 * @param {string} raw          the HTML file's full text
 * @param {string} fallbackTitle used when the doc has no <title>/<h1>
 * @param {object} opts         { convert: boolean }
 */
function parsePageHtml(raw, fallbackTitle, { convert = true } = {}) {
  const { parse } = require('node-html-parser');
  const { convertSection } = require('./convert-sections');

  const root = parse(raw, { blockTextElements: { script: true, style: true } });

  const title = root.querySelector('title')?.text?.trim()
    || root.querySelector('h1')?.text?.trim()
    || fallbackTitle;
  const metaDesc = root.querySelector('meta[name="description"]')?.getAttribute('content') || '';

  const body = root.querySelector('main') || root.querySelector('body') || root;

  const chunks = [];
  const skipped = [];
  for (const node of body.childNodes) {
    if (node.nodeType !== 1) continue; // ignore text/comments between blocks
    const tag = (node.rawTagName || '').toLowerCase();
    if (isChrome(node)) {
      skipped.push(node.getAttribute('id') || (node.getAttribute('class') || '').split(/\s+/)[0] || tag);
      continue;
    }

    // Internal links first — otherwise absolutizeUrls turns `about.html` into
    // `/about.html`, which still 404s.
    const html = absolutizeUrls(rewriteInternalLinks(node.outerHTML)).trim();
    if (!html) continue;

    const id = node.getAttribute('id') || '';
    const cls = (node.getAttribute('class') || '').split(/\s+/)[0] || '';
    // The design styles sections through [data-section-type=...] as well as
    // by class, so the attribute has to survive the import or those rules
    // stop matching and the section renders unstyled.
    const sectionType = node.getAttribute('data-section-type') || '';
    const chunk = { html, id, label: id || cls || tag, sectionType };

    if (convert) {
      // Re-parse the URL-corrected markup so converted components pick up the
      // absolute asset paths too, not the originals.
      const fixed = parse(html);
      const sectionNode = fixed.childNodes.find((n) => n.nodeType === 1) || fixed;
      const result = convertSection(sectionNode, (type, props, children) => ({ type, props, children }));
      if (result.converted > 0) {
        chunk.children = result.children;
        chunk.containerClass = (sectionNode.getAttribute('class') || '');
        chunk.innerClass = result.containerClass || '';
        chunk.stats = { converted: result.converted, total: result.total };
      }
    }

    chunks.push(chunk);
  }

  return { title, metaDesc, chunks, skipped };
}

/* ── Craft node-tree construction ─────────────────────────────────────────── */

let seq = 0;
const nextId = (prefix) => `${prefix}${(seq += 1)}`;

/**
 * Wrap each chunk of imported markup in a Section holding an HTML block (or,
 * when converted, Section → Row → Column → [components]).
 *
 * The Section is a *transparent* wrapper — full-bleed, no padding — because
 * the imported markup already carries its own spacing and width. Adding the
 * usual 64px padding and max-width here would visibly change the design.
 */
function buildTree(chunks) {
  seq = 0;
  const nodes = {};
  const rootChildren = [];

  chunks.forEach((chunk) => {
    const sectionId = nextId('sec');
    const htmlId = nextId('html');

    nodes[sectionId] = {
      type: { resolvedName: 'Section' },
      isCanvas: true,
      displayName: 'Section',
      custom: { displayName: chunk.label },
      parent: 'ROOT',
      hidden: false,
      nodes: [htmlId],
      linkedNodes: {},
      props: {
        // Deliberately blank. The imported markup already carries the design's
        // own id (e.g. <section id="hero">), and repeating it on the wrapper
        // would put two identical ids in the document — which silently breaks
        // anchor links and any `#hero { … }` rule in the stylesheet.
        customId: '',
        customClass: '',
        sectionType: chunk.sectionType || '',
        background: '',
        textColor: '',
        backgroundImage: '',
        overlay: false,
        overlayColor: 'rgb(0 0 0 / 0.45)',
        // Left unset (not 0) so the panel fields start blank and no inline
        // padding overrides the design's own spacing. importedDesign keeps
        // blank meaning "no extra padding" rather than site.css's 64px default.
        paddingTop: null,
        paddingBottom: null,
        paddingTopMobile: '',
        paddingBottomMobile: '',
        paddingX: null,
        maxWidth: '',
        fullBleed: true,
        importedDesign: true,
      },
    };

    // Without conversion (or when no rule matched), the whole section stays
    // as one verbatim HTML block.
    if (!chunk.children || !chunk.children.length) {
      nodes[htmlId] = {
        type: { resolvedName: 'HtmlBlock' },
        isCanvas: false,
        displayName: 'HtmlBlock',
        custom: {},
        parent: sectionId,
        hidden: false,
        nodes: [],
        linkedNodes: {},
        props: { customId: '', customClass: '', markup: chunk.html, runScripts: false },
      };
      rootChildren.push(sectionId);
      return;
    }

    // Converted: Section → Row → Column → [components]. The Row and Column are
    // full-width and gap-free so they add no layout of their own; the design's
    // own container CSS keeps doing that job.
    const rowId = nextId('row');
    const colId = nextId('col');
    nodes[sectionId].nodes = [rowId];
    nodes[sectionId].props.customClass = chunk.containerClass || '';

    nodes[rowId] = {
      type: { resolvedName: 'Row' },
      isCanvas: true,
      displayName: 'Row',
      custom: {},
      parent: sectionId,
      hidden: false,
      nodes: [colId],
      linkedNodes: {},
      // The design's own container class rides on the Row. Row suppresses its
      // `bx-row` layout whenever importedClass is set, so this reproduces the
      // original wrapper (max-width, centring, gutters) rather than fighting it.
      props: {
        customId: '', customClass: '', importedClass: chunk.innerClass || '',
        mode: 'grid', gap: 0, align: 'stretch', justify: 'flex-start', wrap: true,
      },
    };

    nodes[colId] = {
      type: { resolvedName: 'Column' },
      isCanvas: true,
      displayName: 'Column',
      custom: {},
      parent: sectionId ? rowId : null,
      hidden: false,
      nodes: [],
      linkedNodes: {},
      props: {
        customId: '', customClass: '', span: 12, spanTablet: '', spanMobile: '',
        padding: {}, gap: 0, verticalAlign: 'flex-start', horizontalAlign: 'stretch', textAlign: '',
      },
    };

    // Rules can emit nested structures (Row → Column → components), so build
    // the subtree recursively rather than assuming one flat level.
    const CANVAS_TYPES = new Set(['Section', 'Row', 'Column']);
    const addSpec = (spec, parentId) => {
      const nodeId = nextId('n');
      nodes[nodeId] = {
        type: { resolvedName: spec.type },
        isCanvas: CANVAS_TYPES.has(spec.type),
        displayName: spec.type,
        custom: {},
        parent: parentId,
        hidden: false,
        nodes: [],
        linkedNodes: {},
        props: spec.props,
      };
      nodes[parentId].nodes.push(nodeId);
      for (const child of spec.children || []) addSpec(child, nodeId);
      return nodeId;
    };

    for (const spec of chunk.children) addSpec(spec, colId);

    rootChildren.push(sectionId);
  });

  nodes.ROOT = {
    type: { resolvedName: 'PageRoot' },
    isCanvas: true,
    displayName: 'PageRoot',
    custom: {},
    parent: null,
    hidden: false,
    nodes: rootChildren,
    linkedNodes: {},
    props: { background: '', textColor: '', maxWidth: '' },
  };

  return nodes;
}

module.exports = { absolutizeUrls, rewriteInternalLinks, slugFor, isChrome, parsePageHtml, buildTree };
````

---

### 12.5a `client/src/vb/admin/ImportDesignModal.jsx` (NEW)
````jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

// =============================================================================
// ImportDesignModal — upload a design ZIP (one page's HTML + css/ + js/ +
// assets/, same shape as website-files/) and turn it into a page, the way
// scripts/import-design.js already does for a whole folder from the CLI.
//
// Server side: POST /api/website/import/design-zip (routes/pageImport.js).
// Never auto-publishes and never overwrites a live page directly —
// "Create new page" lands as a draft; "Update an existing page" writes a
// reviewable snapshot to that page's Version History instead of touching its
// live content. See that route's header comment for the full safety model.
// =============================================================================

function toSlug(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

function CssConflictRow({ c }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded p-2 mb-2" style={{ background: '#fff8f0' }}>
      <button type="button" className="btn btn-sm btn-link p-0 text-start fw-semibold" onClick={() => setOpen((o) => !o)}>
        <code>{c.selector}</code> already exists on the site with different styling {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="row g-2 mt-1">
          <div className="col-md-6">
            <div className="text-muted small mb-1">Currently on the site</div>
            <pre className="small bg-light p-2 rounded mb-0" style={{ whiteSpace: 'pre-wrap' }}>{c.existing}</pre>
          </div>
          <div className="col-md-6">
            <div className="text-muted small mb-1">In the imported design</div>
            <pre className="small bg-light p-2 rounded mb-0" style={{ whiteSpace: 'pre-wrap' }}>{c.incoming}</pre>
          </div>
        </div>
      )}
      <p className="small text-muted mb-0 mt-1">
        Not applied automatically. Keep the site-wide style as-is, or copy the imported version into{' '}
        <strong>this page's own Custom CSS</strong> (Edit → Page Settings) if the new page needs it specifically.
      </p>
    </div>
  );
}

function ResultSummary({ result, onDone }) {
  const { mode, page_id, version_id, slug, conversion, assets, css } = result;
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  // Same endpoint as Version History's Restore, which saves the page's current
  // content as a snapshot first — so applying here can still be undone.
  async function applyNow() {
    setApplying(true);
    try {
      await api.post(`/website/versions/${version_id}/restore`);
      setApplied(true);
      toast('Imported design applied to the page.', 'success');
    } catch (e) {
      toast(parseApiError(e, 'Could not apply the import.'), 'error');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div>
      <div className="alert alert-success d-flex align-items-center gap-2">
        <iconify-icon icon="solar:check-circle-bold" style={{ fontSize: '1.3rem' }} />
        <div>
          {mode === 'new'
            ? <>Imported as a new <strong>draft</strong> page at <code>/{slug}</code>.</>
            : applied
              ? <>Applied to <code>/{slug}</code>. Its previous content was saved to Version History, so you can restore it back from the page's History button.</>
              : <>Imported — saved as a new snapshot on <code>/{slug}</code>'s Version History. The page hasn't changed yet: click <strong>Apply now</strong> to use it, or review it later from History.</>}
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-4">
          <div className="border rounded p-2 text-center h-100">
            <div className="fs-4 fw-bold">{conversion.converted}/{conversion.total}</div>
            <div className="text-muted small">blocks converted to editable components ({conversion.sections} section{conversion.sections === 1 ? '' : 's'})</div>
          </div>
        </div>
        <div className="col-4">
          <div className="border rounded p-2 text-center h-100">
            <div className="fs-4 fw-bold">{assets.added}</div>
            <div className="text-muted small">new image{assets.added === 1 ? '' : 's'} added to Media Library{assets.reused ? ` (${assets.reused} reused)` : ''}</div>
          </div>
        </div>
        <div className="col-4">
          <div className="border rounded p-2 text-center h-100">
            <div className="fs-4 fw-bold">{css.added.length}</div>
            <div className="text-muted small">new CSS rule{css.added.length === 1 ? '' : 's'} added{css.reused.length ? ` (${css.reused.length} already on the site, reused)` : ''}</div>
          </div>
        </div>
      </div>

      {assets.rejected?.length > 0 && (
        <div className="alert alert-warning small">
          {assets.rejected.length} file{assets.rejected.length === 1 ? '' : 's'} skipped — content didn't match an allowed image type:
          <ul className="mb-0 mt-1">
            {assets.rejected.map((r, i) => <li key={i}>{r.file} — {r.reason}</li>)}
          </ul>
        </div>
      )}

      {css.conflicts?.length > 0 && (
        <div className="mb-3">
          <h6 className="fw-semibold">CSS needing a decision ({css.conflicts.length})</h6>
          {css.conflicts.map((c, i) => <CssConflictRow key={i} c={c} />)}
        </div>
      )}

      {conversion.converted < conversion.total && (
        <p className="small text-muted">
          {conversion.total - conversion.converted} section{conversion.total - conversion.converted === 1 ? '' : 's'} didn't match a known component pattern and came in as raw HTML — still renders exactly as designed, just not drag-and-editable yet.
        </p>
      )}

      <div className="d-flex gap-2 justify-content-end flex-wrap mt-4">
        <button className="btn btn-outline-secondary" onClick={onDone} disabled={applying}>
          {mode === 'update' && !applied ? 'Apply later' : 'Close'}
        </button>
        {mode === 'new' || applied ? (
          <Link to={`/admin/website/pages/${page_id}/edit`} className="btn btn-primary" onClick={onDone}>
            Open in Builder →
          </Link>
        ) : (
          <button className="btn btn-primary" onClick={applyNow} disabled={applying}>
            {applying ? <><span className="spinner-border spinner-border-sm me-1" />Applying…</> : 'Apply now'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ImportDesignModal({ pages, onClose, onImported }) {
  const [mode, setMode] = useState('new'); // 'new' | 'update'
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [targetPageId, setTargetPageId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  function onFileChange(e) {
    const f = e.target.files?.[0] || null;
    setFile(f);
    if (f && !title) {
      const base = f.name.replace(/\.zip$/i, '').replace(/[-_]+/g, ' ');
      setTitle(base);
      setSlug(toSlug(base));
    }
  }

  async function submit() {
    setError('');
    if (!file) return setError('Choose a .zip file first.');
    if (mode === 'new' && !slug.trim()) return setError('Enter a slug for the new page.');
    if (mode === 'update' && !targetPageId) return setError('Choose which page this design updates.');

    const fd = new FormData();
    fd.append('file', file);
    fd.append('mode', mode);
    if (mode === 'new') {
      fd.append('title', title.trim() || slug.trim());
      fd.append('slug', slug.trim());
    } else {
      fd.append('page_id', targetPageId);
    }

    setBusy(true);
    try {
      const { data } = await api.post('/website/import/design-zip', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(data);
    } catch (e) {
      setError(parseApiError(e, 'Import failed.'));
    } finally {
      setBusy(false);
    }
  }

  function done() {
    onImported?.();
    onClose();
  }

  return (
    <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Import Design (ZIP)</h5>
            <button type="button" className="btn-close" onClick={onClose} disabled={busy} />
          </div>
          <div className="modal-body">
            {result ? (
              <ResultSummary result={result} onDone={done} />
            ) : (
              <>
                <p className="text-muted small">
                  Upload a ZIP containing one page's design — an <code>.html</code> file plus its <code>css/</code>, <code>js/</code> and <code>assets/</code> folders (the same shape as a whole design export, just for one page). Sections matching a known pattern become real, editable components; anything else comes in as HTML that renders identically. New images are added to the Media Library; CSS already on the site is reused instead of duplicated.
                </p>

                <div className="mb-3">
                  <label className="form-label fw-medium">Design ZIP</label>
                  <input type="file" accept=".zip" className="form-control" onChange={onFileChange} disabled={busy} />
                </div>

                <div className="mb-3">
                  <div className="btn-group w-100" role="group">
                    <button type="button" className={`btn ${mode === 'new' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setMode('new')} disabled={busy}>
                      Create new page
                    </button>
                    <button type="button" className={`btn ${mode === 'update' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setMode('update')} disabled={busy}>
                      Update an existing page
                    </button>
                  </div>
                </div>

                {mode === 'new' ? (
                  <div className="row g-2 mb-3">
                    <div className="col-md-6">
                      <label className="form-label small">Page Title</label>
                      <input className="form-control" value={title} onChange={(e) => { setTitle(e.target.value); setSlug(toSlug(e.target.value)); }} disabled={busy} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small">Slug</label>
                      <div className="input-group">
                        <span className="input-group-text">/</span>
                        <input className="form-control font-monospace" value={slug} onChange={(e) => setSlug(e.target.value)} disabled={busy} />
                      </div>
                    </div>
                    <div className="col-12 form-text">Creates a new page as a <strong>draft</strong> — nothing goes live until you publish it.</div>
                  </div>
                ) : (
                  <div className="mb-3">
                    <label className="form-label small">Which page is this design for?</label>
                    <select className="form-select" value={targetPageId} onChange={(e) => setTargetPageId(e.target.value)} disabled={busy}>
                      <option value="">Choose a page…</option>
                      {pages.map((p) => <option key={p.id} value={p.id}>{p.title} (/{p.slug})</option>)}
                    </select>
                    <div className="form-text">
                      The live page is <strong>not changed</strong>. This saves the imported content as a new entry in that page's Version History, for you to review and restore when ready.
                    </div>
                  </div>
                )}

                {error && <div className="alert alert-danger small mb-0">{error}</div>}
              </>
            )}
          </div>
          {!result && (
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={submit} disabled={busy || !file}>
                {busy ? <><span className="spinner-border spinner-border-sm me-1" />Importing…</> : 'Import →'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
````

---

### 12.5b `client/src/vb/admin/VersionHistoryModal.jsx` (NEW)
````jsx
import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client.js';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';

// =============================================================================
// VersionHistoryModal — lists a page's saved snapshots (website_versions) and
// restores one over the live page content.
//
// The backend side of this (GET /pages/:id/versions, POST /versions/:vid/restore)
// already existed — every builder Save quietly snapshots the previous content
// before overwriting it. There was just no screen to see or use that history.
// Built alongside the design-ZIP importer because "import as an update"
// deliberately writes its proposed content here rather than touching the live
// page directly — a version an admin reviews and restores, not an
// auto-applied overwrite. Restoring works the same for any snapshot, import
// or otherwise.
// =============================================================================
export default function VersionHistoryModal({ page, onClose, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/website/pages/${page.id}/versions`)
      .then((r) => setVersions(r.data))
      .catch((e) => toast(parseApiError(e, 'Could not load version history.'), 'error'))
      .finally(() => setLoading(false));
  }, [page.id]);

  useEffect(() => { load(); }, [load]);

  async function restore(v) {
    const ok = await confirm(
      `Replace this page's content with "${v.snapshot_label || 'this version'}"? Nothing is deleted — the current content is saved to Version History first, so you can restore it back at any time.`,
      { title: 'Restore this version?', confirmLabel: 'Restore', danger: false }
    );
    if (!ok) return;
    setRestoringId(v.id);
    try {
      await api.post(`/website/versions/${v.id}/restore`);
      toast('Restored. Open the page in the builder to review it.', 'success');
      onRestored?.();
      load();
    } catch (e) {
      toast(parseApiError(e, 'Restore failed.'), 'error');
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <div>
              <h5 className="modal-title mb-0">Version History</h5>
              <p className="text-muted small mb-0">/{page.slug}</p>
            </div>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            {loading ? (
              <div className="text-center py-4"><span className="spinner-border text-primary" /></div>
            ) : versions.length === 0 ? (
              <p className="text-muted text-center py-4 mb-0">No saved snapshots yet — one is created automatically the next time this page is saved or a design is imported over it.</p>
            ) : (
              <div className="list-group">
                {versions.map((v) => (
                  <div key={v.id} className="list-group-item d-flex align-items-center justify-content-between flex-wrap gap-2">
                    <div>
                      <div className="fw-semibold">{v.snapshot_label || 'Untitled snapshot'}</div>
                      <div className="text-muted small">
                        {new Date(v.created_at).toLocaleString()}
                        {v.user_name ? ` · ${v.user_name}` : ''}
                      </div>
                    </div>
                    <button
                      className="btn btn-sm btn-outline-primary"
                      disabled={restoringId === v.id}
                      onClick={() => restore(v)}
                    >
                      {restoringId === v.id ? <><span className="spinner-border spinner-border-sm me-1" />Restoring…</> : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
````

---

### 12.6 `server/src/index.js` (MODIFIED — mount order matters)
````diff
diff --git a/server/src/index.js b/server/src/index.js
index 61e6a73..7bcec61 100644
--- a/server/src/index.js
+++ b/server/src/index.js
@@ -65,6 +65,7 @@ const campaignsRoutes     = require('./routes/campaigns');
 const automationsRoutes   = require('./routes/automations');
 const aiRoutes            = require('./routes/ai');
 const websiteRoutes       = require('./routes/website');
+const pageImportRoutes    = require('./routes/pageImport');
 const cmsRoutes           = require('./routes/cms');
 const cmsDataRoutes       = require('./routes/cmsData');
 const formsRoutes         = require('./routes/forms');
@@ -251,6 +252,10 @@ app.use('/api/maps',          mapsRoutes);
 app.use('/api/campaigns',     campaignsRoutes);
 app.use('/api/automations',   automationsRoutes);
 app.use('/api/ai',            aiRoutes);
+// Mounted before websiteRoutes (both share the /api/website prefix) so it can
+// never be shadowed by a future generic route in website.js — see
+// routes/pageImport.js's header comment.
+app.use('/api/website/import', pageImportRoutes);
 app.use('/api/website',       websiteRoutes);
 app.use('/api/cms',           cmsRoutes);
 app.use('/api/cms-data',      cmsDataRoutes);
````

---

### 12.7 `server/src/services/storage.js` (MODIFIED)
````diff
diff --git a/server/src/services/storage.js b/server/src/services/storage.js
index 9892442..b07f409 100644
--- a/server/src/services/storage.js
+++ b/server/src/services/storage.js
@@ -113,9 +113,15 @@ async function s3Delete(key) {
 // ---------- PUBLIC API ----------
 /**
  * Save a buffer. Returns { key, driver, bucket }.
+ *
+ * `key` is normally auto-generated (random + today's date, via buildKey) so
+ * two uploads never collide. Callers that need a REPRODUCIBLE key — the
+ * design-import asset deduper, so re-importing the same image twice reuses
+ * the same object instead of storing it again — may pass one explicitly.
+ * Still goes through safeLocalPath's containment check on the local driver.
  */
-async function put({ entity_type, entity_id, originalName, contentType, buffer }) {
-  const key = buildKey({ entity_type, entity_id, originalName });
+async function put({ entity_type, entity_id, originalName, contentType, buffer, key: explicitKey }) {
+  const key = explicitKey || buildKey({ entity_type, entity_id, originalName });
   if (DRIVER === 's3') {
     await s3Put({ key, buffer, contentType });
     return { key, driver: 's3', bucket: process.env.S3_BUCKET };
````

---

### 12.8 `server/scripts/import-design.js` (MODIFIED — inline helpers removed, now uses the shared lib)
````diff
diff --git a/server/scripts/import-design.js b/server/scripts/import-design.js
index dc3d185..ec96c6c 100644
--- a/server/scripts/import-design.js
+++ b/server/scripts/import-design.js
@@ -31,8 +31,9 @@
 const fs = require('fs');
 const path = require('path');
 const mysql = require('mysql2/promise');
-const { parse } = require('node-html-parser');
-const { convertSection } = require('./lib/convert-sections');
+const {
+  absolutizeUrls, rewriteInternalLinks, slugFor, parsePageHtml, buildTree,
+} = require('./lib/html-import-utils');
 
 require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
 
@@ -148,278 +149,17 @@ const walk = (dir, out = []) => {
 
 const rel = (file) => path.relative(SRC, file).split(path.sep).join('/');
 
-/**
- * Rewrite relative asset references to absolute ones.
- *
- * `src="assets/x.png"` resolves against the current URL, so it breaks the
- * moment a page lives at a nested path. Everything becomes `/assets/x.png`.
- */
-function absolutizeUrls(text) {
-  return text
-    .replace(/(\s(?:src|href|poster)\s*=\s*")(?!https?:|\/\/|\/|#|data:|mailto:|tel:)([^"]+)"/gi, '$1/$2"')
-    .replace(/(\s(?:src|href|poster)\s*=\s*')(?!https?:|\/\/|\/|#|data:|mailto:|tel:)([^']+)'/gi, "$1/$2'")
-    .replace(/(srcset\s*=\s*")([^"]+)"/gi, (m, p, list) => p + list
-      .split(',')
-      .map((part) => {
-        const [url, ...rest] = part.trim().split(/\s+/);
-        const fixed = /^(https?:|\/\/|\/|data:)/i.test(url) ? url : `/${url}`;
-        return [fixed, ...rest].join(' ');
-      })
-      .join(', ') + '"')
-    .replace(/url\((\s*['"]?)(?!https?:|\/\/|\/|data:|#)([^'")]+)(['"]?\s*)\)/gi, 'url($1/$2$3)');
-}
-
-/**
- * Rewrite links between the design's own pages onto CMS routes.
- *
- * A mockup links page-to-page by filename (`about.html`), but the CMS serves
- * pages at clean slugs (`/about`). Left alone, every internal link on the site
- * 404s — and it isn't obvious, because the links look fine in the markup.
- * `index.html` maps to `/`, and `#anchors` are preserved.
- */
-function rewriteInternalLinks(text) {
-  const rewrite = (quote) => new RegExp(`(\\shref\\s*=\\s*${quote})([^${quote}]+)${quote}`, 'gi');
-  const replacer = (match, prefix, url, quote) => {
-    if (/^(https?:|\/\/|mailto:|tel:|#|data:|javascript:)/i.test(url)) return match;
-    const [pathPart, hash] = url.split('#');
-    if (!/\.html?$/i.test(pathPart)) return match;
-    const base = pathPart.replace(/^\.?\//, '').replace(/\.html?$/i, '');
-    const route = base.toLowerCase() === 'index' ? '/' : `/${base.toLowerCase()}`;
-    return `${prefix}${route}${hash ? `#${hash}` : ''}${quote}`;
-  };
-  return text
-    .replace(rewrite('"'), (m, p, u) => replacer(m, p, u, '"'))
-    .replace(rewrite("'"), (m, p, u) => replacer(m, p, u, "'"));
-}
-
-/** filename → slug. `index.html` becomes the site root page, `home`. */
-function slugFor(file) {
-  const base = path.basename(file, path.extname(file)).toLowerCase();
-  const slug = base === 'index' ? 'home' : base;
-  return slug.replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
-}
-
-/* ── Craft node-tree construction ─────────────────────────────────────────── */
-
-let seq = 0;
-const nextId = (prefix) => `${prefix}${(seq += 1)}`;
-
-/**
- * Wrap each chunk of imported markup in a Section holding an HTML block.
- *
- * The Section is a *transparent* wrapper — full-bleed, zero padding — because
- * the imported markup already carries its own spacing and width. Adding the
- * usual 64px padding and max-width here would visibly change the design.
- */
-function buildTree(chunks) {
-  seq = 0;
-  const nodes = {};
-  const rootChildren = [];
-
-  chunks.forEach((chunk) => {
-    const sectionId = nextId('sec');
-    const htmlId = nextId('html');
-
-    nodes[sectionId] = {
-      type: { resolvedName: 'Section' },
-      isCanvas: true,
-      displayName: 'Section',
-      custom: { displayName: chunk.label },
-      parent: 'ROOT',
-      hidden: false,
-      nodes: [htmlId],
-      linkedNodes: {},
-      props: {
-        // Deliberately blank. The imported markup already carries the design's
-        // own id (e.g. <section id="hero">), and repeating it on the wrapper
-        // would put two identical ids in the document — which silently breaks
-        // anchor links and any `#hero { … }` rule in the stylesheet.
-        customId: '',
-        customClass: '',
-        sectionType: chunk.sectionType || '',
-        background: '',
-        textColor: '',
-        backgroundImage: '',
-        overlay: false,
-        overlayColor: 'rgb(0 0 0 / 0.45)',
-        paddingTop: 0,
-        paddingBottom: 0,
-        paddingTopMobile: '',
-        paddingBottomMobile: '',
-        paddingX: 0,
-        maxWidth: '',
-        fullBleed: true,
-      },
-    };
-
-    // Without --convert (or when no rule matched), the whole section stays as
-    // one verbatim HTML block.
-    if (!chunk.children || !chunk.children.length) {
-      nodes[htmlId] = {
-        type: { resolvedName: 'HtmlBlock' },
-        isCanvas: false,
-        displayName: 'HtmlBlock',
-        custom: {},
-        parent: sectionId,
-        hidden: false,
-        nodes: [],
-        linkedNodes: {},
-        props: { customId: '', customClass: '', markup: chunk.html, runScripts: false },
-      };
-      rootChildren.push(sectionId);
-      return;
-    }
-
-    // Converted: Section → Row → Column → [components]. The Row and Column are
-    // full-width and gap-free so they add no layout of their own; the design's
-    // own container CSS keeps doing that job.
-    const rowId = nextId('row');
-    const colId = nextId('col');
-    nodes[sectionId].nodes = [rowId];
-    nodes[sectionId].props.customClass = chunk.containerClass || '';
-
-    nodes[rowId] = {
-      type: { resolvedName: 'Row' },
-      isCanvas: true,
-      displayName: 'Row',
-      custom: {},
-      parent: sectionId,
-      hidden: false,
-      nodes: [colId],
-      linkedNodes: {},
-      // The design's own container class rides on the Row. Row suppresses its
-      // `bx-row` layout whenever importedClass is set, so this reproduces the
-      // original wrapper (max-width, centring, gutters) rather than fighting it.
-      props: {
-        customId: '', customClass: '', importedClass: chunk.innerClass || '',
-        mode: 'grid', gap: 0, align: 'stretch', justify: 'flex-start', wrap: true,
-      },
-    };
-
-    nodes[colId] = {
-      type: { resolvedName: 'Column' },
-      isCanvas: true,
-      displayName: 'Column',
-      custom: {},
-      parent: sectionId ? rowId : null,
-      hidden: false,
-      nodes: [],
-      linkedNodes: {},
-      props: {
-        customId: '', customClass: '', span: 12, spanTablet: '', spanMobile: '',
-        padding: {}, gap: 0, verticalAlign: 'flex-start', horizontalAlign: 'stretch', textAlign: '',
-      },
-    };
-
-    // Rules can emit nested structures (Row → Column → components), so build
-    // the subtree recursively rather than assuming one flat level.
-    const CANVAS_TYPES = new Set(['Section', 'Row', 'Column']);
-    const addSpec = (spec, parentId) => {
-      const nodeId = nextId('n');
-      nodes[nodeId] = {
-        type: { resolvedName: spec.type },
-        isCanvas: CANVAS_TYPES.has(spec.type),
-        displayName: spec.type,
-        custom: {},
-        parent: parentId,
-        hidden: false,
-        nodes: [],
-        linkedNodes: {},
-        props: spec.props,
-      };
-      nodes[parentId].nodes.push(nodeId);
-      for (const child of spec.children || []) addSpec(child, nodeId);
-      return nodeId;
-    };
-
-    for (const spec of chunk.children) addSpec(spec, colId);
-
-    rootChildren.push(sectionId);
-  });
-
-  nodes.ROOT = {
-    type: { resolvedName: 'PageRoot' },
-    isCanvas: true,
-    displayName: 'PageRoot',
-    custom: {},
-    parent: null,
-    hidden: false,
-    nodes: rootChildren,
-    linkedNodes: {},
-    props: { background: '', textColor: '', maxWidth: '' },
-  };
-
-  return nodes;
-}
-
 /* ── page parsing ─────────────────────────────────────────────────────────── */
-
-// Chrome that belongs to Web Settings, not to a page.
-const CHROME_TAGS = new Set(['header', 'footer', 'nav', 'script', 'noscript', 'style']);
-
-// Pages without a <main> fall back to <body>, where the header and footer are
-// often plain <div>s. Match those by class/id so they don't become sections.
-const CHROME_PATTERN = /(^|\s|-)(nav|navbar|mobile-menu|site-header|site-footer|header|footer|cookie|consent|skip-link|backdrop|overlay-menu)(\s|-|$)/i;
-
-function isChrome(node) {
-  const tag = (node.rawTagName || '').toLowerCase();
-  if (CHROME_TAGS.has(tag)) return true;
-  const cls = node.getAttribute('class') || '';
-  const id = node.getAttribute('id') || '';
-  return CHROME_PATTERN.test(cls) || CHROME_PATTERN.test(id);
-}
+// absolutizeUrls, rewriteInternalLinks, slugFor, buildTree and the actual
+// per-page parsing (chrome-skipping, chunking, conversion) all live in
+// lib/html-import-utils.js now, shared with the admin ZIP importer. This is
+// just the file-path-specific wrapper: read the file, hand raw text to the
+// shared parser, attach the slug the file path implies.
 
 function parsePage(file) {
   const raw = fs.readFileSync(file, 'utf8');
-  const root = parse(raw, { blockTextElements: { script: true, style: true } });
-
-  const title = root.querySelector('title')?.text?.trim()
-    || root.querySelector('h1')?.text?.trim()
-    || path.basename(file, path.extname(file));
-  const metaDesc = root.querySelector('meta[name="description"]')?.getAttribute('content') || '';
-
-  const body = root.querySelector('main') || root.querySelector('body') || root;
-
-  const chunks = [];
-  const skipped = [];
-  for (const node of body.childNodes) {
-    if (node.nodeType !== 1) continue; // ignore text/comments between blocks
-    const tag = (node.rawTagName || '').toLowerCase();
-    if (isChrome(node)) {
-      skipped.push(node.getAttribute('id') || (node.getAttribute('class') || '').split(/\s+/)[0] || tag);
-      continue;
-    }
-
-    // Internal links first — otherwise absolutizeUrls turns `about.html` into
-    // `/about.html`, which still 404s.
-    const html = absolutizeUrls(rewriteInternalLinks(node.outerHTML)).trim();
-    if (!html) continue;
-
-    const id = node.getAttribute('id') || '';
-    const cls = (node.getAttribute('class') || '').split(/\s+/)[0] || '';
-    // The design styles sections through [data-section-type=...] as well as
-    // by class, so the attribute has to survive the import or those rules
-    // stop matching and the section renders unstyled.
-    const sectionType = node.getAttribute('data-section-type') || '';
-    const chunk = { html, id, label: id || cls || tag, sectionType };
-
-    if (CONVERT) {
-      // Re-parse the URL-corrected markup so converted components pick up the
-      // absolute asset paths too, not the originals.
-      const fixed = parse(html);
-      const sectionNode = fixed.childNodes.find((n) => n.nodeType === 1) || fixed;
-      const result = convertSection(sectionNode, (type, props, children) => ({ type, props, children }));
-      if (result.converted > 0) {
-        chunk.children = result.children;
-        chunk.containerClass = (sectionNode.getAttribute('class') || '');
-        chunk.innerClass = result.containerClass || '';
-        chunk.stats = { converted: result.converted, total: result.total };
-      }
-    }
-
-    chunks.push(chunk);
-  }
-
+  const fallbackTitle = path.basename(file, path.extname(file));
+  const { title, metaDesc, chunks, skipped } = parsePageHtml(raw, fallbackTitle, { convert: CONVERT });
   return { title, metaDesc, chunks, skipped, slug: slugFor(file) };
 }
````

---

### 12.9 `server/src/routes/website.js` — versions endpoints (GET list existed; restore MODIFIED to snapshot first). Full current code:
````js
// GET /api/website/pages/:id/versions
router.get('/pages/:id/versions', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      'SELECT id, page_id, snapshot_label, created_by, user_name, created_at FROM website_versions WHERE page_id = :id ORDER BY created_at DESC LIMIT 30',
      { id }
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/website/versions/:vid  (get one version's full data for restore)
router.get('/versions/:vid', requireAuth, async (req, res) => {
  try {
    const { vid } = req.params;
    const [[ver]] = await db.query('SELECT * FROM website_versions WHERE id = :vid', { vid });
    if (!ver) return res.status(404).json({ error: 'Version not found' });
    if (ver.puck_data && typeof ver.puck_data === 'string') {
      try { ver.puck_data = JSON.parse(ver.puck_data); } catch {}
    }
    res.json(ver);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/website/versions/:vid/restore  (restore a version)
router.post('/versions/:vid/restore', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const { vid } = req.params;
    const [[ver]] = await db.query('SELECT * FROM website_versions WHERE id = :vid', { vid });
    if (!ver) return res.status(404).json({ error: 'Version not found' });

    // Snapshot the current content first, so a restore can itself be undone.
    const [[current]] = await db.query('SELECT puck_data FROM website_pages WHERE id = :id', { id: ver.page_id });
    if (current?.puck_data) {
      const userName = req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email : null;
      const restoredLabel = ver.snapshot_label || `version #${ver.id}`;
      await db.query(
        'INSERT INTO website_versions (page_id, puck_data, snapshot_label, created_by, user_name) VALUES (:page_id, :puck_data, :snapshot_label, :created_by, :user_name)',
        {
          page_id: ver.page_id,
          puck_data: typeof current.puck_data === 'string' ? current.puck_data : JSON.stringify(current.puck_data),
          snapshot_label: `Before restoring "${restoredLabel}"`.slice(0, 255),
          created_by: req.user?.id || null,
          user_name: userName,
        }
      );
    }

    await db.query(
      'UPDATE website_pages SET puck_data = :puck_data WHERE id = :id',
      { puck_data: typeof ver.puck_data === 'string' ? ver.puck_data : JSON.stringify(ver.puck_data), id: ver.page_id }
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

````

Diff of the change:
````diff
diff --git a/server/src/routes/website.js b/server/src/routes/website.js
index 0b958d8..60784dd 100644
--- a/server/src/routes/website.js
+++ b/server/src/routes/website.js
@@ -183,6 +183,24 @@ router.post('/versions/:vid/restore', requireAuth, requirePermission('settings.m
     const { vid } = req.params;
     const [[ver]] = await db.query('SELECT * FROM website_versions WHERE id = :vid', { vid });
     if (!ver) return res.status(404).json({ error: 'Version not found' });
+
+    // Snapshot the current content first, so a restore can itself be undone.
+    const [[current]] = await db.query('SELECT puck_data FROM website_pages WHERE id = :id', { id: ver.page_id });
+    if (current?.puck_data) {
+      const userName = req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email : null;
+      const restoredLabel = ver.snapshot_label || `version #${ver.id}`;
+      await db.query(
+        'INSERT INTO website_versions (page_id, puck_data, snapshot_label, created_by, user_name) VALUES (:page_id, :puck_data, :snapshot_label, :created_by, :user_name)',
+        {
+          page_id: ver.page_id,
+          puck_data: typeof current.puck_data === 'string' ? current.puck_data : JSON.stringify(current.puck_data),
+          snapshot_label: `Before restoring "${restoredLabel}"`.slice(0, 255),
+          created_by: req.user?.id || null,
+          user_name: userName,
+        }
+      );
+    }
+
     await db.query(
       'UPDATE website_pages SET puck_data = :puck_data WHERE id = :id',
       { puck_data: typeof ver.puck_data === 'string' ? ver.puck_data : JSON.stringify(ver.puck_data), id: ver.page_id }
````

---

### 12.10 `server/src/services/uploadValidation.js` (EXISTING in KC — create only if the project lacks it; needs `file-type`)
````js
// =============================================================================
// Upload content validation (security remediation H-11)
//
// multer's fileFilter only ever sees the CLIENT-DECLARED Content-Type — a
// multipart header the uploader controls entirely, not the actual file
// bytes. This does real magic-byte sniffing (via `file-type`, ESM-only,
// hence the dynamic import from this CJS codebase) and rejects anything
// whose real content doesn't match an explicitly allowed type.
//
// image/svg+xml is deliberately never in an allowlist that reaches this
// validator — SVG is active content (can embed <script>), and unlike the
// raster/PDF/video types below, `file-type` cannot magic-byte-detect it at
// all (it's XML text, no fixed byte signature), so there would be nothing
// to validate against anyway. If SVG support is ever genuinely needed,
// don't just add it back here — sanitize it server-side (DOMPurify's SVG
// profile) and always serve it as an attachment with nosniff.
// =============================================================================

async function detectFileType(buffer) {
  const { fileTypeFromBuffer } = await import('file-type');
  return fileTypeFromBuffer(buffer);
}

/**
 * Verifies a multer-buffered file's real content matches one of
 * `allowedMimes` (the real allowlist — not just what the client claimed).
 * Returns { ok: true } or { ok: false, error } — never throws, so callers
 * can respond with a clean 400 either way.
 */
async function validateUploadedFile(file, allowedMimes) {
  if (!file?.buffer?.length) return { ok: false, error: 'Empty upload' };
  const detected = await detectFileType(file.buffer);
  if (!detected || !allowedMimes.includes(detected.mime)) {
    return {
      ok: false,
      error: detected
        ? `File content is ${detected.mime}, not an allowed type`
        : 'Could not verify file content — the file may be corrupt or of an unsupported type',
    };
  }
  return { ok: true, detectedMime: detected.mime };
}

module.exports = { validateUploadedFile };
````

---

### 12.11 `client/src/builder/nodes/Section.jsx` (MODIFIED) — full current file
````jsx
// Section — the top-level band of a page. Full-bleed background, constrained
// inner content, and the node that carries a page's anchor identity.

import { Element, useNode } from '@craftjs/core';
import {
  ChoiceField,
  ColorField,
  FieldGroup,
  ImageField,
  NumberField,
  SelectField,
  TextField,
  ToggleField,
} from '../fields/index.jsx';
import Row from './Row.jsx';
import { IDENTITY_DEFAULTS, cssVars, cx, px, styleOverrides, useDomIdentity, useNodeRef } from './nodeUtils.js';

export default function Section({
  background,
  textColor,
  backgroundImage,
  overlay,
  overlayColor,
  paddingTop,
  paddingBottom,
  paddingTopMobile,
  paddingBottomMobile,
  paddingX,
  maxWidth,
  fullBleed,
  sectionType,
  importedDesign,
  children,
}) {
  const ref = useNodeRef();
  const { domId, customClass } = useDomIdentity('section');

  // A section that carries imported design classes is styled by the imported
  // stylesheet, which wins over ours — so panel choices go out inline there.
  // Mobile padding still has to be a variable (a media query can't read an
  // inline style), which is a known limit for imported sections.
  const style = {
    ...styleOverrides({
      imported: Boolean(customClass),
      vars: {
        '--bx-section-bg': background,
        '--bx-section-fg': textColor,
        '--bx-section-bg-image': backgroundImage ? `url("${backgroundImage}")` : '',
        '--bx-section-pt': px(paddingTop),
        '--bx-section-pb': px(paddingBottom),
        '--bx-section-px': px(paddingX),
        '--bx-section-width': maxWidth,
      },
      direct: {
        backgroundColor: background,
        color: textColor,
        backgroundImage: backgroundImage ? `url("${backgroundImage}")` : '',
        paddingTop: px(paddingTop),
        paddingBottom: px(paddingBottom),
        paddingLeft: px(paddingX),
        paddingRight: px(paddingX),
      },
    }),
    ...cssVars({
      '--bx-section-overlay': overlay ? overlayColor : '',
      '--bx-section-pt-sm': px(paddingTopMobile),
      '--bx-section-pb-sm': px(paddingBottomMobile),
    }),
  };

  return (
    <section
      ref={ref}
      id={domId}
      className={cx('bx-section', fullBleed && 'bx-section--full', importedDesign && 'bx-section--imported', overlay && backgroundImage && 'bx-section--overlay', customClass)}
      style={style}
      data-section-type={sectionType || undefined}
    >
      <div className="bx-section__inner">{children}</div>
    </section>
  );
}

function SectionSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });

  return (
    <>
      <FieldGroup title="Background">
        <ColorField label="Background colour" value={props.background} onChange={p('background')} />
        <ColorField label="Text colour" value={props.textColor} onChange={p('textColor')} />
        <ImageField label="Background image" value={props.backgroundImage} onChange={p('backgroundImage')} />
        {props.backgroundImage && (
          <>
            <ToggleField label="Darken image for readability" value={props.overlay} onChange={p('overlay')} />
            {props.overlay && (
              <TextField
                label="Overlay"
                value={props.overlayColor}
                onChange={p('overlayColor')}
                placeholder="rgb(0 0 0 / 0.45)"
              />
            )}
          </>
        )}
      </FieldGroup>

      <FieldGroup title="Layout">
        <ToggleField
          label="Full-bleed (edge to edge)"
          value={props.fullBleed}
          onChange={p('fullBleed')}
          hint="Content spans the full window width instead of the site's max width."
        />
        {!props.fullBleed && (
          <SelectField
            label="Content width"
            value={props.maxWidth}
            onChange={p('maxWidth')}
            options={[
              { value: '', label: 'Site default' },
              { value: '1440px', label: 'Wide — 1440px' },
              { value: '1200px', label: 'Standard — 1200px' },
              { value: '960px', label: 'Narrow — 960px' },
              { value: '720px', label: 'Reading — 720px' },
            ]}
          />
        )}
        <NumberField label="Side padding" value={props.paddingX} onChange={p('paddingX')} suffix="px" min={0} />
        <NumberField label="Padding top" value={props.paddingTop} onChange={p('paddingTop')} suffix="px" min={0} />
        <NumberField label="Padding bottom" value={props.paddingBottom} onChange={p('paddingBottom')} suffix="px" min={0} />
        <NumberField
          label="Padding top (mobile)"
          value={props.paddingTopMobile}
          onChange={p('paddingTopMobile')}
          suffix="px"
          min={0}
          hint="Leave blank to reuse the desktop value."
        />
        <NumberField
          label="Padding bottom (mobile)"
          value={props.paddingBottomMobile}
          onChange={p('paddingBottomMobile')}
          suffix="px"
          min={0}
        />
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField
          label="Custom ID"
          value={props.customId}
          onChange={p('customId')}
          placeholder="services"
          hint="Used for anchor links (#services) and per-section custom CSS. Leave blank for an automatic id."
        />
        <TextField
          label="Custom CSS class"
          value={props.customClass}
          onChange={p('customClass')}
          placeholder="hero dark-band"
          hint="Space-separated. Style these in Page settings → Custom CSS or site-wide CSS."
        />
      </FieldGroup>
    </>
  );
}

Section.craft = {
  displayName: 'Section',
  props: {
    ...IDENTITY_DEFAULTS,
    background: '',
    textColor: '',
    backgroundImage: '',
    overlay: true,
    overlayColor: 'rgb(0 0 0 / 0.45)',
    paddingTop: 64,
    paddingBottom: 64,
    paddingTopMobile: '',
    paddingBottomMobile: '',
    paddingX: 24,
    maxWidth: '',
    fullBleed: false,
    // Carries the design's own data-section-type across the import. The
    // imported stylesheet targets [data-section-type="hero"] etc. directly,
    // so dropping it renders those sections unstyled.
    sectionType: '',
    // Set by the design importer. Blank padding then means "none" instead of
    // the 64px/40px default, since the imported markup brings its own spacing.
    importedDesign: false,
  },
  related: { settings: SectionSettings },
  rules: {
    // Sections accept anything; the default child is a Row so a freshly
    // dropped Section is immediately usable.
    canMoveIn: () => true,
  },
};

/** What the Toolbox drags in — a Section pre-seeded with one Row. */
export function SectionPreset() {
  return (
    <Element is={Section} canvas>
      <Element is={Row} canvas />
    </Element>
  );
}
````

---

### 12.12 `client/src/frontend/theme/site.css` (MODIFIED)
````diff
diff --git a/client/src/frontend/theme/site.css b/client/src/frontend/theme/site.css
index 63e3fb3..4f0eaf3 100644
--- a/client/src/frontend/theme/site.css
+++ b/client/src/frontend/theme/site.css
@@ -128,6 +128,12 @@
   background-position: center;
   color: var(--bx-section-fg, inherit);
 }
+/* Imported design sections: blank padding fields add nothing — the imported
+   markup carries its own spacing. A value typed in the panel still applies. */
+.bx-section--imported {
+  padding-top: var(--bx-section-pt, 0px);
+  padding-bottom: var(--bx-section-pb, 0px);
+}
 .bx-section__inner {
   max-width: var(--bx-section-width, var(--bx-container));
   margin-inline: auto;
@@ -188,6 +194,10 @@
   }
   .bx-row--flex { flex-direction: column; }
   .bx-section { padding-top: var(--bx-section-pt-sm, 40px); padding-bottom: var(--bx-section-pb-sm, 40px); }
+  .bx-section--imported {
+    padding-top: var(--bx-section-pt-sm, var(--bx-section-pt, 0px));
+    padding-bottom: var(--bx-section-pb-sm, var(--bx-section-pb, 0px));
+  }
 }
 
 /* ═══ CONTENT COMPONENTS ══════════════════════════════════════════════════ */
````

---

### 12.13 `client/src/vb/admin/WebsitePagesPage.jsx` (MODIFIED)
````diff
diff --git a/client/src/vb/admin/WebsitePagesPage.jsx b/client/src/vb/admin/WebsitePagesPage.jsx
index dfb2d19..c16213a 100644
--- a/client/src/vb/admin/WebsitePagesPage.jsx
+++ b/client/src/vb/admin/WebsitePagesPage.jsx
@@ -6,6 +6,8 @@ import { PAGE_TEMPLATES, buildTemplate } from '../../builder/templates/pageTempl
 import { useConfirm } from '../../hooks/useConfirm.jsx';
 import { toast } from '../../components/Toast.jsx';
 import { parseApiError } from '../../utils/apiError.js';
+import ImportDesignModal from './ImportDesignModal.jsx';
+import VersionHistoryModal from './VersionHistoryModal.jsx';
 
 const IMPACT_COLOR = { critical: '#dc3545', serious: '#fd7e14', moderate: '#ffc107', minor: '#6c757d' };
 const IMPACT_LABEL = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor' };
@@ -297,12 +299,19 @@ export default function WebsitePagesPage() {
   const [pages, setPages] = useState([]);
   const [loading, setLoading] = useState(true);
   const [showTemplates, setShowTemplates] = useState(false);
+  const [showImport, setShowImport] = useState(false);
   const [creating, setCreating] = useState(false);
   const [adaPage, setAdaPage] = useState(null);
+  const [historyPage, setHistoryPage] = useState(null);
   const navigate = useNavigate();
   const { confirm, dialog: confirmDialog } = useConfirm();
 
+  const reloadPages = useCallback(() => {
+    api.get('/website/pages').then(r => setPages(r.data)).catch(() => {});
+  }, []);
+
   useEffect(() => {
+    setLoading(true);
     api.get('/website/pages').then(r => setPages(r.data)).catch(() => {}).finally(() => setLoading(false));
   }, []);
 
@@ -347,10 +356,16 @@ export default function WebsitePagesPage() {
         title="Website Pages"
         subtitle="Manage your public website pages"
         actions={
-          <button className="btn btn-primary btn-sm" onClick={() => setShowTemplates(true)}>
-            <iconify-icon icon="solar:add-circle-line-duotone" className="me-1" />
-            + New Page
-          </button>
+          <div className="d-flex gap-2">
+            <button className="btn btn-outline-primary btn-sm" onClick={() => setShowImport(true)}>
+              <iconify-icon icon="solar:file-download-line-duotone" className="me-1" />
+              Import Design (ZIP)
+            </button>
+            <button className="btn btn-primary btn-sm" onClick={() => setShowTemplates(true)}>
+              <iconify-icon icon="solar:add-circle-line-duotone" className="me-1" />
+              + New Page
+            </button>
+          </div>
         }
       />
 
@@ -382,6 +397,7 @@ export default function WebsitePagesPage() {
                     <td className="text-end">
                       <a href={`/${p.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-secondary me-1">Preview ↗</a>
                       <button className="btn btn-sm btn-outline-info me-1" onClick={() => setAdaPage(p)} title="Run ADA / WCAG accessibility audit">ADA ♿</button>
+                      <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setHistoryPage(p)} title="View and restore saved versions">History</button>
                       <Link to={`/admin/website/pages/${p.id}/edit`} className="btn btn-sm btn-outline-primary me-1">Edit</Link>
                       <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => clonePage(p.id)} title="Clone this page as a draft">Clone</button>
                       <button className="btn btn-sm btn-outline-danger" onClick={() => deletePage(p.id, p.title)}>Delete</button>
@@ -398,6 +414,7 @@ export default function WebsitePagesPage() {
       )}
 
       {adaPage && <AdaModal page={adaPage} onClose={() => setAdaPage(null)} />}
+      {historyPage && <VersionHistoryModal page={historyPage} onClose={() => setHistoryPage(null)} onRestored={reloadPages} />}
 
       {showTemplates && (
         <TemplatePickerModal
@@ -406,6 +423,14 @@ export default function WebsitePagesPage() {
         />
       )}
 
+      {showImport && (
+        <ImportDesignModal
+          pages={pages}
+          onClose={() => setShowImport(false)}
+          onImported={reloadPages}
+        />
+      )}
+
       {confirmDialog}
     </div>
   );
````

---

### 12.14 `server/package.json` (MODIFIED)
````diff
diff --git a/server/package.json b/server/package.json
index b3445eb..61296ce 100644
--- a/server/package.json
+++ b/server/package.json
@@ -13,6 +13,7 @@
   },
   "dependencies": {
     "@anthropic-ai/sdk": "^0.104.2",
+    "adm-zip": "^0.6.1",
     "bcryptjs": "^2.4.3",
     "cors": "^2.8.5",
     "croner": "^8.1.0",
@@ -32,6 +33,8 @@
     "nodemailer": "^10.0.1",
     "otplib": "^12.0.1",
     "pdfkit": "^0.18.0",
+    "postcss": "^8.5.28",
+    "postcss-safe-parser": "^7.1.0",
     "qrcode": "^1.5.4",
     "twilio": "^6.0.2",
     "zod": "^3.23.8"
````

