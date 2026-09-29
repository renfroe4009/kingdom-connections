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
const {
  absolutizeUrls, rewriteInternalLinks, slugFor, parsePageHtml, buildTree,
} = require('./lib/html-import-utils');

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

// --section mtn-invite,connect-mtn-01  → update ONLY those sections of the
// page, leaving every other section (and any builder edits to them) alone.
// Matched against the design section's data-section-id, its id, or any of its
// classes. Requires --only, since a section is only meaningful within a page.
// Each entry is `name` (auto-match the live section) or `name=target`, where
// target pins WHICH live section to replace when matching can't tell on its
// own: `partners-01=7` (that section), `partners-01=7-8` (that range, for a
// design that merges two live sections into one), or `donate-01=+8` (insert
// before index 8, for a section the live page doesn't have yet).
const SECTIONS = (flag('section', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const [name, target] = entry.split('=');
    return { name: name.trim().toLowerCase(), target: (target || '').trim() };
  });

// --keep-blocks  → when replacing a section, carry over any LIVE blocks it
// holds (Membership, Donation, Form, Shop, Events…) instead of importing the
// design's static stand-in for them. The /join page's tier cards are a
// MembershipBlock reading real tiers from Fundraising; a plain re-import
// would swap that for hardcoded prices and a dead link.
const KEEP_BLOCKS = has('keep-blocks');
const LIVE_BLOCK_TYPES = new Set([
  'MembershipBlock', 'DonationBlock', 'FormEmbed', 'EventListBlock',
  'ProductList', 'ProductDetail', 'MapBlock', 'ContactDetails',
]);

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

/* ── page parsing ─────────────────────────────────────────────────────────── */
// absolutizeUrls, rewriteInternalLinks, slugFor, buildTree and the actual
// per-page parsing (chrome-skipping, chunking, conversion) all live in
// lib/html-import-utils.js now, shared with the admin ZIP importer. This is
// just the file-path-specific wrapper: read the file, hand raw text to the
// shared parser, attach the slug the file path implies.

/* ── --section: update one section, leave the rest of the page alone ──────
 *
 * The normal import replaces a page's whole content, which throws away every
 * builder edit made since. When a designer changes ONE band of a page, that
 * is far too blunt: this path converts only the named section(s) and swaps
 * the matching Section node in place, keeping every sibling untouched.
 *
 * The page's current content is written to website_versions first, so the
 * admin's History button can undo it — the whole-page path has no such
 * safety net, which is exactly why this one does.
 */
function chunkMatches(chunk, needle) {
  return chunk.sectionId.toLowerCase() === needle
    || (chunk.id || '').toLowerCase() === needle
    || (chunk.sectionType || '').toLowerCase() === needle
    || chunk.classList.some((c) => c.toLowerCase() === needle);
}

// Classes every second section carries. Matching on these identifies nothing,
// so they are only a last resort.
const GENERIC_SECTION_CLASS = new Set([
  'ns-section', 'page-section', 'section', 'section-soft', 'wrap', 'container', 'bx-section',
]);

/**
 * Which live Section node corresponds to this design section.
 *
 * Tried most-specific first and stopped at the first tier that identifies
 * exactly one section: the design's own handles (data-section-id, id) before
 * its classes, and distinctive classes before generic ones. Without the tiers
 * `class="ns-section conn-steps"` matched every ns-section on the page, and
 * the import refused to touch any of them.
 */
function findLiveSection(tree, chunk) {
  const rootKids = tree.ROOT?.nodes || [];
  const lower = (s) => (s || '').toLowerCase();
  const sections = [];
  rootKids.forEach((id, index) => {
    const node = tree[id];
    if (node?.type?.resolvedName !== 'Section') return;
    sections.push({
      id,
      index,
      classes: new Set((node.props.customClass || '').split(/\s+/).filter(Boolean).map(lower)),
      customId: lower(node.props.customId),
      name: lower(node.custom?.displayName),
      type: lower(node.props.sectionType),
    });
  });

  const handles = [lower(chunk.sectionId), lower(chunk.id)].filter(Boolean);
  const classes = chunk.classList.map(lower);
  const distinctive = classes.filter((c) => !GENERIC_SECTION_CLASS.has(c));

  const tiers = [
    (s) => handles.some((h) => s.customId === h || s.name === h),
    (s) => distinctive.some((c) => s.classes.has(c)),
    (s) => Boolean(chunk.sectionType) && s.type === lower(chunk.sectionType)
      && distinctive.every((c) => s.classes.has(c)),
    (s) => classes.some((c) => s.classes.has(c)),
  ];

  for (const match of tiers) {
    const hits = sections.filter(match).map(({ id, index }) => ({ id, index }));
    if (hits.length === 1) return hits;
    if (hits.length > 1) return hits; // ambiguous at this level — report, don't guess deeper
  }
  return [];
}

/** Re-key a freshly built tree so its ids cannot collide with the live one. */
function prefixIds(built, prefix) {
  const map = new Map(Object.keys(built).filter((k) => k !== 'ROOT').map((k) => [k, `${prefix}${k}`]));
  const out = {};
  for (const [id, node] of Object.entries(built)) {
    if (id === 'ROOT') continue;
    const copy = JSON.parse(JSON.stringify(node));
    copy.nodes = (copy.nodes || []).map((n) => map.get(n) || n);
    if (copy.parent && map.has(copy.parent)) copy.parent = map.get(copy.parent);
    out[map.get(id)] = copy;
  }
  return { nodes: out, rootChildren: (built.ROOT.nodes || []).map((n) => map.get(n) || n) };
}

/**
 * The live (data-driven) blocks inside a section, with their whole subtrees.
 * Returned in document order; each entry keeps every id it owns so the
 * deletion pass can skip them.
 */
function liveBlocksIn(tree, sectionId) {
  const found = [];
  const walk = (id) => {
    const node = tree[id];
    if (!node) return;
    if (LIVE_BLOCK_TYPES.has(node.type?.resolvedName)) {
      found.push({ id, type: node.type.resolvedName, ids: subtreeIds(tree, id) });
      return; // don't descend into a live block's own children
    }
    for (const kid of node.nodes || []) walk(kid);
  };
  walk(sectionId);
  return found;
}

/**
 * Put a carried-over live block into the freshly imported section, in place
 * of the design's static stand-in for it: the tier cards a MembershipBlock
 * replaces come in as a CardGrid, so that is what it takes over. With no
 * obvious stand-in it goes last inside the section's main container, where
 * it is visible and can be dragged — never silently dropped.
 */
function placeLiveBlock(tree, sectionId, block) {
  const findFirst = (id, predicate) => {
    const node = tree[id];
    if (!node) return null;
    if (predicate(node, id)) return id;
    for (const kid of node.nodes || []) {
      const hit = findFirst(kid, predicate);
      if (hit) return hit;
    }
    return null;
  };

  // The stand-in is either a CardGrid, or a design container whose children
  // are all cards (`.tier-card`, `.founding-card`) — the founding levels come
  // in as the latter, and appending beside them showed the static prices AND
  // the live ones at once.
  const isCardRow = (n, id) => {
    if (id === sectionId || !n.isCanvas) return false;
    const kids = (n.nodes || []).map((k) => tree[k]).filter(Boolean);
    if (kids.length < 2) return false;
    return kids.every((k) => /(^|\s|-)(tier-card|card|founding-card)(\s|-|$)/i.test(k.props?.importedClass || ''));
  };
  // A Donation/Form block's stand-in is the design's static <form> markup,
  // which imports as a raw HTML block — appending beside it would show a dead
  // mockup form next to the working one.
  const isStaticForm = (n) => n.type?.resolvedName === 'HtmlBlock' && /<form[\s>]/i.test(n.props?.markup || '');

  const target = findFirst(sectionId, (n) => n.type?.resolvedName === 'CardGrid')
    || findFirst(sectionId, isCardRow)
    || findFirst(sectionId, isStaticForm);
  if (target) {
    const parentId = tree[target].parent;
    const at = (tree[parentId].nodes || []).indexOf(target);
    for (const dead of subtreeIds(tree, target)) delete tree[dead];
    tree[parentId].nodes[at] = block.id;
    tree[block.id].parent = parentId;
    return 'replacing the design\'s static cards';
  }

  const container = findFirst(sectionId, (n, id) => id !== sectionId && n.isCanvas) || sectionId;
  tree[container].nodes.push(block.id);
  tree[block.id].parent = container;
  return 'appended — no static stand-in found, so check its position';
}

/** Every descendant id of a node, itself included. */
function subtreeIds(tree, id, acc = []) {
  acc.push(id);
  for (const kid of tree[id]?.nodes || []) subtreeIds(tree, kid, acc);
  return acc;
}

/**
 * Work out which live section(s) this design section lands on.
 *
 * With no explicit target it auto-matches and insists on exactly one hit —
 * guessing would silently rewrite the wrong band of the page. `=7`, `=7-8`
 * and `=+8` are the escape hatches for the cases matching cannot decide:
 * a renamed section, a design that merges two live ones, and a section the
 * live page does not have yet.
 */
function resolveTarget(tree, target, chunk, slug, label) {
  const rootKids = tree.ROOT?.nodes || [];

  if (target) {
    const insertAt = /^\+(\d+)$/.exec(target);
    if (insertAt) {
      const index = Math.min(Number(insertAt[1]), rootKids.length);
      return { replaceIds: [], index, insert: true };
    }
    const range = /^(\d+)(?:-(\d+))?$/.exec(target);
    if (!range) {
      console.error(`  /${slug}: "${label}" — target "${target}" must be an index (7), a range (7-8) or an insert (+8).`);
      return null;
    }
    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);
    if (from > to || to >= rootKids.length) {
      console.error(`  /${slug}: "${label}" — target "${target}" is outside this page's ${rootKids.length} sections.`);
      return null;
    }
    return { replaceIds: rootKids.slice(from, to + 1), index: from, insert: false };
  }

  const hits = findLiveSection(tree, chunk);
  if (hits.length !== 1) {
    console.error(`  /${slug}: "${label}" matched ${hits.length} section(s) on the live page — `
      + 'expected exactly one, so nothing was changed for it. '
      + 'Pin it with --section name=<index>, a range (7-8), or +<index> to insert.');
    return null;
  }
  return { replaceIds: [hits[0].id], index: hits[0].index, insert: false };
}

async function updateSections(db, pages) {
  for (const page of pages) {
    const matches = SECTIONS
      .map((entry) => ({ entry, chunk: page.chunks.find((c) => chunkMatches(c, entry.name)) }))
      .filter((w) => w.chunk);
    if (!matches.length) {
      console.error(`  /${page.slug}: no section matched --section "${SECTIONS.map((e) => e.name).join(', ')}".`);
      console.error(`    available: ${page.chunks.map((c) => c.sectionId || c.id || c.classList[0] || c.label).join(', ')}`);
      continue;
    }

    const [[existing]] = await db.query(
      'SELECT id, puck_data FROM website_pages WHERE slug = :slug', { slug: page.slug },
    );
    if (!existing) {
      console.error(`  /${page.slug}: page does not exist yet — import the whole page first.`);
      continue;
    }

    const tree = typeof existing.puck_data === 'string' ? JSON.parse(existing.puck_data) : existing.puck_data;
    if (!tree?.ROOT) {
      console.error(`  /${page.slug}: page content is not a builder tree — skipping.`);
      continue;
    }

    let changed = 0;
    for (const { entry, chunk } of matches) {
      const label = chunk.sectionId || chunk.id || chunk.classList[0] || chunk.label;
      const aim = resolveTarget(tree, entry.target, chunk, page.slug, label);
      if (!aim) continue;
      const { replaceIds, index, insert } = aim;
      const built = prefixIds(buildTree([chunk]), `s${Date.now().toString(36)}${changed}_`);
      const newSectionId = built.rootChildren[0];

      // Lift the live blocks out of the old section(s) BEFORE they are deleted.
      const carried = KEEP_BLOCKS ? replaceIds.flatMap((rid) => liveBlocksIn(tree, rid)) : [];

      for (const rid of replaceIds) {
        for (const dead of subtreeIds(tree, rid)) {
          if (carried.some((c) => c.ids.includes(dead))) continue; // keep the lifted subtrees
          delete tree[dead];
        }
      }
      Object.assign(tree, built.nodes);
      tree[newSectionId].parent = 'ROOT';
      if (insert) tree.ROOT.nodes.splice(index, 0, newSectionId);
      else tree.ROOT.nodes.splice(index, replaceIds.length, newSectionId);

      for (const block of carried) {
        const placed = placeLiveBlock(tree, newSectionId, block);
        console.log(`  /${page.slug}: kept the live ${block.type} block (${placed}).`);
      }
      changed += 1;
      const s = chunk.stats;
      console.log(`  /${page.slug}: ${insert ? 'inserted' : `replaced ${replaceIds.length} live section(s) with`} "${label}" `
        + (s ? `(${s.converted}/${s.total} block(s) → components)` : '(kept as HTML)'));
    }

    if (!changed) continue;

    await db.query(
      `INSERT INTO website_versions (page_id, puck_data, snapshot_label)
       VALUES (:id, :data, :label)`,
      {
        id: existing.id,
        data: typeof existing.puck_data === 'string' ? existing.puck_data : JSON.stringify(existing.puck_data),
        label: `Before section import (${new Date().toISOString().slice(0, 10)})`,
      },
    );
    await db.query('UPDATE website_pages SET puck_data = :data WHERE id = :id', {
      id: existing.id, data: JSON.stringify(tree),
    });
    console.log(`  /${page.slug}: saved. Previous content is in Version History (History button) if you need it back.`);
  }
}

function parsePage(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const fallbackTitle = path.basename(file, path.extname(file));
  const { title, metaDesc, chunks, skipped } = parsePageHtml(raw, fallbackTitle, { convert: CONVERT });
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
    if (SECTIONS.length) {
      for (const page of pages) {
        const matches = page.chunks.filter((c) => SECTIONS.some((e) => chunkMatches(c, e.name)));
        console.log(`  /${page.slug}: ${matches.length} section(s) match --section "${SECTIONS.map((e) => e.name).join(', ')}"`);
        for (const c of matches) {
          const s = c.stats;
          console.log(`        ${(c.sectionId || c.id || c.classList[0] || c.label).padEnd(22)}`
            + (s ? ` ${s.converted}/${s.total} block(s) → components` : ' kept as HTML'));
        }
        if (!matches.length) {
          console.log(`        available: ${page.chunks.map((c) => c.sectionId || c.id || c.classList[0] || c.label).join(', ')}`);
        }
      }
    }
    console.log('Dry run — nothing written. Re-run without --dry-run to apply.');
    return;
  }

  const db = await mysql.createConnection({ ...DB, namedPlaceholders: true });
  try {
    if (SECTIONS.length) {
      await updateSections(db, pages);
      return;
    }
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
      const [[existing]] = await db.query('SELECT id, puck_data FROM website_pages WHERE slug = :slug', { slug: page.slug });
      if (existing) {
        // Snapshot what's there before overwriting it. A re-import discards
        // every builder edit made since the last one, and without this the
        // only way back was a database restore.
        if (existing.puck_data) {
          await db.query(
            `INSERT INTO website_versions (page_id, puck_data, snapshot_label)
             VALUES (:id, :data, :label)`,
            {
              id: existing.id,
              data: typeof existing.puck_data === 'string' ? existing.puck_data : JSON.stringify(existing.puck_data),
              label: `Before design import (${new Date().toISOString().slice(0, 10)})`,
            },
          );
        }
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
