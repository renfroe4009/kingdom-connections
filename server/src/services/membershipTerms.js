// =============================================================================
// How a membership signup bills, by the frequency the donor picked in the
// /join give widget. Used by both the card signup (routes/membership.js) and
// the ACH signup (routes/payments.js), and by billing-cron.js to close out a
// one-time year.
//
//   once     one payment buys one year of membership. The subscriptions row
//            still exists — it's what makes someone a member in Admin →
//            Members and the portal — but auto_charge is off and end_date is
//            the start date, so billing-cron.js closes it at the one-year mark
//            instead of invoicing a renewal.
//   monthly  the tier price every month until the member cancels.
//
// Anything other than 'monthly' is treated as 'once', so a caller that sends
// no frequency can never set up a recurring charge by accident. A tier's own
// interval_unit/interval_count no longer decides how a new signup bills.
// =============================================================================

function membershipTerms(frequency, startDate) {
  if (frequency === 'monthly') {
    return { frequency: 'monthly', label: 'monthly', intervalUnit: 'month', intervalCount: 1, autoCharge: 1, endDate: null };
  }
  return { frequency: 'once', label: 'one-time, 1 year', intervalUnit: 'year', intervalCount: 1, autoCharge: 0, endDate: startDate };
}

const toDateStr = (v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

// A one-time membership whose paid year is up: its next cycle would start
// after end_date, so there is nothing left to bill. Deliberately narrow (tier
// membership, auto_charge off) so no other kind of subscription is affected.
function isEndedOneTimeMembership(sub) {
  return Boolean(sub.membership_tier_id) && !Number(sub.auto_charge)
    && Boolean(sub.end_date) && toDateStr(sub.next_run_date) > toDateStr(sub.end_date);
}

module.exports = { membershipTerms, isEndedOneTimeMembership };
