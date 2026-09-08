// =============================================================================
// Shared server-side HTML sanitizer (security remediation C-05)
//
// Used at every write boundary for a field the public site renders via
// dangerouslySetInnerHTML: blog_posts.body_html, cms_pages.body_html — both
// the human editor (Tiptap, routes/cms.js) and the AI assistant's
// markdown-to-HTML output (services/ai.js) go through this before hitting
// the database. DOMPurify is secure-by-default (strips <script>, event
// handlers, javascript:/data: URLs), but the explicit FORBID lists below
// make that policy visible here rather than relying on defaults alone.
// =============================================================================
const DOMPurify = require('isomorphic-dompurify');

const CONFIG = {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'form'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'srcdoc'],
};

function sanitizeHtml(html) {
  if (!html) return html;
  return DOMPurify.sanitize(html, CONFIG);
}

module.exports = { sanitizeHtml };
