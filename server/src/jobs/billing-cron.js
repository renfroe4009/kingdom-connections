// =============================================================================
// Billing cron — runs every hour:
//   1. Create invoices for subscriptions whose next_run_date <= today
//   2. Flip sent invoices to 'overdue' once past due date
//   3. Send dunning emails for overdue invoices (step 1 at +3d, step 2 at +10d)
// =============================================================================
const crypto = require('crypto');
const { db } = require('../db');
const { logActivity } = require('../services/activity');
const { sendMail } = require('../services/mailer');

function roundMoney(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function todayStr() { return new Date().toISOString().slice(0, 10); }

function addInterval(dateStr, unit, count) {
  const d = new Date(dateStr);
  const n = Number(count || 1);
  switch (unit) {
    case 'day':   d.setDate(d.getDate() + n); break;
    case 'week':  d.setDate(d.getDate() + 7 * n); break;
    case 'month': d.setMonth(d.getMonth() + n); break;
    case 'year':  d.setFullYear(d.getFullYear() + n); break;
    default: break;
  }
  return d.toISOString().slice(0, 10);
}

async function nextInvoiceNumber() {
  const year = new Date().getUTCFullYear();
  const prefix = `INV-${year}-`;
  const [rows] = await db.query(
    `SELECT invoice_number FROM invoices WHERE invoice_number LIKE :p ORDER BY id DESC LIMIT 1`,
    { p: `${prefix}%` });
  const last = rows[0]?.invoice_number;
  const seq = last ? Number(last.split('-').pop()) + 1 : 1;
  return `${prefix}${String(seq).padStart(6, '0')}`;
}

async function runSubscription(subId) {
  const [[sub]] = await db.query('SELECT * FROM subscriptions WHERE id = :id', { id: subId });
  if (!sub) return { ok: false, error: 'Not found' };
  if (sub.status !== 'active') return { ok: false, skipped: true, status: sub.status };

  const [items] = await db.query(
    'SELECT * FROM subscription_items WHERE subscription_id = :id ORDER BY sort_order, id', { id: subId });
  if (!items.length) return { ok: false, error: 'No line items on subscription' };

  const subtotal = roundMoney(items.reduce((a, x) => a + Number(x.quantity) * Number(x.unit_price), 0));
  const discount_amount = roundMoney(subtotal * (Number(sub.discount_rate || 0) / 100));
  const taxable = Math.max(0, subtotal - discount_amount);
  const tax_amount = roundMoney(taxable * (Number(sub.tax_rate || 0) / 100));
  const total = roundMoney(taxable + tax_amount);

  const issue_date = todayStr();
  const due_date   = addInterval(issue_date, 'day', 14);
  const number     = await nextInvoiceNumber();

  const [ins] = await db.query(
    `INSERT INTO invoices
       (payment_token, invoice_number, contact_id, organization_id, owner_id, issue_date, due_date,
        currency, subtotal, tax_rate, tax_amount, discount_rate, discount_amount,
        total, amount_paid, balance_due, status, subscription_id, memo)
     VALUES
       (:payment_token, :number, :cid, :oid, :owner, :issue, :due,
        :currency, :subtotal, :tax_rate, :tax_amount, :discount_rate, :discount_amount,
        :total, 0, :total, 'sent', :sid, :memo)`,
    {
      payment_token: crypto.randomBytes(32).toString('hex'),
      number, cid: sub.contact_id, oid: sub.organization_id, owner: sub.owner_id,
      issue: issue_date, due: due_date, currency: sub.currency,
      subtotal, tax_rate: sub.tax_rate, tax_amount,
      discount_rate: sub.discount_rate, discount_amount,
      total, sid: sub.id,
      memo: `Automatic invoice for subscription "${sub.name}"`,
    }
  );
  const invoiceId = ins.insertId;
  for (let i = 0; i < items.length; i++) {
    const li = items[i];
    const amount = roundMoney(Number(li.quantity) * Number(li.unit_price));
    await db.query(
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
       VALUES (:iid, :d, :q, :p, :a, :s)`,
      { iid: invoiceId, d: li.description, q: li.quantity, p: li.unit_price, a: amount, s: li.sort_order ?? i });
  }

  // Advance next_run_date
  const new_next = addInterval(sub.next_run_date, sub.interval_unit, sub.interval_count);
  const shouldEnd = sub.end_date && new_next > sub.end_date;
  await db.query(
    `UPDATE subscriptions
        SET next_run_date = :next,
            status = CASE WHEN :end = 1 THEN 'completed' ELSE status END
      WHERE id = :id`,
    { next: new_next, end: shouldEnd ? 1 : 0, id: sub.id });

  await logActivity({
    entityType: 'subscription', entityId: sub.id,
    action: 'billed', description: `Generated invoice ${number} ($${total.toFixed(2)})` });
  await logActivity({
    entityType: 'invoice', entityId: invoiceId,
    action: 'created', description: `Auto-generated from subscription #${sub.id}` });

  // Auto-charge: attempt to charge the vault profile on file, same as
  // recurring invoices do below in runRecurringInvoice().
  let autoPayResult = null;
  if (sub.auto_charge && sub.gateway && sub.gateway_profile_id) {
    autoPayResult = await attemptAutoCharge({
      source: sub, entityType: 'subscription', invoiceId, amount: total,
    });
  }

  return { ok: true, invoiceId, invoice_number: number, total, autoPayResult };
}

async function runDueSubscriptions() {
  const [due] = await db.query(
    `SELECT id FROM subscriptions WHERE status = 'active' AND next_run_date <= CURDATE()`);
  const results = [];
  for (const row of due) {
    try {
      results.push(await runSubscription(row.id));
    } catch (err) {
      results.push({ ok: false, id: row.id, error: err.message });
    }
  }
  return results;
}

async function markOverdue() {
  const [res] = await db.query(
    `UPDATE invoices
        SET status = 'overdue'
      WHERE status IN ('sent','partial') AND due_date < CURDATE() AND balance_due > 0`);
  return res.affectedRows || 0;
}

async function runDunning() {
  const [overdue] = await db.query(
    `SELECT i.id, i.invoice_number, i.due_date, i.balance_due, i.last_reminder_at,
            DATEDIFF(CURDATE(), i.due_date) AS days_past,
            c.email AS contact_email,
            CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
       FROM invoices i
       LEFT JOIN contacts c ON c.id = i.contact_id
      WHERE i.status = 'overdue' AND i.balance_due > 0
        AND c.email IS NOT NULL`);

  const sent = [];
  for (const inv of overdue) {
    // Send reminders at +3 and +10 days past due
    const step = inv.days_past >= 10 ? 2 : inv.days_past >= 3 ? 1 : 0;
    if (!step) continue;

    // Throttle: don't re-send within 48 hours
    if (inv.last_reminder_at) {
      const last = new Date(inv.last_reminder_at).getTime();
      if (Date.now() - last < 48 * 3600 * 1000) continue;
    }
    // Don't repeat the same step
    const [[already]] = await db.query(
      'SELECT id FROM dunning_events WHERE invoice_id = :id AND step = :step AND status = "sent" ORDER BY id DESC LIMIT 1',
      { id: inv.id, step });
    if (already) continue;

    const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    const payLink = `${origin}/pay/${inv.id}`;
    const subject = step === 1
      ? `Friendly reminder — invoice ${inv.invoice_number} is ${inv.days_past} days past due`
      : `Final notice — invoice ${inv.invoice_number} is ${inv.days_past} days past due`;
    const body =
`Hi ${inv.contact_name || ''},

Our records show invoice ${inv.invoice_number} for $${Number(inv.balance_due).toFixed(2)} is past due.

Please pay online: ${payLink}

If you've already paid, thank you — please disregard this note.`;

    try {
      await sendMail({
        to: inv.contact_email, subject, text: body,
        entityType: 'contact', entityId: null,
      });
      await db.query(
        `INSERT INTO dunning_events (invoice_id, step, channel, status, recipient, message)
         VALUES (:id, :step, 'email', 'sent', :to, :msg)`,
        { id: inv.id, step, to: inv.contact_email, msg: subject });
      await db.query('UPDATE invoices SET last_reminder_at = NOW() WHERE id = :id', { id: inv.id });
      await logActivity({
        entityType: 'invoice', entityId: inv.id,
        action: 'dunning_sent', description: `Dunning step ${step} sent to ${inv.contact_email}` });
      sent.push({ id: inv.id, step });
    } catch (err) {
      await db.query(
        `INSERT INTO dunning_events (invoice_id, step, channel, status, recipient, message)
         VALUES (:id, :step, 'email', 'failed', :to, :msg)`,
        { id: inv.id, step, to: inv.contact_email, msg: err.message });
    }
  }
  return sent;
}

// =============================================================================
// Recurring Invoice processing
// =============================================================================

async function runRecurringInvoice(riId) {
  const [[ri]] = await db.query('SELECT * FROM recurring_invoices WHERE id = :id', { id: riId });
  if (!ri) return { ok: false, error: 'Not found' };
  if (ri.status !== 'active') return { ok: false, skipped: true, status: ri.status };

  const [items] = await db.query(
    'SELECT * FROM recurring_invoice_items WHERE recurring_invoice_id = :id ORDER BY sort_order, id',
    { id: riId });
  if (!items.length) return { ok: false, error: 'No line items on recurring invoice' };

  const subtotal       = roundMoney(items.reduce((a, x) => a + Number(x.quantity) * Number(x.unit_price), 0));
  const discount_amount = roundMoney(subtotal * (Number(ri.discount_rate || 0) / 100));
  const taxable        = Math.max(0, subtotal - discount_amount);
  const tax_amount     = roundMoney(taxable * (Number(ri.tax_rate || 0) / 100));
  const total          = roundMoney(taxable + tax_amount);

  const issue_date = todayStr();
  const due_date   = addInterval(issue_date, 'day', Number(ri.due_days ?? 14));
  const number     = await nextInvoiceNumber();

  const [ins] = await db.query(
    `INSERT INTO invoices
       (payment_token, invoice_number, contact_id, organization_id, owner_id, issue_date, due_date,
        currency, subtotal, tax_rate, tax_amount, discount_rate, discount_amount,
        total, amount_paid, balance_due, status, recurring_invoice_id, memo)
     VALUES
       (:payment_token, :number, :cid, :oid, :owner, :issue, :due,
        :currency, :subtotal, :tax_rate, :tax_amount, :discount_rate, :discount_amount,
        :total, 0, :total, 'sent', :rid, :memo)`,
    {
      payment_token: crypto.randomBytes(32).toString('hex'),
      number, cid: ri.contact_id, oid: ri.organization_id, owner: ri.owner_id,
      issue: issue_date, due: due_date, currency: ri.currency,
      subtotal, tax_rate: ri.tax_rate, tax_amount,
      discount_rate: ri.discount_rate, discount_amount,
      total, rid: ri.id,
      memo: ri.memo || `Recurring invoice "${ri.name}"`,
    }
  );
  const invoiceId = ins.insertId;

  for (let i = 0; i < items.length; i++) {
    const li = items[i];
    const amount = roundMoney(Number(li.quantity) * Number(li.unit_price));
    await db.query(
      `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
       VALUES (:iid, :d, :q, :p, :a, :s)`,
      { iid: invoiceId, d: li.description, q: li.quantity, p: li.unit_price, a: amount, s: li.sort_order ?? i });
  }

  // Advance counters and next_run_date
  const new_occurrences = Number(ri.occurrences_run || 0) + 1;
  const new_next        = addInterval(ri.next_run_date, ri.interval_unit, ri.interval_count);

  // Determine if we should complete the series:
  // - max_occurrences reached, OR
  // - end_date set and next run would be after it
  const hitMax    = ri.max_occurrences && new_occurrences >= Number(ri.max_occurrences);
  const hitEnd    = ri.end_date && new_next > ri.end_date;
  const newStatus = (hitMax || hitEnd) ? 'completed' : 'active';

  await db.query(
    `UPDATE recurring_invoices
        SET next_run_date  = :next,
            occurrences_run = :occ,
            status          = :status
      WHERE id = :id`,
    { next: new_next, occ: new_occurrences, status: newStatus, id: ri.id });

  await logActivity({
    entityType: 'recurring_invoice', entityId: ri.id,
    action: 'billed',
    description: `Generated invoice ${number} ($${total.toFixed(2)}) — occurrence ${new_occurrences}${ri.max_occurrences ? ' of ' + ri.max_occurrences : ''}`,
  });
  await logActivity({
    entityType: 'invoice', entityId: invoiceId,
    action: 'created',
    description: `Auto-generated from recurring invoice #${ri.id} "${ri.name}"`,
  });

  // Auto-pay: attempt to charge the vault profile if configured.
  let autoPayResult = null;
  if (ri.auto_pay && ri.gateway && ri.gateway_profile_id) {
    autoPayResult = await attemptAutoCharge({
      source: ri, entityType: 'recurring_invoice', invoiceId, amount: total,
    });
  }

  return { ok: true, invoiceId, invoice_number: number, total, status: newStatus, autoPayResult };
}

// Fires the membership-renewal notification when the subscription behind an
// auto-charge is a membership (subscriptions.membership_tier_id, migration
// 049) rather than a fund-linked recurring donation or a generic billing
// plan. The fund-linked donation-tagging case (recurring donations AND
// pledge installments) is handled generically by
// services/constituents.js's tagInvoicePaymentAsDonation — called
// separately below, for every payment-capture path, not just this one —
// since neither `recurring_invoices` (pledges) nor a plain commerce
// payment plan has a `membership_tier_id` to check here.
async function tagRecurringDonation({ source, entityType, paymentId, amount }) {
  if (entityType !== 'subscription' || !source.membership_tier_id) return;
  const { notifyMembershipEvent } = require('../services/constituents');
  try {
    const [[tier]] = await db.query('SELECT name FROM membership_tiers WHERE id = :id', { id: source.membership_tier_id });
    await notifyMembershipEvent('membership.renewed', source.contact_id, { tierName: tier?.name, amount });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[billing-cron] failed to fire membership.renewed (subscription #${source.id}, payment #${paymentId}):`, e.message);
  }
}

// Charges the vault profile (card OR ACH-on-file — Valor's Passage.js tokenizes
// both the same way, so vaultCharge with a stored token works for either;
// see client/public/passage-save-card.html) attached to a subscription or
// recurring invoice. `source` is either row shape — both carry `.id` and
// `.gateway_profile_id`, which is all this function reads.
// Adds the mandatory processing-fee surcharge to an auto-generated invoice
// right before it's charged — mirrors the same b2b_only-gated computation
// used by one-time card charges (payments.js /public/charge/:invoiceId) and
// the storefront (checkout.js), just applied here since recurring auto-pay
// bypasses those endpoints entirely and charges the vault profile directly.
// Returns the amount actually charged (base + fee, if any).
async function applyAutoChargeFee({ cfg, source, invoiceId, baseAmount }) {
  const { computeProcessingFee } = require('../services/gateways');
  const isB2B = Boolean(source.organization_id);
  const feeAllowed = !cfg.b2b_only || isB2B;
  const fee = feeAllowed ? computeProcessingFee({ cfg, baseAmount }) : null;
  if (!fee?.amount) return { fee: null, chargeAmount: baseAmount };

  const [[{ lineCount }]] = await db.query(
    'SELECT COUNT(*) AS lineCount FROM invoice_line_items WHERE invoice_id = :id', { id: invoiceId });
  await db.query(
    `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order)
     VALUES (:invoice_id, :desc, 1, :amount, :amount, :sort_order)`,
    { invoice_id: invoiceId, desc: fee.label, amount: fee.amount, sort_order: lineCount }
  );
  await db.query(
    `UPDATE invoices SET total = total + :fee, balance_due = balance_due + :fee WHERE id = :id`,
    { fee: fee.amount, id: invoiceId }
  );

  return { fee, chargeAmount: Math.round((baseAmount + fee.amount) * 100) / 100 };
}

async function attemptAutoCharge({ source, entityType, invoiceId, amount }) {
  const {
    getGateway,
    valorVaultCharge,
    valorVaultAchCharge,
    mapValorVaultChargeResponse,
    authnetVaultCharge,
    mapAuthnetVaultChargeResponse,
  } = require('../services/gateways');

  const label = `${entityType} #${source.id}`;

  // Look up the vault profile stored in vault_profiles using the gateway_profile_id
  // (which is vault_profiles.id set on the subscription/recurring invoice).
  const [[profile]] = await db.query(
    'SELECT * FROM vault_profiles WHERE id = :id',
    { id: source.gateway_profile_id }
  );

  if (!profile) {
    // eslint-disable-next-line no-console
    console.warn(`[billing-cron] auto-pay skipped: vault profile #${source.gateway_profile_id} not found (${label})`);
    return { ok: false, skipped: true, reason: 'vault_profile_not_found' };
  }

  // Load the generated invoice for context (invoice_number, contact email).
  const [[inv]] = await db.query(
    `SELECT i.invoice_number, i.currency,
            c.email AS contact_email,
            CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
       FROM invoices i
       LEFT JOIN contacts c ON c.id = i.contact_id
      WHERE i.id = :id`,
    { id: invoiceId }
  );

  if (profile.gateway === 'valor') {
    const isAch = profile.payment_method === 'ach';

    if (isAch && !profile.valor_vault_id) {
      // eslint-disable-next-line no-console
      console.warn(`[billing-cron] auto-pay skipped: vault profile #${profile.id} has no valor_vault_id (${label})`);
      return { ok: false, skipped: true, reason: 'no_vault_id' };
    }
    if (!isAch && !profile.card_token) {
      // eslint-disable-next-line no-console
      console.warn(`[billing-cron] auto-pay skipped: vault profile #${profile.id} has no card_token (${label})`);
      return { ok: false, skipped: true, reason: 'no_card_token' };
    }

    const cfg = await getGateway('valor', null);
    if (!cfg) {
      // eslint-disable-next-line no-console
      console.warn('[billing-cron] auto-pay skipped: no active valor gateway config');
      return { ok: false, skipped: true, reason: 'no_gateway_config' };
    }

    const { fee, chargeAmount } = await applyAutoChargeFee({ cfg, source, invoiceId, baseAmount: amount });

    let chargeJson;
    try {
      if (isAch) {
        // ACH has no reusable Passage token like cards do — charge by vault
        // reference instead (see gateways.js's valorVaultAchCharge). Note:
        // unlike the card path, the mandatory processing-fee surcharge
        // computed above isn't passed through here — Valor's ACH sale API
        // has no surcharge_amount field the way /?pagesale's card path does.
        chargeJson = await valorVaultAchCharge(cfg, {
          vault_id:           profile.valor_vault_id,
          payment_profile_id: profile.valor_payment_profile_id,
          amount:             chargeAmount,
          invoicenumber:      inv?.invoice_number || `INV-${invoiceId}`,
          email:              inv?.contact_email  || undefined,
        });
      } else {
        chargeJson = await valorVaultCharge(cfg, {
          card_token:      profile.card_token,
          amount:          chargeAmount,
          invoicenumber:   inv?.invoice_number || `INV-${invoiceId}`,
          cardholdername:  profile.cardholder_name || undefined,
          email:           inv?.contact_email      || undefined,
          surcharge_amount: fee?.amount || 0,
        });
      }
    } catch (chargeErr) {
      // eslint-disable-next-line no-console
      console.error(`[billing-cron] auto-pay charge error (${label}, invoice #${invoiceId}):`, chargeErr.message);
      return { ok: false, error: chargeErr.message };
    }

    const mapped = mapValorVaultChargeResponse(chargeJson);
    const captured = mapped?.status === 'captured';
    // ACH settles over 1-3 business days rather than approving instantly — a
    // healthy debit comes back 'pending' here (Valor's IPN webhook flips it
    // to captured/failed later), not an immediate decline. Treat it as a
    // successful auto-pay attempt (not a dunning-worthy failure) — only a
    // genuine failed/voided/refunded status is a real decline.
    const pending = mapped?.status === 'pending';
    const fulfilled = captured || pending;
    const method = isAch ? 'ach' : 'card';

    // Insert payment record.
    const receiptToken = crypto.randomBytes(32).toString('hex');
    const [pIns] = await db.query(
      `INSERT INTO payments
         (invoice_id, gateway, method, amount, currency, status,
          fee_amount, fee_label,
          external_txn_id, external_auth_code,
          card_last4, card_brand, card_expiry, card_holder_name,
          processor_message, processor_code,
          processor_response, received_at, receipt_token, vault_profile_id)
       VALUES
         (:iid, 'valor', :method, :amount, :currency,
          :status, :fee, :flab,
          :txnId, :auth,
          :last4, :brand, :exp, :holder,
          :pmsg, :pcode,
          CAST(:raw AS JSON), NOW(), :rtok, :vaultProfileId)`,
      {
        iid:      invoiceId,
        method,
        amount:   chargeAmount,
        currency: inv?.currency || 'USD',
        vaultProfileId: profile.id,
        status:   mapped?.status || 'failed',
        fee:      fee?.amount || null,
        flab:     fee?.label  || null,
        txnId:    mapped?.txnId  || null,
        auth:     mapped?.auth   || null,
        last4:    mapped?.last4  || profile.last4   || null,
        brand:    mapped?.brand  || profile.card_brand || null,
        exp:      mapped?.exp    || profile.expiry   || null,
        holder:   mapped?.holder || profile.cardholder_name || null,
        pmsg:     mapped?.pmsg   || null,
        pcode:    mapped?.pcode  || null,
        raw:      JSON.stringify(chargeJson),
        rtok:     receiptToken,
      }
    );

    // Refresh invoice balance / status if the charge was captured.
    if (captured) {
      const { refreshInvoiceTotalsById } = require('../routes/invoices');
      if (typeof refreshInvoiceTotalsById === 'function') {
        const totals = await refreshInvoiceTotalsById(invoiceId);
        if (totals && totals.balance_due <= 0.005) {
          await db.query("UPDATE invoices SET status='paid', paid_at=NOW() WHERE id=:id", { id: invoiceId });
        } else if (totals && totals.amount_paid > 0) {
          await db.query("UPDATE invoices SET status='partial' WHERE id=:id AND status IN ('sent','overdue')", { id: invoiceId });
        }
      }
      const { tagInvoicePaymentAsDonation } = require('../services/constituents');
      const { maybeSendReceiptEmail } = require('../services/receipts');
      await tagInvoicePaymentAsDonation(pIns.insertId);
      await tagRecurringDonation({ source, entityType, paymentId: pIns.insertId, amount });
      await maybeSendReceiptEmail(pIns.insertId);
    }

    await logActivity({
      entityType: 'invoice', entityId: invoiceId,
      action: captured ? 'payment_captured' : pending ? 'payment_pending' : 'payment_failed',
      description: `Auto-pay via vault (${label}): ${captured ? `captured $${chargeAmount}` : pending ? `ACH debit submitted, processing $${chargeAmount}` : `failed — ${mapped?.pmsg || 'declined'}`}`,
    });

    return {
      ok:        fulfilled,
      gateway:   'valor',
      paymentId: pIns.insertId,
      txnId:     mapped?.txnId,
      status:    mapped?.status,
    };
  }

  if (profile.gateway === 'authnet') {
    if (!profile.authnet_customer_profile_id || !profile.authnet_payment_profile_id) {
      // eslint-disable-next-line no-console
      console.warn(`[billing-cron] auto-pay skipped: vault profile #${profile.id} missing authnet CIM IDs`);
      return { ok: false, skipped: true, reason: 'authnet_missing_profile_ids' };
    }

    const cfg = await getGateway('authnet', null);
    if (!cfg) {
      // eslint-disable-next-line no-console
      console.warn('[billing-cron] auto-pay skipped: no active authnet gateway config');
      return { ok: false, skipped: true, reason: 'no_gateway_config' };
    }

    const { fee, chargeAmount } = await applyAutoChargeFee({ cfg, source, invoiceId, baseAmount: amount });

    let chargeJson;
    try {
      chargeJson = await authnetVaultCharge(cfg, {
        customer_profile_id: profile.authnet_customer_profile_id,
        payment_profile_id:  profile.authnet_payment_profile_id,
        amount: chargeAmount,
        invoice_number: inv?.invoice_number || `INV-${invoiceId}`,
        description:    `Auto-pay for invoice ${inv?.invoice_number || invoiceId}`,
        surcharge_amount: fee?.amount || 0,
      });
    } catch (chargeErr) {
      // eslint-disable-next-line no-console
      console.error(`[billing-cron] auto-pay authnet charge error (${label}, invoice #${invoiceId}):`, chargeErr.message);
      return { ok: false, error: chargeErr.message };
    }

    const mapped = mapAuthnetVaultChargeResponse(chargeJson);
    const captured = mapped?.approved === true;

    // Insert payment record (same pattern as valor block above).
    const receiptToken = crypto.randomBytes(32).toString('hex');
    const [pIns] = await db.query(
      `INSERT INTO payments
         (invoice_id, gateway, method, amount, currency, status,
          fee_amount, fee_label,
          external_txn_id, external_auth_code,
          card_last4, card_brand, card_expiry, card_holder_name,
          processor_message, processor_code,
          avs_result, cvv_result,
          processor_response, received_at, receipt_token, vault_profile_id)
       VALUES
         (:iid, 'authnet', 'card', :amount, :currency,
          :status, :fee, :flab, :txnId, :auth,
          :last4, :brand, :exp, :holder,
          :pmsg, :pcode,
          :avs, :cvv,
          CAST(:raw AS JSON), NOW(), :rtok, :vaultProfileId)`,
      {
        iid:           invoiceId,
        amount:        chargeAmount,
        currency:      inv?.currency || 'USD',
        status:        captured ? 'captured' : 'failed',
        fee:           fee?.amount || null,
        flab:          fee?.label  || null,
        txnId:         mapped?.external_txn_id   || null,
        auth:          mapped?.external_auth_code || null,
        last4:         mapped?.card_last4         || profile.last4      || null,
        brand:         mapped?.card_brand         || profile.card_brand  || null,
        exp:           profile.expiry             || null,
        holder:        profile.cardholder_name    || null,
        pmsg:          mapped?.processor_message  || null,
        pcode:         mapped?.processor_code     || null,
        avs:           mapped?.avs_result         || null,
        cvv:           mapped?.cvv_result         || null,
        raw:           JSON.stringify(chargeJson),
        rtok:          receiptToken,
        vaultProfileId: profile.id,
      }
    );

    // Refresh invoice balance / status if the charge was captured.
    if (captured) {
      const { refreshInvoiceTotalsById } = require('../routes/invoices');
      if (typeof refreshInvoiceTotalsById === 'function') {
        const totals = await refreshInvoiceTotalsById(invoiceId);
        if (totals && totals.balance_due <= 0.005) {
          await db.query("UPDATE invoices SET status='paid', paid_at=NOW() WHERE id=:id", { id: invoiceId });
        } else if (totals && totals.amount_paid > 0) {
          await db.query("UPDATE invoices SET status='partial' WHERE id=:id AND status IN ('sent','overdue')", { id: invoiceId });
        }
      }
      const { tagInvoicePaymentAsDonation } = require('../services/constituents');
      const { maybeSendReceiptEmail } = require('../services/receipts');
      await tagInvoicePaymentAsDonation(pIns.insertId);
      await tagRecurringDonation({ source, entityType, paymentId: pIns.insertId, amount });
      await maybeSendReceiptEmail(pIns.insertId);
    }

    await logActivity({
      entityType: 'invoice', entityId: invoiceId,
      action: captured ? 'payment_captured' : 'payment_failed',
      description: `Auto-pay via authnet vault (${label}): ${captured ? `captured $${chargeAmount}` : `failed — ${mapped?.decline_reason || mapped?.processor_message || 'declined'}`}`,
    });

    return {
      ok:        captured,
      gateway:   'authnet',
      paymentId: pIns.insertId,
      txnId:     mapped?.external_txn_id,
      status:    captured ? 'captured' : 'failed',
    };
  }

  return { ok: false, skipped: true, reason: 'unknown_gateway' };
}

async function runDueRecurringInvoices() {
  const [due] = await db.query(
    `SELECT id FROM recurring_invoices WHERE status = 'active' AND next_run_date <= CURDATE()`);
  const results = [];
  for (const row of due) {
    try {
      results.push(await runRecurringInvoice(row.id));
    } catch (err) {
      results.push({ ok: false, id: row.id, error: err.message });
    }
  }
  return results;
}

// Fires 'membership.renewal_upcoming' once per membership per renewal cycle,
// REMINDER_DAYS before it auto-charges. Dedup is via the activities table
// (no new table needed) — without it, an hourly cron would re-fire the same
// reminder ~24x on the one calendar day the DATEDIFF matches.
const MEMBERSHIP_REMINDER_DAYS = 7;
async function checkMembershipRenewals() {
  const [dueSoon] = await db.query(
    `SELECT s.id, s.contact_id, s.next_run_date, t.name AS tier_name, t.price
       FROM subscriptions s
       JOIN membership_tiers t ON t.id = s.membership_tier_id
      WHERE s.status = 'active'
        AND DATEDIFF(s.next_run_date, CURDATE()) = :days`,
    { days: MEMBERSHIP_REMINDER_DAYS }
  );
  const { notifyMembershipEvent } = require('../services/constituents');
  let sent = 0;
  for (const sub of dueSoon) {
    const [[already]] = await db.query(
      `SELECT id FROM activities
        WHERE entity_type = 'subscription' AND entity_id = :id AND action = 'renewal_reminder_sent'
          AND created_at >= DATE_SUB(CURDATE(), INTERVAL :days DAY)`,
      { id: sub.id, days: MEMBERSHIP_REMINDER_DAYS + 1 }
    );
    if (already) continue;
    await notifyMembershipEvent('membership.renewal_upcoming', sub.contact_id, { tierName: sub.tier_name, amount: sub.price, nextRunDate: sub.next_run_date });
    await logActivity({
      entityType: 'subscription', entityId: sub.id, action: 'renewal_reminder_sent',
      description: `Renewal reminder sent — renews ${sub.next_run_date}`,
    });
    sent++;
  }
  return sent;
}

const PLEDGE_REMINDER_DAYS = 7;

// Mirrors checkMembershipRenewals exactly, for fund-linked recurring_invoices
// (pledges) instead of membership-tier subscriptions — same dedupe-via-
// activity-log pattern, same reminder window.
async function checkPledgeInstallmentsUpcoming() {
  const [dueSoon] = await db.query(
    `SELECT ri.id, ri.contact_id, ri.next_run_date, f.name AS fund_name,
            COALESCE(it.subtotal, 0) AS amount
       FROM recurring_invoices ri
       JOIN funds f ON f.id = ri.fund_id
       LEFT JOIN (
         SELECT recurring_invoice_id, SUM(quantity * unit_price) AS subtotal
           FROM recurring_invoice_items
          GROUP BY recurring_invoice_id
       ) it ON it.recurring_invoice_id = ri.id
      WHERE ri.status = 'active' AND ri.fund_id IS NOT NULL
        AND DATEDIFF(ri.next_run_date, CURDATE()) = :days`,
    { days: PLEDGE_REMINDER_DAYS }
  );
  const { notifyPledgeInstallmentUpcoming } = require('../services/constituents');
  let sent = 0;
  for (const pledge of dueSoon) {
    const [[already]] = await db.query(
      `SELECT id FROM activities
        WHERE entity_type = 'recurring_invoice' AND entity_id = :id AND action = 'installment_reminder_sent'
          AND created_at >= DATE_SUB(CURDATE(), INTERVAL :days DAY)`,
      { id: pledge.id, days: PLEDGE_REMINDER_DAYS + 1 }
    );
    if (already) continue;
    await notifyPledgeInstallmentUpcoming(pledge.contact_id, {
      fundName: pledge.fund_name, amount: pledge.amount, dueDate: pledge.next_run_date,
    });
    await logActivity({
      entityType: 'recurring_invoice', entityId: pledge.id, action: 'installment_reminder_sent',
      description: `Installment reminder sent — due ${pledge.next_run_date}`,
    });
    sent++;
  }
  return sent;
}

const COMPLIANCE_REMINDER_DAYS = 30; // longer lead time than billing reminders — background-check/waiver renewal isn't instant

// Same dedupe-via-activity-log pattern as checkMembershipRenewals /
// checkPledgeInstallmentsUpcoming, applied to volunteer_compliance_items.
async function checkComplianceExpiring() {
  const [expiringSoon] = await db.query(
    `SELECT vci.id, vci.contact_id, vci.type, vci.expiry_date
       FROM volunteer_compliance_items vci
      WHERE vci.status = 'approved'
        AND DATEDIFF(vci.expiry_date, CURDATE()) = :days`,
    { days: COMPLIANCE_REMINDER_DAYS }
  );
  const { notifyVolunteerComplianceExpiring } = require('../services/constituents');
  let sent = 0;
  for (const item of expiringSoon) {
    const [[already]] = await db.query(
      `SELECT id FROM activities
        WHERE entity_type = 'volunteer_compliance_item' AND entity_id = :id AND action = 'expiry_reminder_sent'
          AND created_at >= DATE_SUB(CURDATE(), INTERVAL :days DAY)`,
      { id: item.id, days: COMPLIANCE_REMINDER_DAYS + 1 }
    );
    if (already) continue;
    // Humanize the ENUM value for the email — "background_check" -> "Background Check"
    const typeLabel = item.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    await notifyVolunteerComplianceExpiring(item.contact_id, { type: typeLabel, expiryDate: item.expiry_date });
    await logActivity({
      entityType: 'volunteer_compliance_item', entityId: item.id, action: 'expiry_reminder_sent',
      description: `Expiry reminder sent — expires ${item.expiry_date}`,
    });
    sent++;
  }
  return sent;
}

async function tick() {
  try {
    const billed    = await runDueSubscriptions();
    const recurring = await runDueRecurringInvoices();
    const overdue   = await markOverdue();
    const dunned    = await runDunning();
    const reminded  = await checkMembershipRenewals();
    const pledgeReminded = await checkPledgeInstallmentsUpcoming();
    const complianceReminded = await checkComplianceExpiring();
    if (billed.length || recurring.length || overdue || dunned.length || reminded || pledgeReminded || complianceReminded) {
      // eslint-disable-next-line no-console
      console.log('[billing-cron] tick', { billed: billed.length, recurring: recurring.length, overdue, dunned: dunned.length, reminded, pledgeReminded, complianceReminded });
    }
    if (!global._jobStatus) global._jobStatus = {};
    global._jobStatus.billing = { lastRan: new Date().toISOString(), billed: billed.length, recurring: recurring.length, overdue, dunned: dunned.length, reminded, pledgeReminded, complianceReminded };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing-cron] tick failed:', err);
    if (!global._jobStatus) global._jobStatus = {};
    global._jobStatus.billing = { lastRan: new Date().toISOString(), error: err.message };
  }
}

function startBillingCron() {
  // Run 10 seconds after boot so any migration pending finishes first, then hourly.
  setTimeout(tick, 10_000);
  setInterval(tick, 60 * 60 * 1000);
  // eslint-disable-next-line no-console
  console.log('[billing-cron] scheduled (hourly)');
}

module.exports = startBillingCron;
module.exports.runSubscription = runSubscription;
module.exports.runDueSubscriptions = runDueSubscriptions;
module.exports.runRecurringInvoice = runRecurringInvoice;
module.exports.runDueRecurringInvoices = runDueRecurringInvoices;
module.exports.markOverdue = markOverdue;
module.exports.runDunning = runDunning;
module.exports.checkMembershipRenewals = checkMembershipRenewals;
module.exports.checkPledgeInstallmentsUpcoming = checkPledgeInstallmentsUpcoming;
module.exports.checkComplianceExpiring = checkComplianceExpiring;
module.exports.addInterval = addInterval;
