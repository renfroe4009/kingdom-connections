// =============================================================================
// Quick diagnostic: dump the latest payment row(s) for a given invoice number.
//
// Usage:
//   cd server && node scripts/inspect-latest-payment.js INV-2026-000011
//
// Tells us at a glance:
//   * was a payment row even created?
//   * what status? (pending = customer never finished; captured = something
//     flipped it — either webhook, postMessage listener, or manual fallback)
//   * what fields landed? (NULL card_brand + NULL external_txn_id + status=
//     captured = manual fallback button was clicked, no gateway data captured)
// =============================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

(async () => {
  const invNum = process.argv[2];
  if (!invNum) {
    console.error('Usage: node scripts/inspect-latest-payment.js <invoice_number>');
    process.exit(1);
  }
  const [invs] = await db.query(
    'SELECT id, invoice_number, status, total, amount_paid, balance_due FROM invoices WHERE invoice_number = ? LIMIT 1',
    [invNum]
  );
  if (!invs.length) {
    console.error(`No invoice found with number ${invNum}`);
    process.exit(1);
  }
  const inv = invs[0];
  console.log('Invoice:', inv);

  // Pull every column on the row — column names vary by migration revision.
  const [pays] = await db.query(
    `SELECT * FROM payments WHERE invoice_id = ? ORDER BY id DESC`,
    [inv.id]
  );
  if (!pays.length) {
    console.log('\nNo payment rows for this invoice.');
    console.log('Diagnosis: the customer never even started a checkout, OR startCheckout failed before inserting.');
    process.exit(0);
  }

  console.log(`\nFound ${pays.length} payment row(s):`);
  for (const p of pays) {
    console.log('---');
    console.log(p);
    const authCode = p.auth_code ?? p.authCode ?? p.authorization_code ?? null;
    const empty = !p.external_txn_id && !p.card_brand && !p.card_last4 && !authCode;
    if (p.status === 'captured' && empty) {
      console.log('>> Diagnosis: status=captured but ALL gateway fields are NULL.');
      console.log('   This is the signature of the manual fallback button being clicked');
      console.log('   ("I\'ve completed payment") — no gateway data was captured.');
    } else if (p.status === 'pending' && empty) {
      console.log('>> Diagnosis: status=pending, no gateway data. Customer either');
      console.log('   abandoned the iframe or Valor never posted back.');
    } else if (p.external_txn_id) {
      console.log('>> Has external_txn_id — postMessage listener or webhook DID fire.');
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
