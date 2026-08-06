#!/usr/bin/env node
/* =============================================================================
 * create-privacy-accessibility-pages.js
 * The import-design audit found website-files/privacy.html and
 * accessibility.html have no corresponding live page — creates both as
 * simple published Puck pages (a single TextBlock with the reference copy),
 * matching the pattern already used for this site's other content-only pages.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';

function page(slug, title, html) {
  return {
    slug,
    title,
    puck_data: {
      root: { props: { pageTitle: title } },
      zones: {},
      content: [{
        type: 'TextBlock',
        props: {
          id: `TextBlock-${slug}`,
          html,
          center: 'left',
          bgColor: '#F8F5EF',
          padding: '3.5rem 1.5rem',
          maxWidth: '760px',
          blockAlign: 'site',
          animDelay: '0',
          animation: 'none',
          textColor: '',
        },
      }],
    },
  };
}

const PRIVACY_HTML = `
<h1 style="font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:clamp(2.25rem,5vw,3rem);letter-spacing:-1.5px;color:${NAVY};">Privacy Policy</h1>
<p style="font-size:0.85rem;color:#9ca3af;margin-top:0.5rem;">Last updated: July 2026</p>
<div style="max-width:44rem;margin-top:2.5rem;font-size:0.95rem;color:#4b5563;line-height:1.7;">
  <h2 style="font-size:1.25rem;font-weight:600;color:${NAVY};">Who we are</h2>
  <p style="margin-top:0.5rem;">The Ventura County Sheriff's Foundation ("VCSF," "we," "us") is an independent 501(c)(3) nonprofit (Tax ID #20-3780163). Contact: P.O. Box 3007, Camarillo, CA 93011 &middot; (805) 492-4398 &middot; admin@vcsheriffsfoundation.org.</p>
  <h2 style="font-size:1.25rem;font-weight:600;color:${NAVY};margin-top:1.5rem;">Information we collect</h2>
  <p style="margin-top:0.5rem;">We may collect information you voluntarily provide (name, email, phone, donation or membership details, contact-form messages) and limited technical data needed to operate the site (for example, shopping cart contents stored in your browser's local storage).</p>
  <h2 style="font-size:1.25rem;font-weight:600;color:${NAVY};margin-top:1.5rem;">How we use information</h2>
  <p style="margin-top:0.5rem;">To respond to inquiries, process donations/memberships through our payment partners, improve our programs and website, and meet legal obligations. We do not sell personal information.</p>
  <h2 style="font-size:1.25rem;font-weight:600;color:${NAVY};margin-top:1.5rem;">Your rights</h2>
  <p style="margin-top:0.5rem;">Depending on your location, you may have rights to access, correct, delete, or restrict processing of your personal data, and to withdraw consent. Contact admin@vcsheriffsfoundation.org.</p>
  <h2 style="font-size:1.25rem;font-weight:600;color:${NAVY};margin-top:1.5rem;">Children</h2>
  <p style="margin-top:0.5rem;">This site is not directed at children under 13. We do not knowingly collect personal information from children online.</p>
</div>
`.trim();

const ACCESSIBILITY_HTML = `
<h1 style="font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:clamp(2.25rem,5vw,3rem);letter-spacing:-1.5px;color:${NAVY};">Accessibility Statement</h1>
<p style="font-size:0.85rem;color:#9ca3af;margin-top:0.5rem;">Commitment to WCAG 2.2 Level AA</p>
<div style="max-width:44rem;margin-top:2.5rem;font-size:0.95rem;color:#4b5563;line-height:1.7;">
  <p>The Ventura County Sheriff's Foundation is committed to ensuring digital accessibility for people with disabilities. We continually improve the user experience for everyone and apply relevant accessibility standards.</p>
  <h2 style="font-size:1.25rem;font-weight:600;color:${NAVY};margin-top:1.5rem;">Conformance goal</h2>
  <p style="margin-top:0.5rem;">We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.2 at Level AA across desktop and mobile devices.</p>
  <h2 style="font-size:1.25rem;font-weight:600;color:${NAVY};margin-top:1.5rem;">Measures we take</h2>
  <ul style="margin-top:0.5rem;padding-left:1.25rem;list-style:disc;">
    <li>Semantic HTML structure and clear page titles</li>
    <li>Keyboard access for navigation, modals, and cart where present</li>
    <li>Meaningful image alternative text</li>
    <li>Color contrast aligned with our navy / gold / cream branding</li>
    <li>Responsive, mobile-friendly layouts</li>
  </ul>
  <h2 style="font-size:1.25rem;font-weight:600;color:${NAVY};margin-top:1.5rem;">Feedback</h2>
  <p style="margin-top:0.5rem;">If you encounter an accessibility barrier, contact us:</p>
  <p style="margin-top:0.5rem;">
    Email: <a href="mailto:admin@vcsheriffsfoundation.org" style="color:${NAVY};text-decoration:underline;">admin@vcsheriffsfoundation.org</a><br>
    Phone: <a href="tel:8054924398" style="color:${NAVY};text-decoration:underline;">(805) 492-4398</a><br>
    Mail: P.O. Box 3007, Camarillo, CA 93011
  </p>
</div>
`.trim();

async function main() {
  const pages = [
    page('privacy', "Privacy Policy | Ventura County Sheriff's Foundation", PRIVACY_HTML),
    page('accessibility', "Accessibility Statement | Ventura County Sheriff's Foundation", ACCESSIBILITY_HTML),
  ];

  for (const p of pages) {
    const [[existing]] = await db.query('SELECT id FROM website_pages WHERE slug = :slug', { slug: p.slug });
    if (existing) {
      console.log(`Skipping "${p.slug}" — a page with this slug already exists (id ${existing.id}).`);
      continue;
    }
    await db.query(
      'INSERT INTO website_pages (title, slug, status, puck_data) VALUES (:title, :slug, :status, :puck_data)',
      { title: p.title, slug: p.slug, status: 'published', puck_data: JSON.stringify(p.puck_data) }
    );
    console.log(`Created page "${p.slug}".`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
