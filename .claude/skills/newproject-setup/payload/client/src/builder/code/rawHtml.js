// Helpers for rendering user-authored HTML/CSS/JS.
//
// THE TRAP: assigning markup with innerHTML never executes any <script> inside
// it — the browser parses the tags but flags them as already-executed. The only
// way to run user JS is to build a real <script> element and append it. This is
// used by both the HTML block and the code-mode page renderer.

/**
 * Inject markup into a container and then re-create its scripts so they run.
 * Returns a cleanup function that removes anything appended outside the
 * container (nothing today, but keeps the contract stable).
 */
export function injectHtml(container, markup) {
  if (!container) return;
  container.innerHTML = markup || '';
  runScriptsIn(container);
}

/** Re-create every <script> inside `container` so the browser executes it. */
export function runScriptsIn(container) {
  if (!container) return;
  const scripts = Array.from(container.querySelectorAll('script'));
  for (const old of scripts) {
    const script = container.ownerDocument.createElement('script');
    for (const attr of old.attributes) script.setAttribute(attr.name, attr.value);
    script.textContent = old.textContent;
    old.replaceWith(script);
  }
}

/**
 * Run a standalone block of JS in a document. Returns a cleanup that removes
 * the element — important in an SPA, where leaving a page must not leave its
 * script tag behind.
 */
export function appendScript(code, doc = document, marker = 'data-page-js') {
  if (!code) return () => {};
  const script = doc.createElement('script');
  script.setAttribute(marker, 'true');
  script.textContent = code;
  doc.body.appendChild(script);
  return () => script.remove();
}

/* ── Pretty-printing ───────────────────────────────────────────────────────
 * The HTML we hand the code editor comes from `innerHTML`, which is one
 * enormous line — unreadable and miserable to edit. These indent it.
 *
 * The one rule that matters for correctness: whitespace between *inline*
 * elements is rendered, so breaking `<p>Hello <strong>you</strong></p>` across
 * lines would visibly change the page. Only block-level elements get their own
 * line; anything whose children are all phrasing content stays on one.
 */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn', 'em',
  'i', 'img', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong',
  'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);

function openTag(el) {
  const attrs = Array.from(el.attributes)
    .map((a) => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`)
    .join('');
  return `<${el.tagName.toLowerCase()}${attrs}>`;
}

/** Indent the children of a DOM node into readable markup. */
export function formatHtmlNode(root, indent = '  ') {
  const lines = [];

  const walk = (node, depth) => {
    const pad = indent.repeat(depth);
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent.replace(/\s+/g, ' ').trim();
        if (text) lines.push(pad + text);
        continue;
      }
      if (child.nodeType === Node.COMMENT_NODE) {
        lines.push(`${pad}<!--${child.textContent}-->`);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = child.tagName.toLowerCase();
      if (VOID_TAGS.has(tag)) {
        lines.push(pad + openTag(child));
        continue;
      }

      // `pre` and `textarea` render their whitespace verbatim — never reflow.
      if (tag === 'pre' || tag === 'textarea') {
        lines.push(`${pad}${openTag(child)}${child.innerHTML}</${tag}>`);
        continue;
      }

      const inlineOnly = Array.from(child.childNodes).every(
        (n) => n.nodeType === Node.TEXT_NODE
          || (n.nodeType === Node.ELEMENT_NODE && INLINE_TAGS.has(n.tagName.toLowerCase())),
      );

      if (inlineOnly) {
        const inner = child.innerHTML.replace(/\s+/g, ' ').trim();
        lines.push(`${pad}${openTag(child)}${inner}</${tag}>`);
        continue;
      }

      lines.push(pad + openTag(child));
      walk(child, depth + 1);
      lines.push(`${pad}</${tag}>`);
    }
  };

  walk(root, 0);
  return lines.join('\n');
}

/** Same, but taking (and returning) a markup string. */
export function formatHtmlString(html, indent = '  ') {
  if (!html || !html.trim()) return '';
  try {
    const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
    return formatHtmlNode(parsed.body, indent);
  } catch {
    // Never lose the user's markup to a formatting failure.
    return html;
  }
}

/** Inject a <style> and return a cleanup. */
export function appendStyle(cssText, doc = document, marker = 'data-page-css') {
  if (!cssText) return () => {};
  const style = doc.createElement('style');
  style.setAttribute(marker, 'true');
  style.textContent = cssText;
  doc.head.appendChild(style);
  return () => style.remove();
}
