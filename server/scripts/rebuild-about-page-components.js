#!/usr/bin/env node
/* =============================================================================
 * rebuild-about-page-components.js
 * Replaces the About page's RawHTML sections with real, editable Puck
 * components (HeroBanner, TextBlock, TwoColumn, Testimonials) — same content,
 * same images, now authorable in the builder. CardGrid-values was already a
 * real component and is left as-is.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'about'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const byId = id => data.content.findIndex(b => b.props.id === id);

  // ── Hero ──────────────────────────────────────────────────────────────────
  data.content[byId('RawHTML-hero')] = {
    type: 'HeroBanner',
    props: {
      id: 'HeroBanner-about',
      eyebrow: 'OUR STORY', eyebrowBg: 'rgba(255,255,255,0.9)', eyebrowColor: NAVY,
      headline: 'A legacy of service and partnership.',
      headlineColor: '#ffffff', headlineSize: 'clamp(2.5rem,5vw,3.75rem)',
      subtext: '', subtextColor: 'rgba(255,255,255,0.9)', subtextSize: '1.1rem',
      bgImage: '/api/website/media/file/media/library/2026-07-08/d20e9998c44121a817ef175701c3ed4937ab3299.jpg',
      bgPosition: 'center', bgSize: 'cover', bgColor: NAVY, overlay: 0.55,
      height: '420px', verticalAlign: 'center', align: 'left',
      ctaText: '', ctaUrl: '#', ctaColor: GOLD, ctaTextColor: '#ffffff',
      ctaText2: '', ctaUrl2: '#', btnRadius: '50px', animation: 'none', animDelay: '0',
    },
  };

  // ── Intro prose (Established 2005 + mission statement paragraphs) ──────────
  const introIdx = byId('RawHTML-intro');
  data.content[introIdx] = {
    type: 'TextBlock',
    props: {
      id: 'TextBlock-intro',
      html: `<div style="color:${GOLD};font-size:.75rem;letter-spacing:2.5px;font-weight:500;">ESTABLISHED 2005</div>
<h2 style="color:${NAVY};font-size:clamp(2rem,4.5vw,3rem);letter-spacing:-1.5px;margin:.5rem 0 0;line-height:1;font-family:'Playfair Display',Georgia,serif;font-weight:700;">Independent. Focused. Dedicated to one mission.</h2>
<div style="margin-top:2rem;font-size:15.2px;color:#4b5563;line-height:1.75;">
<p>The Ventura County Sheriff's Foundation is an independent 501(c)(3) nonprofit organization with the sole objective to support the Ventura County Sheriff's Office (VCSO). Tax ID #20-3780163.</p>
<p>We build community partnerships to enhance public safety in Ventura County through grants for equipment and technology, specialized training, scholarships for the families of our deputies, and signature community engagement programs that humanize law enforcement and create lasting positive relationships.</p>
</div>`,
      maxWidth: '960px', padding: '4rem 1.5rem', bgColor: '', textColor: '', center: 'left',
      animation: 'none', animDelay: '0',
    },
  };

  // ── Mission / Vision two-tone cards ─────────────────────────────────────────
  data.content.splice(introIdx + 1, 0, {
    type: 'TwoColumn',
    props: {
      id: 'TwoColumn-mission-vision',
      ratio: '1fr 1fr', gap: '1.5rem', verticalAlign: 'flex-start',
      containerBgColor: '', containerBgDecoration: '', containerPadding: '0 1.5rem 4rem', containerMaxWidth: '960px',
      leftContent: `<div style="color:${GOLD};font-size:.875rem;font-weight:600;letter-spacing:.15em;">OUR MISSION</div><p style="margin-top:1.25rem;font-size:1.25rem;line-height:1.35;">"The Ventura County Sheriff's Foundation is an independent nonprofit 501(c)(3) organization with a sole objective to support the Ventura County Sheriff's Office (VCSO). The Foundation seeks to build community partnerships to enhance public safety in Ventura County with the support of individuals, families and businesses."</p>`,
      leftBgDecoration: '', leftBgImage: '', leftBgColor: '#ffffff', leftOverlay: 0.4, leftTextColor: '#1F2937',
      leftPadding: '2.25rem', leftMinHeight: '', leftBgPosition: 'center center',
      rightContent: `<div style="color:${GOLD};font-size:.875rem;font-weight:600;letter-spacing:.15em;">OUR VISION</div><p style="margin-top:1.25rem;font-size:1.5rem;line-height:1.3;">To serve as the trusted conduit between the residents of Ventura County and the dedicated men and women of the Ventura County Sheriff's Office.</p><div style="font-size:.875rem;color:rgba(255,255,255,.6);margin-top:2rem;">Every program, every grant, and every event exists to strengthen that bond.</div>`,
      rightBgDecoration: '', rightBgImage: '', rightBgColor: NAVY, rightOverlay: 0.4, rightTextColor: '#ffffff',
      rightPadding: '2.25rem', rightMinHeight: '', rightBgPosition: 'center center',
      leftHtml: '', rightHtml: '', leftImage: '', rightImage: '',
      animation: 'none', animDelay: '0',
    },
  });

  // ── Defining moment / Sgt. Ron Helus legacy ─────────────────────────────────
  data.content[byId('RawHTML-history')] = {
    type: 'TwoColumn',
    props: {
      id: 'TwoColumn-history',
      ratio: '2fr 3fr', gap: '3.5rem', verticalAlign: 'flex-start',
      containerBgColor: '#ffffff', containerBgDecoration: '', containerPadding: '4rem 1.5rem', containerMaxWidth: '1200px',
      leftContent: `<div style="text-transform:uppercase;font-size:.75rem;letter-spacing:2px;font-weight:600;color:${GOLD};">A DEFINING MOMENT</div><h3 style="color:${NAVY};font-size:2.25rem;letter-spacing:-.5px;margin-top:.75rem;font-family:'Playfair Display',Georgia,serif;font-weight:700;">The Borderline Shooting &amp; the Sgt. Ron Helus Legacy</h3>`,
      leftBgDecoration: '', leftBgImage: '', leftBgColor: '', leftOverlay: 0.4, leftTextColor: '',
      leftPadding: '0', leftMinHeight: '', leftBgPosition: 'center center',
      rightContent: `<div style="color:#4b5563;font-size:15px;line-height:1.75;"><p>On November 7, 2018, Sgt. Ron Helus — a 29-year veteran of the Ventura County Sheriff's Office, SWAT member, and FBI-certified firearms instructor — was killed in the line of duty while responding to the mass shooting at the Borderline Bar &amp; Grill in Thousand Oaks.</p><p>In the years that followed, the Foundation made it a central mission to honor Sgt. Helus's legacy by dramatically improving realistic, high-quality training for every deputy in Ventura County. The result is the Sgt. Ron Helus Training Facility — a state-of-the-art live-fire training complex that prepares our deputies for the threats they face today.</p><p style="font-size:.875rem;font-weight:500;color:${NAVY};">This facility, along with continued support for K9 and Mounted Patrol training areas, stands as a permanent tribute to his sacrifice and our ongoing commitment to the safety of both our deputies and the public they serve.</p></div>`,
      rightBgDecoration: '', rightBgImage: '', rightBgColor: '', rightOverlay: 0.4, rightTextColor: '',
      rightPadding: '0', rightMinHeight: '', rightBgPosition: 'center center',
      leftHtml: '', rightHtml: '', leftImage: '', rightImage: '',
      animation: 'none', animDelay: '0',
    },
  };

  // ── Closing quote ─────────────────────────────────────────────────────────
  data.content[byId('RawHTML-quote')] = {
    type: 'Testimonials',
    props: {
      id: 'Testimonials-about',
      heading: '', subtext: '', layout: 'grid', columns: '1',
      items: [
        { quote: 'The Foundation gives our community a direct way to say thank you and to invest in the safety of the people who protect us every day.', author: 'Longtime VCSF Supporter & Local Business Owner', role: '', avatar: '', rating: 0, tags: '' },
      ],
      bgColor: NAVY, cardBg: '#0A1F3D', textColor: '#ffffff', accentColor: GOLD, padding: '3.5rem 2rem',
      animation: 'none', animDelay: '0',
    },
  };

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'about' });

  console.log('About page rebuilt with real components:');
  data.content.forEach((b, i) => console.log(` ${i}. ${b.type} (${b.props.id})`));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
