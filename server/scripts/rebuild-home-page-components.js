#!/usr/bin/env node
/* =============================================================================
 * rebuild-home-page-components.js
 * Replaces the Home page's RawHTML sections (hero, programs grid, sponsors,
 * final CTA) with real, editable Puck components — HeroBanner, CardGrid,
 * SponsorLogoGrid, CTABanner — so the page is authorable in the builder
 * instead of being locked inside raw HTML blobs. StatsRow, TwoColumn, and the
 * "ways to help" CardGrid were already real components and are left as-is.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';

async function main() {
  const [rows] = await db.query("SELECT id, original_name, file_url FROM media_files WHERE original_name IN ('1.jpg','2.jpg','3.jpg','4.jpg','9.jpg')");
  const u = {};
  for (const r of rows) u[r.original_name] = r.file_url;

  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'home'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;

  const byId = id => data.content.findIndex(b => b.props.id === id);

  // ── Hero ──────────────────────────────────────────────────────────────────
  data.content[byId('RawHTML-hero')] = {
    type: 'HeroBanner',
    props: {
      id: 'HeroBanner-home',
      eyebrow: "EST. 2005 • 501(c)(3) NONPROFIT",
      eyebrowBg: 'rgba(255,255,255,0.9)', eyebrowColor: NAVY,
      headline: "Supporting Our Deputies.\nStrengthening Our Community.",
      headlineColor: '#ffffff', headlineSize: 'clamp(2.5rem,6vw,4rem)',
      subtext: "The Ventura County Sheriff's Foundation builds meaningful partnerships between the community and the Ventura County Sheriff's Office to enhance public safety across our county.",
      subtextColor: 'rgba(255,255,255,0.9)', subtextSize: '1.25rem',
      bgImage: u['1.jpg'], bgPosition: 'center', bgSize: 'cover', bgColor: NAVY, overlay: 0.6,
      height: '100vh', verticalAlign: 'center', align: 'left',
      ctaText: 'Donate Today', ctaUrl: '/support#donate', ctaColor: GOLD, ctaTextColor: NAVY,
      ctaText2: 'Explore Our Programs →', ctaUrl2: '/programs',
      btnRadius: '12px', animation: 'none', animDelay: '0',
    },
  };

  // ── Programs overview grid (photo cards) ─────────────────────────────────
  data.content[byId('RawHTML-programs')] = {
    type: 'CardGrid',
    props: {
      id: 'CardGrid-programs',
      label: 'WHAT WE DO', heading: 'Programs & Impact',
      headingColor: NAVY, subtext: '', subtextColor: '',
      columns: 4, cardStyle: 'plain', bgColor: '#ffffff',
      cardBg: '#F8F5EF', cardTitleColor: NAVY, cardTextColor: '#4b5563', cardLinkColor: GOLD,
      iconColor: GOLD, btnRadius: '24px', cardTitleSize: '1.25rem',
      animation: 'none', animDelay: '0',
      items: [
        { image: u['2.jpg'], icon: '', title: 'Shop with a Cop', link: '/programs#shop', linkText: 'LEARN MORE →',
          text: 'Annual holiday program pairing deputies with under-resourced children for shopping, meals, and positive relationship building. Record 160 children served in a single year.' },
        { image: u['3.jpg'], icon: '', title: 'Coppers and Choppers', link: '/programs#coppers', linkText: 'LEARN MORE →',
          text: 'Free annual family event at Camarillo Airport showcasing SWAT, K9, Air Unit, Search & Rescue, and more. 10th anniversary in 2025 with hundreds of families attending.' },
        { image: u['4.jpg'], icon: '', title: 'Sgt. Ron Helus Training Facility', link: '/programs#facility', linkText: 'LEARN MORE →',
          text: 'Major investment honoring the legacy of Sgt. Ron Helus (lost in the 2018 Borderline shooting) by delivering advanced, realistic training for modern threats.' },
        { image: u['9.jpg'], icon: '', title: 'Grossman Scholarship & Grants', link: '/programs#scholarship', linkText: 'LEARN MORE →',
          text: '$2,500 scholarships for children of VCSO employees. Plus targeted grants providing equipment, technology, and specialized training directly to our deputies.' },
      ],
    },
  };

  // ── Sponsors strip ────────────────────────────────────────────────────────
  data.content[byId('RawHTML-sponsors')] = {
    type: 'SponsorLogoGrid',
    props: {
      id: 'SponsorLogoGrid-home',
      eyebrow: 'PROUDLY SUPPORTED BY', heading: 'Our Community Partners',
      ctaText: 'Become a sponsor →', ctaUrl: '/support#sponsor',
      bgColor: NAVY, textColor: '#ffffff', columns: 6, grayscaleHover: false,
      footnoteText: '+ DOZENS OF LOCAL BUSINESSES, WINERIES & COMMUNITY ORGANIZATIONS',
      logos: [
        { name: 'TARGET', image: '', url: '' },
        { name: 'AMG THOUSAND OAKS', image: '', url: '' },
        { name: "MASTRO'S", image: '', url: '' },
        { name: "YOUNG'S MARKET", image: '', url: '' },
        { name: 'BUENA VISTA WINERY', image: '', url: '' },
        { name: 'CHICK-FIL-A', image: '', url: '' },
      ],
    },
  };

  // ── Final CTA ─────────────────────────────────────────────────────────────
  data.content[byId('RawHTML-cta')] = {
    type: 'CTABanner',
    props: {
      id: 'CTABanner-home',
      headline: 'Help us continue building a stronger, safer Ventura County.',
      headlineColor: NAVY, headlineSize: '2.5rem',
      subtext: 'EVERY CONTRIBUTION MATTERS', subtextColor: GOLD, subtextSize: '0.9rem',
      bgImage: '', bgOverlay: 0, bgColor: '#F8F5EF', bgDecoration: '', textColor: NAVY, btnRadius: '16px',
      btn1Text: 'Donate Now', btn1Url: '/support#donate', btn1BgColor: GOLD, btn1TextColor: NAVY,
      btn2Text: 'Explore All Ways to Help', btn2Url: '/support', btn2BgColor: 'transparent', btn2TextColor: NAVY,
    },
  };

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'home' });

  console.log('Home page rebuilt with real components:');
  data.content.forEach((b, i) => console.log(` ${i}. ${b.type} (${b.props.id})`));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
