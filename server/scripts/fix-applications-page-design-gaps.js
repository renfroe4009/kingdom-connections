#!/usr/bin/env node
/* =============================================================================
 * fix-applications-page-design-gaps.js
 * Closes the gaps found by the import-design audit against website-files/applications.html:
 *  - Eyebrow labels were baked into card body text (or missing) instead of a field
 *  - CTA link rendered as plain text; reference wants a filled navy button
 *  - Page intro was crammed into CardGrid's centered/sans-serif heading+subtext
 *  - Two info cards were side-by-side; reference has them full-width and stacked
 *  - Card radius unset, falls back to a squarer 8px default
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'applications'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const grid = data.content.find(b => b.props.id === 'CardGrid-applications');
  const p = grid.props;

  const PREFIX0 = "FOR THE VENTURA COUNTY SHERIFF'S OFFICE — ";
  if (p.items[0].text.startsWith(PREFIX0)) {
    p.items[0].eyebrow = "FOR THE VENTURA COUNTY SHERIFF'S OFFICE";
    p.items[0].text = p.items[0].text.slice(PREFIX0.length);
  }
  p.items[1].eyebrow = 'FOR DEPUTY FAMILIES';

  p.cardLinkStyle = 'button';
  p.cardLinkBg = NAVY;
  p.cardLinkTextColor = '#ffffff';

  p.columns = 1;
  p.cardRadius = '24px';
  p.heading = '';
  p.subtext = '';

  const intro = {
    type: 'TextBlock',
    props: {
      id: 'TextBlock-applications-header',
      html: `<div style="color:${GOLD};text-transform:uppercase;font-size:.75rem;letter-spacing:2px;font-weight:600;">APPLICATIONS</div>\n<h1 style="color:${NAVY};font-size:clamp(2.5rem,5.5vw,3.75rem);letter-spacing:-1.6px;line-height:1;margin-top:.5rem;font-family:'Playfair Display',Georgia,serif;font-weight:700;">Applications</h1>\n<p style="margin-top:1rem;color:#4b5563;max-width:32rem;">The Ventura County Sheriff's Foundation supports two primary application processes: grants to the Sheriff's Office and the Grossman Scholarship for deputy families.</p>`,
      center: 'left',
      bgColor: '#F8F5EF',
      padding: '3rem 1.5rem 1rem',
      maxWidth: '960px',
      blockAlign: 'site',
      animDelay: '0',
      animation: 'none',
      textColor: '',
    },
  };

  const gridIdx = data.content.findIndex(b => b.props.id === 'CardGrid-applications');
  data.content.splice(gridIdx, 0, intro);

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'applications' });

  console.log('Applications page design gaps fixed.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
