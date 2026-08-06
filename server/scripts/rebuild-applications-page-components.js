#!/usr/bin/env node
/* =============================================================================
 * rebuild-applications-page-components.js
 * Replaces the Applications page's RawHTML block with a real, editable
 * CardGrid (intro heading/subtext + the 2 process cards) plus a closing
 * TextBlock for the disclaimer paragraph.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'applications'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const byId = id => data.content.findIndex(b => b.props.id === id);

  const appsIdx = byId('RawHTML-apps');
  data.content[appsIdx] = {
    type: 'CardGrid',
    props: {
      id: 'CardGrid-applications',
      label: '', heading: 'Applications',
      headingColor: NAVY,
      subtext: "The Ventura County Sheriff's Foundation supports two primary application processes: grants to the Sheriff's Office and the Grossman Scholarship for deputy families.",
      subtextColor: '#4b5563',
      columns: 2, cardStyle: 'bordered', bgColor: '#F8F5EF',
      cardBg: '#ffffff', cardTitleColor: NAVY, cardTextColor: '#4b5563', cardLinkColor: GOLD,
      iconColor: GOLD, btnRadius: '16px', cardTitleSize: '1.5rem',
      animation: 'none', animDelay: '0',
      items: [
        {
          image: '', icon: '', title: 'Grant Applications',
          text: "FOR THE VENTURA COUNTY SHERIFF'S OFFICE — The Foundation awards grants exclusively to the Ventura County Sheriff's Office for equipment, technology upgrades, specialized training, and community programs that enhance public safety. Grant applications are submitted internally by VCSO command staff. If you are a deputy or supervisor with a project that aligns with our mission, please coordinate through your chain of command. Contact admin@vcsheriffsfoundation.org for questions about the grant process.",
          link: '', linkText: '',
        },
        {
          image: '', icon: '', title: 'Grossman Scholarship',
          text: '$2,500 awards for graduating high school seniors and GED recipients who are the children or legal dependents of current Ventura County Sheriff\'s Office employees or sworn deputies in good standing. Minimum 3.0 GPA. 300–500 word essay required on the influence of having a parent/guardian in VCSO. Deadline for the current cycle: January 16, 2026.',
          link: 'https://vccf.academicworks.com/opportunities/3501', linkText: 'Apply via Ventura County Community Foundation →',
        },
      ],
    },
  };

  data.content.splice(appsIdx + 1, 0, {
    type: 'TextBlock',
    props: {
      id: 'TextBlock-applications-note',
      html: `<p style="font-size:.875rem;color:#4b5563;">The Foundation does not accept grant applications from individuals, other nonprofits, or the general public. All grants are directed exclusively to the Ventura County Sheriff's Office.</p>`,
      maxWidth: '1200px', padding: '0 1.5rem 3rem', bgColor: '#F8F5EF', textColor: '', center: 'left',
      animation: 'none', animDelay: '0',
    },
  });

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'applications' });

  console.log('Applications page rebuilt with real components:');
  data.content.forEach((b, i) => console.log(` ${i}. ${b.type} (${b.props.id})`));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
