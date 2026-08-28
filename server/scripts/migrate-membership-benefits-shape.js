#!/usr/bin/env node
/* =============================================================================
 * migrate-membership-benefits-shape.js
 *
 * The 6 real membership_tiers rows (Emerald/Diamond/Ruby/Eagle/Liberty/
 * Patriot) currently store benefits_json as a plain string array — the older
 * shape from before this project's Membership Craft.js block existed. The new
 * MembershipBlock.jsx (client/src/builder/nodes/MembershipBlock.jsx) expects
 * `{ badge, features, cta }`:
 *   - badge   truthy  -> renders the card as the featured/gold tier (Diamond,
 *             matching website-files/join.html's .tier-card--featured)
 *   - features        -> the existing benefit bullet list, unchanged
 *   - cta             -> exact button copy for join.html's Founding cards,
 *             which use a different verb per tier ("Become an Eagle" /
 *             "Choose Liberty" / "Choose Patriot") rather than a uniform
 *             "Select {name}" template
 *
 * Also backfills Eagle/Liberty/Patriot's `description`, which currently holds
 * a generic "Founding Member" placeholder — join.html's mockup has the real
 * per-tier sentence.
 *
 * Idempotent — matched by slug, safe to re-run. Only touches the 6 known
 * slugs; any tier an admin has since added is left untouched.
 *
 * Run: cd server && node scripts/migrate-membership-benefits-shape.js
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const UPDATES = [
  { slug: 'emerald', badge: false, cta: 'Select Emerald' },
  { slug: 'diamond', badge: true, cta: 'Select Diamond' },
  { slug: 'ruby', badge: false, cta: 'Select Ruby' },
  { slug: 'eagle', badge: false, cta: 'Become an Eagle', description: '5-Year Membership for two people · Founding Member Recognition' },
  { slug: 'liberty', badge: false, cta: 'Choose Liberty', description: '5-Year Membership for two people · Founding Member Recognition' },
  { slug: 'patriot', badge: false, cta: 'Choose Patriot', description: '7-Year Membership for four people · Founding Members Recognition' },
];

async function main() {
  for (const u of UPDATES) {
    const [[row]] = await db.query('SELECT id, benefits_json, description FROM membership_tiers WHERE slug = :slug', { slug: u.slug });
    if (!row) { console.log(`! no tier with slug "${u.slug}" — skipped`); continue; }

    const current = typeof row.benefits_json === 'string' ? JSON.parse(row.benefits_json) : row.benefits_json;
    const features = Array.isArray(current) ? current : (Array.isArray(current?.features) ? current.features : []);
    const benefits_json = JSON.stringify({ badge: u.badge ? true : null, features, cta: u.cta });
    const description = u.description ?? row.description;

    await db.query(
      'UPDATE membership_tiers SET benefits_json = CAST(:benefits AS JSON), description = :description WHERE id = :id',
      { id: row.id, benefits: benefits_json, description }
    );
    console.log(`= updated "${u.slug}" (badge=${!!u.badge}, cta="${u.cta}")`);
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
