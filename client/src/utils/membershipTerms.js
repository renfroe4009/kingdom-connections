// =============================================================================
// A plan that won't bill again: its next cycle starts after its end_date
// (server/src/services/membershipTerms.js). That's every one-time
// membership, whose end_date is the last day of its paid year.
// =============================================================================
export function wontRenew(sub) {
  return Boolean(sub?.end_date) && String(sub.next_run_date).slice(0, 10) > String(sub.end_date).slice(0, 10);
}
