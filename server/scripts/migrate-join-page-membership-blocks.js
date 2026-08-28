#!/usr/bin/env node
/* =============================================================================
 * migrate-join-page-membership-blocks.js
 *
 * The /join page's two membership sections ("Supporting Members" and
 * "Founding Members") currently each hold a static CardGrid node — cards with
 * hardcoded prices/copy and a dead link to the old kingdomconnection.world
 * signup.php. This swaps both CardGrid nodes for the new MembershipBlock
 * (client/src/builder/nodes/MembershipBlock.jsx), which fetches real tiers
 * from /api/membership/public/tiers and runs the actual join/checkout flow.
 *
 * membership_tiers has no column separating the 6 tiers into the two groups
 * seen in the mockup, but sort_order (0-5) already matches it exactly:
 *   0-2 Emerald/Diamond/Ruby   -> Supporting Members section (skip 0, limit 3)
 *   3-5 Eagle/Liberty/Patriot  -> Founding Members section   (skip 3, limit 3)
 * The Supporting cards show the benefit bullet list (matching join.html);
 * the Founding cards don't (showFeatures: false), matching the mockup.
 *
 * Only the CardGrid node itself is replaced — same node id, same parent —
 * so the section/row/column/heading nodes around it (and their copy) are
 * untouched. Run migrate-membership-benefits-shape.js first so each tier's
 * benefits_json carries the { badge, features, cta } shape this block reads
 * (a tier with the old plain-array shape just renders with an empty benefit
 * list and a generic "Select {name}" button, so this is safe to run either
 * order, but the cards won't look right until both have run).
 *
 * Idempotent — a node already of type MembershipBlock is left alone.
 *
 * Run: cd server && node scripts/migrate-join-page-membership-blocks.js
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const MEMBERSHIP_DEFAULT_PROPS = {
  customId: '',
  customClass: '',
  heading: '',
  blurb: '',
  showFeatures: true,
  ctaTemplate: 'Select {name}',
  footnoteText: '',
  thankYouText: 'Thank you — your membership is active. A confirmation has been emailed to you.',
};

const TARGETS = [
  { nodeId: 'n67', skip: 0, limit: 3, showFeatures: true, label: 'Supporting Members (join-tiers)' },
  { nodeId: 'n76', skip: 3, limit: 3, showFeatures: false, label: 'Founding Members' },
];

async function main() {
  const [[page]] = await db.query("SELECT id, puck_data FROM website_pages WHERE slug = 'join'");
  if (!page) throw new Error('No website_pages row with slug "join"');

  const tree = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  let changed = false;

  for (const t of TARGETS) {
    const node = tree[t.nodeId];
    if (!node) { console.log(`! node "${t.nodeId}" not found — skipped`); continue; }
    if (node.type?.resolvedName === 'MembershipBlock') { console.log(`= "${t.nodeId}" (${t.label}) already MembershipBlock — skipped`); continue; }
    if (node.type?.resolvedName !== 'CardGrid') { console.log(`! "${t.nodeId}" is "${node.type?.resolvedName}", not CardGrid — skipped to be safe`); continue; }

    tree[t.nodeId] = {
      type: { resolvedName: 'MembershipBlock' },
      isCanvas: false,
      props: { ...MEMBERSHIP_DEFAULT_PROPS, skip: t.skip, limit: t.limit, showFeatures: t.showFeatures },
      displayName: 'Membership',
      custom: {},
      parent: node.parent,
      hidden: false,
      nodes: [],
      linkedNodes: {},
    };
    changed = true;
    console.log(`+ "${t.nodeId}" (${t.label}) -> MembershipBlock (skip ${t.skip}, limit ${t.limit})`);
  }

  if (!changed) { console.log('\nNothing to do.'); process.exit(0); }

  await db.query('UPDATE website_pages SET puck_data = :data WHERE id = :id', {
    id: page.id,
    data: JSON.stringify(tree),
  });
  console.log('\nDone.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
