#!/usr/bin/env node
/* =============================================================================
 * fix-support-page-design-gaps.js
 * Closes the gaps found by the import-design audit against website-files/support.html:
 *  - Entire 4-tier Membership pricing grid was missing from the live page
 *  - CTA banner eyebrow was merged into the subtext paragraph
 *  - CTA banner headline needed the serif treatment used elsewhere on the site
 *  - CTA banner should be a boxed, left-aligned card, not full-bleed/centered
 *  - Donation designation dropdown never appeared because `funds` was empty
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const FUNDS = [
  { name: 'Shop with a Cop',                       slug: 'shop-with-a-cop' },
  { name: "Sgt. Ron Helus Training Facility",      slug: 'sgt-ron-helus-training-facility' },
  { name: 'Grossman Scholarship',                  slug: 'grossman-scholarship' },
  { name: 'Coppers and Choppers',                  slug: 'coppers-and-choppers' },
  { name: 'Deputy Equipment & Technology',         slug: 'deputy-equipment-technology' },
];

async function main() {
  for (const f of FUNDS) {
    await db.query(
      'INSERT INTO funds (kind, name, slug, is_active) VALUES (:kind, :name, :slug, 1) ON DUPLICATE KEY UPDATE name = name',
      { kind: 'fund', name: f.name, slug: f.slug }
    );
  }

  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'support'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const byId = id => data.content.find(b => b.props.id === id);
  const idxOf = id => data.content.findIndex(b => b.props.id === id);

  const cta = byId('CTABanner-sponsor');
  cta.props.eyebrow = 'FOR LOCAL BUSINESSES';
  cta.props.eyebrowColor = '#C9A227';
  cta.props.subtext = 'Local businesses are the backbone of our success. Your sponsorship of Shop with a Cop, Coppers and Choppers, or training initiatives provides direct visibility in the community while making a tangible difference in public safety.';
  cta.props.headlineFont = 'serif';
  cta.props.layout = 'boxed';
  cta.props.cardRadius = '24px';
  cta.props.paddingY = '3.5rem';

  const membershipBlock = {
    type: 'MembershipTierGrid',
    props: {
      id: 'MembershipTierGrid-support',
      eyebrow: 'MEMBERSHIP',
      heading: "Join the Ventura County Sheriff's Foundation",
      featuredSlug: 'bronze',
      footnote: 'Allow 4–6 weeks for fulfillment of physical membership materials. Questions? Call (805) 492-4398.',
      submitText: 'Join Now',
      successMessage: 'Welcome! Your membership is active and a receipt has been sent to your email.',
      bgColor: 'transparent',
      cardBgColor: '#ffffff',
      accentColor: '#C9A227',
      headingColor: '#0A1F3D',
      textColor: '#4b5563',
      btnRadius: '16px',
      cardRadius: '24px',
      animation: 'none',
      animDelay: '0',
    },
  };

  const donationIdx = idxOf('DonationCard-11e56970-f97e-40b4-824a-b5686dbb17f7');
  data.content.splice(donationIdx + 1, 0, membershipBlock);

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'support' });

  console.log('Support page design gaps fixed (funds seeded, membership grid added, CTA fixed).');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
