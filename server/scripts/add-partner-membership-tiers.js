#!/usr/bin/env node
// Adds the 3 "Partner" membership tiers from the new /join design
// (website-files/join.html's partners-01 section) as real, admin-managed
// membership_tiers rows — sort_order 6-8, right after Founding's 3-5, so
// MembershipBlock's existing skip/limit convention (membership_tiers has no
// category column) picks them up as a third group with skip:6, limit:3.
//
// Renewal cadence mirrors the Supporting tier's own price-to-length pattern
// (smaller price -> shorter interval): $2,500 -> 3yr, $5,000 -> 5yr,
// $10,000 -> 7yr, same as Emerald/Diamond/Ruby.
//
// Idempotent by slug — safe to re-run.
//
//   node scripts/add-partner-membership-tiers.js
//   node scripts/add-partner-membership-tiers.js --host ... --port ... --user ... --password ... --database ...

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

const TIERS = [
  {
    name: '$2,500 Partner', slug: 'partner-2500', price: 2500,
    interval_unit: 'year', interval_count: 3, sort_order: 6,
    description: 'Stand with Kingdom Connections as we carry the Gospel farther.',
    benefits_json: { cta: null, badge: null, features: [] },
  },
  {
    name: '$5,000 Partner', slug: 'partner-5000', price: 5000,
    interval_unit: 'year', interval_count: 5, sort_order: 7,
    description: 'Help plant prayer, connection, and Kingdom business across the nations.',
    benefits_json: { cta: null, badge: true, features: [] },
  },
  {
    name: '$10,000 Partner', slug: 'partner-10000', price: 10000,
    interval_unit: 'year', interval_count: 7, sort_order: 8,
    description: 'A founding partnership that multiplies reach around the globe.',
    benefits_json: { cta: null, badge: null, features: [] },
  },
];

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection({ ...CONFIG, namedPlaceholders: true });
  try {
    for (const t of TIERS) {
      const [[existing]] = await db.query('SELECT id FROM membership_tiers WHERE slug = :slug', { slug: t.slug });
      if (existing) { console.log(`= ${t.name} (${t.slug}) already exists — skipped`); continue; }
      await db.query(
        `INSERT INTO membership_tiers
           (name, slug, description, price, interval_unit, interval_count, benefits_json, is_active, sort_order)
         VALUES
           (:name, :slug, :description, :price, :interval_unit, :interval_count, CAST(:benefits AS JSON), 1, :sort_order)`,
        { ...t, benefits: JSON.stringify(t.benefits_json) }
      );
      console.log(`+ Created ${t.name} (${t.slug}) — $${t.price}, renews every ${t.interval_count} ${t.interval_unit}(s)`);
    }
  } finally {
    await db.end();
  }
  console.log('\nDone.');
})().catch((err) => { console.error(err.message); process.exit(1); });
