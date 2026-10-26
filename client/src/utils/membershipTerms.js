// =============================================================================
// A one-time membership (server/src/services/membershipTerms.js) is a
// subscriptions row with auto_charge off and end_date at its start date, so
// its next_run_date is when the paid year ends rather than a renewal date.
// =============================================================================
export function isOneTimeMembership(sub) {
  return !Number(sub?.auto_charge) && Boolean(sub?.end_date)
    && String(sub.next_run_date).slice(0, 10) > String(sub.end_date).slice(0, 10);
}
