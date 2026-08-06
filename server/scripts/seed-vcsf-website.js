#!/usr/bin/env node
/* =============================================================================
 * seed-vcsf-website.js
 * Seeds the VCSF website into the CRM: media library images, global settings,
 * forms (contact + donate), and all 8 website pages built from the new design
 * in website-files/.
 *
 * Run from the server/ directory on the machine that hosts the DB:
 *   cd server && node scripts/seed-vcsf-website.js
 *
 * Idempotent — safe to re-run (replaces previously seeded VCSF rows).
 * Uses the storage service, so it works with STORAGE_DRIVER=local now and
 * the vcsf-media R2 bucket later (re-run after switching drivers).
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const { db } = require('../src/db');
const storage = require('../src/services/storage');
let sharp; try { sharp = require('sharp'); } catch { sharp = null; }

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';
const CREAM = '#F8F5EF';

const IMG_DIR = path.join(__dirname, '..', '..', 'website-files', 'images');

// name → { file, alt, webp: convert to webp? }
const IMAGES = {
  hero:        { file: '1.jpg', alt: 'Ventura County deputies serving the community' },
  shopcop:     { file: '2.jpg', alt: 'Deputies helping children shop for holiday gifts during Shop with a Cop' },
  choppers:    { file: '3.jpg', alt: 'Coppers and Choppers community event with helicopter and families' },
  facility:    { file: '4.jpg', alt: 'Sgt. Ron Helus Training Facility live-fire range' },
  community1:  { file: '5.jpg', alt: 'Community members at a VCSF event' },
  merch:       { file: '6.jpg', alt: 'Backing the Badge yard sign' },
  abouthero:   { file: '7.jpg', alt: 'Ventura County Sheriff Office deputies' },
  apparel:     { file: '8.jpg', alt: 'VCSF embroidered apparel and merchandise' },
  scholarship: { file: '9.jpg', alt: 'Scholarship recipient with deputy parent' },
  logoHeader:  { file: 'logo-header.png',  alt: 'VCSF logo (navy text)', raw: true },
  logoFooter:  { file: 'logo-footer.png',  alt: 'VCSF logo (white/reversed)', raw: true },
  logoEmblem:  { file: 'vcsf_logo_emblem.png', alt: 'VCSF emblem', raw: true },
  favicon32:   { file: 'favicon-star-32.png',  alt: 'VCSF favicon 32', raw: true },
  favicon180:  { file: 'favicon-star-180.png', alt: 'VCSF favicon 180', raw: true },
  favicon512:  { file: 'favicon-star-512.png', alt: 'VCSF favicon 512', raw: true },
};

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function url(key) {
  return storage.getPublicUrl(key) || `/api/website/media/file/${key}`;
}

/* ── Shared page CSS (per-page custom_css) ─────────────────────────────────── */
const PAGE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap');
.spa-puck-page{background:${CREAM};font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1F2937;}
.heading-serif{font-family:'Playfair Display',Georgia,serif;font-weight:700;line-height:1.1;}
.prose-custom p{margin-bottom:1.25rem;line-height:1.75;}
.btn-gold{background-color:${GOLD};color:${NAVY};font-weight:600;text-decoration:none;display:inline-block;transition:all .2s cubic-bezier(.4,0,.2,1);}
.btn-gold:hover{background-color:#A07F1A;color:${NAVY};transform:translateY(-1px);box-shadow:0 10px 15px -3px rgb(0 0 0/.1);}
.btn-navy{background-color:${NAVY};color:#fff;font-weight:600;text-decoration:none;display:inline-block;transition:all .2s ease;}
.btn-navy:hover{background-color:#122A4A;color:#fff;transform:translateY(-1px);}
.btn-outline-w{background:transparent;border:2px solid #fff;color:#fff;font-weight:600;text-decoration:none;display:inline-block;transition:all .2s ease;}
.btn-outline-w:hover{background:#fff;color:${NAVY};}
.btn-outline-n{background:transparent;border:1px solid ${NAVY};color:${NAVY};font-weight:600;text-decoration:none;display:inline-block;transition:all .2s ease;}
.btn-outline-n:hover{background:#f3f4f6;color:${NAVY};}
.vcsf-card{transition:transform .3s cubic-bezier(.4,0,.2,1),box-shadow .3s cubic-bezier(.4,0,.2,1);}
.vcsf-card:hover{transform:translateY(-8px);box-shadow:0 20px 25px -5px rgb(0 0 0/.1),0 8px 10px -6px rgb(0 0 0/.1);}
.vcsf-eyebrow{text-transform:uppercase;letter-spacing:2px;font-size:.75rem;font-weight:600;color:${GOLD};}
.vcsf-container{max-width:1280px;margin:0 auto;padding-left:1.5rem;padding-right:1.5rem;}
`;

/* ── HTML section builders (u = image url map) ─────────────────────────────── */
function homePage(u) {
  const hero = `
<section style="min-height:640px;height:92vh;display:flex;align-items:center;background-image:linear-gradient(to bottom,rgba(10,31,61,.65) 0%,rgba(10,31,61,.55) 40%,rgba(10,31,61,.75) 100%),url('${u.hero}');background-size:cover;background-position:center;">
  <div class="vcsf-container" style="width:100%;">
    <div style="max-width:760px;">
      <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.9);backdrop-filter:blur(4px);padding:.35rem 1rem;border-radius:999px;font-size:.72rem;font-weight:600;letter-spacing:.15em;color:${NAVY};margin-bottom:1.5rem;">EST. 2005 • 501(c)(3) NONPROFIT</div>
      <h1 class="heading-serif" style="color:#fff;font-size:clamp(2.8rem,6vw,4.5rem);letter-spacing:-2px;margin:0 0 1.5rem;">Supporting Our Deputies.<br>Strengthening Our Community.</h1>
      <p style="max-width:520px;font-size:1.25rem;color:rgba(255,255,255,.9);margin:0 0 2.25rem;line-height:1.6;">The Ventura County Sheriff's Foundation builds meaningful partnerships between the community and the Ventura County Sheriff's Office to enhance public safety across our county.</p>
      <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;">
        <a href="/support#donate" class="btn-gold" style="padding:1rem 2.25rem;border-radius:.75rem;font-size:1rem;box-shadow:0 10px 15px -3px rgb(0 0 0/.2);">Donate Today</a>
        <a href="/programs" class="btn-outline-w" style="padding:1rem 2rem;border-radius:.75rem;font-size:1rem;">Explore Our Programs →</a>
      </div>
      <div style="margin-top:2rem;display:flex;align-items:center;gap:2rem;color:rgba(255,255,255,.8);font-size:.9rem;">
        <div style="display:flex;">
          <div style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.6);overflow:hidden;background:#fff;"><img src="${u.abouthero}" style="width:100%;height:100%;object-fit:cover;" alt=""></div>
          <div style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.6);overflow:hidden;background:#fff;margin-left:-8px;"><img src="${u.community1}" style="width:100%;height:100%;object-fit:cover;" alt=""></div>
          <div style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.6);overflow:hidden;background:#fff;margin-left:-8px;"><img src="${u.shopcop}" style="width:100%;height:100%;object-fit:cover;" alt=""></div>
        </div>
        <div>Trusted by thousands of families and local businesses</div>
      </div>
    </div>
  </div>
</section>`;

  const programCard = (href, img, alt, title, text) => `
<a href="${href}" class="vcsf-card" style="display:flex;flex-direction:column;background:${CREAM};border-radius:1.5rem;overflow:hidden;text-decoration:none;">
  <div style="height:14rem;overflow:hidden;"><img src="${img}" alt="${alt}" style="width:100%;height:100%;object-fit:cover;"></div>
  <div style="padding:1.5rem;display:flex;flex-direction:column;flex:1;">
    <div style="font-weight:600;font-size:1.25rem;color:${NAVY};margin-bottom:.5rem;">${title}</div>
    <p style="font-size:.875rem;color:#4b5563;flex:1;margin:0;line-height:1.6;">${text}</p>
    <div style="margin-top:1.25rem;font-size:.75rem;font-weight:500;color:${GOLD};">LEARN MORE →</div>
  </div>
</a>`;

  const programs = `
<section style="background:#fff;padding:4rem 0;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
  <div class="vcsf-container">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:2.5rem;flex-wrap:wrap;gap:1rem;">
      <div>
        <div class="vcsf-eyebrow" style="margin-bottom:.5rem;">WHAT WE DO</div>
        <h2 style="font-size:2.25rem;font-weight:700;color:${NAVY};letter-spacing:-.5px;margin:0;">Programs &amp; Impact</h2>
      </div>
      <a href="/programs" style="font-size:.875rem;font-weight:600;color:${NAVY};text-decoration:none;">VIEW ALL PROGRAMS →</a>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1.5rem;">
      ${programCard('/programs#shop', u.shopcop, 'Shop with a Cop', 'Shop with a Cop', 'Annual holiday program pairing deputies with under-resourced children for shopping, meals, and positive relationship building. Record 160 children served in a single year.')}
      ${programCard('/programs#coppers', u.choppers, 'Coppers and Choppers', 'Coppers and Choppers', 'Free annual family event at Camarillo Airport showcasing SWAT, K9, Air Unit, Search &amp; Rescue, and more. 10th anniversary in 2025 with hundreds of families attending.')}
      ${programCard('/programs#facility', u.facility, 'Sgt. Ron Helus Training Facility', 'Sgt. Ron Helus Training Facility', 'Major investment honoring the legacy of Sgt. Ron Helus (lost in the 2018 Borderline shooting) by delivering advanced, realistic training for modern threats.')}
      ${programCard('/programs#scholarship', u.scholarship, 'Grossman Scholarship', 'Grossman Scholarship &amp; Grants', '$2,500 scholarships for children of VCSO employees. Plus targeted grants providing equipment, technology, and specialized training directly to our deputies.')}
    </div>
  </div>
</section>`;

  const sponsors = `
<section style="background:${NAVY};padding:3rem 0;">
  <div class="vcsf-container">
    <div style="display:flex;justify-content:center;margin-bottom:1.5rem;"><img src="${u.logoFooter}" alt="Ventura County Sheriff's Foundation" style="height:2.5rem;width:auto;opacity:.95;"></div>
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1.5rem;margin-bottom:2rem;">
      <div>
        <div style="color:${GOLD};text-transform:uppercase;font-size:.75rem;letter-spacing:2.5px;font-weight:600;">PROUDLY SUPPORTED BY</div>
        <div style="color:#fff;font-size:1.875rem;letter-spacing:-.5px;font-weight:600;margin-top:.25rem;">Our Community Partners</div>
      </div>
      <a href="/support#sponsor" style="font-size:.875rem;color:${GOLD};font-weight:500;text-decoration:none;">Become a sponsor →</a>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:2rem 1.5rem;text-align:center;">
      ${['TARGET','AMG THOUSAND OAKS',"MASTRO'S","YOUNG'S MARKET",'BUENA VISTA WINERY','CHICK-FIL-A'].map(sp => `<div style="color:rgba(255,255,255,.7);font-size:.875rem;font-weight:500;letter-spacing:.05em;padding:.25rem 0;">${sp}</div>`).join('')}
    </div>
    <div style="text-align:center;font-size:10px;color:rgba(255,255,255,.5);margin-top:1.25rem;letter-spacing:.2em;">+ DOZENS OF LOCAL BUSINESSES, WINERIES &amp; COMMUNITY ORGANIZATIONS</div>
  </div>
</section>`;

  const finalCta = `
<section style="padding:4rem 1.5rem;text-align:center;">
  <div style="max-width:36rem;margin:0 auto;">
    <div style="color:${GOLD};font-size:.75rem;letter-spacing:3px;font-weight:600;margin-bottom:.75rem;">EVERY CONTRIBUTION MATTERS</div>
    <h3 style="font-size:2.25rem;letter-spacing:-1px;font-weight:600;color:${NAVY};margin:0;">Help us continue building a stronger, safer Ventura County.</h3>
    <div style="display:flex;flex-wrap:wrap;gap:1rem;justify-content:center;margin-top:2rem;">
      <a href="/support#donate" class="btn-gold" style="padding:1rem 2.5rem;border-radius:1rem;font-size:1rem;">Donate Now</a>
      <a href="/support" class="btn-outline-n" style="padding:1rem 2.5rem;border-radius:1rem;font-size:1rem;border-width:2px;">Explore All Ways to Help</a>
    </div>
    <p style="margin-top:1.25rem;font-size:.75rem;color:#6b7280;">Your gift is tax-deductible. Questions? Call us at (805) 492-4398</p>
  </div>
</section>`;

  return {
    title: 'Home', slug: 'home', status: 'published',
    meta_title: "Ventura County Sheriff's Foundation | Supporting Our Deputies, Strengthening Our Community",
    meta_desc: "The Ventura County Sheriff's Foundation (VCSF) is an independent 501(c)(3) nonprofit building community partnerships to enhance public safety and support the Ventura County Sheriff's Office.",
    meta_keywords: "Ventura County Sheriff's Foundation, VCSF, VCSO, Shop with a Cop, Coppers and Choppers, Sgt. Ron Helus Training Facility, Grossman Scholarship",
    og_image: u.hero,
    custom_css: PAGE_CSS,
    puck_data: {
      root: { props: { pageTitle: "Ventura County Sheriff's Foundation" } },
      zones: {},
      content: [
        { type: 'RawHTML', props: { id: 'RawHTML-hero', code: hero } },
        { type: 'StatsRow', props: {
          id: 'StatsRow-impact',
          items: [
            { value: '160', prefix: '', suffix: '+', label: 'CHILDREN SUPPORTED IN A SINGLE SHOP WITH A COP EVENT' },
            { value: '10',  prefix: '', suffix: '',  label: 'YEARS OF COPPERS & CHOPPERS FAMILY COMMUNITY EVENTS' },
            { value: '2,500', prefix: '$', suffix: '', label: 'GROSSMAN SCHOLARSHIPS AWARDED TO DEPUTY FAMILIES' },
            { value: '100', prefix: '', suffix: '%', label: 'OF PROCEEDS SUPPORT VENTURA COUNTY DEPUTIES' },
          ],
          bgColor: '#ffffff', textColor: NAVY, labelColor: '#6b7280', padding: '3rem 2rem', divider: 'line',
        }},
        { type: 'TwoColumn', props: {
          id: 'TwoColumn-mission',
          ratio: '3fr 2fr', gap: '3rem', verticalAlign: 'center',
          containerBgColor: CREAM, containerPadding: '5rem 0', containerMaxWidth: '1280px', containerBgDecoration: '',
          leftContent: `<div class="vcsf-eyebrow" style="margin-bottom:.75rem;">OUR MISSION</div><h2 class="heading-serif" style="color:${NAVY};font-size:clamp(2rem,4vw,3rem);letter-spacing:-1px;margin:0 0 2rem;">Building community partnerships to enhance public safety in Ventura County.</h2><div class="prose-custom" style="font-size:15.5px;color:#4b5563;max-width:46ch;"><p>The Ventura County Sheriff's Foundation is an independent 501(c)(3) nonprofit organization with the sole objective to support the Ventura County Sheriff's Office (VCSO).</p><p>We seek to build community partnerships to enhance public safety in Ventura County with the support of individuals, families, and businesses.</p></div><a href="/about" style="display:inline-flex;align-items:center;font-weight:600;font-size:.875rem;color:${NAVY};text-decoration:none;margin-top:1rem;">LEARN MORE ABOUT OUR STORY <span style="margin-left:.5rem;">→</span></a>`,
          leftBgDecoration: '', leftBgImage: '', leftBgColor: '', leftOverlay: 0, leftTextColor: '', leftPadding: '0', leftMinHeight: '', leftBgPosition: 'center center',
          rightContent: `<div style="background:${NAVY};color:#fff;padding:2.25rem;border-radius:1.5rem;"><div style="color:${GOLD};font-size:.75rem;letter-spacing:2px;font-weight:500;margin-bottom:1.25rem;">OUR VISION</div><p style="font-size:1.5rem;line-height:1.3;margin:0;">To serve as the trusted conduit between the residents of Ventura County and the dedicated men and women of the Ventura County Sheriff's Office.</p><div style="height:1px;background:rgba(255,255,255,.2);margin:2rem 0;"></div><div style="font-size:.875rem;"><div style="font-weight:600;">Every dollar</div><div style="color:rgba(255,255,255,.7);">directly supports our deputies and community programs</div></div></div>`,
          rightBgDecoration: '', rightBgImage: '', rightBgColor: '', rightOverlay: 0, rightTextColor: '', rightPadding: '0', rightMinHeight: '', rightBgPosition: 'center center',
          animation: 'none', animDelay: '0',
        }},
        { type: 'RawHTML', props: { id: 'RawHTML-programs', code: programs } },
        { type: 'CardGrid', props: {
          id: 'CardGrid-help',
          label: 'GET INVOLVED',
          heading: 'There are many ways to stand with our deputies.',
          headingColor: NAVY, subtext: '', subtextColor: '',
          columns: 3, cardStyle: 'bordered', bgColor: CREAM,
          cardBg: '#ffffff', cardTitleColor: NAVY, cardTextColor: '#4b5563', cardLinkColor: GOLD,
          iconColor: GOLD, btnRadius: '12px', cardTitleSize: '1.5rem',
          animation: 'none', animDelay: '0',
          items: [
            { icon: 'fa-solid fa-hand-holding-dollar', title: 'Make a Donation', text: '100% of your gift supports grants, training, Shop with a Cop, scholarships, and equipment for the men and women who protect our community.', link: '/support#donate', linkText: 'GIVE NOW →' },
            { icon: 'fa-solid fa-id-card', title: 'Become a Member', text: 'Join at Bronze, Silver, or higher levels. Receive an official membership card, decals, lapel pin, and the satisfaction of directly backing our local deputies year-round.', link: '/support#membership', linkText: 'JOIN TODAY →' },
            { icon: 'fa-solid fa-handshake', title: 'Sponsor an Event', text: 'Local businesses play a vital role. Sponsor Shop with a Cop, Coppers and Choppers, or training initiatives and receive prominent recognition across our community.', link: '/support#sponsor', linkText: 'BECOME A SPONSOR →' },
          ],
        }},
        { type: 'RawHTML', props: { id: 'RawHTML-sponsors', code: sponsors } },
        { type: 'RawHTML', props: { id: 'RawHTML-cta', code: finalCta } },
      ],
    },
  };
}

function aboutPage(u) {
  const hero = `
<section style="height:420px;position:relative;display:flex;align-items:center;background-image:linear-gradient(to right,rgba(10,31,61,.8),rgba(10,31,61,.4)),url('${u.abouthero}');background-size:cover;background-position:center;">
  <div class="vcsf-container" style="width:100%;">
    <div style="max-width:32rem;">
      <div class="vcsf-eyebrow" style="font-size:.875rem;margin-bottom:.75rem;">OUR STORY</div>
      <h1 class="heading-serif" style="color:#fff;font-size:clamp(2.5rem,5vw,3.75rem);letter-spacing:-2px;margin:0;">A legacy of service and partnership.</h1>
    </div>
  </div>
</section>`;

  const intro = `
<div class="vcsf-container" style="padding-top:4rem;padding-bottom:4rem;">
  <div style="max-width:48rem;">
    <div style="color:${GOLD};font-size:.75rem;letter-spacing:2.5px;font-weight:500;">ESTABLISHED 2005</div>
    <h2 class="heading-serif" style="color:${NAVY};font-size:clamp(2rem,4.5vw,3rem);letter-spacing:-1.5px;margin:.5rem 0 0;line-height:1;">Independent. Focused. Dedicated to one mission.</h2>
  </div>
  <div class="prose-custom" style="max-width:48rem;margin-top:2rem;font-size:15.2px;color:#4b5563;">
    <p>The Ventura County Sheriff's Foundation is an independent 501(c)(3) nonprofit organization with the sole objective to support the Ventura County Sheriff's Office (VCSO). Tax ID #20-3780163.</p>
    <p>We build community partnerships to enhance public safety in Ventura County through grants for equipment and technology, specialized training, scholarships for the families of our deputies, and signature community engagement programs that humanize law enforcement and create lasting positive relationships.</p>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.5rem;margin-top:3rem;">
    <div style="background:#fff;border-radius:1.5rem;padding:2.25rem;border:1px solid #e5e7eb;">
      <div style="color:${GOLD};font-size:.875rem;font-weight:600;letter-spacing:.15em;">OUR MISSION</div>
      <p style="margin-top:1.25rem;font-size:1.25rem;line-height:1.35;">"The Ventura County Sheriff's Foundation is an independent nonprofit 501(c)(3) organization with a sole objective to support the Ventura County Sheriff's Office (VCSO). The Foundation seeks to build community partnerships to enhance public safety in Ventura County with the support of individuals, families and businesses."</p>
    </div>
    <div style="background:${NAVY};color:#fff;border-radius:1.5rem;padding:2.25rem;display:flex;flex-direction:column;">
      <div style="color:${GOLD};font-size:.875rem;font-weight:600;letter-spacing:.15em;">OUR VISION</div>
      <p style="margin-top:1.25rem;font-size:1.5rem;line-height:1.3;flex:1;">To serve as the trusted conduit between the residents of Ventura County and the dedicated men and women of the Ventura County Sheriff's Office.</p>
      <div style="font-size:.875rem;color:rgba(255,255,255,.6);margin-top:auto;padding-top:2rem;">Every program, every grant, and every event exists to strengthen that bond.</div>
    </div>
  </div>
</div>`;

  const history = `
<div style="background:#fff;padding:4rem 0;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
  <div class="vcsf-container">
    <div style="display:grid;grid-template-columns:5fr 7fr;gap:3.5rem;" class="vcsf-history-grid">
      <div>
        <div class="vcsf-eyebrow">A DEFINING MOMENT</div>
        <h3 class="heading-serif" style="color:${NAVY};font-size:2.25rem;letter-spacing:-.5px;margin-top:.75rem;">The Borderline Shooting &amp; the Sgt. Ron Helus Legacy</h3>
      </div>
      <div class="prose-custom" style="color:#4b5563;font-size:15px;">
        <p>On November 7, 2018, Sgt. Ron Helus — a 29-year veteran of the Ventura County Sheriff's Office, SWAT member, and FBI-certified firearms instructor — was killed in the line of duty while responding to the mass shooting at the Borderline Bar &amp; Grill in Thousand Oaks.</p>
        <p>In the years that followed, the Foundation made it a central mission to honor Sgt. Helus's legacy by dramatically improving realistic, high-quality training for every deputy in Ventura County. The result is the Sgt. Ron Helus Training Facility — a state-of-the-art live-fire training complex that prepares our deputies for the threats they face today.</p>
        <p style="font-size:.875rem;font-weight:500;color:${NAVY};">This facility, along with continued support for K9 and Mounted Patrol training areas, stands as a permanent tribute to his sacrifice and our ongoing commitment to the safety of both our deputies and the public they serve.</p>
      </div>
    </div>
  </div>
</div>
<style>@media(max-width:768px){.vcsf-history-grid{grid-template-columns:1fr !important;}}</style>`;

  const quote = `
<div style="background:${NAVY};padding:3.5rem 0;color:rgba(255,255,255,.9);">
  <div class="vcsf-container" style="text-align:center;">
    <div style="display:flex;justify-content:center;margin-bottom:1.5rem;"><img src="${u.logoFooter}" alt="Ventura County Sheriff's Foundation" style="height:2.25rem;width:auto;opacity:.9;"></div>
    <div style="max-width:32rem;margin:0 auto;">
      <p style="font-style:italic;font-size:1.25rem;line-height:1.5;">"The Foundation gives our community a direct way to say thank you and to invest in the safety of the people who protect us every day."</p>
      <div style="color:${GOLD};font-size:.875rem;margin-top:1rem;letter-spacing:.1em;font-weight:500;">— LONGTIME VCSF SUPPORTER &amp; LOCAL BUSINESS OWNER</div>
    </div>
  </div>
</div>`;

  return {
    title: 'About', slug: 'about', status: 'published',
    meta_title: "About Us | Ventura County Sheriff's Foundation",
    meta_desc: "Learn about the Ventura County Sheriff's Foundation — our history, mission, and the legacy of Sgt. Ron Helus.",
    meta_keywords: '', og_image: u.abouthero, custom_css: PAGE_CSS,
    puck_data: {
      root: { props: { pageTitle: 'About Us' } }, zones: {},
      content: [
        { type: 'RawHTML', props: { id: 'RawHTML-hero', code: hero } },
        { type: 'RawHTML', props: { id: 'RawHTML-intro', code: intro } },
        { type: 'RawHTML', props: { id: 'RawHTML-history', code: history } },
        { type: 'CardGrid', props: {
          id: 'CardGrid-values',
          label: 'HOW WE WORK', heading: 'Our guiding principles',
          headingColor: NAVY, subtext: '', subtextColor: '',
          columns: 3, cardStyle: 'plain', bgColor: CREAM,
          cardBg: '#ffffff', cardTitleColor: NAVY, cardTextColor: '#4b5563', cardLinkColor: GOLD,
          iconColor: GOLD, btnRadius: '12px', cardTitleSize: '1.25rem',
          animation: 'none', animDelay: '0',
          items: [
            { icon: 'fa-solid fa-scale-balanced', title: 'Transparency & Accountability', text: 'We exist solely to support VCSO. Every dollar is tracked and every program is designed for measurable impact on deputy safety and community relations.', link: '', linkText: '' },
            { icon: 'fa-solid fa-people-group', title: 'Community First', text: 'We believe the strongest public safety comes from genuine relationships. Our events and programs put deputies and residents side-by-side in positive, humanizing settings.', link: '', linkText: '' },
            { icon: 'fa-solid fa-shield-halved', title: 'Direct Support', text: "We do not fund other nonprofits. We fund the Ventura County Sheriff's Office directly — equipment, training, scholarships for deputy families, and community programs run by deputies themselves.", link: '', linkText: '' },
          ],
        }},
        { type: 'RawHTML', props: { id: 'RawHTML-quote', code: quote } },
      ],
    },
  };
}

function programsPage(u) {
  const header = `
<div class="vcsf-container" style="padding-top:3rem;padding-bottom:2rem;">
  <div style="max-width:42rem;">
    <div class="vcsf-eyebrow">PROGRAMS</div>
    <h1 class="heading-serif" style="color:${NAVY};font-size:clamp(2.5rem,5.5vw,3.75rem);letter-spacing:-1.6px;line-height:1;margin-top:.5rem;">How we support our deputies and community.</h1>
  </div>
</div>`;

  const section = (id, badge, title, bodyHtml, img, alt, imgLeft = false, extra = '') => `
<section id="${id}" class="vcsf-container" style="padding-bottom:4rem;">
  <div style="display:grid;grid-template-columns:1fr 1fr;background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem;overflow:hidden;align-items:stretch;" class="vcsf-prog-grid">
    ${imgLeft ? `<div style="min-height:320px;background-image:url('${img}');background-size:cover;background-position:center;" role="img" aria-label="${alt}"></div>` : ''}
    <div style="padding:3rem;">
      <div style="display:inline-block;padding:.25rem .875rem;font-size:.75rem;background:${GOLD};color:${NAVY};font-weight:600;border-radius:.25rem;">${badge}</div>
      <h2 style="color:${NAVY};font-size:2.25rem;font-weight:600;letter-spacing:-.5px;margin:1rem 0 1.25rem;">${title}</h2>
      <div class="prose-custom" style="color:#4b5563;font-size:15px;">${bodyHtml}</div>
      ${extra}
    </div>
    ${!imgLeft ? `<div style="min-height:320px;background-image:url('${img}');background-size:cover;background-position:center;" role="img" aria-label="${alt}"></div>` : ''}
  </div>
</section>`;

  const scholarship = `
<section id="scholarship" class="vcsf-container">
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem;padding:3rem;">
    <div style="display:grid;grid-template-columns:5fr 7fr;gap:3rem;" class="vcsf-prog-grid">
      <div>
        <div style="color:${GOLD};font-size:.75rem;letter-spacing:.15em;font-weight:500;">EDUCATION SUPPORT</div>
        <h2 class="heading-serif" style="color:${NAVY};font-size:2.25rem;letter-spacing:-.5px;margin-top:.5rem;">Grossman Scholarship</h2>
        <p style="margin-top:1.25rem;color:#4b5563;">The Dr. Richard A. Grossman College Scholarship Fund provides $2,500 awards to graduating high school seniors or GED recipients who are the children or dependents of current VCSO employees and sworn deputies in good standing.</p>
      </div>
      <div style="font-size:.875rem;color:#4b5563;">
        <p><strong>Eligibility:</strong> Minimum 3.0 GPA. Preference given to prior recipients. Applicants must submit a 300–500 word essay describing how being the son or daughter of a VCSO deputy or employee has influenced them.</p>
        <p style="margin-top:.75rem;">Applications are processed through the Ventura County Community Foundation (VCCF) AcademicWorks portal.</p>
        <div style="margin-top:1.5rem;"><a href="https://vccf.academicworks.com/opportunities/3501" target="_blank" rel="noopener" style="font-weight:600;color:${NAVY};text-decoration:none;">Apply for the Grossman Scholarship ↗</a></div>
        <div style="height:1px;background:#e5e7eb;margin:1.75rem 0;"></div>
        <div>
          <div style="font-weight:600;color:${NAVY};">Grants to the Ventura County Sheriff's Office</div>
          <p style="margin-top:.25rem;">The Foundation provides grants exclusively to VCSO for equipment, technology upgrades, specialized training, and community programs. Grant applications are submitted internally by the Sheriff's Office.</p>
          <a href="/applications" style="display:inline-block;margin-top:.5rem;font-size:.875rem;font-weight:500;color:${GOLD};text-decoration:none;">View grant guidelines &amp; application process →</a>
        </div>
      </div>
    </div>
  </div>
</section>
<div class="vcsf-container" style="padding:3.5rem 1.5rem;text-align:center;">
  <a href="/support" class="btn-gold" style="padding:1rem 2.5rem;font-size:1rem;border-radius:1rem;">Support These Programs</a>
  <div style="font-size:.75rem;color:#6b7280;margin-top:1rem;">100% of donations go directly to these initiatives</div>
</div>
<style>@media(max-width:768px){.vcsf-prog-grid{grid-template-columns:1fr !important;}}</style>`;

  return {
    title: 'Programs', slug: 'programs', status: 'published',
    meta_title: "Programs & Impact | Ventura County Sheriff's Foundation",
    meta_desc: "Shop with a Cop, Coppers and Choppers, the Sgt. Ron Helus Training Facility, and the Grossman Scholarship — how VCSF supports deputies and the Ventura County community.",
    meta_keywords: '', og_image: u.choppers, custom_css: PAGE_CSS,
    puck_data: {
      root: { props: { pageTitle: 'Programs & Impact' } }, zones: {},
      content: [
        { type: 'RawHTML', props: { id: 'RawHTML-header', code: header } },
        { type: 'RawHTML', props: { id: 'RawHTML-shop', code: section('shop', 'COMMUNITY ENGAGEMENT', 'Shop with a Cop',
          `<p>Each holiday season, the Ventura County Sheriff's Foundation partners with the VCSO, CHP Ventura, and local businesses to give under-resourced children a memorable shopping experience with a deputy by their side.</p>
           <p>Children are paired one-on-one with a deputy or explorer for breakfast, photos, and a shopping trip (typically at Target in Camarillo) where they can purchase gifts for themselves and their families.</p>
           <p style="font-weight:500;color:${NAVY};">Record year: 160 children served in 2019. The program continues to grow with participation from multiple VCSO stations.</p>`,
          u.shopcop, 'Shop with a Cop', false,
          `<div style="margin-top:1.75rem;font-size:.875rem;"><a href="/support" style="font-weight:600;color:${GOLD};text-decoration:none;">Sponsor or donate specifically to Shop with a Cop →</a></div>`) } },
        { type: 'RawHTML', props: { id: 'RawHTML-coppers', code: section('coppers', 'SIGNATURE EVENT', 'Coppers and Choppers',
          `<p>Our annual free, family-friendly community day at the Ventura County Sheriff's Air Unit hangar at Camarillo Airport. The 10th annual event was held September 13, 2025.</p>
           <p>Attendees meet deputies from every specialized unit — K9, SWAT, Search &amp; Rescue, Bomb/Arson, Marine Patrol, Mounted Patrol — and experience helicopter displays, static vehicle displays, food trucks, bounce houses, and hands-on activities.</p>
           <p style="font-weight:500;">This event has become one of the most beloved public safety community traditions in Ventura County.</p>`,
          u.choppers, 'Coppers and Choppers', true,
          `<div style="margin-top:1.25rem;font-size:.75rem;color:#6b7280;">Next event: September 2026 • Free admission • All ages welcome</div>`) } },
        { type: 'RawHTML', props: { id: 'RawHTML-facility', code: section('facility', 'MAJOR CAPITAL PROJECT', 'Sgt. Ron Helus Training Facility',
          `<p>Named in honor of Sgt. Ron Helus, who gave his life in the 2018 Borderline Bar &amp; Grill shooting, this live-fire training facility represents the Foundation's largest single investment in deputy safety and readiness.</p>
           <p>Groundbreaking took place in 2021. The facility provides realistic, high-stress training scenarios that prepare deputies for the complex threats they face in the field — from active shooter response to de-escalation and tactical decision-making.</p>
           <p style="font-weight:500;color:${NAVY};">The Foundation also supports the K9 and Mounted Patrol training facilities (barns, arenas, and specialized training areas).</p>`,
          u.facility, 'Sgt. Ron Helus Training Facility', false) } },
        { type: 'RawHTML', props: { id: 'RawHTML-scholarship', code: scholarship } },
      ],
    },
  };
}

function supportPage(u) {
  const header = `
<div class="vcsf-container" style="padding-top:3rem;padding-bottom:1.5rem;">
  <h1 class="heading-serif" style="color:${NAVY};font-size:clamp(2.5rem,5.5vw,3.75rem);letter-spacing:-2px;margin:0;">Support the men and women who protect us.</h1>
  <p style="max-width:32rem;margin-top:1rem;font-size:1.125rem;color:#4b5563;">Your partnership directly funds safer deputies, stronger community connections, and brighter futures for the families of those who serve.</p>
</div>
<div id="donate" class="vcsf-container" style="padding-top:1rem;">
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem 1.5rem 0 0;padding:3rem 3rem 0;">
    <div style="max-width:42rem;">
      <div class="vcsf-eyebrow">DIRECT IMPACT</div>
      <h2 class="heading-serif" style="color:${NAVY};font-size:2.25rem;letter-spacing:-1px;margin-top:.5rem;">Make a Donation</h2>
      <p style="margin-top:1rem;font-size:.875rem;color:#4b5563;">100% of every gift supports grants, training facilities, Shop with a Cop, scholarships, and community events. Designate your gift or let us direct it where it's needed most.</p>
    </div>
  </div>
</div>`;

  const donateFormWrapOpen = `<div class="vcsf-container"><div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 1.5rem 1.5rem;padding:1rem 3rem 3rem;">`;
  const donateFormWrapClose = `</div></div>`;

  const membership = `
<section id="membership" class="vcsf-container" style="padding-top:3rem;padding-bottom:3rem;">
  <div style="margin-bottom:2rem;"><div class="vcsf-eyebrow">MEMBERSHIP</div><h2 class="heading-serif" style="color:${NAVY};font-size:2.25rem;letter-spacing:-1px;margin-top:.25rem;">Join the Ventura County Sheriff's Foundation</h2></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:1.5rem;">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem;padding:2rem;">
      <div style="font-size:.875rem;color:${GOLD};font-weight:500;">SENIOR BRONZE</div>
      <div style="margin-top:.75rem;"><span style="font-size:2.25rem;font-weight:600;">$20</span><span style="color:#6b7280;">/year</span></div>
      <ul style="margin:1.5rem 0 0;padding:0;list-style:none;font-size:.875rem;color:#4b5563;line-height:2;"><li>• Personalized membership card</li><li>• Window decal</li><li>• Recognition in annual report</li></ul>
      <a href="/contact" class="btn-outline-n" style="margin-top:1.75rem;display:block;text-align:center;padding:.75rem;font-size:.875rem;border-radius:1rem;">Join as Senior Bronze</a>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem;padding:2rem;position:relative;">
      <div style="position:absolute;top:-8px;right:20px;background:${GOLD};color:${NAVY};font-size:10px;font-weight:700;padding:1px 12px;border-radius:.25rem;letter-spacing:.1em;">POPULAR</div>
      <div style="font-size:.875rem;color:${GOLD};font-weight:500;">BRONZE</div>
      <div style="margin-top:.75rem;"><span style="font-size:2.25rem;font-weight:600;">$40</span><span style="color:#6b7280;">/year</span></div>
      <ul style="margin:1.5rem 0 0;padding:0;list-style:none;font-size:.875rem;color:#4b5563;line-height:2;"><li>• Personalized membership card</li><li>• 1 window decal</li><li>• Recognition in annual report</li></ul>
      <a href="/contact" class="btn-gold" style="margin-top:1.75rem;display:block;text-align:center;padding:.75rem;font-size:.875rem;border-radius:1rem;">Join as Bronze</a>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem;padding:2rem;">
      <div style="font-size:.875rem;color:${GOLD};font-weight:500;">SILVER</div>
      <div style="margin-top:.75rem;"><span style="font-size:2.25rem;font-weight:600;">$110</span><span style="color:#6b7280;">/year</span></div>
      <ul style="margin:1.5rem 0 0;padding:0;list-style:none;font-size:.875rem;color:#4b5563;line-height:2;"><li>• Personalized membership card</li><li>• Set of window decals</li><li>• Official badge lapel pin</li><li>• Recognition in annual report</li></ul>
      <a href="/contact" class="btn-outline-n" style="margin-top:1.75rem;display:block;text-align:center;padding:.75rem;font-size:.875rem;border-radius:1rem;">Join as Silver</a>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem;padding:2rem;">
      <div style="font-size:.875rem;color:${GOLD};font-weight:500;">GOLD &amp; DIAMOND</div>
      <div style="margin-top:.75rem;font-size:1.5rem;font-weight:600;">From $250</div>
      <div style="font-size:.875rem;margin-top:.25rem;color:#4b5563;">Higher levels include multiple cards, enhanced recognition, and special event invitations. Diamond level begins at $1,000.</div>
      <a href="/contact" class="btn-outline-n" style="margin-top:2rem;display:block;text-align:center;padding:.75rem;font-size:.875rem;border-radius:1rem;">Contact for Higher Levels</a>
      <div style="font-size:.75rem;text-align:center;color:#6b7280;margin-top:.75rem;">Lifetime membership also available — inquire for details.</div>
    </div>
  </div>
  <div style="font-size:.75rem;color:#6b7280;margin-top:1rem;">Allow 4–6 weeks for fulfillment of physical membership materials. Questions? Call (805) 492-4398.</div>
</section>`;

  const sponsor = `
<section id="sponsor" class="vcsf-container" style="padding-bottom:3.5rem;">
  <div style="background:${NAVY};color:#fff;border-radius:1.5rem;padding:3rem;">
    <div style="max-width:42rem;">
      <div style="text-transform:uppercase;font-size:.75rem;color:${GOLD};letter-spacing:.15em;">FOR LOCAL BUSINESSES</div>
      <h2 class="heading-serif" style="font-size:2.25rem;margin-top:.5rem;">Sponsor an Event or Program</h2>
      <p style="margin-top:1.25rem;color:rgba(255,255,255,.8);">Local businesses are the backbone of our success. Your sponsorship of Shop with a Cop, Coppers and Choppers, or training initiatives provides direct visibility in the community while making a tangible difference in public safety.</p>
      <div style="display:flex;flex-wrap:wrap;gap:.75rem;margin-top:2rem;">
        <a href="/contact" style="background:#fff;color:${NAVY};padding:.75rem 2rem;border-radius:1rem;font-weight:600;font-size:.875rem;text-decoration:none;">Discuss Sponsorship Opportunities</a>
        <a href="mailto:admin@vcsheriffsfoundation.org" style="padding:.75rem 2rem;border-radius:1rem;border:1px solid rgba(255,255,255,.4);font-size:.875rem;color:#fff;text-decoration:none;">Email Us</a>
      </div>
    </div>
  </div>
</section>`;

  return {
    title: 'Support Us', slug: 'support', status: 'published',
    meta_title: "Support Us • Donate & Membership | Ventura County Sheriff's Foundation",
    meta_desc: 'Donate, become a member, or sponsor an event. 100% of your gift supports Ventura County deputies and community programs.',
    meta_keywords: '', og_image: u.hero, custom_css: PAGE_CSS,
    puck_data: {
      root: { props: { pageTitle: 'Support Us' } }, zones: {},
      content: [
        { type: 'RawHTML', props: { id: 'RawHTML-header', code: header } },
        { type: 'RawHTML', props: { id: 'RawHTML-formopen', code: donateFormWrapOpen } },
        { type: 'FormEmbed', props: { id: 'FormEmbed-donate', formSlug: 'donate', textColor: '#1F2937', btnColor: GOLD, btnTextColor: NAVY, btnRadius: '16px' } },
        { type: 'RawHTML', props: { id: 'RawHTML-formclose', code: donateFormWrapClose } },
        { type: 'RawHTML', props: { id: 'RawHTML-membership', code: membership } },
        { type: 'RawHTML', props: { id: 'RawHTML-sponsor', code: sponsor } },
      ],
    },
  };
}

function shopPage(u) {
  const products = [
    { id: 'sign-yard', name: 'Backing the Badge Yard Sign', price: 10, img: u.merch, note: 'Show your support in your front yard' },
    { id: 'polo', name: 'VCSF Embroidered Polo', price: 45, img: u.apparel, note: 'Navy with gold logo • Sizes S–3XL' },
    { id: 'cap', name: 'VCSF Embroidered Cap', price: 22, img: u.apparel, note: 'Navy with gold logo • Adjustable' },
    { id: 'coin', name: 'VCSF Challenge Coin', price: 15, img: u.apparel, note: 'Limited edition • Collectible' },
    { id: 'hoodie', name: 'VCSF Heavyweight Hoodie', price: 58, img: u.apparel, note: 'Premium fleece • Sizes S–3XL' },
    { id: 'decal-pack', name: 'Window Decal Pack (3)', price: 12, img: u.merch, note: 'For car, home, or office' },
  ];
  const grid = `
<div class="vcsf-container" style="padding-top:2.5rem;padding-bottom:2rem;">
  <div style="display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:1rem;">
    <div><div class="vcsf-eyebrow" style="letter-spacing:2.5px;">OFFICIAL MERCHANDISE</div><h1 class="heading-serif" style="color:${NAVY};font-size:clamp(2.25rem,5vw,3rem);letter-spacing:-1.5px;margin-top:.25rem;">Shop &amp; Show Your Support</h1></div>
    <div style="text-align:right;font-size:.75rem;color:#6b7280;">All proceeds benefit<br>Ventura County deputies &amp; programs</div>
  </div>
</div>
<div class="vcsf-container" style="padding-bottom:4rem;">
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.5rem;">
    ${products.map(p => `
    <div class="vcsf-card" style="background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem;overflow:hidden;">
      <div style="height:16rem;overflow:hidden;background:#f3f4f6;"><img src="${p.img}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;"></div>
      <div style="padding:1.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;"><div style="font-weight:600;">${p.name}</div><div style="font-weight:600;">$${p.price}</div></div>
        <div style="font-size:.75rem;color:#6b7280;margin-top:2px;">${p.note}</div>
        <a href="/contact" class="btn-navy" style="margin-top:1.25rem;display:block;width:100%;text-align:center;padding:.75rem;font-size:.875rem;border-radius:1rem;">Order — Contact Us</a>
      </div>
    </div>`).join('')}
  </div>
  <div style="font-size:.75rem;text-align:center;color:#6b7280;margin-top:2.5rem;">Questions about sizing or bulk orders for your business? <a href="/contact" style="text-decoration:underline;color:inherit;">Contact us</a>. Online checkout is coming soon.</div>
</div>`;

  return {
    title: 'Shop', slug: 'shop', status: 'published',
    meta_title: "Shop • Merch & Support | Ventura County Sheriff's Foundation",
    meta_desc: 'Official VCSF merchandise — all proceeds support Ventura County deputies and community programs.',
    meta_keywords: '', og_image: u.apparel, custom_css: PAGE_CSS,
    puck_data: {
      root: { props: { pageTitle: 'Shop' } }, zones: {},
      content: [{ type: 'RawHTML', props: { id: 'RawHTML-shop', code: grid } }],
    },
  };
}

function newsPage(u) {
  const items = [
    { date: 'SEPTEMBER 2025', title: '10th Annual Coppers and Choppers Draws Record Crowd', body: "The 10th anniversary of Coppers and Choppers welcomed hundreds of families to the Sheriff's Air Unit at Camarillo Airport. Highlights included walk-around tours of Copter 5 (Firehawk), K9 demonstrations, SWAT and bomb squad vehicles, Search & Rescue displays, food trucks, and children's activities. The event remains completely free thanks to the generous support of sponsors and the Foundation." },
    { date: 'DECEMBER 2025', title: 'Shop with a Cop 2025 Brings Joy to Local Children', body: "Deputies and Explorers from stations across the county spent the day shopping with children facing financial hardship. Each child received breakfast, a photo with their deputy, and the opportunity to purchase gifts. The program, supported entirely by donations and sponsors such as Target and local restaurants, continues to build trust between law enforcement and the community's youngest residents." },
    { date: '2024 — 2025', title: 'Sgt. Ron Helus Training Facility Nears Full Operational Capacity', body: 'The live-fire training complex named in memory of Sgt. Ron Helus is now delivering advanced tactical and decision-making training to deputies county-wide. The Foundation remains committed to ongoing equipment and facility upgrades so that every deputy has access to the best possible preparation for the challenges of modern policing.' },
    { date: 'JANUARY 2026', title: 'Grossman Scholarship Applications Open for 2026', body: 'The Dr. Richard A. Grossman College Scholarship ($2,500) is available to graduating seniors and GED recipients who are the dependents of current VCSO employees or sworn personnel. A 300–500 word essay is required. Applications are submitted through the Ventura County Community Foundation portal.' },
  ];
  const html = `
<div class="vcsf-container" style="padding-top:2.75rem;padding-bottom:2rem;">
  <h1 class="heading-serif" style="color:${NAVY};font-size:clamp(2.25rem,5vw,3rem);letter-spacing:-1.5px;margin:0;">News &amp; Event Recaps</h1>
</div>
<div class="vcsf-container" style="padding-bottom:5rem;">
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1.5rem;">
    ${items.map(n => `
    <div class="vcsf-card" style="background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem;padding:2rem;">
      <div style="font-size:.75rem;color:${GOLD};">${n.date}</div>
      <div style="font-weight:600;font-size:1.5rem;color:${NAVY};margin-top:.5rem;line-height:1.25;">${n.title}</div>
      <div style="font-size:.875rem;margin-top:.75rem;color:#4b5563;line-height:1.6;">${n.body}</div>
    </div>`).join('')}
  </div>
</div>`;
  return {
    title: 'News', slug: 'news', status: 'published',
    meta_title: "News & Events | Ventura County Sheriff's Foundation",
    meta_desc: 'Event recaps and news from the Ventura County Sheriff\'s Foundation — Coppers and Choppers, Shop with a Cop, training facility updates, and scholarships.',
    meta_keywords: '', og_image: u.choppers, custom_css: PAGE_CSS,
    puck_data: {
      root: { props: { pageTitle: 'News & Events' } }, zones: {},
      content: [{ type: 'RawHTML', props: { id: 'RawHTML-news', code: html } }],
    },
  };
}

function contactPage(u) {
  const header = `
<div class="vcsf-container" style="padding-top:3.5rem;">
  <div style="max-width:32rem;"><div class="vcsf-eyebrow">WE'D LOVE TO HEAR FROM YOU</div><h1 class="heading-serif" style="color:${NAVY};font-size:clamp(2.5rem,5.5vw,3.75rem);letter-spacing:-2px;margin-top:.25rem;">Get in touch.</h1></div>
</div>
<div class="vcsf-container"><div style="display:grid;grid-template-columns:3fr 2fr;gap:2.5rem;margin-top:3rem;padding-bottom:3.5rem;" class="vcsf-contact-grid">
  <div id="vcsf-contact-form" style="background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem;padding:2rem;">`;
  // FormEmbed goes between; then close grid with info card
  const info = `</div>
  <div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem;padding:2rem;font-size:.875rem;">
      <div style="font-weight:600;color:${NAVY};margin-bottom:1rem;">Direct Contact</div>
      <div style="color:#4b5563;line-height:1.7;">
        <div style="margin-bottom:.75rem;"><strong style="color:${NAVY};">Phone:</strong><br><a href="tel:8054924398" style="color:inherit;text-decoration:none;">(805) 492-4398</a></div>
        <div style="margin-bottom:.75rem;"><strong style="color:${NAVY};">Email:</strong><br><a href="mailto:admin@vcsheriffsfoundation.org" style="color:inherit;text-decoration:none;">admin@vcsheriffsfoundation.org</a></div>
        <div><strong style="color:${NAVY};">Mailing Address:</strong><br>P.O. Box 3007<br>Camarillo, CA 93011</div>
      </div>
    </div>
    <div style="margin-top:1.5rem;font-size:.75rem;color:#6b7280;">Follow us on social media for the latest event photos and updates:</div>
    <div style="display:flex;gap:1.25rem;font-size:.875rem;margin-top:.5rem;">
      <a href="https://facebook.com/vcsheriffsfoundation" target="_blank" rel="noopener" style="color:${NAVY};text-decoration:none;">Facebook</a>
      <a href="https://instagram.com/vcsfoundation" target="_blank" rel="noopener" style="color:${NAVY};text-decoration:none;">Instagram</a>
    </div>
  </div>
</div></div>
<style>@media(max-width:768px){.vcsf-contact-grid{grid-template-columns:1fr !important;}}</style>`;

  return {
    title: 'Contact', slug: 'contact', status: 'published',
    meta_title: "Contact Us | Ventura County Sheriff's Foundation",
    meta_desc: "Contact the Ventura County Sheriff's Foundation — donations, membership, sponsorship, grants, and general inquiries.",
    meta_keywords: '', og_image: u.hero, custom_css: PAGE_CSS,
    puck_data: {
      root: { props: { pageTitle: 'Contact Us' } }, zones: {},
      content: [
        { type: 'RawHTML', props: { id: 'RawHTML-header', code: header } },
        { type: 'FormEmbed', props: { id: 'FormEmbed-contact', formSlug: 'contact', textColor: '#1F2937', btnColor: GOLD, btnTextColor: NAVY, btnRadius: '16px' } },
        { type: 'RawHTML', props: { id: 'RawHTML-info', code: info } },
      ],
    },
  };
}

function applicationsPage(u) {
  const html = `
<div class="vcsf-container" style="padding-top:3rem;">
  <h1 class="heading-serif" style="color:${NAVY};font-size:clamp(2.25rem,5vw,3rem);letter-spacing:-1.5px;margin:0;">Applications</h1>
  <p style="max-width:28rem;margin-top:.5rem;color:#4b5563;">The Ventura County Sheriff's Foundation supports two primary application processes: grants to the Sheriff's Office and the Grossman Scholarship for deputy families.</p>
</div>
<div class="vcsf-container" style="padding:3rem 1.5rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1.5rem;">
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem;padding:2.25rem;">
    <div style="text-transform:uppercase;font-size:.75rem;letter-spacing:.15em;color:${GOLD};">FOR THE VENTURA COUNTY SHERIFF'S OFFICE</div>
    <h2 style="font-size:1.875rem;color:${NAVY};font-weight:600;letter-spacing:-.5px;margin-top:.75rem;">Grant Applications</h2>
    <div class="prose-custom" style="margin-top:1.25rem;font-size:.875rem;color:#4b5563;">
      <p>The Foundation awards grants exclusively to the Ventura County Sheriff's Office for equipment, technology upgrades, specialized training, and community programs that enhance public safety.</p>
      <p>Grant applications are submitted internally by VCSO command staff. If you are a deputy or supervisor with a project that aligns with our mission, please coordinate through your chain of command.</p>
    </div>
    <div style="margin-top:2rem;font-size:.875rem;font-weight:500;color:${GOLD};">Contact admin@vcsheriffsfoundation.org for questions about the grant process.</div>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:1.5rem;padding:2.25rem;">
    <div style="text-transform:uppercase;font-size:.75rem;letter-spacing:.15em;color:${GOLD};">FOR DEPUTY FAMILIES</div>
    <h2 style="font-size:1.875rem;color:${NAVY};font-weight:600;letter-spacing:-.5px;margin-top:.75rem;">Grossman Scholarship</h2>
    <div class="prose-custom" style="margin-top:1.25rem;font-size:.875rem;color:#4b5563;">
      <p><strong>$2,500 awards</strong> for graduating high school seniors and GED recipients who are the children or legal dependents of current Ventura County Sheriff's Office employees or sworn deputies in good standing.</p>
      <p style="margin-top:.75rem;">Minimum 3.0 GPA. 300–500 word essay required on the influence of having a parent/guardian in VCSO.</p>
    </div>
    <a href="https://vccf.academicworks.com/opportunities/3501" target="_blank" rel="noopener" class="btn-navy" style="margin-top:1.75rem;font-size:.875rem;padding:.75rem 2rem;border-radius:1rem;">Apply via Ventura County Community Foundation →</a>
    <div style="font-size:.75rem;margin-top:.75rem;color:#6b7280;">Deadline for the current cycle: January 16, 2026</div>
  </div>
</div>
<div class="vcsf-container" style="padding-bottom:4rem;font-size:.875rem;color:#4b5563;">
  The Foundation does not accept grant applications from individuals, other nonprofits, or the general public. All grants are directed exclusively to the Ventura County Sheriff's Office.
</div>`;
  return {
    title: 'Applications', slug: 'applications', status: 'published',
    meta_title: "Applications & Scholarships | Ventura County Sheriff's Foundation",
    meta_desc: 'Grant application guidelines for VCSO and the Grossman Scholarship application process for deputy families.',
    meta_keywords: '', og_image: u.scholarship, custom_css: PAGE_CSS,
    puck_data: {
      root: { props: { pageTitle: 'Applications' } }, zones: {},
      content: [{ type: 'RawHTML', props: { id: 'RawHTML-apps', code: html } }],
    },
  };
}

/* ── Forms ─────────────────────────────────────────────────────────────────── */
const FORMS = [
  {
    name: 'Contact Form', slug: 'contact',
    description: 'VCSF website contact form',
    submit_text: 'Send Message',
    success_msg: 'Thank you. We have received your message and will reply within 2 business days.',
    crm_action: 'create_contact',
    crm_mapping_json: { first_name: 'first_name', last_name: 'last_name', email: 'email', phone: 'phone' },
    fields: [
      { field_key: 'first_name', label: 'First Name', field_type: 'text', is_required: 1, col_width: 'half', sort_order: 1 },
      { field_key: 'last_name', label: 'Last Name', field_type: 'text', is_required: 1, col_width: 'half', sort_order: 2 },
      { field_key: 'email', label: 'Email Address', field_type: 'email', is_required: 1, col_width: 'full', sort_order: 3 },
      { field_key: 'phone', label: 'Phone (optional)', field_type: 'phone', is_required: 0, col_width: 'full', sort_order: 4 },
      { field_key: 'topic', label: 'How can we help?', field_type: 'select', is_required: 0, col_width: 'full', sort_order: 5,
        options_json: ['General Inquiry', 'Donation or Membership Question', 'Event Sponsorship', 'Grant or Scholarship Application', 'Volunteer Opportunities', 'Media / Press'] },
      { field_key: 'message', label: 'Message', field_type: 'textarea', placeholder: 'Tell us how we can help...', is_required: 1, col_width: 'full', sort_order: 6 },
    ],
  },
  {
    name: 'Donation Form', slug: 'donate',
    description: 'VCSF website donation intent form (payment processing wired separately)',
    submit_text: 'Donate Securely',
    success_msg: 'Thank you! Your generous gift has been received. Our team will follow up with a confirmation and tax receipt.',
    crm_action: 'create_contact',
    crm_mapping_json: { first_name: 'first_name', last_name: 'last_name', email: 'email' },
    fields: [
      { field_key: 'amount', label: 'Donation Amount (USD)', field_type: 'number', placeholder: '100', is_required: 1, col_width: 'half', sort_order: 1, validation_json: { min: 1 } },
      { field_key: 'designation', label: 'Designation (optional)', field_type: 'select', is_required: 0, col_width: 'half', sort_order: 2,
        options_json: ['Where needed most', 'Shop with a Cop', 'Sgt. Ron Helus Training Facility', 'Grossman Scholarship Fund', 'Coppers and Choppers', 'Deputy Equipment & Technology'] },
      { field_key: 'first_name', label: 'First Name', field_type: 'text', is_required: 1, col_width: 'half', sort_order: 3 },
      { field_key: 'last_name', label: 'Last Name', field_type: 'text', is_required: 1, col_width: 'half', sort_order: 4 },
      { field_key: 'email', label: 'Email Address', field_type: 'email', is_required: 1, col_width: 'full', sort_order: 5 },
      { field_key: 'recurring', label: 'Make this a monthly recurring gift', field_type: 'checkbox', is_required: 0, col_width: 'full', sort_order: 6 },
    ],
  },
];

/* ── Main ──────────────────────────────────────────────────────────────────── */
async function main() {
  console.log(`Storage driver: ${storage.driver || process.env.STORAGE_DRIVER || 'local'}`);

  /* 1. Media */
  console.log('\n── Seeding media library ──');
  const [[folderRow]] = await db.query("SELECT id FROM media_folders WHERE name = 'VCSF Website' LIMIT 1");
  let folderId = folderRow?.id;
  if (!folderId) {
    const [r] = await db.query("INSERT INTO media_folders (name, parent_id) VALUES ('VCSF Website', NULL)");
    folderId = r.insertId;
  }

  const urls = {};
  for (const [name, meta] of Object.entries(IMAGES)) {
    const src = path.join(IMG_DIR, meta.file);
    if (!fs.existsSync(src)) { console.warn(`  ! missing ${meta.file} — skipped`); continue; }

    let buffer = fs.readFileSync(src);
    let ext = path.extname(meta.file).toLowerCase();
    let mime = MIME[ext] || 'application/octet-stream';
    let width = null, height = null;

    if (!meta.raw && sharp && (ext === '.jpg' || ext === '.jpeg' || ext === '.png')) {
      const out = await sharp(buffer).rotate().resize({ width: 2400, withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 }).toBuffer({ resolveWithObject: true });
      buffer = out.data; width = out.info.width; height = out.info.height;
      ext = '.webp'; mime = 'image/webp';
    } else if (sharp) {
      try { const m = await sharp(buffer).metadata(); width = m.width; height = m.height; } catch {}
    }

    // replace any previous row for this image (matched by folder + original name)
    const [old] = await db.query('SELECT id, filename FROM media_files WHERE folder_id = ? AND original_name = ?', [folderId, meta.file]);
    for (const o of old) {
      try { await storage.remove({ driver: storage.driver, key: o.filename }); } catch {}
      await db.query('DELETE FROM media_files WHERE id = ?', [o.id]);
    }

    const { key } = await storage.put({
      entity_type: 'media', entity_id: 'library',
      originalName: path.basename(meta.file, path.extname(meta.file)) + ext,
      contentType: mime, buffer,
    });

    const file_url = url(key);
    await db.query(
      `INSERT INTO media_files (filename, original_name, file_url, mime_type, file_size, width, height, alt_text, folder_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [key, meta.file, file_url, mime, buffer.length, width, height, meta.alt, folderId]
    );
    urls[name] = file_url;
    console.log(`  ✓ ${meta.file} → ${file_url}`);
  }

  /* 2. Global settings */
  console.log('\n── Seeding website global settings ──');
  const SETTINGS = {
    site_name: "Ventura County Sheriff's Foundation",
    header_logo_url: urls.logoHeader || '',
    footer_logo_url: urls.logoFooter || '',
    header_nav_links: JSON.stringify([
      { label: 'Home', url: '/' },
      { label: 'About', url: '/about' },
      { label: 'Programs', url: '/programs' },
      { label: 'Support Us', url: '/support' },
      { label: 'Shop', url: '/shop' },
      { label: 'News', url: '/news' },
      { label: 'Contact', url: '/contact' },
    ]),
    footer_col2_title: 'Quick Links',
    footer_col2_links: JSON.stringify([
      { label: 'Our Programs', url: '/programs' },
      { label: 'Donate & Membership', url: '/support' },
      { label: 'News & Events', url: '/news' },
      { label: 'Grant & Scholarship Applications', url: '/applications' },
    ]),
    footer_col3_title: 'Get Involved',
    footer_col3_links: JSON.stringify([
      { label: 'Donate', url: '/support' },
      { label: 'Become a Member', url: '/support' },
      { label: 'Shop Merchandise', url: '/shop' },
      { label: 'Contact Us', url: '/contact' },
    ]),
    footer_cta_buttons: JSON.stringify([{ label: 'Donate Now', url: '/support' }]),
    footer_copyright: "Ventura County Sheriff's Foundation. All rights reserved.",
    social_facebook: 'https://facebook.com/vcsheriffsfoundation',
    social_instagram: 'https://instagram.com/vcsfoundation',
    social_linkedin: '',
    header_email: 'admin@vcsheriffsfoundation.org',
  };
  for (const [key, value] of Object.entries(SETTINGS)) {
    await db.query(
      'INSERT INTO website_global_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
      [key, value]
    );
  }
  console.log(`  ✓ ${Object.keys(SETTINGS).length} settings written`);

  /* 3. Forms */
  console.log('\n── Seeding forms ──');
  for (const form of FORMS) {
    const [[existing]] = await db.query('SELECT id FROM forms WHERE slug = ?', [form.slug]);
    if (existing) {
      await db.query('DELETE FROM form_fields WHERE form_id = ?', [existing.id]);
      await db.query('DELETE FROM forms WHERE id = ?', [existing.id]);
    }
    const [r] = await db.query(
      `INSERT INTO forms (name, slug, description, submit_text, success_msg, notify_email, is_active, crm_action, crm_mapping_json, redirect_url, honeypot)
       VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?, NULL, 1)`,
      [form.name, form.slug, form.description, form.submit_text, form.success_msg, form.crm_action, JSON.stringify(form.crm_mapping_json)]
    );
    for (const f of form.fields) {
      await db.query(
        `INSERT INTO form_fields (form_id, field_key, label, field_type, placeholder, help_text, default_value, col_width, options_json, validation_json, is_required, sort_order, show_if_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [r.insertId, f.field_key, f.label, f.field_type, f.placeholder || null, f.help_text || null, f.default_value || null,
         f.col_width || 'full', f.options_json ? JSON.stringify(f.options_json) : null,
         f.validation_json ? JSON.stringify(f.validation_json) : null, f.is_required ? 1 : 0, f.sort_order || 0]
      );
    }
    console.log(`  ✓ form "${form.name}" (${form.fields.length} fields)`);
  }

  /* 4. Pages */
  console.log('\n── Seeding website pages ──');
  const pages = [homePage(urls), aboutPage(urls), programsPage(urls), supportPage(urls), shopPage(urls), newsPage(urls), contactPage(urls), applicationsPage(urls)];
  for (const p of pages) {
    await db.query('DELETE FROM website_versions WHERE page_id IN (SELECT id FROM website_pages WHERE slug = ?)', [p.slug]).catch(() => {});
    await db.query('DELETE FROM website_pages WHERE slug = ?', [p.slug]);
    await db.query(
      `INSERT INTO website_pages (title, slug, status, puck_data, meta_title, meta_desc, meta_keywords, og_image, custom_css, custom_js, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL)`,
      [p.title, p.slug, p.status, JSON.stringify(p.puck_data), p.meta_title, p.meta_desc, p.meta_keywords, p.og_image, p.custom_css]
    );
    console.log(`  ✓ page /${p.slug === 'home' ? '' : p.slug} ("${p.title}")`);
  }

  console.log('\nDone. Open http://localhost:5178/ to view the site.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
