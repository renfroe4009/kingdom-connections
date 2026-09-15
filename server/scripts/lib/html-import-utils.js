// =============================================================================
// html-import-utils — the pure, page-agnostic helpers shared by every design
// import path: the CLI script (import-design.js, whole folders) and the
// admin-facing ZIP importer (routes/pageImport.js, one design at a time).
//
// Moved out of import-design.js verbatim (no behaviour change) so both
// callers share one implementation instead of two copies that drift.
// convertSection lives in its own file (convert-sections.js) already and
// needs no changes — it operates on a parsed node, not on file paths.
// =============================================================================

/**
 * Rewrite relative asset references to absolute ones.
 *
 * `src="assets/x.png"` resolves against the current URL, so it breaks the
 * moment a page lives at a nested path. Everything becomes `/assets/x.png`.
 */
function absolutizeUrls(text) {
  return text
    .replace(/(\s(?:src|href|poster)\s*=\s*")(?!https?:|\/\/|\/|#|data:|mailto:|tel:)([^"]+)"/gi, '$1/$2"')
    .replace(/(\s(?:src|href|poster)\s*=\s*')(?!https?:|\/\/|\/|#|data:|mailto:|tel:)([^']+)'/gi, "$1/$2'")
    .replace(/(srcset\s*=\s*")([^"]+)"/gi, (m, p, list) => p + list
      .split(',')
      .map((part) => {
        const [url, ...rest] = part.trim().split(/\s+/);
        const fixed = /^(https?:|\/\/|\/|data:)/i.test(url) ? url : `/${url}`;
        return [fixed, ...rest].join(' ');
      })
      .join(', ') + '"')
    .replace(/url\((\s*['"]?)(?!https?:|\/\/|\/|data:|#)([^'")]+)(['"]?\s*)\)/gi, 'url($1/$2$3)');
}

/**
 * Rewrite links between the design's own pages onto CMS routes.
 *
 * A mockup links page-to-page by filename (`about.html`), but the CMS serves
 * pages at clean slugs (`/about`). Left alone, every internal link on the site
 * 404s — and it isn't obvious, because the links look fine in the markup.
 * `index.html` maps to `/`, and `#anchors` are preserved.
 */
function rewriteInternalLinks(text) {
  const rewrite = (quote) => new RegExp(`(\\shref\\s*=\\s*${quote})([^${quote}]+)${quote}`, 'gi');
  const replacer = (match, prefix, url, quote) => {
    if (/^(https?:|\/\/|mailto:|tel:|#|data:|javascript:)/i.test(url)) return match;
    const [pathPart, hash] = url.split('#');
    if (!/\.html?$/i.test(pathPart)) return match;
    const base = pathPart.replace(/^\.?\//, '').replace(/\.html?$/i, '');
    const route = base.toLowerCase() === 'index' ? '/' : `/${base.toLowerCase()}`;
    return `${prefix}${route}${hash ? `#${hash}` : ''}${quote}`;
  };
  return text
    .replace(rewrite('"'), (m, p, u) => replacer(m, p, u, '"'))
    .replace(rewrite("'"), (m, p, u) => replacer(m, p, u, "'"));
}

/** filename → slug. `index.html` becomes the site root page, `home`. */
function slugFor(file) {
  const path = require('path');
  const base = path.basename(file, path.extname(file)).toLowerCase();
  const slug = base === 'index' ? 'home' : base;
  return slug.replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
}

// Chrome that belongs to Web Settings, not to a page.
const CHROME_TAGS = new Set(['header', 'footer', 'nav', 'script', 'noscript', 'style']);

// Pages without a <main> fall back to <body>, where the header and footer are
// often plain <div>s. Match those by class/id so they don't become sections.
const CHROME_PATTERN = /(^|\s|-)(nav|navbar|mobile-menu|site-header|site-footer|header|footer|cookie|consent|skip-link|backdrop|overlay-menu)(\s|-|$)/i;

function isChrome(node) {
  const tag = (node.rawTagName || '').toLowerCase();
  if (CHROME_TAGS.has(tag)) return true;
  const cls = node.getAttribute('class') || '';
  const id = node.getAttribute('id') || '';
  return CHROME_PATTERN.test(cls) || CHROME_PATTERN.test(id);
}

/**
 * Parse one HTML document's body into import chunks (one per top-level
 * section, header/footer/nav skipped) and run each through convertSection
 * when `convert` is true. Page-agnostic — takes raw HTML text, not a file
 * path, so both the folder-walking CLI and the single-ZIP importer can call
 * it the same way.
 *
 * @param {string} raw          the HTML file's full text
 * @param {string} fallbackTitle used when the doc has no <title>/<h1>
 * @param {object} opts         { convert: boolean }
 */
function parsePageHtml(raw, fallbackTitle, { convert = true } = {}) {
  const { parse } = require('node-html-parser');
  const { convertSection } = require('./convert-sections');

  const root = parse(raw, { blockTextElements: { script: true, style: true } });

  const title = root.querySelector('title')?.text?.trim()
    || root.querySelector('h1')?.text?.trim()
    || fallbackTitle;
  const metaDesc = root.querySelector('meta[name="description"]')?.getAttribute('content') || '';

  const body = root.querySelector('main') || root.querySelector('body') || root;

  const chunks = [];
  const skipped = [];
  for (const node of body.childNodes) {
    if (node.nodeType !== 1) continue; // ignore text/comments between blocks
    const tag = (node.rawTagName || '').toLowerCase();
    if (isChrome(node)) {
      skipped.push(node.getAttribute('id') || (node.getAttribute('class') || '').split(/\s+/)[0] || tag);
      continue;
    }

    // Internal links first — otherwise absolutizeUrls turns `about.html` into
    // `/about.html`, which still 404s.
    const html = absolutizeUrls(rewriteInternalLinks(node.outerHTML)).trim();
    if (!html) continue;

    const id = node.getAttribute('id') || '';
    const cls = (node.getAttribute('class') || '').split(/\s+/)[0] || '';
    // The design styles sections through [data-section-type=...] as well as
    // by class, so the attribute has to survive the import or those rules
    // stop matching and the section renders unstyled.
    const sectionType = node.getAttribute('data-section-type') || '';
    const chunk = { html, id, label: id || cls || tag, sectionType };

    if (convert) {
      // Re-parse the URL-corrected markup so converted components pick up the
      // absolute asset paths too, not the originals.
      const fixed = parse(html);
      const sectionNode = fixed.childNodes.find((n) => n.nodeType === 1) || fixed;
      const result = convertSection(sectionNode, (type, props, children) => ({ type, props, children }));
      if (result.converted > 0) {
        chunk.children = result.children;
        chunk.containerClass = (sectionNode.getAttribute('class') || '');
        chunk.innerClass = result.containerClass || '';
        chunk.stats = { converted: result.converted, total: result.total };
      }
    }

    chunks.push(chunk);
  }

  return { title, metaDesc, chunks, skipped };
}

/* ── Craft node-tree construction ─────────────────────────────────────────── */

let seq = 0;
const nextId = (prefix) => `${prefix}${(seq += 1)}`;

/**
 * Wrap each chunk of imported markup in a Section holding an HTML block (or,
 * when converted, Section → Row → Column → [components]).
 *
 * The Section is a *transparent* wrapper — full-bleed, no padding — because
 * the imported markup already carries its own spacing and width. Adding the
 * usual 64px padding and max-width here would visibly change the design.
 */
function buildTree(chunks) {
  seq = 0;
  const nodes = {};
  const rootChildren = [];

  chunks.forEach((chunk) => {
    const sectionId = nextId('sec');
    const htmlId = nextId('html');

    nodes[sectionId] = {
      type: { resolvedName: 'Section' },
      isCanvas: true,
      displayName: 'Section',
      custom: { displayName: chunk.label },
      parent: 'ROOT',
      hidden: false,
      nodes: [htmlId],
      linkedNodes: {},
      props: {
        // Deliberately blank. The imported markup already carries the design's
        // own id (e.g. <section id="hero">), and repeating it on the wrapper
        // would put two identical ids in the document — which silently breaks
        // anchor links and any `#hero { … }` rule in the stylesheet.
        customId: '',
        customClass: '',
        sectionType: chunk.sectionType || '',
        background: '',
        textColor: '',
        backgroundImage: '',
        overlay: false,
        overlayColor: 'rgb(0 0 0 / 0.45)',
        // Left unset (not 0) so the panel fields start blank and no inline
        // padding overrides the design's own spacing. importedDesign keeps
        // blank meaning "no extra padding" rather than site.css's 64px default.
        paddingTop: null,
        paddingBottom: null,
        paddingTopMobile: '',
        paddingBottomMobile: '',
        paddingX: null,
        maxWidth: '',
        fullBleed: true,
        importedDesign: true,
      },
    };

    // Without conversion (or when no rule matched), the whole section stays
    // as one verbatim HTML block.
    if (!chunk.children || !chunk.children.length) {
      nodes[htmlId] = {
        type: { resolvedName: 'HtmlBlock' },
        isCanvas: false,
        displayName: 'HtmlBlock',
        custom: {},
        parent: sectionId,
        hidden: false,
        nodes: [],
        linkedNodes: {},
        props: { customId: '', customClass: '', markup: chunk.html, runScripts: false },
      };
      rootChildren.push(sectionId);
      return;
    }

    // Converted: Section → Row → Column → [components]. The Row and Column are
    // full-width and gap-free so they add no layout of their own; the design's
    // own container CSS keeps doing that job.
    const rowId = nextId('row');
    const colId = nextId('col');
    nodes[sectionId].nodes = [rowId];
    nodes[sectionId].props.customClass = chunk.containerClass || '';

    nodes[rowId] = {
      type: { resolvedName: 'Row' },
      isCanvas: true,
      displayName: 'Row',
      custom: {},
      parent: sectionId,
      hidden: false,
      nodes: [colId],
      linkedNodes: {},
      // The design's own container class rides on the Row. Row suppresses its
      // `bx-row` layout whenever importedClass is set, so this reproduces the
      // original wrapper (max-width, centring, gutters) rather than fighting it.
      props: {
        customId: '', customClass: '', importedClass: chunk.innerClass || '',
        mode: 'grid', gap: 0, align: 'stretch', justify: 'flex-start', wrap: true,
      },
    };

    nodes[colId] = {
      type: { resolvedName: 'Column' },
      isCanvas: true,
      displayName: 'Column',
      custom: {},
      parent: sectionId ? rowId : null,
      hidden: false,
      nodes: [],
      linkedNodes: {},
      props: {
        customId: '', customClass: '', span: 12, spanTablet: '', spanMobile: '',
        padding: {}, gap: 0, verticalAlign: 'flex-start', horizontalAlign: 'stretch', textAlign: '',
      },
    };

    // Rules can emit nested structures (Row → Column → components), so build
    // the subtree recursively rather than assuming one flat level.
    const CANVAS_TYPES = new Set(['Section', 'Row', 'Column']);
    const addSpec = (spec, parentId) => {
      const nodeId = nextId('n');
      nodes[nodeId] = {
        type: { resolvedName: spec.type },
        isCanvas: CANVAS_TYPES.has(spec.type),
        displayName: spec.type,
        custom: {},
        parent: parentId,
        hidden: false,
        nodes: [],
        linkedNodes: {},
        props: spec.props,
      };
      nodes[parentId].nodes.push(nodeId);
      for (const child of spec.children || []) addSpec(child, nodeId);
      return nodeId;
    };

    for (const spec of chunk.children) addSpec(spec, colId);

    rootChildren.push(sectionId);
  });

  nodes.ROOT = {
    type: { resolvedName: 'PageRoot' },
    isCanvas: true,
    displayName: 'PageRoot',
    custom: {},
    parent: null,
    hidden: false,
    nodes: rootChildren,
    linkedNodes: {},
    props: { background: '', textColor: '', maxWidth: '' },
  };

  return nodes;
}

module.exports = { absolutizeUrls, rewriteInternalLinks, slugFor, isChrome, parsePageHtml, buildTree };
