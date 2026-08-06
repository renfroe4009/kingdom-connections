#!/usr/bin/env node
/* =============================================================================
 * rebuild-support-page-components.js
 * Replaces the Support page's RawHTML sections with real, editable Puck
 * components — TextBlock (intro), FormEmbed (donate, now carrying its own
 * heading/subtext so the RawHTML open/close wrapper divs are no longer
 * needed), PricingTable (membership tiers), CTABanner (sponsor CTA).
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'support'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const byId = id => data.content.findIndex(b => b.props.id === id);

  // ── Page intro heading ───────────────────────────────────────────────────
  data.content[byId('RawHTML-header')] = {
    type: 'TextBlock',
    props: {
      id: 'TextBlock-header',
      html: `<h1 style="color:${NAVY};font-size:clamp(2.5rem,5.5vw,3.75rem);letter-spacing:-2px;margin:0;font-family:'Playfair Display',Georgia,serif;font-weight:700;">Support the men and women who protect us.</h1>
<p style="max-width:32rem;margin-top:1rem;font-size:1.125rem;color:#4b5563;">Your partnership directly funds safer deputies, stronger community connections, and brighter futures for the families of those who serve.</p>`,
      maxWidth: '960px', padding: '3rem 1.5rem 1rem', bgColor: '', textColor: '', center: 'left',
      animation: 'none', animDelay: '0',
    },
  };

  // ── Donation form — carries its own heading/subtext now, so the
  // RawHTML-formopen/formclose wrapper divs collapse into this one block ────
  data.content[byId('FormEmbed-donate')] = {
    type: 'FormEmbed',
    props: {
      id: 'FormEmbed-donate',
      formSlug: 'donate',
      heading: 'Make a Donation',
      subtext: "100% of every gift supports grants, training facilities, Shop with a Cop, scholarships, and community events. Designate your gift or let us direct it where it's needed most.",
      bgColor: '#ffffff', textColor: '#1F2937', padding: '2rem 1.5rem 3rem', maxWidth: '960px',
      btnColor: GOLD, btnRadius: '16px', btnTextColor: NAVY,
      animation: 'none', animDelay: '0',
    },
  };
  data.content.splice(byId('RawHTML-formopen'), 1);
  data.content.splice(byId('RawHTML-formclose'), 1);

  // ── Membership tiers ──────────────────────────────────────────────────────
  data.content[byId('RawHTML-membership')] = {
    type: 'PricingTable',
    props: {
      id: 'PricingTable-membership',
      accentColor: GOLD, standardHeaderBg: NAVY, headerTextColor: '#ffffff', priceColor: '',
      cardBodyBg: '#ffffff', featureTextColor: '#4b5563', bulletColor: '', sectionBg: 'transparent',
      noteBgColor: '#f5f5f5', noteTextColor: '#6b7280', cardRadius: '16px', btnRadius: '16px',
      tierNameSize: '1rem', priceSize: '1.75rem', featureSize: '0.875rem',
      modalTitle: 'Join the Ventura County Sheriff\'s Foundation', modalHeaderBg: GOLD,
      tiers: [
        { name: 'Senior Bronze', icon: 'fa-solid fa-id-card', price: '$20/year', featured: 'false', formSlug: '',
          features: 'Personalized membership card\nWindow decal\nRecognition in annual report' },
        { name: 'Bronze', icon: 'fa-solid fa-id-card', price: '$40/year', featured: 'true', formSlug: '',
          features: 'Personalized membership card\n1 window decal\nRecognition in annual report' },
        { name: 'Silver', icon: 'fa-solid fa-award', price: '$110/year', featured: 'false', formSlug: '',
          features: 'Personalized membership card\nSet of window decals\nOfficial badge lapel pin\nRecognition in annual report' },
        { name: 'Gold & Diamond', icon: 'fa-solid fa-gem', price: 'From $250', featured: 'false', formSlug: '',
          features: 'Multiple membership cards\nEnhanced recognition\nSpecial event invitations\nDiamond level from $1,000\nLifetime membership available — inquire for details' },
      ],
      pricingNote: 'Allow 4–6 weeks for fulfillment of physical membership materials. Questions? Call (805) 492-4398.',
    },
  };

  // ── Sponsor CTA ───────────────────────────────────────────────────────────
  data.content[byId('RawHTML-sponsor')] = {
    type: 'CTABanner',
    props: {
      id: 'CTABanner-sponsor',
      headline: 'Sponsor an Event or Program', headlineColor: '#ffffff', headlineSize: '2.5rem',
      subtext: 'FOR LOCAL BUSINESSES — Local businesses are the backbone of our success. Your sponsorship of Shop with a Cop, Coppers and Choppers, or training initiatives provides direct visibility in the community while making a tangible difference in public safety.',
      subtextColor: 'rgba(255,255,255,0.8)', subtextSize: '1rem',
      bgImage: '', bgOverlay: 0.7, bgColor: NAVY, bgDecoration: '', textColor: '#ffffff', btnRadius: '16px',
      btn1Text: 'Discuss Sponsorship Opportunities', btn1Url: '/contact', btn1BgColor: '#ffffff', btn1TextColor: NAVY,
      btn2Text: 'Email Us', btn2Url: 'mailto:admin@vcsheriffsfoundation.org', btn2BgColor: 'transparent', btn2TextColor: '#ffffff',
    },
  };

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'support' });

  console.log('Support page rebuilt with real components:');
  data.content.forEach((b, i) => console.log(` ${i}. ${b.type} (${b.props.id})`));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
