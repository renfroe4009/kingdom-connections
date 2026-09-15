// =============================================================================
// cssRuleDiff — rule-level comparison between an imported page's stylesheet
// and the site's existing CSS (website_global_settings.site_custom_css).
//
// Deliberately NOT string-diffing whole files, and deliberately NOT an AI
// judgment call: the import pipeline reuses rules that already exist,
// appends only genuinely new ones, and flags real conflicts for a human —
// the same rule, run twice, must always produce the same result.
//
// A rule is identified by its selector PLUS its enclosing at-rule chain
// (e.g. inside `@media (min-width: 768px)`), because the same selector means
// something different inside and outside a media query — that's not a
// duplicate, and must not be treated as one.
//
// @font-face and @keyframes carry no selector at all, so they're compared
// separately, keyed by their at-rule name + params (e.g. "keyframes fadeIn").
// =============================================================================
const postcss = require('postcss');
const safeParser = require('postcss-safe-parser');

/** Declarations, order-independent, whitespace/case-insensitive — comparing
 *  intent, not formatting. Not attempting deeper CSS equivalence (unit
 *  conversion, colour-format normalisation) — that's a judgment call better
 *  left to the human reviewing a flagged conflict than guessed at silently. */
function declarationSignature(container) {
  const decls = [];
  container.walkDecls((d) => {
    if (d.parent !== container) return; // this container's own decls only, not a nested rule's
    decls.push(`${d.prop.trim().toLowerCase()}:${d.value.trim().replace(/\s+/g, ' ').toLowerCase()}${d.important ? '!important' : ''}`);
  });
  return decls.sort().join(';');
}

/** The chain of enclosing at-rules, outermost first, e.g. ['media (min-width: 768px)']. */
function scopeChain(rule) {
  const chain = [];
  let p = rule.parent;
  while (p && p.type !== 'root') {
    if (p.type === 'atrule') chain.unshift(`${p.name} ${p.params}`.trim());
    p = p.parent;
  }
  return chain;
}

function ruleKey(rule) {
  return `${scopeChain(rule).join(' > ')} :: ${rule.selector.trim().replace(/\s+/g, ' ')}`;
}

/**
 * Index every selector rule and every @font-face/@keyframes block in a
 * stylesheet by its key, with a normalised signature for comparison and the
 * raw source text for re-emitting untouched.
 */
function indexStylesheet(css) {
  const index = new Map();
  let root;
  try {
    root = postcss.parse(css || '', { parser: safeParser });
  } catch (_e) {
    // Malformed input shouldn't crash the whole import — treat as empty, so
    // every rule in the OTHER stylesheet reports as new/added rather than
    // the pipeline throwing.
    return index;
  }

  root.walkRules((rule) => {
    // Skip rules whose own container is itself inside @font-face/@keyframes —
    // those are walked separately below and aren't "selector" rules.
    if (rule.parent?.type === 'atrule' && /^(-\w+-)?keyframes$/.test(rule.parent.name)) return;
    const key = ruleKey(rule);
    const sig = declarationSignature(rule);
    // A selector can legally repeat in one stylesheet (progressive enhancement
    // blocks); last one wins, matching how a real cascade would resolve it.
    index.set(key, { key, selector: rule.selector, scope: scopeChain(rule), signature: sig, source: rule.toString() });
  });

  root.walkAtRules((at) => {
    if (/^(-\w+-)?keyframes$/.test(at.name) || at.name === 'font-face') {
      const key = `@${at.name} ${at.params}`.trim();
      index.set(key, { key, selector: key, scope: [], signature: at.toString().replace(/\s+/g, ' ').toLowerCase(), source: at.toString() });
    }
  });

  return index;
}

/**
 * Compare a new page's CSS against the site's existing CSS.
 *
 * @param {string} newCss      the imported page's stylesheet text
 * @param {string} existingCss the current site_custom_css
 * @returns {{
 *   reused:    Array<{selector: string}>,
 *   added:     Array<{selector: string, source: string}>,
 *   conflicts: Array<{selector: string, existing: string, incoming: string}>,
 *   appendCss: string,   CSS text of only the `added` rules, ready to append
 * }}
 */
function diffStylesheets(newCss, existingCss) {
  const existingIndex = indexStylesheet(existingCss);
  const newIndex = indexStylesheet(newCss);

  const reused = [];
  const added = [];
  const conflicts = [];

  for (const rule of newIndex.values()) {
    const match = existingIndex.get(rule.key);
    if (!match) {
      added.push({ selector: rule.selector, source: rule.source });
    } else if (match.signature === rule.signature) {
      reused.push({ selector: rule.selector });
    } else {
      conflicts.push({ selector: rule.selector, existing: match.source, incoming: rule.source });
    }
  }

  const appendCss = added.map((a) => a.source).join('\n\n');

  return { reused, added, conflicts, appendCss };
}

module.exports = { diffStylesheets, indexStylesheet, declarationSignature };
