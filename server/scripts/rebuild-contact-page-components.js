#!/usr/bin/env node
/* =============================================================================
 * rebuild-contact-page-components.js
 * Replaces the Contact page's 3-block RawHTML+FormEmbed structure with a
 * single ContactSection component — it already has fields for exactly this
 * content (eyebrow/heading, info items, quick links, embedded form via
 * formSlug), so no RawHTML wrapper divs are needed at all.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const GOLD = '#C9A227';

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'contact'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const byId = id => data.content.findIndex(b => b.props.id === id);

  const headerIdx = byId('RawHTML-header');
  data.content[headerIdx] = {
    type: 'ContactSection',
    props: {
      id: 'ContactSection-contact',
      bgColor: '#F8F5EF', padding: '3.5rem 1.5rem',
      formSide: 'left', accentColor: GOLD,
      infoEyebrow: "WE'D LOVE TO HEAR FROM YOU", infoHeading: 'Get in touch.', infoDescription: '',
      infoItems: [
        { icon: 'fa-solid fa-phone', label: 'Phone', value: '(805) 492-4398', href: 'tel:8054924398' },
        { icon: 'fa-solid fa-envelope', label: 'Email', value: 'admin@vcsheriffsfoundation.org', href: 'mailto:admin@vcsheriffsfoundation.org' },
        { icon: 'fa-solid fa-location-dot', label: 'Mailing Address', value: 'P.O. Box 3007\nCamarillo, CA 93011', href: '' },
      ],
      quickLinks: [
        { label: 'Facebook', url: 'https://facebook.com/vcsheriffsfoundation' },
        { label: 'Instagram', url: 'https://instagram.com/vcsfoundation' },
      ],
      formHeading: '', formSubtext: '', formSlug: 'contact',
      btnColor: GOLD, btnTextColor: '#0A1F3D', btnRadius: '16px',
      mapEmbedUrl: '', mapHeight: '220px', mapRadius: '12px',
    },
  };

  // FormEmbed-contact and RawHTML-info are now fully absorbed into ContactSection above
  data.content.splice(byId('FormEmbed-contact'), 1);
  data.content.splice(byId('RawHTML-info'), 1);

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'contact' });

  console.log('Contact page rebuilt with real components:');
  data.content.forEach((b, i) => console.log(` ${i}. ${b.type} (${b.props.id})`));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
