// =============================================================================
// membership_tiers.benefits_json comes in two shapes: the original plain list
// of benefit strings, and { badge, features, cta, image } — the shape
// server/scripts/migrate-membership-benefits-shape.js moved the seeded tiers
// to for the /join Membership block. Normalises either (or the JSON string a
// driver may hand back) to the object shape, so every reader gets
// `features` as an array and the other keys pass through untouched.
// =============================================================================
export function parseTierBenefits(value) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  if (Array.isArray(parsed)) return { features: parsed };
  if (parsed && typeof parsed === 'object') {
    return { ...parsed, features: Array.isArray(parsed.features) ? parsed.features : [] };
  }
  return { features: [] };
}
