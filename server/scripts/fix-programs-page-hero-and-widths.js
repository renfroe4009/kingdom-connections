#!/usr/bin/env node
/* =============================================================================
 * fix-programs-page-hero-and-widths.js
 * Replaces the plain text-only Programs page intro with a two-column hero:
 * left-aligned eyebrow + headline in a white rounded card, a photo flush on
 * the right (same flush-image/clipped-corner pattern as the program cards
 * below), sitting on the page's tan (#F8F5EF) background. Also switches the
 * Grossman Scholarship section to the same site-container width the header
 * uses, so every section on the page lines up at the same width.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';

async function main() {
  const [[img]] = await db.query("SELECT file_url FROM media_files WHERE original_name = '1.jpg'");

  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'programs'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const idx = data.content.findIndex(b => b.props.id === 'TextBlock-header');

  const hero = {
    type: 'TwoColumn',
    props: {
      id: 'TwoColumn-programs-hero',
      ratio: '1fr 1fr', gap: '0', verticalAlign: 'center',
      containerBgColor: '#ffffff',
      containerBgDecoration: '', containerPadding: '', containerMaxWidth: '',
      containerWidthMode: 'site',
      containerRadius: '24px', containerBorder: 'thin', containerBorderColor: '#e5e5e5',
      cardRadius: '0px',
      leftContent: `<div style="color:${GOLD};text-transform:uppercase;font-size:.75rem;letter-spacing:2px;font-weight:600;">PROGRAMS</div><h1 style="color:${NAVY};font-size:clamp(2.25rem,5vw,3.75rem);letter-spacing:-1.6px;line-height:1;margin-top:.5rem;font-family:'Playfair Display',Georgia,serif;font-weight:700;">How we support our deputies and community.</h1>`,
      leftBgDecoration: '', leftBgImage: '', leftBgColor: '', leftOverlay: 0, leftTextColor: '',
      leftPadding: 'clamp(2.5rem, 5vw, 3.5rem)', leftMinHeight: '', leftBgPosition: 'center center',
      rightContent: '', rightBgDecoration: '',
      rightBgImage: img.file_url, rightBgColor: '', rightOverlay: 0, rightTextColor: '',
      rightPadding: '0', rightMinHeight: '320px', rightBgPosition: 'center center',
      leftHtml: '', rightHtml: '', leftImage: '', rightImage: '',
      animation: 'none', animDelay: '0',
    },
  };

  data.content[idx] = hero;

  const scholarship = data.content.find(b => b.props.id === 'TwoColumn-scholarship').props;
  scholarship.containerWidthMode = 'site';
  scholarship.containerMaxWidth = '';

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'programs' });

  console.log('Programs page hero rebuilt and section widths aligned to the header.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
