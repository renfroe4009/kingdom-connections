// =============================================================================
// A plan that won't bill again: its next cycle starts after its end_date
// (server/src/services/membershipTerms.js). That's every one-time
// membership, whose end_date is the last day of its paid year.
// =============================================================================
export function wontRenew(sub) {
  return Boolean(sub?.end_date) && String(sub.next_run_date).slice(0, 10) > String(sub.end_date).slice(0, 10);
}

// A one-time membership specifically, as opposed to a regular plan that has
// simply run past its end date.
export function isOneTimeMembership(sub) {
  return Boolean(sub?.membership_tier_id) && !Number(sub?.auto_charge) && wontRenew(sub);
}
