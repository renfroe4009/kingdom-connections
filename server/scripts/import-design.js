#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// import-design — turn a folder of static HTML/CSS/JS/assets into CMS pages.
//
//   node scripts/import-design.js --dir ../../website-files
//   node scripts/import-design.js --dir ./design --dry-run
//
// WHAT IT PRODUCES
// Each page becomes a *visual* page whose top-level chunks are Sections, each
// holding one HTML block with the original markup. That combination is the
// point:
//   • pixel-exact, because the markup renders verbatim;
//   • immediately drag-and-droppable, because each design section is a real
//     Section node the client can reorder, duplicate or delete;
//   • incrementally upgradable — swap any one HTML block for real components
//     (Heading, Card Grid, Form…) whenever you get to it, without touching
//     the rest of the page.
//
// Whole-page code mode would give you the first of those and none of the
// others, which is why this doesn't use it.
//
// Header, footer and nav are deliberately NOT imported: they're driven by
// Web Settings so they stay consistent across every page. The script prints
// what it skipped so you can transcribe the nav links.
//
// ⚠️ Reads server/.env by default. Pass --host/--database explicitly if that
// isn't the database you mean to write to.
// =============================================================================

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { parse } = require('node-html-parser');
const { convertSection } = require('./lib/convert-sections');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/* ── args ─────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

// Defaults to app/website-files — the convention is that each project keeps
// its own design mockup in-tree, so the import is reproducible on any machine
// and nobody has to remember where the original zip was downloaded to.
const DEFAULT_DIR = path.resolve(__dirname, '..', '..', 'website-files');
const DIR = flag('dir');
const DRY = has('dry-run');
const STATUS = flag('status', 'published');
const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'client', 'public');

// --only home,about   → import just those pages (match by file name or slug).
// Importing one page at a time is the safer way to work: bring in a page,
// convert and check it, then move to the next.
const ONLY = (flag('only', '') || '')
  .split(',')
  .map((s) => s.trim().replace(/\.html?$/i, '').toLowerCase())
  .filter(Boolean);

// --skip-assets / --skip-css  → leave the shared files alone. Once the first
// import has copied 26MB of images and loaded the stylesheet, later per-page
// imports have no reason to redo that work.
const SKIP_ASSETS = has('skip-assets');
const SKIP_CSS = has('skip-css');

// Conversion is ON by default; --no-convert opts out.
//
// It used to be opt-in via --convert, and forgetting the flag produced a page
// where every section was raw HTML — which is indistinguishable from the rules
// having failed, and hands the client an editor with nothing to edit. The
// whole point of importing into a builder is editable components, so that is
// now the default and opting out is the deliberate act.
//
// Anything unrecognised still becomes an HTML block, so the page always
// renders identically either way.
const CONVERT = !has('no-convert');

// Only these get copied into public/. An allowlist, not a denylist: design
// folders are full of things that must not be published — READMEs, build
// scripts, editor state, the designer's own notes.
const ASSET_EXT = /\.(jpe?g|png|gif|svg|webp|avif|ico|bmp|mp4|webm|mov|m4v|ogg|mp3|wav|woff2?|ttf|otf|eot|pdf)$/i;

// Junk that ships with hand-assembled folders. Matched against any path
// segment, so a whole backup directory is skipped in one go.
const DEFAULT_EXCLUDES = [
  '__MACOSX', '.DS_Store', 'Thumbs.db', '.git', 'node_modules',
  '_backup', '_original', '_snapshot', '_old', '.tmp',
];
const EXTRA_EXCLUDES = (flag('exclude', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const EXCLUDES = [...DEFAULT_EXCLUDES, ...EXTRA_EXCLUDES];

const isExcluded = (relPath) =>
  relPath.split('/').some((seg) => EXCLUDES.some((ex) => seg === ex || seg.startsWith(ex)));

const SRC = DIR ? path.resolve(process.cwd(), DIR) : DEFAULT_DIR;
if (!fs.existsSync(SRC)) {
  if (!DIR) {
    console.error(`No design folder found at ${DEFAULT_DIR}`);
    console.error('');
    console.error('Put this project\'s mockup there — the .html pages at the top level, with');
    console.error('css/, js/ and assets/ beside them — then re-run. Or point elsewhere:');
    console.error('  node scripts/import-design.js --dir <folder>');
  } else {
    console.error(`Not found: ${SRC}`);
  }
  process.exit(1);
}

// A mockup nested one level down (the usual result of unzipping) is the most
// common mistake, so find it rather than reporting "no pages".
if (!fs.readdirSync(SRC).some((f) => /\.html?$/i.test(f))) {
  const nested = fs.readdirSync(SRC, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !isExcluded(e.name))
    .map((e) => path.join(SRC, e.name))
    .find((d) => fs.readdirSync(d).some((f) => /\.html?$/i.test(f)));
  if (nested) {
    console.error(`No .html files directly in ${SRC}`);
    console.error(`Found them one level down — did you mean:`);
    console.error(`  --dir "${nested}"`);
    console.error('(or move that folder\'s contents up a level)');
    process.exit(1);
  }
}

const DB = {
  host: flag('host', process.env.DB_HOST),
  port: Number(flag('port', process.env.DB_PORT || 3306)),
  user: flag('user', process.env.DB_USER),
  password: flag('password', process.env.DB_PASSWORD),
  database: flag('database', process.env.DB_NAME),
};

/* ── helpers ──────────────────────────────────────────────────────────────── */

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const rel = (file) => path.relative(SRC, file).split(path.sep).join('/');

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
  const base = path.basename(file, path.extname(file)).toLowerCase();
  const slug = base === 'index' ? 'home' : base;
  return slug.replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
}

/* ── Craft node-tree construction ─────────────────────────────────────────── */

let seq = 0;
const nextId = (prefix) => `${prefix}${(seq += 1)}`;

/**
 * Wrap each chunk of imported markup in a Section holding an HTML block.
 *
 * The Section is a *transparent* wrapper — full-bleed, zero padding — because
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
        paddingTop: 0,
        paddingBottom: 0,
        paddingTopMobile: '',
        paddingBottomMobile: '',
        paddingX: 0,
        maxWidth: '',
        fullBleed: true,
      },
    };

    // Without --convert (or when no rule matched), the whole section stays as
    // one verbatim HTML block.
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

/* ── page parsing ─────────────────────────────────────────────────────────── */

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

function parsePage(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const root = parse(raw, { blockTextElements: { script: true, style: true } });

  const title = root.querySelector('title')?.text?.trim()
    || root.querySelector('h1')?.text?.trim()
    || path.basename(file, path.extname(file));
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

    if (CONVERT) {
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

  return { title, metaDesc, chunks, skipped, slug: slugFor(file) };
}

/* ── main ─────────────────────────────────────────────────────────────────── */

(async () => {
  const allFiles = walk(SRC);
  const kept = allFiles.filter((f) => !isExcluded(rel(f)));
  const excludedCount = allFiles.length - kept.length;

  const allHtml = kept.filter((f) => /\.html?$/i.test(f) && !rel(f).includes('/'));
  const htmlFiles = ONLY.length
    ? allHtml.filter((f) => {
      const base = path.basename(f, path.extname(f)).toLowerCase();
      return ONLY.includes(base) || ONLY.includes(slugFor(f));
    })
    : allHtml;

  if (ONLY.length && !htmlFiles.length) {
    console.error(`--only "${ONLY.join(', ')}" matched nothing. Available: ${allHtml.map((f) => path.basename(f)).join(', ')}`);
    process.exit(1);
  }
  const cssFiles = kept.filter((f) => /\.css$/i.test(f));
  const jsFiles = kept.filter((f) => /\.js$/i.test(f));
  const assetFiles = kept.filter((f) => ASSET_EXT.test(f));
  const ignored = kept.filter((f) => !ASSET_EXT.test(f) && !/\.(html?|css|js)$/i.test(f));

  if (!allHtml.length) {
    console.error(`No .html files at the top level of ${SRC}`);
    console.error('');
    console.error('Expected layout:');
    console.error('  website-files/');
    console.error('    index.html  about.html  …   ← pages at the top level');
    console.error('    css/    css/*.css            → Site CSS');
    console.error('    js/     js/*.js              → Site-wide JavaScript');
    console.error('    assets/ images, fonts, video → copied to client/public/');
    process.exit(1);
  }

  console.log(`Source: ${SRC}`);
  console.log(`  ${htmlFiles.length} of ${allHtml.length} page(s)${ONLY.length ? ` (--only ${ONLY.join(', ')})` : ''}`
    + `, ${cssFiles.length} stylesheet(s), ${jsFiles.length} script(s), ${assetFiles.length} asset(s)`);
  if (excludedCount) console.log(`  ${excludedCount} file(s) excluded (backups, OS cruft — see --exclude)`);
  if (ignored.length) console.log(`  ${ignored.length} non-asset file(s) not copied: ${ignored.slice(0, 4).map(rel).join(', ')}${ignored.length > 4 ? '…' : ''}`);
  console.log(`Target: ${DB.user}@${DB.host}:${DB.port}/${DB.database}${DRY ? '   [DRY RUN]' : ''}`);
  console.log('');

  // 1. Copy assets into the client's public folder, preserving structure so
  //    /assets/... keeps resolving exactly as it did in the mockup.
  let copied = 0;
  let bytes = 0;
  const suspect = [];
  for (const file of SKIP_ASSETS ? [] : assetFiles) {
    const size = fs.statSync(file).size;
    // A "video" of a few hundred bytes is a placeholder someone left behind,
    // not media. Copy it anyway, but say so — otherwise it's discovered as a
    // silently broken hero on the live site.
    if (size < 1024 && /\.(mp4|webm|mov|m4v|jpe?g|png|webp|avif)$/i.test(file)) suspect.push({ file: rel(file), size });
    const target = path.join(PUBLIC_DIR, rel(file));
    if (!DRY) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
    }
    copied += 1;
    bytes += size;
  }
  console.log(SKIP_ASSETS
    ? 'Assets → skipped (--skip-assets)'
    : `Assets → client/public/  (${copied} file(s), ${Math.round(bytes / 1024 / 1024 * 10) / 10} MB)`);
  if (suspect.length) {
    console.log('');
    console.log(`  ⚠ ${suspect.length} media file(s) are suspiciously small — likely placeholders, not real media:`);
    for (const s of suspect.slice(0, 8)) console.log(`      ${s.file}  (${s.size} bytes)`);
    if (suspect.length > 8) console.log(`      …and ${suspect.length - 8} more`);
    console.log('    Replace them with the real files, or those elements will render blank.');
  }

  // 2. Concatenate stylesheets and scripts into the site-wide settings.
  const siteCss = cssFiles
    .map((f) => `/* ── ${rel(f)} ───────────────────────────── */\n${absolutizeUrls(fs.readFileSync(f, 'utf8'))}`)
    .join('\n\n');
  const siteJs = jsFiles
    .map((f) => `/* ── ${rel(f)} ───────────────────────────── */\n${fs.readFileSync(f, 'utf8')}`)
    .join('\n\n');
  console.log(`Site CSS: ${Math.round(Buffer.byteLength(siteCss) / 1024)} KB from ${cssFiles.length} file(s)`);
  console.log(`Site JS:  ${Math.round(Buffer.byteLength(siteJs) / 1024)} KB from ${jsFiles.length} file(s)`);
  console.log('');

  // 3. Parse each page.
  const pages = htmlFiles.map(parsePage);
  for (const page of pages) {
    console.log(`  /${page.slug}  "${page.title}"  → ${page.chunks.length} section(s)`
      + (page.skipped.length ? `   (skipped ${[...new Set(page.skipped)].join(', ')} — those come from Web Settings)` : ''));
    if (CONVERT) {
      for (const chunk of page.chunks) {
        const s = chunk.stats;
        console.log(s
          ? `        ${chunk.label.padEnd(20)} ${s.converted}/${s.total} block(s) → components`
          : `        ${chunk.label.padEnd(20)} kept as HTML (no rule matched)`);
      }
    }
  }
  console.log('');

  if (DRY) {
    console.log('Dry run — nothing written. Re-run without --dry-run to apply.');
    return;
  }

  const db = await mysql.createConnection({ ...DB, namedPlaceholders: true });
  try {
    if (SKIP_CSS) {
      console.log('Site CSS/JS → skipped (--skip-css); any edits you made there are preserved');
    } else {
      await db.query(
        `INSERT INTO website_global_settings (setting_key, setting_value) VALUES ('site_custom_css', :css)
         ON DUPLICATE KEY UPDATE setting_value = :css`, { css: siteCss },
      );
      await db.query(
        `INSERT INTO website_global_settings (setting_key, setting_value) VALUES ('site_custom_js', :js)
         ON DUPLICATE KEY UPDATE setting_value = :js`, { js: siteJs },
      );
    }

    for (const page of pages) {
      const tree = JSON.stringify(buildTree(page.chunks));
      const [[existing]] = await db.query('SELECT id FROM website_pages WHERE slug = :slug', { slug: page.slug });
      if (existing) {
        await db.query(
          `UPDATE website_pages SET title = :title, status = :status, puck_data = :data,
                  page_mode = 'visual', meta_desc = :desc WHERE id = :id`,
          { id: existing.id, title: page.title, status: STATUS, data: tree, desc: page.metaDesc },
        );
        console.log(`  updated  /${page.slug}  (id ${existing.id})`);
      } else {
        const [res] = await db.query(
          `INSERT INTO website_pages (title, slug, status, puck_data, page_mode, meta_desc)
           VALUES (:title, :slug, :status, :data, 'visual', :desc)`,
          { title: page.title, slug: page.slug, status: STATUS, data: tree, desc: page.metaDesc },
        );
        console.log(`  created  /${page.slug}  (id ${res.insertId})`);
      }
    }
  } finally {
    await db.end();
  }

  console.log('');
  console.log('Done. Next steps:');
  console.log('  1. Website → Header & Footer → Theme: set the brand colours to match the design.');
  console.log('  2. Website → Header & Footer → Navigation / Footer: recreate the nav and footer links.');
  console.log('  3. Open a page in the builder — each design section is a draggable Section you can');
  console.log('     reorder, or replace with real components one at a time.');
})().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
