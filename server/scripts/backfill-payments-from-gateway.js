// =============================================================================
// Backfill payment rows with data pulled directly from the gateway.
//
// Why: when an IPN doesn't land (local dev, blocked URL, gateway hiccup), the
// payment row keeps the placeholder data we wrote at session-create time —
// no card_brand, no card_last4, no auth code, status stuck on 'pending'.
// Receipts then look bare. This script walks every payment that's missing
// enrichment data and pulls the full transaction record from the gateway.
//
// Usage:
//   cd server && node scripts/backfill-payments-from-gateway.js [--id <paymentId>] [--dry]
//
// Options:
//   --id <paymentId>   only backfill the specified payment row
//   --dry              show what would change without writing
//
// What it handles:
//   * Auth.net — tries getTransactionDetailsRequest with the locally stored
//     external_txn_id. If that fails (because external_txn_id is actually the
//     hosted-page TOKEN, not the real transId), falls back to searching the
//     gateway by invoiceNumber across unsettled + recent settled batches.
//   * Valor — calls valorFetchTransaction. (Valor's redirect URL usually
//     carries the real txn id, so the local external_txn_id is normally
//     correct already.)
//
// Idempotent: applies via the same COALESCE pattern as the webhook handlers,
// so re-running the script won't blow away non-null fields with nulls.
// =============================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { db } = require('../src/db');
const {
  getGateway,
  authnetFetchTransaction,
  authnetSearchByInvoice,
  valorFetchTransaction,
  valorSearchByInvoice,
} = require('../src/services/gateways');

const args = process.argv.slice(2);
const onlyId = (() => {
  const i = args.indexOf('--id');
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : null;
})();
const dryRun = args.includes('--dry');

// ---------- gateway-specific mappers ----------

function mapAuthnetTxn(t) {
  if (!t) return null;
  const ts = String(t.transactionStatus || '').toLowerCase();
  const status =
    ts.includes('refund')             ? 'refunded'   :
    ts.includes('void')               ? 'voided'     :
    ts.includes('declined')           ? 'failed'     :
    ts.includes('expired')            ? 'failed'     :
    ts.includes('error')              ? 'failed'     :
    ts.includes('settled')            ? 'captured'   :
    ts.includes('capturedpending')    ? 'captured'   :
    ts.includes('authorizedpending')  ? 'authorized' :
    null;  // null = leave existing status alone
  const cc = t.payment?.creditCard || {};
  const billing = t.billTo
    ? JSON.stringify({
        firstName: t.billTo.firstName, lastName: t.billTo.lastName,
        company:   t.billTo.company,   address: t.billTo.address,
        city:      t.billTo.city,      state:   t.billTo.state,
        zip:       t.billTo.zip,       country: t.billTo.country,
        phoneNumber: t.billTo.phoneNumber })
    : null;
  return {
    txnId:   t.transId || null,
    status,
    auth:    t.authCode || null,
    last4:   cc.cardNumber ? String(cc.cardNumber).slice(-4) : null,
    brand:   cc.cardType || null,
    exp:     cc.expirationDate || null,
    holder:  t.billTo
              ? `${t.billTo.firstName || ''} ${t.billTo.lastName || ''}`.trim() || null
              : null,
    avs:     t.AVSResponse || t.AVSResponseCode || null,
    avsmsg:  t.AVSResponseDescription || null,
    cvv:     t.cardCodeResponse || null,
    pmsg:    t.responseReasonDescription || t.transactionStatus || null,
    pcode:   t.responseCode || t.responseReasonCode || null,
    cip:     t.customerIP || null,
    billing,
    batch:   t.batch?.batchId || null,
    amount:  Number(t.authAmount || t.settleAmount || 0) || null,
  };
}

function mapValorTxn(json) {
  if (!json) return null;
  const d = json?.data || json;
  const ss = String(d.status || d.result || d.transactionStatus || '').toLowerCase();
  const status =
    ss.includes('refund')   ? 'refunded'   :
    ss.includes('void')     ? 'voided'     :
    ss.includes('declin')   ? 'failed'     :
    ss.includes('approv')   ? 'captured'   :
    ss.includes('captur')   ? 'captured'   :
    ss.includes('settled')  ? 'captured'   :
    ss.includes('auth')     ? 'authorized' :
    null;
  const billing = (d.billing_address || d.billingAddress)
    ? JSON.stringify({
        address: d.billing_address || d.billingAddress,
        city:    d.billing_city    || d.billingCity,
        state:   d.billing_state   || d.billingState,
        zip:     d.billing_zip     || d.billingZip,
        country: d.billing_country || d.billingCountry })
    : null;
  return {
    txnId:   d.transactionId || d.txnId || null,
    status,
    auth:    d.authCode || d.auth_code || d.approvalCode || null,
    last4:   d.cardLast4 || d.last4 || d.cardNumberLast4 || null,
    brand:   d.cardBrand || d.brand || d.cardType || null,
    exp:     d.cardExpiry || d.expiry || d.expirationDate || null,
    holder:  d.cardHolder || d.cardHolderName || d.customer_name || null,
    avs:     d.avsResult || d.avs_result || d.avsResponse || null,
    avsmsg:  d.avsMessage || d.avs_message || null,
    cvv:     d.cvvResult || d.cvv_result || d.cvvResponse || null,
    pmsg:    d.message || d.responseMessage || d.statusMessage || null,
    pcode:   d.responseCode || d.code || null,
    cip:     d.customerIp || d.customer_ip || null,
    billing,
    batch:   d.batchId || d.batch_id || null,
    amount:  Number(d.amount || d.authorizedAmount || 0) || null,
  };
}

async function applyMapped(payId, m, raw) {
  await db.query(
    `UPDATE payments
        SET status              = COALESCE(:status, status),
            external_txn_id     = COALESCE(:txnId, external_txn_id),
            external_auth_code  = COALESCE(:auth, external_auth_code),
            card_last4          = COALESCE(:last4, card_last4),
            card_brand          = COALESCE(:brand, card_brand),
            card_expiry         = COALESCE(:exp, card_expiry),
            card_holder_name    = COALESCE(:holder, card_holder_name),
            avs_result          = COALESCE(:avs, avs_result),
            avs_message         = COALESCE(:avsmsg, avs_message),
            cvv_result          = COALESCE(:cvv, cvv_result),
            processor_message   = COALESCE(:pmsg, processor_message),
            processor_code      = COALESCE(:pcode, processor_code),
            customer_ip         = COALESCE(:cip, customer_ip),
            billing_address     = COALESCE(CAST(:billing AS JSON), billing_address),
            batch_id            = COALESCE(:batch, batch_id),
            amount              = COALESCE(:amount, amount),
            processor_response  = CAST(:pr AS JSON),
            received_at         = COALESCE(received_at, NOW())
      WHERE id = :id`,
    {
      status: m.status, txnId: m.txnId, auth: m.auth, last4: m.last4,
      brand: m.brand, exp: m.exp, holder: m.holder, avs: m.avs,
      avsmsg: m.avsmsg, cvv: m.cvv, pmsg: m.pmsg, pcode: m.pcode,
      cip: m.cip, billing: m.billing, batch: m.batch, amount: m.amount,
      pr: JSON.stringify(raw),
      id: payId,
    }
  );
}

async function refreshInvoice(invoiceId) {
  const [[inv]] = await db.query('SELECT total FROM invoices WHERE id = :id', { id: invoiceId });
  if (!inv) return;
  const [[agg]] = await db.query(
    `SELECT COALESCE(SUM(amount - COALESCE(fee_amount, 0)), 0) AS paid
       FROM payments
      WHERE invoice_id = :id AND status IN ('captured','authorized')`,
    { id: invoiceId });
  const amount_paid = Math.round(Number(agg.paid) * 100) / 100;
  const balance_due = Math.round((Number(inv.total) - amount_paid) * 100) / 100;
  const isPaid = balance_due <= 0.005;
  await db.query(
    `UPDATE invoices
        SET amount_paid = :amount_paid,
            balance_due = :balance_due,
            status = CASE
              WHEN :paid = 1 THEN 'paid'
              WHEN :amount_paid > 0 AND status IN ('sent','overdue','draft') THEN 'partial'
              ELSE status END,
            paid_at = CASE WHEN :paid = 1 AND paid_at IS NULL THEN NOW() ELSE paid_at END
      WHERE id = :id`,
    { amount_paid, balance_due, paid: isPaid ? 1 : 0, id: invoiceId });
}

// ---------- per-payment driver ----------

async function backfillOne(pay) {
  const cfg = await getGateway(pay.gateway, pay.gateway_mode);
  if (!cfg) return { skipped: 'no-gateway-config' };

  if (pay.gateway === 'authnet') {
    // Try direct lookup with whatever's in external_txn_id.
    let txn = null;
    if (pay.external_txn_id) {
      const r = await authnetFetchTransaction(cfg, pay.external_txn_id).catch(() => null);
      if (r?.transaction) txn = r.transaction;
    }
    // Fallback: search by invoiceNumber.
    if (!txn && pay.invoice_number) {
      const realId = await authnetSearchByInvoice(cfg, pay.invoice_number).catch((e) => {
        console.warn(`  [search] ${e.message}`);
        return null;
      });
      if (realId) {
        const r2 = await authnetFetchTransaction(cfg, realId).catch(() => null);
        if (r2?.transaction) txn = r2.transaction;
      }
    }
    if (!txn) return { skipped: 'no-match-on-gateway' };
    const mapped = mapAuthnetTxn(txn);
    if (dryRun) return { dry: true, mapped };
    await applyMapped(pay.id, mapped, txn);
    if (mapped.status === 'captured' || mapped.status === 'authorized'
        || mapped.status === 'refunded' || mapped.status === 'voided') {
      await refreshInvoice(pay.invoice_id);
    }
    return { applied: true, mapped };
  }

  if (pay.gateway === 'valor') {
    // Try direct lookup first if we have a stored id.
    let json = null;
    if (pay.external_txn_id) {
      json = await valorFetchTransaction(cfg, pay.external_txn_id).catch((e) => {
        console.warn(`  [valor fetch] ${e.message}`);
        return null;
      });
    }
    // Fallback: search Valor by invoice number. Covers the common case where
    // we never captured the txn id locally (manual confirm, missed redirect
    // params, webhook can't reach localhost).
    if (!json && pay.invoice_number) {
      const realId = await valorSearchByInvoice(cfg, pay.invoice_number).catch((e) => {
        console.warn(`  [valor search] ${e.message}`);
        return null;
      });
      if (realId) {
        json = await valorFetchTransaction(cfg, realId).catch(() => null);
      }
    }
    if (!json) return { skipped: 'no-match-on-gateway' };
    const mapped = mapValorTxn(json);
    if (!mapped?.txnId && !mapped?.status && !mapped?.last4) {
      return { skipped: 'valor-empty-response', raw: json };
    }
    if (dryRun) return { dry: true, mapped };
    await applyMapped(pay.id, mapped, json);
    if (mapped.status === 'captured' || mapped.status === 'authorized'
        || mapped.status === 'refunded' || mapped.status === 'voided') {
      await refreshInvoice(pay.invoice_id);
    }
    return { applied: true, mapped };
  }

  return { skipped: `unsupported-gateway:${pay.gateway}` };
}

// ---------- main ----------

async function main() {
  const where = onlyId
    ? 'p.id = :pid'
    // Default: any payment that's still missing card_brand OR is stuck pending,
    // and has SOMETHING we can use to find it (token or invoice number).
    : `(p.card_brand IS NULL OR p.status = 'pending')
       AND (p.external_txn_id IS NOT NULL OR i.invoice_number IS NOT NULL)`;

  const [rows] = await db.query(
    `SELECT p.id, p.invoice_id, p.gateway, p.gateway_mode, p.status, p.amount,
            p.external_txn_id, p.card_brand, p.card_last4,
            i.invoice_number
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
      WHERE ${where}
      ORDER BY p.id DESC`,
    onlyId ? { pid: onlyId } : {}
  );

  if (!rows.length) {
    console.log('No candidate payments. Nothing to backfill.');
    await db.end();
    return;
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Backfilling ${rows.length} payment row(s)...\n`);
  const summary = { applied: 0, skipped: 0, errored: 0 };

  for (const pay of rows) {
    const tag = `#${pay.id} (inv ${pay.invoice_number}, ${pay.gateway}/${pay.gateway_mode || '?'}, status=${pay.status})`;
    try {
      const result = await backfillOne(pay);
      if (result.applied) {
        summary.applied++;
        const m = result.mapped;
        console.log(`  ✓ ${tag} → ${m.brand || '?'} ****${m.last4 || '????'} status=${m.status || '(unchanged)'} txn=${m.txnId || '(kept)'}`);
      } else if (result.dry) {
        const m = result.mapped;
        console.log(`  ~ ${tag} would set ${m.brand || '?'} ****${m.last4 || '????'} status=${m.status || '(unchanged)'}`);
      } else {
        summary.skipped++;
        console.log(`  - ${tag} skipped: ${result.skipped}`);
      }
    } catch (e) {
      summary.errored++;
      console.error(`  ✗ ${tag} error: ${e.message}`);
    }
  }

  console.log(`\nDone. applied=${summary.applied} skipped=${summary.skipped} errored=${summary.errored}`);
  await db.end();
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
