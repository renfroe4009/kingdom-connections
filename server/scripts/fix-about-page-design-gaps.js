#!/usr/bin/env node
/* =============================================================================
 * fix-about-page-design-gaps.js
 * Closes the gaps found by the import-design audit against website-files/about.html:
 *  - Testimonials block missing the logo above the quote
 *  - Hero overlay is a flat black tint, reference wants a navy left-to-right gradient
 *  - Values card icons shown, reference design uses none
 *  - Testimonial attribution not uppercase/em-dash styled like the reference
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

async function main() {
  const [rows] = await db.query("SELECT file_url FROM media_files WHERE original_name = 'logo-footer.png'");
  const logoUrl = rows[0] ? rows[0].file_url : '';

  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'about'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const byId = id => data.content.find(b => b.props.id === id);

  const hero = byId('HeroBanner-about');
  hero.props.overlayDirection = 'gradient';
  hero.props.bgColor = '#0A1F3D';

  const testimonials = byId('Testimonials-about');
  testimonials.props.logo = logoUrl;
  testimonials.props.logoWidth = '140px';
  testimonials.props.items[0].author = '— LONGTIME VCSF SUPPORTER & LOCAL BUSINESS OWNER';
  testimonials.props.items[0].role = '';

  const values = byId('CardGrid-values');
  values.props.items.forEach(item => { item.icon = ''; });

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'about' });

  console.log('About page design gaps fixed.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
