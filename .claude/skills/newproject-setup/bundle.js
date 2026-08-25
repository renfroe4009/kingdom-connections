#!/usr/bin/env node
// =============================================================================
// bundle — make this skill self-contained, and install it into a fresh project.
//
// The builder is thousands of lines across ~40 files. It cannot be regenerated
// from a description, and pointing at "a sibling project that has it" breaks the
// moment someone clones onto another drive. So the skill carries a copy of the
// source in `payload/` and installs from itself.
//
//   node bundle.js --pack       refresh payload/ from THIS project (do this
//                               whenever the builder changes, then commit)
//   node bundle.js --install    copy payload/ into the current project
//   node bundle.js              status — what's bundled vs what's here
//
// --install never overwrites an existing file unless --force is passed, so a
// half-finished setup can be resumed without losing local edits.
// =============================================================================

const fs = require('fs');
const path = require('path');

const SKILL_DIR = __dirname;
const PAYLOAD = path.join(SKILL_DIR, 'payload');

// Walk up from the skill directory to the app root (the folder holding
// client/ and server/). Works from .claude/skills/<name>/ at any depth.
function findAppRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'client')) && fs.existsSync(path.join(dir, 'server'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const APP = findAppRoot(SKILL_DIR);

// Everything the Craft.js builder needs, as paths relative to the app root.
// Directories are copied recursively; files individually.
const MANIFEST = [
  { from: 'client/src/builder', type: 'dir' },
  { from: 'client/src/frontend/renderer', type: 'dir' },
  { from: 'client/src/frontend/theme', type: 'dir' },
  // `frontend/components` and `frontend/context` hold this client's whole
  // commerce feature set (checkout, membership, ticketing…) alongside the
  // handful the generic builder actually imports. Pack those specific files,
  // not the directory — packing the directory swept in another client's
  // checkout/payment component here once already; see the ⚠️ warning below
  // `--pack` in this file's usage comment.
  { from: 'client/src/frontend/components/CartBadge.jsx', type: 'file' },
  { from: 'client/src/frontend/components/CartDrawer.jsx', type: 'file' },
  { from: 'client/src/frontend/components/AddToCartButton.jsx', type: 'file' },
  { from: 'client/src/frontend/components/DonationCheckout.jsx', type: 'file' },
  { from: 'client/src/frontend/components/PriceDisplay.jsx', type: 'file' },
  { from: 'client/src/frontend/components/PublicFormEmbed.jsx', type: 'file' },
  { from: 'client/src/frontend/context/CartContext.jsx', type: 'file' },
  { from: 'client/src/components/PublicLayout.jsx', type: 'file' },
  // The admin surface for everything PublicLayout reads — Theme, site CSS/JS,
  // nav, footer, contact. Bundled because the two are one contract: a settings
  // key renamed in the layout is a dead control here, and site_custom_css has
  // no other editor. Generic; keep client copy out of its placeholder text.
  { from: 'client/src/vb/admin/WebsiteHeaderFooterPage.jsx', type: 'file' },
  { from: 'server/scripts/import-design.js', type: 'file' },
  { from: 'server/scripts/import-nav-from-design.js', type: 'file' },
  { from: 'server/scripts/ensure-builder-schema.js', type: 'file' },
  { from: 'server/scripts/detect-stack.js', type: 'file' },
  { from: 'server/scripts/lib/convert-sections.js', type: 'file' },
  { from: 'qa/audit.js', type: 'file' },
  { from: 'qa/package.json', type: 'file' },
];

// Dependency names only — versions are read from this project's package.json at
// pack time, so the bundle never drifts from what it was tested against.
const CLIENT_DEPS = [
  '@craftjs/core', '@craftjs/layers', '@uiw/react-codemirror',
  '@codemirror/lang-html', '@codemirror/lang-css', '@codemirror/lang-javascript',
];
const SERVER_DEPS = ['node-html-parser'];

const SKIP = new Set(['node_modules', 'reports', 'dist', '.DS_Store']);

function copyRecursive(src, dest, { force, log }) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (SKIP.has(entry)) continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry), { force, log });
    }
    return;
  }
  if (fs.existsSync(dest) && !force) {
    log.skipped.push(dest);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  log.written.push(dest);
}

function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      if (entry.isDirectory()) walk(path.join(d, entry.name));
      else n += 1;
    }
  };
  walk(dir);
  return n;
}

function readDeps() {
  const read = (file) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  };
  const client = read(path.join(APP, 'client/package.json'));
  const server = read(path.join(APP, 'server/package.json'));
  const pick = (pkg, names) => Object.fromEntries(
    names.map((n) => [n, pkg.dependencies?.[n] || pkg.devDependencies?.[n]]).filter(([, v]) => v),
  );
  return { client: pick(client, CLIENT_DEPS), server: pick(server, SERVER_DEPS) };
}

/* ── pack ─────────────────────────────────────────────────────────────────── */

function pack() {
  if (!APP) throw new Error('Cannot find the app root (a folder containing client/ and server/).');
  fs.rmSync(PAYLOAD, { recursive: true, force: true });

  const log = { written: [], skipped: [] };
  for (const item of MANIFEST) {
    const src = path.join(APP, item.from);
    if (!fs.existsSync(src)) {
      console.log(`  missing, not bundled: ${item.from}`);
      continue;
    }
    copyRecursive(src, path.join(PAYLOAD, item.from), { force: true, log });
  }

  const deps = readDeps();
  fs.writeFileSync(
    path.join(PAYLOAD, 'manifest.json'),
    JSON.stringify({
      packedFrom: APP,
      // No timestamp: it would churn the diff on every re-pack for no benefit.
      files: MANIFEST.map((m) => m.from),
      dependencies: deps,
    }, null, 2),
  );

  console.log(`\nPacked ${log.written.length} files into payload/`);
  console.log('Dependencies recorded:');
  for (const [scope, map] of Object.entries(deps)) {
    for (const [name, version] of Object.entries(map)) console.log(`  ${scope.padEnd(7)} ${name}@${version}`);
  }
  console.log('\nCommit payload/ so the skill travels with the repo.\n');
}

/* ── install ──────────────────────────────────────────────────────────────── */

function install({ force }) {
  if (!APP) throw new Error('Cannot find the app root (a folder containing client/ and server/).');
  if (!fs.existsSync(PAYLOAD)) {
    throw new Error('payload/ is empty — run `node bundle.js --pack` in a project that has the builder first.');
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(PAYLOAD, 'manifest.json'), 'utf8'));
  const log = { written: [], skipped: [] };

  for (const rel of manifest.files) {
    const src = path.join(PAYLOAD, rel);
    if (!fs.existsSync(src)) continue;
    copyRecursive(src, path.join(APP, rel), { force, log });
  }

  console.log(`\nInstalled into ${APP}`);
  console.log(`  written  ${log.written.length}`);
  console.log(`  skipped  ${log.skipped.length}${log.skipped.length ? ' (already present — pass --force to overwrite)' : ''}`);
  if (log.skipped.length && log.skipped.length <= 10) {
    for (const f of log.skipped) console.log(`    ${path.relative(APP, f)}`);
  }

  // Dependencies are printed rather than installed: npm install is slow, needs
  // network, and is the user's call on a machine we know nothing about.
  console.log('\nNow install the dependencies:\n');
  const line = (scope, map) => {
    const specs = Object.entries(map).map(([n, v]) => `${n}@${v}`).join(' ');
    if (specs) console.log(`  cd ${scope} && npm install ${specs}`);
  };
  line('client', manifest.dependencies.client || {});
  line('server', manifest.dependencies.server || {});
  console.log('\nThen: node server/scripts/detect-stack.js\n');
}

/* ── status ───────────────────────────────────────────────────────────────── */

function status() {
  console.log(`\nSkill    ${SKILL_DIR}`);
  console.log(`App root ${APP || 'NOT FOUND — run this from inside a project'}`);
  const n = countFiles(PAYLOAD);
  console.log(`Payload  ${n ? `${n} files` : 'empty — run --pack in a project that has the builder'}`);

  if (n && APP) {
    const manifest = JSON.parse(fs.readFileSync(path.join(PAYLOAD, 'manifest.json'), 'utf8'));
    console.log('\nTarget project:');
    for (const rel of manifest.files) {
      const there = fs.existsSync(path.join(APP, rel));
      console.log(`  ${there ? 'present' : 'MISSING'}  ${rel}`);
    }
  }
  console.log('\n--pack to bundle, --install to deploy into this project.\n');
}

try {
  if (process.argv.includes('--pack')) pack();
  else if (process.argv.includes('--install')) install({ force: process.argv.includes('--force') });
  else status();
} catch (err) {
  console.error(`\n${err.message}\n`);
  process.exit(1);
}
