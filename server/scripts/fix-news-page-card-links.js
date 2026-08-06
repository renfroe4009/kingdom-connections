#!/usr/bin/env node
/* =============================================================================
 * fix-news-page-card-links.js
 * The News page's 4 CardGrid items had long, uneven-length descriptions
 * (inherited from the old Timeline milestones) and no working link. Swaps
 * in the reference website-files/news.html card copy — short, roughly
 * equal length across all 4 — and points each "Read More" link at the real
 * blog post created by create-news-blog-posts.js.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const CARDS = {
  '10th Annual Coppers and Choppers Draws Record Crowd': {
    text: 'Hundreds of families gathered at the Camarillo Airport Air Unit hangar for helicopter displays, K9 demonstrations, SWAT vehicles, and community connection.',
    link: '/blog/coppers-and-choppers-2025',
  },
  'Shop with a Cop 2025 Brings Joy to Local Children': {
    text: 'Deputies from multiple stations, Explorers, and volunteers paired with children for holiday shopping at Target.',
    link: '/blog/shop-with-a-cop-2025',
  },
  'Sgt. Ron Helus Training Facility Nears Full Operational Capacity': {
    text: 'Advanced live-fire and scenario-based training is now available to all sworn personnel. The Foundation continues to fund equipment and facility enhancements.',
    link: '/blog/helus-training-facility',
  },
  'Grossman Scholarship Applications Open for 2026': {
    text: '$2,500 scholarships are available for high-achieving children and dependents of VCSO employees and deputies.',
    link: '/blog/grossman-scholarship-2026',
  },
};

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'news'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const grid = data.content.find(b => b.props.id === 'CardGrid-news');

  grid.props.items.forEach(item => {
    const fix = CARDS[item.title];
    if (!fix) return;
    item.text = fix.text;
    item.link = fix.link;
    item.linkText = 'Read More →';
  });

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'news' });

  console.log('News page card text shortened and Read More links wired to blog posts.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
