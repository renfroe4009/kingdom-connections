#!/usr/bin/env node
/* =============================================================================
 * fix-about-page-styling.js
 * Design-gap audit (website-files/about.html vs. live /about) found several
 * blocks with capable-but-unset props: card corners default to square/8px
 * instead of the reference's rounded-3xl, the mission/vision section is
 * capped at 960px instead of matching the header's site-container width, the
 * intro paragraph column is wider than the reference's max-w-3xl, and the
 * "Our guiding principles" heading has no serif option set (field added in
 * this same pass — see puckConfig.jsx CardGrid.headingFont).
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const FIXES = {
  'TwoColumn-mission-vision': { cardRadius: '24px', containerWidthMode: 'site' },
  'CardGrid-values':          { cardRadius: '24px', headingFont: 'serif' },
  'TextBlock-intro':          { maxWidth: '800px' },
};

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'about'");
  if (!page) { console.error('about: page not found'); process.exit(1); }
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;

  for (const [blockId, props] of Object.entries(FIXES)) {
    const idx = data.content.findIndex(b => b.props.id === blockId);
    if (idx === -1) { console.error(`about: ${blockId} not found`); continue; }
    Object.assign(data.content[idx].props, props);
    console.log(`about: updated ${blockId} —`, props);
  }

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'about' });
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
