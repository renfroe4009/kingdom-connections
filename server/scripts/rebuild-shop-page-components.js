#!/usr/bin/env node
/* =============================================================================
 * rebuild-shop-page-components.js
 * Replaces the Shop page's RawHTML product grid with a real, editable
 * CardGrid component — same 6 items, same images/prices, plus a closing
 * TextBlock for the bulk-order note. Left as static "contact to order" cards
 * rather than switching to the real ShopListing/cart system, since that would
 * mean creating live product/price/tax records — a separate decision.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';

async function main() {
  const [[page]] = await db.query("SELECT puck_data FROM website_pages WHERE slug = 'shop'");
  const data = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  const byId = id => data.content.findIndex(b => b.props.id === id);

  const shopIdx = byId('RawHTML-shop');
  data.content[shopIdx] = {
    type: 'CardGrid',
    props: {
      id: 'CardGrid-shop',
      label: 'OFFICIAL MERCHANDISE', heading: 'Shop & Show Your Support',
      headingColor: NAVY, subtext: 'All proceeds benefit Ventura County deputies & programs.', subtextColor: '#6b7280',
      columns: 3, cardStyle: 'bordered', bgColor: '#ffffff',
      cardBg: '#ffffff', cardTitleColor: NAVY, cardTextColor: '#6b7280', cardLinkColor: GOLD,
      iconColor: GOLD, btnRadius: '16px', cardTitleSize: '1.1rem',
      animation: 'none', animDelay: '0',
      items: [
        { image: '/api/website/media/file/media/library/2026-07-08/c693187460dd6b37cf4f4c79c424e5d3a1beb5d3.jpg', icon: '', title: 'Backing the Badge Yard Sign — $10', text: 'Show your support in your front yard', link: '/contact', linkText: 'Order — Contact Us' },
        { image: '/api/website/media/file/media/library/2026-07-08/b8734e4b0c647c54343f6f0312549c5fb6c87d40.jpg', icon: '', title: 'VCSF Embroidered Polo — $45', text: 'Navy with gold logo • Sizes S–3XL', link: '/contact', linkText: 'Order — Contact Us' },
        { image: '/api/website/media/file/media/library/2026-07-08/b8734e4b0c647c54343f6f0312549c5fb6c87d40.jpg', icon: '', title: 'VCSF Embroidered Cap — $22', text: 'Navy with gold logo • Adjustable', link: '/contact', linkText: 'Order — Contact Us' },
        { image: '/api/website/media/file/media/library/2026-07-08/b8734e4b0c647c54343f6f0312549c5fb6c87d40.jpg', icon: '', title: 'VCSF Challenge Coin — $15', text: 'Limited edition • Collectible', link: '/contact', linkText: 'Order — Contact Us' },
        { image: '/api/website/media/file/media/library/2026-07-08/b8734e4b0c647c54343f6f0312549c5fb6c87d40.jpg', icon: '', title: 'VCSF Heavyweight Hoodie — $58', text: 'Premium fleece • Sizes S–3XL', link: '/contact', linkText: 'Order — Contact Us' },
        { image: '/api/website/media/file/media/library/2026-07-08/c693187460dd6b37cf4f4c79c424e5d3a1beb5d3.jpg', icon: '', title: 'Window Decal Pack (3) — $12', text: 'For car, home, or office', link: '/contact', linkText: 'Order — Contact Us' },
      ],
    },
  };

  data.content.splice(shopIdx + 1, 0, {
    type: 'TextBlock',
    props: {
      id: 'TextBlock-shop-note',
      html: `<p style="font-size:.875rem;color:#6b7280;">Questions about sizing or bulk orders for your business? <a href="/contact" style="text-decoration:underline;color:inherit;">Contact us</a>. Online checkout is coming soon.</p>`,
      maxWidth: '1200px', padding: '0 1.5rem 2.5rem', bgColor: '', textColor: '', center: 'center',
      animation: 'none', animDelay: '0',
    },
  });

  await db.query('UPDATE website_pages SET puck_data = :puck_data WHERE slug = :slug',
    { puck_data: JSON.stringify(data), slug: 'shop' });

  console.log('Shop page rebuilt with real components:');
  data.content.forEach((b, i) => console.log(` ${i}. ${b.type} (${b.props.id})`));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
