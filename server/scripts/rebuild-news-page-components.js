#!/usr/bin/env node
/* =============================================================================
 * rebuild-news-page-components.js
 * Replaces the News page's RawHTML card grid with a real, editable Timeline
 * component (vertical layout) — same 4 dated recaps, now authorable in the
 * builder instead of locked inside a raw HTML blob.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'news'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const byId = id => data.content.findIndex(b => b.props.id === id);

  data.content[byId('RawHTML-news')] = {
    type: 'Timeline',
    props: {
      id: 'Timeline-news',
      // Vertical layout hardcodes white/light-slate text meant for a dark
      // card background — keep bgColor dark (matches site navy) so titles
      // and descriptions stay legible instead of washing out on a light bg.
      eyebrow: '', heading: 'News & Event Recaps', subtext: '',
      headingColor: '#ffffff', subtextColor: '', bgColor: NAVY, accentColor: GOLD, layout: 'vertical',
      milestones: [
        { phase: 'SEPTEMBER 2025', title: '10th Annual Coppers and Choppers Draws Record Crowd', status: 'done',
          desc: "The 10th anniversary of Coppers and Choppers welcomed hundreds of families to the Sheriff's Air Unit at Camarillo Airport. Highlights included walk-around tours of Copter 5 (Firehawk), K9 demonstrations, SWAT and bomb squad vehicles, Search & Rescue displays, food trucks, and children's activities. The event remains completely free thanks to the generous support of sponsors and the Foundation.", img: '' },
        { phase: 'DECEMBER 2025', title: 'Shop with a Cop 2025 Brings Joy to Local Children', status: 'done',
          desc: "Deputies and Explorers from stations across the county spent the day shopping with children facing financial hardship. Each child received breakfast, a photo with their deputy, and the opportunity to purchase gifts. The program, supported entirely by donations and sponsors such as Target and local restaurants, continues to build trust between law enforcement and the community's youngest residents.", img: '' },
        { phase: '2024 — 2025', title: 'Sgt. Ron Helus Training Facility Nears Full Operational Capacity', status: 'done',
          desc: 'The live-fire training complex named in memory of Sgt. Ron Helus is now delivering advanced tactical and decision-making training to deputies county-wide. The Foundation remains committed to ongoing equipment and facility upgrades so that every deputy has access to the best possible preparation for the challenges of modern policing.', img: '' },
        { phase: 'JANUARY 2026', title: 'Grossman Scholarship Applications Open for 2026', status: 'done',
          desc: 'The Dr. Richard A. Grossman College Scholarship ($2,500) is available to graduating seniors and GED recipients who are the dependents of current VCSO employees or sworn personnel. A 300–500 word essay is required. Applications are submitted through the Ventura County Community Foundation portal.', img: '' },
      ],
    },
  };

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'news' });

  console.log('News page rebuilt with real components:');
  data.content.forEach((b, i) => console.log(` ${i}. ${b.type} (${b.props.id})`));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
