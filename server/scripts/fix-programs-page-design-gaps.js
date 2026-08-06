#!/usr/bin/env node
/* =============================================================================
 * fix-programs-page-design-gaps.js
 * Closes the gaps found by the import-design audit against website-files/programs.html:
 *  - Program badge text was baked into the description as a plain-text prefix
 *  - Each program should be its own bordered card, not one continuous block
 *  - Grossman Scholarship section should be a single bordered, rounded card
 *  - Page-intro heading should sit flush with the site container (header width)
 *  - Shop with a Cop CTA should be a plain text link, not a filled button
 *  - CTA banner headline duplicated the button text
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'programs'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const byId = id => data.content.find(b => b.props.id === id);

  const services = byId('ServicesList-programs');
  services.props.itemCard = 'card';
  services.props.itemCardRadius = '24px';
  services.props.itemImageMinHeight = '320px';

  const BADGES = {
    'Shop with a Cop': 'COMMUNITY ENGAGEMENT',
    'Coppers and Choppers': 'SIGNATURE EVENT',
    'Sgt. Ron Helus Training Facility': 'MAJOR CAPITAL PROJECT',
  };
  services.props.services.forEach(s => {
    const badge = BADGES[s.title];
    if (badge && s.description.startsWith(badge + ' — ')) {
      s.badge = badge;
      s.description = s.description.slice((badge + ' — ').length);
    }
    if (s.link_url) s.link_style = 'text';
  });

  const scholarship = byId('TwoColumn-scholarship');
  scholarship.props.containerRadius = '24px';
  scholarship.props.containerBorder = 'thin';
  scholarship.props.containerBorderColor = '#e5e5e5';

  byId('TextBlock-header').props.blockAlign = 'site';

  const cta = byId('CTABanner-programs');
  cta.props.headline = '';
  cta.props.paddingY = '3.5rem';

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'programs' });

  console.log('Programs page design gaps fixed.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
