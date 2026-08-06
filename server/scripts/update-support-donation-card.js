#!/usr/bin/env node
/* =============================================================================
 * update-support-donation-card.js
 * Replaces the Support page's generic FormEmbed-donate block with the real
 * DonationCard component (two-column: intro copy + quick-amount donate form),
 * matching the vcsf-redesign reference design. One-off, not idempotent-safe
 * to re-run if the block has since been hand-edited in the builder.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'support'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const idx = data.content.findIndex(b => b.props.id === 'FormEmbed-donate');
  if (idx === -1) { console.error('FormEmbed-donate block not found — already replaced?'); process.exit(1); }

  data.content[idx] = {
    type: 'DonationCard',
    props: {
      id: 'DonationCard-donate',
      eyebrow: 'DIRECT IMPACT',
      heading: 'Make a Donation',
      description: "100% of every gift supports grants, training facilities, Shop with a Cop, scholarships, and community events. Designate your gift or let us direct it where it's needed most.",
      amounts: '25,50,100,250,500',
      designations: [
        { label: 'Where needed most' },
        { label: 'Shop with a Cop' },
        { label: 'Sgt. Ron Helus Training Facility' },
        { label: 'Grossman Scholarship' },
        { label: 'Coppers and Choppers' },
        { label: 'Deputy Equipment & Technology' },
      ],
      showMonthlyOption: 'yes',
      monthlyLabel: 'Make this a monthly recurring gift',
      submitText: 'Donate Securely',
      disclaimerText: 'Payments processed securely. Tax receipt sent automatically.',
      successMessage: 'Thank you! Online donation processing is coming soon — please check back shortly, or call (805) 492-4398 to give by phone.',
      bgColor: '#ffffff',
      sectionBgColor: 'transparent',
      accentColor: '#C9A227',
      headingColor: '#0A1F3D',
      textColor: '#4b5563',
      btnColor: '#C9A227',
      btnTextColor: '#0A1F3D',
      btnRadius: '16px',
      animation: 'none',
      animDelay: '0',
    },
  };

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'support' });

  console.log('Support page donation block replaced:');
  data.content.forEach((b, i) => console.log(` ${i}. ${b.type} (${b.props.id})`));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
