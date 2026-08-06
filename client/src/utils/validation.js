// =============================================================================
// Shared client-side validation helpers. These mirror server-side rules
// (server/src/routes/*.js Zod schemas) closely enough to catch the same
// mistakes before a round-trip to the API — they do NOT replace server
// validation, which remains the source of truth (never relax a server rule
// to match these).
// =============================================================================

// Same intent as the server's z.string().email() (server/src/routes/contacts.js) —
// require an @ and a dot-containing domain. Not byte-identical to Zod's
// internal regex, but same class of "is this shaped like an email" check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Permissive US phone: accepts an optional leading 1/+1, then 10 digits with
// any mix of spaces/dots/dashes/parens as separators.
const PHONE_RE = /^\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;

export const PHONE_HINT = 'e.g. 805-555-1234';

export function isValidEmail(value) {
  if (!value || !value.trim()) return true; // emptiness is a separate "required" check
  return EMAIL_RE.test(value.trim());
}

export function isValidPhone(value) {
  if (!value || !value.trim()) return true;
  return PHONE_RE.test(value.trim());
}

export function isBlank(value) {
  return value == null || String(value).trim() === '';
}
