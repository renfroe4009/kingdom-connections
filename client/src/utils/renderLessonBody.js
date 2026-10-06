// Lesson bodies from the Learning module carry a bodyFormat ('markdown' or
// 'html') and the module explicitly does not render them itself — "the host
// renders it, per bodyFormat" (vendor/kcc-lms/src/services/learning.ts). A
// lesson author is not a trusted source of HTML (vendor's own README), so
// both paths go through the same sanitizeHtml() used everywhere else
// database-sourced HTML reaches the page — markdown is converted to HTML
// first, then sanitized exactly like a raw HTML body would be.
import { marked } from 'marked';
import { sanitizeHtml } from './sanitizeHtml.js';

export function renderLessonBody(body, bodyFormat) {
  if (!body) return '';
  const html = bodyFormat === 'html' ? body : marked.parse(body, { breaks: true });
  return sanitizeHtml(html);
}
