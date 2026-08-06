#!/usr/bin/env node
/* =============================================================================
 * fix-home-page-design-gaps.js
 * Closes the gaps found by the import-design audit against website-files/index.html:
 *  - Programs & Impact grid was 2 columns, reference shows 4
 *  - 3 of 4 program cards linked to /blog instead of their real anchor
 *  - card radius unset on both CardGrid blocks, falls back to a squarer 8px
 *  - hero missing trust-row caption + #impact scroll link
 *  - CTA banner missing the tax-deductible footnote
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'home'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const byId = id => data.content.find(b => b.props.id === id);

  const programs = byId('CardGrid-programs');
  programs.props.columns = 4;
  programs.props.cardRadius = '24px';
  programs.props.items[0].link = '/programs#shop';
  programs.props.items[2].link = '/programs#facility';
  programs.props.items[3].link = '/programs#scholarship';

  byId('CardGrid-help').props.cardRadius = '24px';

  byId('StatsRow-impact').props.anchorId = 'impact';

  const hero = byId('HeroBanner-home');
  hero.props.scrollLinkText = 'See our impact ↓';
  hero.props.scrollLinkTarget = 'impact';
  hero.props.trustCaption = 'Trusted by thousands of families and local businesses';

  byId('CTABanner-home').props.footnoteText = 'Your gift is tax-deductible. Questions? Call us at (805) 492-4398';

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'home' });

  console.log('Home page design gaps fixed.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
