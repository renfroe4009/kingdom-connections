#!/usr/bin/env node
/* =============================================================================
 * migrate-join-page-give-widget.js
 *
 * Two changes to the /join page's Craft.js tree (website_pages.puck_data),
 * matching migrate-join-page-membership-blocks.js's exact technique (replace
 * a node in place — same id, same parent, so everything around it is
 * untouched):
 *
 * 1. The Partners section (smumko4390_sec1) still holds 3 hand-built static
 *    cards (Column > Column x3 > TextBlock/ButtonBlock) under node
 *    smumko4390_n13 — the one piece of /join not yet converted to a live
 *    MembershipBlock. Swapped for a 3rd MembershipBlock (skip:6, limit:3 —
 *    the Partner tiers added by add-partner-membership-tiers.js), same
 *    convention as the existing Supporting (skip:0) and Founding (skip:3)
 *    instances. The old static cards' now-orphaned descendant nodes are
 *    deleted from the tree entirely (found by walking n13's own `nodes`
 *    array recursively — not hardcoded ids — so this doesn't assume the
 *    exact shape found when this script was written).
 *
 * 2. The existing "#give" DonationBlock (donation-join-1) already has the
 *    right 4 tabs (Supporting/Founding/Partner/General) and the right
 *    backLabel/backUrl — but its amounts are hardcoded strings
 *    ("50,100*,250") rather than live tiers, and every tab (including the
 *    3 membership ones) runs through the generic donations pipeline rather
 *    than the real membership signup. Swapped for GiveWidgetBlock
 *    (client/src/builder/nodes/GiveWidgetBlock.jsx), which fetches live
 *    tiers for its membership-kind tabs and routes them through
 *    /api/membership/public/signup instead.
 *
 * Idempotent — a node already of the target type is left alone.
 *
 * Run: cd server && node scripts/migrate-join-page-give-widget.js
 *      node scripts/migrate-join-page-give-widget.js --host ... --port ... --user ... --password ... --database ...
 * ========================================================================== */
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const CONFIG = {
  host: arg('host', process.env.DB_HOST),
  port: Number(arg('port', process.env.DB_PORT || 3306)),
  user: arg('user', process.env.DB_USER),
  password: arg('password', process.env.DB_PASSWORD),
  database: arg('database', process.env.DB_NAME),
};

const PARTNER_NODE_ID = 'smumko4390_n13';
const GIVE_NODE_ID = 'donation-join-1';

const MEMBERSHIP_DEFAULT_PROPS = {
  customId: '', customClass: '', heading: '', blurb: '',
  skip: 6, limit: 3, showFeatures: false,
  ctaTemplate: 'Select {name}', footnoteText: '',
};

const GIVE_WIDGET_PROPS = {
  customId: '', customClass: '', heading: '', blurb: '',
  stepHeading: 'Choose your gift',
  stepLead: 'Select one-time or monthly, then pick an amount.',
  tabs: [
    { label: 'Supporting | Membership', kind: 'membership', skip: 0, limit: 3, impact: 'Membership Portal Access, the 17 Day Discipleship Program, a Prayer Coin, and invitations to member webinars and events.' },
    { label: 'Founding | Membership', kind: 'membership', skip: 3, limit: 3, impact: 'Founding recognition, a logo gift, and VIP invitations to webinars and special events.' },
    { label: 'Partner | Membership', kind: 'membership', skip: 6, limit: 3, impact: 'Partnership that expands prayer, connection, and the Word around the globe.' },
    { label: 'General | Donations', kind: 'donation', amounts: '25,50,100*,250,500,1000', impact: 'Every gift helps Kingdom Connections connect, pray, and impact the world.' },
  ],
  allowCustom: true,
  coverFeesOption: true,
  coverFeesLabel: 'Cover processing fees',
  fundSlug: 'general-fund',
  backLabel: '← Membership levels',
  backUrl: '#levels',
  buttonLabel: 'Continue',
  thankYouText: 'Thank you — your gift has been received. A receipt is on its way to your email.',
  disclaimerText: 'Payments processed securely. A receipt is sent to your email automatically.',
};

function collectDescendants(tree, id, out) {
  const node = tree[id];
  if (!node) return out;
  for (const childId of node.nodes || []) {
    out.push(childId);
    collectDescendants(tree, childId, out);
  }
  return out;
}

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection({ ...CONFIG, namedPlaceholders: true });
  try {
    const [[page]] = await db.query("SELECT id, puck_data FROM website_pages WHERE slug = 'join'");
    if (!page) throw new Error('No website_pages row with slug "join"');

    const tree = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
    let changed = false;

    // --- 1. Partner cards -> 3rd MembershipBlock ---
    const partnerNode = tree[PARTNER_NODE_ID];
    if (!partnerNode) {
      console.log(`! node "${PARTNER_NODE_ID}" not found — skipped`);
    } else if (partnerNode.type?.resolvedName === 'MembershipBlock') {
      console.log(`= "${PARTNER_NODE_ID}" already MembershipBlock — skipped`);
    } else {
      const toDelete = collectDescendants(tree, PARTNER_NODE_ID, []);
      tree[PARTNER_NODE_ID] = {
        type: { resolvedName: 'MembershipBlock' },
        isCanvas: false,
        props: { ...MEMBERSHIP_DEFAULT_PROPS },
        displayName: 'Membership',
        custom: {},
        parent: partnerNode.parent,
        hidden: false,
        nodes: [],
        linkedNodes: {},
      };
      for (const id of toDelete) delete tree[id];
      changed = true;
      console.log(`+ "${PARTNER_NODE_ID}" -> MembershipBlock (skip 6, limit 3), deleted ${toDelete.length} orphaned descendant node(s)`);
    }

    // --- 2. #give DonationBlock -> GiveWidgetBlock ---
    const giveNode = tree[GIVE_NODE_ID];
    if (!giveNode) {
      console.log(`! node "${GIVE_NODE_ID}" not found — skipped`);
    } else if (giveNode.type?.resolvedName === 'GiveWidgetBlock') {
      console.log(`= "${GIVE_NODE_ID}" already GiveWidgetBlock — skipped`);
    } else if (giveNode.type?.resolvedName !== 'DonationBlock') {
      console.log(`! "${GIVE_NODE_ID}" is "${giveNode.type?.resolvedName}", not DonationBlock — skipped to be safe`);
    } else {
      tree[GIVE_NODE_ID] = {
        type: { resolvedName: 'GiveWidgetBlock' },
        isCanvas: false,
        props: { ...GIVE_WIDGET_PROPS },
        displayName: 'Give Widget',
        custom: {},
        parent: giveNode.parent,
        hidden: false,
        nodes: [],
        linkedNodes: {},
      };
      changed = true;
      console.log(`+ "${GIVE_NODE_ID}" -> GiveWidgetBlock`);
    }

    if (!changed) { console.log('\nNothing to do.'); return; }

    await db.query('UPDATE website_pages SET puck_data = :data WHERE id = :id', {
      id: page.id,
      data: JSON.stringify(tree),
    });
    console.log('\nDone.');
  } finally {
    await db.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
