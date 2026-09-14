// =============================================================================
// brandColors — the org's brand colours, with one set of neutral fallbacks.
//
// Every server-rendered surface that paints a brand colour (emails, receipts,
// PDFs, the hosted payment page, the public theme endpoint) reads it from
// business_settings. When a colour is blank, they must all fall back to the
// same *neutral* values — never a specific client's palette. This codebase is
// cloned from project to project, and per-file fallbacks drifted into a
// previous client's navy/gold and the boilerplate's orange, which then
// surfaced on the next client's receipts the moment a colour field was
// cleared. Keeping the fallbacks here is what stops that recurring.
//
// NEUTRAL matches the client-side defaults in client/src/frontend/theme/
// siteTheme.js (THEME_DEFAULTS) and site.css, so server- and client-rendered
// surfaces agree when nothing is configured.
// =============================================================================
const { db } = require('../db');

const NEUTRAL = Object.freeze({
  primary:   '#1f2937',
  secondary: '#4b5563',
});

/** A stored colour, or the neutral fallback when it is blank. */
function withFallback(value, fallback) {
  const v = typeof value === 'string' ? value.trim() : '';
  return v || fallback;
}

/**
 * The org's primary/secondary colours from business_settings.
 * Never throws — a failed read yields the neutral palette.
 */
async function getBrandColors() {
  try {
    const [[row]] = await db.query(
      'SELECT primary_color, secondary_color FROM business_settings WHERE id = 1'
    );
    return {
      primary:   withFallback(row?.primary_color, NEUTRAL.primary),
      secondary: withFallback(row?.secondary_color, NEUTRAL.secondary),
    };
  } catch (_e) {
    return { ...NEUTRAL };
  }
}

module.exports = { NEUTRAL, withFallback, getBrandColors };
