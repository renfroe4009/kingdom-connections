#!/usr/bin/env node
/* =============================================================================
 * rebuild-programs-page-components.js
 * Replaces the Programs page's RawHTML sections with real, editable Puck
 * components (TextBlock, ServicesList "featured" layout, TwoColumn, CTABanner)
 * — same content, same images, now authorable in the builder.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'programs'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const byId = id => data.content.findIndex(b => b.props.id === id);

  // ── Header ────────────────────────────────────────────────────────────────
  data.content[byId('RawHTML-header')] = {
    type: 'TextBlock',
    props: {
      id: 'TextBlock-header',
      html: `<div style="color:${GOLD};text-transform:uppercase;font-size:.75rem;letter-spacing:2px;font-weight:600;">PROGRAMS</div>
<h1 style="color:${NAVY};font-size:clamp(2.5rem,5.5vw,3.75rem);letter-spacing:-1.6px;line-height:1;margin-top:.5rem;font-family:'Playfair Display',Georgia,serif;font-weight:700;">How we support our deputies and community.</h1>`,
      maxWidth: '960px', padding: '3rem 1.5rem 1rem', bgColor: '', textColor: '', center: 'left',
      animation: 'none', animDelay: '0',
    },
  };

  // ── Shop with a Cop / Coppers and Choppers / Training Facility ─────────────
  // (i%2 alternation in ServicesList "featured" naturally matches: text-first,
  // image-first, text-first — exactly matching the original 3 sections.)
  data.content[byId('RawHTML-shop')] = {
    type: 'ServicesList',
    props: {
      id: 'ServicesList-programs',
      heading: '', subheading: '', layout: 'featured', columns: '3',
      services: [
        {
          icon: '', title: 'Shop with a Cop',
          description: "COMMUNITY ENGAGEMENT — Each holiday season, the Ventura County Sheriff's Foundation partners with the VCSO, CHP Ventura, and local businesses to give under-resourced children a memorable shopping experience with a deputy by their side. Children are paired one-on-one with a deputy or explorer for breakfast, photos, and a shopping trip (typically at Target in Camarillo) where they can purchase gifts for themselves and their families. Record year: 160 children served in 2019. The program continues to grow with participation from multiple VCSO stations.",
          price: '', link_url: '/support', link_text: 'Sponsor or donate specifically to Shop with a Cop →',
          image_url: '/api/website/media/file/media/library/2026-07-08/6c3fb45e4d7d50cf86e5bfd76f823eef42300843.jpg',
        },
        {
          icon: '', title: 'Coppers and Choppers',
          description: "SIGNATURE EVENT — Our annual free, family-friendly community day at the Ventura County Sheriff's Air Unit hangar at Camarillo Airport. The 10th annual event was held September 13, 2025. Attendees meet deputies from every specialized unit — K9, SWAT, Search & Rescue, Bomb/Arson, Marine Patrol, Mounted Patrol — and experience helicopter displays, static vehicle displays, food trucks, bounce houses, and hands-on activities. This event has become one of the most beloved public safety community traditions in Ventura County. Next event: September 2026 • Free admission • All ages welcome.",
          price: '', link_url: '', link_text: '',
          image_url: '/api/website/media/file/media/library/2026-07-08/bff80b278927c05e5e69c74eb076c54700cdb11e.jpg',
        },
        {
          icon: '', title: 'Sgt. Ron Helus Training Facility',
          description: "MAJOR CAPITAL PROJECT — Named in honor of Sgt. Ron Helus, who gave his life in the 2018 Borderline Bar & Grill shooting, this live-fire training facility represents the Foundation's largest single investment in deputy safety and readiness. Groundbreaking took place in 2021. The facility provides realistic, high-stress training scenarios that prepare deputies for the complex threats they face in the field — from active shooter response to de-escalation and tactical decision-making. The Foundation also supports the K9 and Mounted Patrol training facilities (barns, arenas, and specialized training areas).",
          price: '', link_url: '', link_text: '',
          image_url: '/api/website/media/file/media/library/2026-07-08/12f9836efe7c2ebc92a091be2664ea9de2b25c48.jpg',
        },
      ],
      bg_color: '#ffffff', text_color: NAVY, accent_color: GOLD, showNumbers: 'no',
      cta_text: '', cta_url: '', anim_type: 'none', anim_delay: '0',
    },
  };

  // Remove the now-merged RawHTML-coppers / RawHTML-facility blocks
  data.content.splice(byId('RawHTML-coppers'), 1);
  data.content.splice(byId('RawHTML-facility'), 1);

  // ── Grossman Scholarship + grants info ──────────────────────────────────────
  const scholarshipIdx = byId('RawHTML-scholarship');
  data.content[scholarshipIdx] = {
    type: 'TwoColumn',
    props: {
      id: 'TwoColumn-scholarship',
      ratio: '2fr 3fr', gap: '3rem', verticalAlign: 'flex-start',
      containerBgColor: '#ffffff', containerBgDecoration: '', containerPadding: '3rem', containerMaxWidth: '1200px',
      leftContent: `<div style="color:${GOLD};font-size:.75rem;letter-spacing:.15em;font-weight:500;">EDUCATION SUPPORT</div><h2 style="color:${NAVY};font-size:2.25rem;letter-spacing:-.5px;margin-top:.5rem;font-family:'Playfair Display',Georgia,serif;font-weight:700;">Grossman Scholarship</h2><p style="margin-top:1.25rem;color:#4b5563;">The Dr. Richard A. Grossman College Scholarship Fund provides $2,500 awards to graduating high school seniors or GED recipients who are the children or dependents of current VCSO employees and sworn deputies in good standing.</p>`,
      leftBgDecoration: '', leftBgImage: '', leftBgColor: '', leftOverlay: 0.4, leftTextColor: '',
      leftPadding: '0', leftMinHeight: '', leftBgPosition: 'center center',
      rightContent: `<div style="font-size:.875rem;color:#4b5563;line-height:1.7;"><p><strong>Eligibility:</strong> Minimum 3.0 GPA. Preference given to prior recipients. Applicants must submit a 300–500 word essay describing how being the son or daughter of a VCSO deputy or employee has influenced them.</p><p style="margin-top:.75rem;">Applications are processed through the Ventura County Community Foundation (VCCF) AcademicWorks portal.</p><div style="margin-top:1.5rem;"><a href="https://vccf.academicworks.com/opportunities/3501" target="_blank" rel="noopener" style="font-weight:600;color:${NAVY};text-decoration:none;">Apply for the Grossman Scholarship ↗</a></div><div style="height:1px;background:#e5e7eb;margin:1.75rem 0;"></div><div><div style="font-weight:600;color:${NAVY};">Grants to the Ventura County Sheriff's Office</div><p style="margin-top:.25rem;">The Foundation provides grants exclusively to VCSO for equipment, technology upgrades, specialized training, and community programs. Grant applications are submitted internally by the Sheriff's Office.</p><a href="/applications" style="display:inline-block;margin-top:.5rem;font-size:.875rem;font-weight:500;color:${GOLD};text-decoration:none;">View grant guidelines &amp; application process →</a></div></div>`,
      rightBgDecoration: '', rightBgImage: '', rightBgColor: '', rightOverlay: 0.4, rightTextColor: '',
      rightPadding: '0', rightMinHeight: '', rightBgPosition: 'center center',
      leftHtml: '', rightHtml: '', leftImage: '', rightImage: '',
      animation: 'none', animDelay: '0',
    },
  };

  // ── Closing CTA ───────────────────────────────────────────────────────────
  data.content.splice(scholarshipIdx + 1, 0, {
    type: 'CTABanner',
    props: {
      id: 'CTABanner-programs',
      headline: 'Support These Programs', headlineColor: NAVY, headlineSize: '1.5rem',
      subtext: '100% of donations go directly to these initiatives', subtextColor: '#6b7280', subtextSize: '0.9rem',
      bgImage: '', bgOverlay: 0.7, bgColor: 'transparent', bgDecoration: '', textColor: NAVY, btnRadius: '16px',
      btn1Text: 'Support These Programs', btn1Url: '/support', btn1BgColor: GOLD, btn1TextColor: NAVY,
      btn2Text: '', btn2Url: '', btn2BgColor: 'transparent', btn2TextColor: NAVY,
    },
  });

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'programs' });

  console.log('Programs page rebuilt with real components:');
  data.content.forEach((b, i) => console.log(` ${i}. ${b.type} (${b.props.id})`));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
