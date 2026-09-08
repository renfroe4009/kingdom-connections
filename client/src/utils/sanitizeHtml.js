// =============================================================================
// Shared client-side HTML sanitizer (security remediation C-05)
//
// Defense in depth at every dangerouslySetInnerHTML site that renders
// database-sourced HTML (blog posts, product descriptions, builder-authored
// rich text). The server already sanitizes on write (services/sanitizeHtml.js,
// same FORBID lists), but a second, independent sanitization pass at render
// time means a bypass of one layer doesn't compromise the whole chain — and
// it's the only layer for any row written before this fix shipped.
// =============================================================================
import DOMPurify from 'dompurify';

const CONFIG = {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'form'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'srcdoc'],
};

export function sanitizeHtml(html) {
  if (!html) return html;
  return DOMPurify.sanitize(html, CONFIG);
}
