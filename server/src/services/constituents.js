// =============================================================================
// Constituent-record side effects fired when a gift is recorded — thin
// helpers so donations.js/billing-cron.js's four donation-creation call
// sites each stay a one-line call instead of duplicating this logic.
// =============================================================================
const { db } = require('../db');

// Tags a contact "Donor" (etc.) via the existing tags/contact_tags engine
// (see db/migrations/048_constituent_role_tags.sql) rather than a new column.
async function ensureConstituentTag(contactId, tagName) {
  if (!contactId) return;
  try {
    const [[tag]] = await db.query('SELECT id FROM tags WHERE name = :name', { name: tagName });
    if (!tag) return; // tag not seeded — no-op rather than failing the caller's flow
    await db.query(
      'INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES (:cid, :tid)',
      { cid: contactId, tid: tag.id }
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[constituents] failed to tag contact #${contactId} as "${tagName}":`, e.message);
  }
}

// Fires the 'donation.captured' automation trigger (stewardship sequences —
// thank-you emails, task reminders, etc. — configured in the Automations
// builder) for the donor's contact record. Best-effort: automation failures
// must never break the donation flow that called this.
async function notifyDonationCaptured(contactId, { amount, fundName, isRecurring }) {
  if (!contactId) return;
  try {
    const { triggerWorkflow } = require('./automations');
    const [[contact]] = await db.query('SELECT * FROM contacts WHERE id = :id', { id: contactId });
    if (!contact) return;
    await triggerWorkflow('donation.captured', 'contact', contact, {
      amount, fund_name: fundName || null, is_recurring: !!isRecurring,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[constituents] donation.captured trigger failed for contact #${contactId}:`, e.message);
  }
}

// Fires a membership lifecycle trigger ('membership.started', '.renewed',
// '.renewal_upcoming', '.lapsed') — same best-effort contract as
// notifyDonationCaptured. eventType is the trigger_type automation workflows
// match on; keep new event names added here in sync with the TRIGGERS list
// in client/src/pages/AutomationBuilder.jsx so staff can actually select them.
async function notifyMembershipEvent(eventType, contactId, { tierName, amount, nextRunDate } = {}) {
  if (!contactId) return;
  try {
    const { triggerWorkflow } = require('./automations');
    const [[contact]] = await db.query('SELECT * FROM contacts WHERE id = :id', { id: contactId });
    if (!contact) return;
    await triggerWorkflow(eventType, 'contact', contact, {
      tier_name: tierName || null, amount: amount ?? null, next_run_date: nextRunDate || null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[constituents] ${eventType} trigger failed for contact #${contactId}:`, e.message);
  }
}

// Fires 'pledge.installment_upcoming' ahead of a pledge's next installment —
// same best-effort contract as notifyMembershipEvent. Keep in sync with the
// TRIGGERS list in client/src/pages/AutomationBuilder.jsx.
async function notifyPledgeInstallmentUpcoming(contactId, { fundName, amount, dueDate } = {}) {
  if (!contactId) return;
  try {
    const { triggerWorkflow } = require('./automations');
    const [[contact]] = await db.query('SELECT * FROM contacts WHERE id = :id', { id: contactId });
    if (!contact) return;
    await triggerWorkflow('pledge.installment_upcoming', 'contact', contact, {
      fund_name: fundName || null, amount: amount ?? null, due_date: dueDate || null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[constituents] pledge.installment_upcoming trigger failed for contact #${contactId}:`, e.message);
  }
}

// Fires 'volunteer.compliance_expiring' ahead of a background-check/waiver
// expiry — same best-effort contract as the other notify* helpers. Keep in
// sync with the TRIGGERS list in client/src/pages/AutomationBuilder.jsx.
async function notifyVolunteerComplianceExpiring(contactId, { type, expiryDate } = {}) {
  if (!contactId) return;
  try {
    const { triggerWorkflow } = require('./automations');
    const [[contact]] = await db.query('SELECT * FROM contacts WHERE id = :id', { id: contactId });
    if (!contact) return;
    await triggerWorkflow('volunteer.compliance_expiring', 'contact', contact, {
      compliance_type: type || null, expiry_date: expiryDate || null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[constituents] volunteer.compliance_expiring trigger failed for contact #${contactId}:`, e.message);
  }
}

// Tags a captured payment as a donation when it settles a fund-linked
// recurring_invoice (a pledge installment) or subscription (a recurring
// donation) cycle — regardless of HOW it was paid: cron auto-charge, a
// staff-recorded manual payment, a donor's portal saved-method payment, or
// the public pay-link charge. Previously only the cron path tagged these,
// so a pledge/recurring gift paid by check or self-service portal payment
// silently never became a real donation. Idempotent — safe to call from
// every capture path without risking a duplicate `donations` row.
async function tagInvoicePaymentAsDonation(paymentId) {
  try {
    const [[existing]] = await db.query('SELECT id FROM donations WHERE payment_id = :pid', { pid: paymentId });
    if (existing) return;

    const [[pay]] = await db.query(
      `SELECT p.id AS payment_id, p.amount, p.invoice_id,
              i.recurring_invoice_id, i.subscription_id
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
        WHERE p.id = :pid AND p.status IN ('captured','authorized')`,
      { pid: paymentId }
    );
    if (!pay) return;

    let source = null;
    if (pay.recurring_invoice_id) {
      const [[ri]] = await db.query('SELECT * FROM recurring_invoices WHERE id = :id', { id: pay.recurring_invoice_id });
      if (ri?.fund_id) source = ri;
    } else if (pay.subscription_id) {
      const [[sub]] = await db.query('SELECT * FROM subscriptions WHERE id = :id', { id: pay.subscription_id });
      if (sub?.fund_id) source = sub;
    }
    if (!source) return; // not a fund-linked pledge/recurring-donation cycle

    await db.query(
      `INSERT INTO donations (contact_id, organization_id, fund_id, payment_id, invoice_id, source)
       VALUES (:contact_id, :organization_id, :fund_id, :payment_id, :invoice_id, 'form')`,
      {
        contact_id: source.contact_id || null, organization_id: source.organization_id || null,
        fund_id: source.fund_id, payment_id: paymentId, invoice_id: pay.invoice_id,
      }
    );
    await ensureConstituentTag(source.contact_id, 'Donor');
    const [[fund]] = await db.query('SELECT name FROM funds WHERE id = :id', { id: source.fund_id });
    await notifyDonationCaptured(source.contact_id, { amount: pay.amount, fundName: fund?.name, isRecurring: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[constituents] tagInvoicePaymentAsDonation failed (payment #${paymentId}):`, e.message);
  }
}

module.exports = {
  ensureConstituentTag, notifyDonationCaptured, notifyMembershipEvent,
  notifyPledgeInstallmentUpcoming, notifyVolunteerComplianceExpiring,
  tagInvoicePaymentAsDonation,
};
