#!/usr/bin/env node
/* =============================================================================
 * fix-hero-serif-and-eyebrow.js
 * HeroBanner had no way to render a serif headline (the reference design uses
 * Playfair Display for every H1) — now that the field exists, backfill it on
 * the two existing hero instances. Also fixes About's eyebrow badge, which
 * should be plain gold text (no white pill) per the reference, unlike Home's
 * pill-style eyebrow which was already correct.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const FIXES = {
  home:  { blockId: 'HeroBanner-home',  props: { headlineFont: 'serif' } },
  about: { blockId: 'HeroBanner-about', props: { headlineFont: 'serif', eyebrowBg: 'transparent', eyebrowColor: '#C9A227' } },
};

async function main() {
  for (const [slug, { blockId, props }] of Object.entries(FIXES)) {
    const [[page]] = await db.query('SELECT puck_data FROM website_pages WHERE slug = :slug', { slug });
    if (!page) { console.error(`${slug}: page not found`); continue; }
    const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
    const idx = data.content.findIndex(b => b.props.id === blockId);
    if (idx === -1) { console.error(`${slug}: ${blockId} not found`); continue; }
    Object.assign(data.content[idx].props, props);
    await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
      { puck_data: JSON.stringify(data), slug });
    console.log(`${slug}: updated ${blockId} —`, props);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
