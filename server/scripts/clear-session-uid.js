// =============================================================================
// One-shot fix: clear the Valor session uid out of external_txn_id on rows
// where the hosted-page session token was incorrectly stored as the
// transaction id. Run once after the schema-clarification fix in
// routes/payments.js so existing payment rows align with the new convention
// (external_txn_id = real Valor transactionId, NULL otherwise).
//
// We identify "session uid was stored, not txn id" with two signals:
//   1. external_txn_id has a value AND
//   2. card_brand IS NULL AND card_last4 IS NULL
//
// A row that has card data must have been enriched from a real txn lookup,
// so we leave those alone. A row missing card data with an external_txn_id
// is almost certainly holding a stale session token — clear it.
//
// Usage:
//   cd server && node scripts/clear-session-uid.js [--dry]
// =============================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const dry = process.argv.includes('--dry');

(async () => {
  const [rows] = await db.query(
    `SELECT p.id, p.invoice_id, i.invoice_number, p.external_txn_id, p.status
       FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.gateway = 'valor'
        AND p.external_txn_id IS NOT NULL
        AND p.card_brand IS NULL
        AND p.card_last4 IS NULL`
  );
  if (!rows.length) {
    console.log('No payment rows match. Nothing to clear.');
    process.exit(0);
  }
  console.log(`${dry ? '[DRY] ' : ''}Clearing external_txn_id on ${rows.length} row(s):`);
  for (const r of rows) {
    console.log(`  payment #${r.id} (inv ${r.invoice_number}, status=${r.status}) was: ${r.external_txn_id}`);
  }
  if (dry) { process.exit(0); }
  const ids = rows.map((r) => r.id);
  await db.query(
    `UPDATE payments SET external_txn_id = NULL WHERE id IN (?)`,
    [ids]
  );
  console.log('\nDone.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
