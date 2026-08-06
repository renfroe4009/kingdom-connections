#!/usr/bin/env node
/* =============================================================================
 * fix-news-page-design-gaps.js
 * Closes the gaps found by the import-design audit against website-files/news.html:
 *  - Whole page was one dark vertical Timeline block; reference has 3 sections
 *    (page-intro, a 4-card photo grid, a closing CTA) — Timeline has no link
 *    field, so migrate the recaps to CardGrid, which supports photos + tags.
 *  - Page-intro (eyebrow + serif H1 + subtext) was missing entirely.
 *  - Closing "Be Part of the Story" CTA banner was missing entirely.
 *  - All 4 recap items had no photo.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';

async function main() {
  const [rows] = await db.query("SELECT original_name, file_url FROM media_files WHERE original_name IN ('2.jpg','3.jpg','4.jpg','9.jpg')");
  const u = {};
  for (const r of rows) u[r.original_name] = r.file_url;

  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'news'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const timeline = data.content.find(b => b.props.id === 'Timeline-news');
  const milestones = timeline.props.milestones;
  const images = [u['3.jpg'], u['2.jpg'], u['4.jpg'], u['9.jpg']];

  const intro = {
    type: 'TextBlock',
    props: {
      id: 'TextBlock-news-header',
      html: `<div style="color:${GOLD};text-transform:uppercase;font-size:.75rem;letter-spacing:2px;font-weight:600;">NEWS &amp; EVENTS</div>\n<h1 style="color:${NAVY};font-size:clamp(2.5rem,5.5vw,3.75rem);letter-spacing:-1.6px;line-height:1;margin-top:.5rem;font-family:'Playfair Display',Georgia,serif;font-weight:700;">Stories from our community</h1>\n<p style="margin-top:1rem;color:#4b5563;font-size:1.1rem;">The latest updates from our programs, events, and the deputies and families we support.</p>`,
      center: 'left',
      bgColor: '',
      padding: '3rem 1.5rem 1rem',
      maxWidth: '960px',
      blockAlign: 'site',
      animDelay: '0',
      animation: 'none',
      textColor: '',
    },
  };

  const grid = {
    type: 'CardGrid',
    props: {
      id: 'CardGrid-news',
      label: '', heading: '', headingColor: '', headingFont: 'sans', subtext: '', subtextColor: '',
      headerLinkText: '', headerLinkUrl: '',
      columns: 4, cardStyle: 'plain', cardRadius: '16px', bgColor: 'transparent',
      cardBg: '#ffffff', cardTitleColor: NAVY, cardTextColor: '#4b5563', cardLinkColor: GOLD,
      cardLinkStyle: 'text', cardLinkBg: NAVY, cardLinkTextColor: '#ffffff',
      iconColor: GOLD, btnRadius: '50px', cardTitleSize: '1.1rem',
      animation: 'none', animDelay: '0',
      items: milestones.map((m, i) => ({
        image: images[i] || '',
        icon: '',
        eyebrow: m.phase || '',
        title: m.title || '',
        text: m.desc || '',
        link: '',
        linkText: '',
      })),
    },
  };

  const cta = {
    type: 'CTABanner',
    props: {
      id: 'CTABanner-news',
      eyebrow: 'BE PART OF THE STORY', eyebrowColor: GOLD,
      headline: 'Support the programs behind these headlines.',
      headlineColor: NAVY, headlineFont: 'serif', headlineSize: '2rem',
      subtext: '', subtextColor: '', subtextSize: '1rem',
      footnoteText: '', footnoteColor: '',
      bgImage: '', bgOverlay: 0, bgColor: '#F8F5EF', bgDecoration: '', textColor: NAVY, btnRadius: '50px',
      btn1Text: 'Donate or Join', btn1Url: '/support', btn1BgColor: GOLD, btn1TextColor: NAVY,
      btn2Text: '', btn2Url: '', btn2BgColor: 'transparent', btn2TextColor: NAVY,
      layout: 'boxed', cardRadius: '24px', paddingY: '3.5rem', paddingX: '2rem',
    },
  };

  data.content = [intro, grid, cta];

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'news' });

  console.log('News page design gaps fixed (migrated Timeline to CardGrid, added intro + CTA sections, added images).');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
