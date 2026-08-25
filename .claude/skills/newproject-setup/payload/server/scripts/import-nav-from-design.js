#!/usr/bin/env node
// Import header/footer chrome from the design mockup into website_global_settings.
//
// The design already contains the nav, the footer columns, the social strip and
// the legal links. Retyping twenty links is slow and goes wrong quietly — a
// mistyped href only fails when someone clicks it — so this reads them out of
// website-files/ instead.
//
// Report-only by default. Read the report before passing --apply: an empty
// section means its SELECTOR is wrong for this design, NOT that the design
// lacks the content.
//
//   node scripts/import-nav-from-design.js
//   node scripts/import-nav-from-design.js --apply
//
// ⚠️ Reads server/.env, which often points at the real database. Pass
// --host/--database explicitly when you mean a different one.

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { parse } = require('node-html-parser');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const APPLY = process.argv.includes('--apply');

const CONFIG = {
  host: arg('host', process.env.DB_HOST),
  port: Number(arg('port', process.env.DB_PORT || 3306)),
  user: arg('user', process.env.DB_USER),
  password: arg('password', process.env.DB_PASSWORD),
  database: arg('database', process.env.DB_NAME),
};

const DIR = arg('dir', path.join(__dirname, '..', '..', 'website-files'));
const SOURCE = arg('page', 'index.html');

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ PER-PROJECT — the only part that changes between designs. Change the
// selectors, never the logic below. Verify each against the mockup's markup.
// ─────────────────────────────────────────────────────────────────────────────
const SELECTORS = {
  navLinks:      '.nav-desktop a',
  navCtaClass:   'btn',              // a nav link carrying this class is a CTA
  footerGrid:    '.site-footer__grid',
  footerBrand:   '.site-footer__brand',
  footerBlurb:   '.site-footer__brand p',
  socialStrip:   '.social-links a',
  footerColLinks:'.site-footer__links a',
  contactList:   '.contact-list li',
  footerDomain:  '.site-footer__domain',
  footerBottom:  '.site-footer__bottom',
};

// Design hrefs → CMS routes, so slugs line up with the pages import-design.js
// creates. `index.html` is the home page, everything else drops the extension.
function toRoute(href) {
  const raw = (href || '').trim();
  if (!raw || raw.startsWith('#')) return raw || '/';
  if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;
  const [file, hash] = raw.split('#');
  const base = path.basename(file || '', '.html');
  if (!base || base === 'index') return hash ? `/#${hash}` : '/';
  return hash ? `/${base}#${hash}` : `/${base}`;
}

const text = (n) => (n ? n.text.replace(/\s+/g, ' ').trim() : '');

function linkList(nodes) {
  return nodes
    .map((a) => ({ label: text(a), url: toRoute(a.getAttribute('href')) }))
    .filter((l) => l.label);
}

function extract(root) {
  const out = {};
  const notes = [];

  // ── Header nav + CTAs ─────────────────────────────────────────────────────
  const navAnchors = root.querySelectorAll(SELECTORS.navLinks);
  const isCta = (a) => (a.getAttribute('class') || '').split(/\s+/).includes(SELECTORS.navCtaClass);
  out.header_nav_links = linkList(navAnchors.filter((a) => !isCta(a)));
  out.header_cta_buttons = linkList(navAnchors.filter(isCta));
  if (!out.header_nav_links.length) notes.push(`no nav links matched "${SELECTORS.navLinks}"`);

  // ── Footer brand ──────────────────────────────────────────────────────────
  const blurb = root.querySelector(SELECTORS.footerBlurb);
  if (blurb) out.footer_blurb = text(blurb);
  else notes.push(`no footer blurb matched "${SELECTORS.footerBlurb}"`);

  // ── Social strip — keyed off aria-label, the only reliable signal when the
  // icons are inline SVG with no class of their own. ─────────────────────────
  const SOCIAL_MAP = {
    facebook: 'social_facebook', instagram: 'social_instagram',
    youtube: 'social_youtube', linkedin: 'social_linkedin',
    x: 'social_twitter', twitter: 'social_twitter',
  };
  const socials = root.querySelectorAll(SELECTORS.socialStrip);
  for (const a of socials) {
    const label = (a.getAttribute('aria-label') || '').trim().toLowerCase();
    const key = SOCIAL_MAP[label];
    if (key) out[key] = a.getAttribute('href') || '';
  }
  if (!socials.length) notes.push(`no social links matched "${SELECTORS.socialStrip}"`);

  // ── Footer link columns ───────────────────────────────────────────────────
  // Each column is a <div> holding an <h3> and a links wrapper. The brand
  // column has no <h3>, so it drops out naturally.
  const grid = root.querySelector(SELECTORS.footerGrid);
  const columns = [];
  if (grid) {
    for (const col of grid.childNodes.filter((n) => n.nodeType === 1)) {
      const heading = col.querySelector('h3');
      const links = linkList(col.querySelectorAll(SELECTORS.footerColLinks));
      if (heading && links.length) columns.push({ title: text(heading), links });
    }
  } else {
    notes.push(`no footer grid matched "${SELECTORS.footerGrid}"`);
  }
  // The settings schema numbers link columns from 2 (1 is the brand column).
  columns.slice(0, 3).forEach((col, i) => {
    out[`footer_col${i + 2}_title`] = col.title;
    out[`footer_col${i + 2}_links`] = col.links;
  });

  // ── Contact column ────────────────────────────────────────────────────────
  const contactCol = grid && grid.childNodes
    .filter((n) => n.nodeType === 1)
    .find((c) => c.querySelector(SELECTORS.contactList.replace(' li', '')));
  if (contactCol) {
    const heading = contactCol.querySelector('h3');
    if (heading) out.footer_contact_title = text(heading);
    for (const li of contactCol.querySelectorAll('li')) {
      const mail = li.querySelector('a[href^="mailto:"]');
      const value = text(li).replace(/^[^\w+]+\s*/, '');
      if (mail) out.header_email = (mail.getAttribute('href') || '').replace(/^mailto:/, '');
      else if (/[0-9]|1-800|phone/i.test(value)) out.footer_contact_phone = value;
      else if (value) out.footer_contact_location = value;
    }
    const domain = contactCol.querySelector(SELECTORS.footerDomain);
    if (domain) {
      out.footer_domain_label = text(domain);
      out.footer_domain_url = domain.getAttribute('href') || '';
    }
  } else {
    notes.push(`no contact column matched "${SELECTORS.contactList}"`);
  }

  // ── Bottom bar: copyright + legal links ───────────────────────────────────
  const bottom = root.querySelector(SELECTORS.footerBottom);
  if (bottom) {
    out.footer_legal_links = linkList(bottom.querySelectorAll('a'));
    // "© 2026 Example Org. All Rights Reserved." → the name only; the layout
    // renders the © and the year itself.
    const spans = bottom.querySelectorAll('span');
    const copyText = spans.length ? text(spans[0]) : '';
    const name = copyText.replace(/^©\s*/, '').replace(/^\d{4}\s*/, '').trim();
    if (name) out.footer_copyright = name;
  } else {
    notes.push(`no bottom bar matched "${SELECTORS.footerBottom}"`);
  }

  return { out, notes };
}

const JSON_KEYS = new Set([
  'header_nav_links', 'header_cta_buttons', 'footer_legal_links',
  'footer_col2_links', 'footer_col3_links', 'footer_col4_links',
]);

(async () => {
  const file = path.join(DIR, SOURCE);
  if (!fs.existsSync(file)) {
    console.error(`Source not found: ${file}`);
    process.exit(1);
  }
  console.log(`Source: ${file}`);
  const { out, notes } = extract(parse(fs.readFileSync(file, 'utf8')));

  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}${APPLY ? '' : '   [REPORT ONLY]'}\n`);

  for (const [k, v] of Object.entries(out)) {
    const shown = Array.isArray(v)
      ? `${v.length} item(s): ${v.map((i) => i.label).join(', ')}`
      : JSON.stringify(v);
    console.log(`  ${k.padEnd(24)} ${shown}`);
  }

  if (notes.length) {
    console.log('\n  ⚠ Sections that matched nothing — the SELECTOR is likely wrong');
    console.log('    for this design, not the content missing:');
    notes.forEach((n) => console.log(`      - ${n}`));
  }

  if (!APPLY) {
    console.log('\nReport only — nothing written. Re-run with --apply to save.');
    console.log('Then check the Nav and Footer tabs rather than assuming.');
    return;
  }

  const db = await mysql.createConnection(CONFIG);
  try {
    let written = 0;
    for (const [key, value] of Object.entries(out)) {
      const stored = JSON_KEYS.has(key) ? JSON.stringify(value) : String(value);
      await db.query(
        `INSERT INTO website_global_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, stored]
      );
      written += 1;
    }
    console.log(`\nWrote ${written} setting(s). Open Website → Header & Footer and check them.`);
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
