#!/usr/bin/env node
/* =============================================================================
 * fix-contact-page-design-gaps.js
 * Closes the gaps found by the import-design audit against website-files/contact.html:
 *  - Page heading was crammed into the narrow info column, small and sans-serif
 *  - Form/info card styling was swapped relative to the reference
 *  - No footer micro-copy under the submit button
 *  - Input/textarea corner radius didn't match the site's rounder convention
 *  - Quick links were filled pills with no lead-in sentence
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'contact'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const section = data.content.find(b => b.props.id === 'ContactSection-contact');
  const p = section.props;

  p.heroEyebrow = p.infoEyebrow;
  p.heroHeading = p.infoHeading;
  p.heroHeadingFont = 'serif';
  p.infoEyebrow = '';
  p.infoHeading = '';

  p.formCardStyle = 'none';
  p.infoCardLabel = 'Direct Contact';

  p.footerNote = 'We typically respond within 2 business days.';
  p.footerNoteColor = '';

  p.inputRadius = '16';
  p.textareaRadius = '24';

  p.quickLinksIntro = 'Follow us on social media for the latest event photos and updates:';
  p.quickLinksStyle = 'text';

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'contact' });

  console.log('Contact page design gaps fixed.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
