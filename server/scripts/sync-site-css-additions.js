#!/usr/bin/env node
/* =============================================================================
 * sync-site-css-additions.js
 *
 * The live site stylesheet is NOT website-files/css/styles.css — it's the
 * `site_custom_css` row in website_global_settings (setting_key/setting_value
 * key-value table), injected as a <style> tag by useSiteCustomCss() on every
 * public route. That DB value has already diverged from the static file
 * (a prepended fonts.css block, some live URL-path fixes, a few small
 * production-only tweaks) — so it must never be overwritten wholesale from
 * the static file, only appended/updated in place.
 *
 * This script keeps one clearly-marked block of our own additions (donation
 * panel styling, hold badges, event/shop restyle classes, etc. — everything
 * this "wire up modules to frontend" pass adds on top of the imported
 * design) in sync between server/scripts/lib/site-css-additions.css (the
 * source of truth to edit) and the live DB value. Re-run any time that file
 * changes — idempotent, replaces only the marked block, never touches
 * anything else in site_custom_css.
 *
 * Run: cd server && node scripts/sync-site-css-additions.js
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');

const BEGIN = '/* === KC additions (sync-site-css-additions.js) BEGIN — do not hand-edit between these markers, edit server/scripts/lib/site-css-additions.css instead === */';
const END = '/* === KC additions (sync-site-css-additions.js) END === */';

async function main() {
  const additions = fs.readFileSync(path.join(__dirname, 'lib', 'site-css-additions.css'), 'utf8').trim();
  const block = `${BEGIN}\n${additions}\n${END}`;

  const [[row]] = await db.query(
    "SELECT setting_value FROM website_global_settings WHERE setting_key = 'site_custom_css'"
  );
  if (!row) throw new Error('No site_custom_css row in website_global_settings');

  let css = row.setting_value;
  const beginIdx = css.indexOf(BEGIN);
  const endIdx = css.indexOf(END);

  if (beginIdx !== -1 && endIdx !== -1) {
    css = css.slice(0, beginIdx) + block + css.slice(endIdx + END.length);
    console.log('Replaced existing KC-additions block.');
  } else {
    css = `${css}\n\n${block}\n`;
    console.log('Appended new KC-additions block.');
  }

  await db.query(
    "UPDATE website_global_settings SET setting_value = :css WHERE setting_key = 'site_custom_css'",
    { css }
  );
  console.log('Done.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
