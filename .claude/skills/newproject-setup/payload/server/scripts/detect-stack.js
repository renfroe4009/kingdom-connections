#!/usr/bin/env node
// =============================================================================
// detect-stack — what state is this project in?
//
// The setup skill runs this first. A clone of an already-converted project
// needs almost none of the conversion work, while a clone of the older
// Puck-based base needs all of it — and guessing wrong is destructive in one
// direction and a no-op in the other.
//
//   node scripts/detect-stack.js            # human summary
//   node scripts/detect-stack.js --json     # machine-readable, for the skill
//   node scripts/detect-stack.js --skip-db  # filesystem only, no DB needed
//
// Read-only. Touches nothing.
// =============================================================================

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const APP = path.resolve(__dirname, '..', '..');
const CLIENT = path.join(APP, 'client');
const SERVER = path.join(APP, 'server');

const JSON_OUT = process.argv.includes('--json');
const SKIP_DB = process.argv.includes('--skip-db');

const exists = (...parts) => fs.existsSync(path.join(...parts));
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

/* ── Builder ──────────────────────────────────────────────────────────────── */

// Files the Puck build left behind. Their presence means conversion never ran
// (or ran partially and stopped), not merely that a dependency lingers.
const PUCK_FILES = [
  'src/cms/puckConfig.jsx',
  'src/cms/BuilderPalette.jsx',
  'src/cms/SitePreviewShell.jsx',
  'src/cms/pageTemplates.js',
  'src/pages/WebsitePageEditor.jsx',
];

const CRAFT_FILES = [
  'src/builder/editor/BuilderPage.jsx',
  'src/builder/editor/CanvasFrame.jsx',
  'src/builder/nodes/index.jsx',
  'src/frontend/theme/site.css',
];

function inspectBuilder() {
  const pkg = readJson(path.join(CLIENT, 'package.json'));
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };

  const puckLeftovers = PUCK_FILES.filter((f) => exists(CLIENT, f));
  const craftMissing = CRAFT_FILES.filter((f) => !exists(CLIENT, f));

  return {
    puckDependency: deps['@measured/puck'] || null,
    puckLeftovers,
    craftDependency: deps['@craftjs/core'] || null,
    craftLayersDependency: deps['@craftjs/layers'] || null,
    craftMissing,
    codeEditorDependency: deps['@uiw/react-codemirror'] || null,
    nodeCount: countNodes(),
  };
}

// One file per node type, minus the registry and the shared helpers.
function countNodes() {
  const dir = path.join(CLIENT, 'src/builder/nodes');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsx') && !['index.jsx'].includes(f)).length;
}

/* ── Design source ────────────────────────────────────────────────────────── */

function inspectDesign() {
  const dir = path.join(APP, 'website-files');
  if (!fs.existsSync(dir)) return { present: false };

  const walk = (base, depth = 0) => {
    if (depth > 3) return [];
    let out = [];
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '__MACOSX' || entry.name.startsWith('_backup')) continue;
      const full = path.join(base, entry.name);
      if (entry.isDirectory()) out = out.concat(walk(full, depth + 1));
      else out.push(full);
    }
    return out;
  };

  const files = walk(dir);
  const byExt = (ext) => files.filter((f) => f.toLowerCase().endsWith(ext));
  const css = byExt('.css');

  // Placeholder media is common in handed-over design folders — a few dozen
  // bytes of Mac path instead of the real asset. Silent until the page renders.
  const media = files.filter((f) => /\.(mp4|webm|mov|jpg|jpeg|png|webp|avif|gif|svg)$/i.test(f));
  const placeholders = media.filter((f) => {
    try { return fs.statSync(f).size < 1024; } catch { return false; }
  }).map((f) => path.relative(dir, f));

  return {
    present: true,
    pages: byExt('.html').map((f) => path.relative(dir, f)),
    stylesheets: css.map((f) => ({
      file: path.relative(dir, f),
      bytes: fs.statSync(f).size,
    })),
    scripts: byExt('.js').map((f) => path.relative(dir, f)),
    assetCount: files.length,
    placeholderMedia: placeholders,
  };
}

/* ── Database ─────────────────────────────────────────────────────────────── */

async function inspectDatabase() {
  if (SKIP_DB) return { checked: false, reason: '--skip-db' };
  const config = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
  if (!config.host || !config.database) {
    return { checked: false, reason: 'server/.env is missing DB_HOST or DB_NAME' };
  }

  let mysql;
  try { mysql = require('mysql2/promise'); } catch {
    return { checked: false, reason: 'mysql2 not installed — run npm install in server/' };
  }

  let db;
  try {
    db = await mysql.createConnection(config);
  } catch (err) {
    return { checked: false, reason: `cannot connect: ${err.message}`, target: `${config.host}/${config.database}` };
  }

  try {
    const [cols] = await db.query(
      `SELECT table_name AS t, column_name AS c, column_type AS ty
         FROM information_schema.columns
        WHERE table_schema = ?
          AND ((table_name = 'website_pages' AND column_name IN ('page_mode','code_html','custom_css','custom_js'))
            OR (table_name = 'website_global_settings' AND column_name = 'setting_value'))`,
      [config.database],
    );
    const find = (t, c) => cols.find((r) => r.t === t && r.c === c);
    const wide = (t, c) => /^(medium|long)text/i.test(find(t, c)?.ty || '');

    const [[pages]] = await db.query('SELECT COUNT(*) AS n FROM website_pages').catch(() => [[{ n: null }]]);
    const [[settings]] = await db.query('SELECT COUNT(*) AS n FROM website_global_settings').catch(() => [[{ n: null }]]);

    return {
      checked: true,
      target: `${config.host}/${config.database}`,
      schemaReady: Boolean(find('website_pages', 'page_mode') && find('website_pages', 'code_html'))
        && wide('website_global_settings', 'setting_value')
        && wide('website_pages', 'custom_css')
        && wide('website_pages', 'custom_js'),
      hasPageMode: Boolean(find('website_pages', 'page_mode')),
      hasCodeHtml: Boolean(find('website_pages', 'code_html')),
      widened: {
        'website_global_settings.setting_value': wide('website_global_settings', 'setting_value'),
        'website_pages.custom_css': wide('website_pages', 'custom_css'),
        'website_pages.custom_js': wide('website_pages', 'custom_js'),
      },
      pageCount: pages?.n ?? null,
      settingCount: settings?.n ?? null,
    };
  } finally {
    await db.end();
  }
}

/* ── Verdict ──────────────────────────────────────────────────────────────── */

function decide(report) {
  const { builder, design, database } = report;
  const todo = [];

  if (builder.puckDependency || builder.puckLeftovers.length) todo.push('remove-puck');
  if (!builder.craftDependency || builder.craftMissing.length) todo.push('install-craft');
  if (database.checked && !database.schemaReady) todo.push('apply-schema');
  if (!database.checked) todo.push('verify-database');
  if (!design.present || !design.pages?.length) todo.push('await-design');
  else if ((database.pageCount ?? 0) === 0) todo.push('import-design');
  if (design.present && design.pages?.length && (database.pageCount ?? 0) > 0) todo.push('convert-and-verify');

  let stack = 'unknown';
  if (builder.craftDependency && !builder.puckDependency && !builder.puckLeftovers.length) stack = 'craft';
  else if (builder.puckDependency || builder.puckLeftovers.length) {
    stack = builder.craftDependency ? 'mixed — conversion started but incomplete' : 'puck';
  }

  return { stack, todo };
}

(async () => {
  const report = {
    appPath: APP,
    builder: inspectBuilder(),
    design: inspectDesign(),
    database: await inspectDatabase(),
  };
  report.verdict = decide(report);

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const { builder: b, design: d, database: db, verdict: v } = report;
  const tick = (ok) => (ok ? 'yes' : 'NO');

  console.log(`\nProject   ${APP}`);
  console.log(`Stack     ${v.stack}\n`);

  console.log('BUILDER');
  console.log(`  Puck dependency      ${b.puckDependency || 'absent'}`);
  console.log(`  Puck files left      ${b.puckLeftovers.length ? b.puckLeftovers.join(', ') : 'none'}`);
  console.log(`  Craft.js             ${b.craftDependency || 'absent'}`);
  console.log(`  Craft files missing  ${b.craftMissing.length ? b.craftMissing.join(', ') : 'none'}`);
  console.log(`  Node types           ${b.nodeCount}`);
  console.log(`  Code editor          ${b.codeEditorDependency || 'absent'}`);

  console.log('\nDESIGN (website-files/)');
  if (!d.present) console.log('  not present');
  else {
    console.log(`  Pages                ${d.pages.length}${d.pages.length ? ` — ${d.pages.slice(0, 6).join(', ')}${d.pages.length > 6 ? ', …' : ''}` : ''}`);
    console.log(`  Stylesheets          ${d.stylesheets.map((s) => `${s.file} (${Math.round(s.bytes / 1024)}KB)`).join(', ') || 'none'}`);
    console.log(`  Scripts              ${d.scripts.join(', ') || 'none'}`);
    console.log(`  Files total          ${d.assetCount}`);
    if (d.placeholderMedia.length) {
      console.log(`  ⚠ Placeholder media  ${d.placeholderMedia.length} file(s) under 1KB — real assets missing`);
      for (const f of d.placeholderMedia.slice(0, 5)) console.log(`      ${f}`);
    }
  }

  console.log('\nDATABASE');
  if (!db.checked) console.log(`  not checked — ${db.reason}`);
  else {
    console.log(`  Target               ${db.target}`);
    console.log(`  Builder schema       ${tick(db.schemaReady)}`);
    console.log(`    page_mode          ${tick(db.hasPageMode)}`);
    console.log(`    code_html          ${tick(db.hasCodeHtml)}`);
    for (const [key, ok] of Object.entries(db.widened)) console.log(`    ${key.padEnd(17)} ${tick(ok)}`);
    console.log(`  Pages / settings     ${db.pageCount} / ${db.settingCount}`);
  }

  console.log(`\nNEXT: ${v.todo.join(' → ') || 'nothing — project looks complete'}\n`);
})().catch((err) => { console.error(err); process.exit(2); });
