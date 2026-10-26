// =============================================================================
// How a membership signup bills, by the frequency the donor picked in the
// /join give widget. Used by both the card signup (routes/membership.js) and
// the ACH signup (routes/payments.js).
//
//   once     one payment buys one year of membership. The subscriptions row
//            still exists — it's what makes someone a member in Admin →
//            Members and the portal — with auto_charge off, next_run_date a
//            year out and end_date the day before it, the last day of the
//            year. billing-cron.js never bills a cycle that starts after
//            end_date, so it closes the row when the year is up.
//   monthly  the tier price every month until the member cancels.
//
// Anything other than 'monthly' is treated as 'once', so a caller that sends
// no frequency can never set up a recurring charge by accident. A tier's own
// interval_unit/interval_count no longer decides how a new signup bills.
// =============================================================================

function lastDayOfYearFrom(startDate) {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function membershipTerms(frequency, startDate) {
  if (frequency === 'monthly') {
    return { frequency: 'monthly', label: 'monthly', intervalUnit: 'month', intervalCount: 1, autoCharge: 1, endDate: null };
  }
  return {
    frequency: 'once', label: 'one-time, 1 year', intervalUnit: 'year', intervalCount: 1, autoCharge: 0,
    endDate: startDate ? lastDayOfYearFrom(startDate) : null,
  };
}

// SQL for "this plan will not bill again": its next cycle starts after its
// end_date. True of a one-time membership from the day it's created.
const wontRenewSql = (alias) => `(${alias}.end_date IS NOT NULL AND ${alias}.next_run_date > ${alias}.end_date)`;

module.exports = { membershipTerms, wontRenewSql };
