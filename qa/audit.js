#!/usr/bin/env node
// =============================================================================
// QA audit — accessibility, responsive layout and speed for the public site.
//
// Produces measurements, not opinions. The qa-audit skill and qa-auditor agent
// read the JSON this writes and do the diagnosis; keeping the two apart means
// the numbers are reproducible and reviewable on their own.
//
//   node audit.js                                  # local dev, all discovered pages
//   node audit.js --url https://example.com        # a deployed site
//   node audit.js --only /licensing --skip-speed   # one page, layout + a11y only
//
// Exit code is 1 when anything critical or serious is found, so this can gate
// CI later without changes.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilderPkg from '@axe-core/playwright';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import * as chromeLauncher from 'chrome-launcher';

// The package ships a CJS default export; this works under both interops.
const AxeBuilder = AxeBuilderPkg.default ?? AxeBuilderPkg;

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ── Arguments ────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { args[key] = true; } else { args[key] = next; i += 1; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const BASE = String(args.url || 'http://localhost:5183').replace(/\/$/, '');
const BREAKPOINTS = String(args.breakpoints || '360,430,768,1024,1440')
  .split(',').map((n) => Number(n.trim())).filter(Boolean);
const MAX_PAGES = Number(args['max-pages'] || 12);
const OUT_DIR = args.out ? path.resolve(String(args.out)) : path.join(HERE, 'reports');

const RUN = { ada: !args['skip-ada'], responsive: !args['skip-responsive'], speed: !args['skip-speed'] };
// This is a client-rendered app whose header, footer and page body all arrive
// from the API *after* load fires. Measuring too early reports the pre-settings
// skeleton — an empty logo link reads as a `link-name` violation that doesn't
// exist once the data lands. Raise it on a slow connection.
const SETTLE_MS = Number(args.settle || 1200);
const SPEED_DESKTOP = Boolean(args['speed-desktop']);

// Paths that aren't part of the public site. Auditing the admin behind a login
// wall produces noise, not findings.
const EXCLUDED = [/^\/login/, /^\/admin/, /^\/portal/, /^\/dashboard/, /^\/api\//];

/* ── Page discovery ───────────────────────────────────────────────────────── */

/**
 * Git Bash rewrites a lone `/` argument into the MSYS root
 * (`C:/Program Files/Git/`) before Node ever sees it, so `--only /` silently
 * becomes a nonsense URL. Recognise that and anything else missing its leading
 * slash rather than failing with "Cannot navigate to invalid URL".
 */
function normalisePath(value) {
  let path = String(value).trim();
  if (/^[A-Za-z]:[\\/]/.test(path)) return '/';
  if (!path.startsWith('/')) path = `/${path}`;
  return path.replace(/\/+$/, '') || '/';
}

/**
 * Without an explicit --pages list, crawl the home page's own navigation and
 * footer. That's the set a visitor can actually reach, which is the set worth
 * auditing — and it stays correct when a client's nav changes.
 */
async function discoverPages(page) {
  if (args.only) return [normalisePath(args.only)];
  if (args.pages) return String(args.pages).split(',').map((p) => p.trim()).filter(Boolean).map(normalisePath);

  await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });
  const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
    .map((a) => a.getAttribute('href') || ''));

  const paths = new Set(['/']);
  for (const href of hrefs) {
    if (!href || href.startsWith('#') || /^(https?:|mailto:|tel:)/i.test(href)) {
      // Keep same-origin absolute URLs; drop everything genuinely external.
      if (!href.startsWith(BASE)) continue;
    }
    const clean = href.replace(BASE, '').split('#')[0].split('?')[0];
    if (!clean.startsWith('/')) continue;
    if (EXCLUDED.some((re) => re.test(clean))) continue;
    paths.add(clean.length > 1 ? clean.replace(/\/$/, '') : '/');
  }
  return Array.from(paths).slice(0, MAX_PAGES);
}

/* ── Accessibility (axe-core, WCAG 2.1 A/AA) ──────────────────────────────── */

// `networkidle` is deliberately avoided throughout: a Vite dev server holds an
// HMR WebSocket open, so it never fires and every page times out. `load` plus a
// short settle covers the same ground and works against dev and production
// builds alike.
async function runAda(page, url, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  // The page body arrives from the API after the shell loads.
  await page.waitForSelector('.bx-page, main', { timeout: 15_000 }).catch(() => {});
  // Settings-driven chrome (logo, nav, footer) renders on a later tick than
  // the page body, so waiting for the body alone is not enough.
  await page.waitForFunction(() => document.querySelectorAll('img, svg').length > 0, null, { timeout: 10_000 })
    .catch(() => {});
  await page.waitForTimeout(SETTLE_MS);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();

  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,          // critical | serious | moderate | minor
    help: v.help,
    helpUrl: v.helpUrl,
    tags: v.tags.filter((t) => t.startsWith('wcag')),
    count: v.nodes.length,
    // Three examples is enough to locate a pattern without burying the report.
    examples: v.nodes.slice(0, 3).map((n) => ({
      selector: Array.isArray(n.target) ? n.target.join(' ') : String(n.target),
      html: (n.html || '').slice(0, 200),
      failure: (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 300),
    })),
  }));
}

/* ── Responsive layout ────────────────────────────────────────────────────── */

// Runs inside the page. Self-contained by necessity — no closure over Node scope.
function responsiveProbe() {
  const describe = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      if (node.id) { parts.unshift(`#${node.id}`); break; }
      const cls = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      parts.unshift(node.tagName.toLowerCase() + (cls.length ? `.${cls.join('.')}` : ''));
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const visible = (el, rect) => {
    // A 1px box parked off-screen is the visually-hidden pattern (skip links,
    // screen-reader text). It is correct, not a defect — counting it produced
    // both a nonsensical "-10358px overflow" and a bogus 1x1 tap target.
    if (rect.width <= 1 || rect.height <= 1) return false;
    if (rect.right < 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };

  const vw = document.documentElement.clientWidth;
  const scrollW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);

  /* Horizontal overflow — the single most common mobile defect. */
  const overflowing = [];
  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (!visible(el, rect)) continue;
    // Only the right edge counts. Content deliberately parked off-screen left
    // is a hiding technique, not horizontal overflow.
    const past = Math.round(rect.right - vw);
    if (past <= 1) continue;
    const cs = getComputedStyle(el);
    // Fixed/sticky chrome that deliberately spans the viewport isn't a defect.
    if ((cs.position === 'fixed' || cs.position === 'sticky') && past <= 1) continue;
    overflowing.push({
      selector: describe(el),
      tag: el.tagName.toLowerCase(),
      pastRightEdgePx: past,
      leftPx: Math.round(rect.left),
      widthPx: Math.round(rect.width),
      text: (el.textContent || '').trim().slice(0, 60),
      // Likely causes, read straight from computed style so the fix is obvious.
      hints: [
        cs.whiteSpace === 'nowrap' && 'white-space: nowrap',
        cs.position === 'fixed' && 'position: fixed',
        cs.position === 'absolute' && 'position: absolute',
        !/%|auto/.test(cs.width) && parseFloat(cs.width) > vw && `fixed width ${cs.width}`,
        parseFloat(cs.minWidth) > vw && `min-width ${cs.minWidth}`,
        cs.overflowWrap === 'normal' && cs.wordBreak === 'normal'
          && (el.textContent || '').trim().split(/\s+/).some((w) => w.length > 20) && 'long unbroken word',
      ].filter(Boolean),
    });
  }
  // Report the outermost offenders — an overflowing child drags its parents
  // with it, and listing the whole chain buries the actual cause.
  const seen = new Set(overflowing.map((o) => o.selector));
  const culprits = overflowing
    .filter((o) => !Array.from(seen).some((s) => s !== o.selector && o.selector.startsWith(`${s} > `)))
    .sort((a, b) => b.pastRightEdgePx - a.pastRightEdgePx)
    .slice(0, 8);

  /* Tap targets — WCAG 2.2 SC 2.5.8 requires 24px; 44px is the practical floor. */
  const tapTargets = [];
  const INTERACTIVE = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [onclick]';
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    const rect = el.getBoundingClientRect();
    if (!visible(el, rect)) continue;
    const cs = getComputedStyle(el);
    // SC 2.5.8 exempts targets inline within a sentence.
    if (el.tagName === 'A' && cs.display.startsWith('inline') && el.parentElement
      && (el.parentElement.textContent || '').trim().length > (el.textContent || '').trim().length + 10) continue;
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w >= 44 && h >= 44) continue;
    tapTargets.push({
      selector: describe(el),
      sizePx: `${w}x${h}`,
      severity: (w < 24 || h < 24) ? 'fail' : 'warn',   // fail = WCAG 2.2 AA breach
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
    });
  }

  /* Text too small to read comfortably on a phone. */
  const tinyText = [];
  for (const el of document.querySelectorAll('p, li, span, td, a, label, div')) {
    if (!el.childNodes.length) continue;
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('').trim();
    if (ownText.length < 8) continue;
    const rect = el.getBoundingClientRect();
    if (!visible(el, rect)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size >= 12) continue;
    tinyText.push({ selector: describe(el), fontSizePx: Math.round(size * 10) / 10, text: ownText.slice(0, 50) });
  }

  /* Images with no intrinsic size — the usual source of layout shift. */
  const unsizedImages = [];
  for (const img of document.querySelectorAll('img')) {
    const rect = img.getBoundingClientRect();
    if (!visible(img, rect)) continue;
    const cs = getComputedStyle(img);
    if (img.hasAttribute('width') || img.hasAttribute('height')) continue;
    if (cs.aspectRatio && cs.aspectRatio !== 'auto') continue;
    unsizedImages.push({ selector: describe(img), src: (img.getAttribute('src') || '').slice(-60) });
  }

  const meta = document.querySelector('meta[name="viewport"]');
  return {
    viewportWidth: vw,
    documentScrollWidth: scrollW,
    horizontalOverflowPx: Math.max(0, scrollW - vw),
    culprits,
    tapTargets: tapTargets.slice(0, 12),
    tapTargetTotal: tapTargets.length,
    tinyText: tinyText.slice(0, 8),
    unsizedImages: unsizedImages.slice(0, 8),
    viewportMeta: meta ? meta.getAttribute('content') : null,
    // Pinch-zoom must not be disabled (WCAG 1.4.4).
    zoomBlocked: meta ? /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(meta.getAttribute('content') || '') : false,
  };
}

async function runResponsive(page, url) {
  const byBreakpoint = {};
  for (const width of BREAKPOINTS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    // The page body arrives from the API after the shell loads; measuring
    // before it lands would report an empty document as clean.
    await page.waitForSelector('.bx-page, main', { timeout: 15_000 }).catch(() => {});
  // Settings-driven chrome (logo, nav, footer) renders on a later tick than
  // the page body, so waiting for the body alone is not enough.
  await page.waitForFunction(() => document.querySelectorAll('img, svg').length > 0, null, { timeout: 10_000 })
    .catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    byBreakpoint[width] = await page.evaluate(responsiveProbe);
  }
  return byBreakpoint;
}

/* ── Speed (Lighthouse) ───────────────────────────────────────────────────── */

const METRICS = [
  'first-contentful-paint', 'largest-contentful-paint', 'cumulative-layout-shift',
  'total-blocking-time', 'speed-index', 'interactive',
];

async function runSpeed(url, port, formFactor) {
  const options = {
    port,
    output: 'json',
    logLevel: 'error',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
  };
  const { lhr } = await lighthouse(url, options, formFactor === 'desktop' ? desktopConfig : undefined);

  const metrics = {};
  for (const id of METRICS) {
    const audit = lhr.audits[id];
    if (audit) metrics[id] = { value: audit.displayValue || null, score: audit.score, raw: audit.numericValue };
  }

  // Opportunities carry an estimated saving; that's what makes them actionable.
  const opportunities = Object.values(lhr.audits)
    .filter((a) => a.details?.type === 'opportunity' && (a.numericValue || 0) > 100)
    .sort((a, b) => (b.numericValue || 0) - (a.numericValue || 0))
    .slice(0, 8)
    .map((a) => ({ id: a.id, title: a.title, savingsMs: Math.round(a.numericValue) }));

  return {
    formFactor,
    scores: Object.fromEntries(Object.entries(lhr.categories)
      .map(([key, cat]) => [key, cat.score === null ? null : Math.round(cat.score * 100)])),
    metrics,
    opportunities,
  };
}

/* ── Reporting ────────────────────────────────────────────────────────────── */

function summarise(report) {
  let critical = 0;
  let serious = 0;
  for (const page of report.pages) {
    for (const group of Object.values(page.ada || {})) {
      for (const v of group) {
        if (v.impact === 'critical') critical += 1;
        if (v.impact === 'serious') serious += 1;
      }
    }
    for (const bp of Object.values(page.responsive || {})) {
      if (bp.horizontalOverflowPx > 1) serious += 1;
      if (bp.zoomBlocked) critical += 1;
      serious += bp.tapTargets.filter((t) => t.severity === 'fail').length;
    }
  }
  return { critical, serious };
}

function toMarkdown(report) {
  const lines = [`# QA audit — ${report.baseUrl}`, '', `Run ${report.startedAt} · ${report.pages.length} pages`, ''];

  if (report.warnings.length) {
    lines.push('## ⚠️ Warnings', '');
    for (const w of report.warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  lines.push('## Summary', '', '| Page | A11y issues | Overflow | Small taps | Perf |', '|---|---|---|---|---|');
  for (const p of report.pages) {
    const ada = Object.values(p.ada || {}).flat();
    const bps = Object.entries(p.responsive || {});
    const overflow = bps.filter(([, b]) => b.horizontalOverflowPx > 1).map(([w]) => `${w}px`).join(', ') || '—';
    const taps = bps.reduce((n, [, b]) => n + b.tapTargets.filter((t) => t.severity === 'fail').length, 0) || '—';
    const perfScore = (p.speed && p.speed[0]) ? p.speed[0].scores.performance : null;
    lines.push(`| \`${p.path}\` | ${ada.length || '—'} | ${overflow} | ${taps} | ${perfScore ?? '—'} |`);
  }
  lines.push('');

  for (const p of report.pages) {
    lines.push(`## \`${p.path}\``, '');
    if (p.error) { lines.push(`**Failed to audit:** ${p.error}`, ''); continue; }

    const ada = Object.entries(p.ada || {});
    if (ada.length) {
      lines.push('### Accessibility', '');
      for (const [width, violations] of ada) {
        if (!violations.length) { lines.push(`**${width}px** — no violations.`, ''); continue; }
        lines.push(`**${width}px**`, '');
        for (const v of violations) {
          lines.push(`- **${v.impact}** · \`${v.id}\` · ${v.count}× — ${v.help}`);
          for (const ex of v.examples) lines.push(`  - \`${ex.selector}\``);
        }
        lines.push('');
      }
    }

    const resp = Object.entries(p.responsive || {});
    if (resp.length) {
      lines.push('### Responsive', '');
      for (const [width, b] of resp) {
        const flags = [];
        if (b.horizontalOverflowPx > 1) flags.push(`overflows by ${b.horizontalOverflowPx}px`);
        if (b.zoomBlocked) flags.push('pinch-zoom disabled');
        if (!b.viewportMeta) flags.push('no viewport meta');
        const fails = b.tapTargets.filter((t) => t.severity === 'fail');
        if (fails.length) flags.push(`${fails.length} tap targets under 24px`);
        if (b.tinyText.length) flags.push(`${b.tinyText.length} text runs under 12px`);
        lines.push(`**${width}px** — ${flags.length ? flags.join('; ') : 'clean'}`);
        for (const c of b.culprits) {
          lines.push(`  - \`${c.selector}\` extends ${c.pastRightEdgePx}px past the edge`
            + (c.hints.length ? ` — ${c.hints.join(', ')}` : ''));
        }
        for (const t of fails.slice(0, 5)) lines.push(`  - \`${t.selector}\` is ${t.sizePx}`);
      }
      lines.push('');
    }

    for (const s of p.speed || []) {
      lines.push(`### Speed (${s.formFactor})`, '');
      lines.push(`Performance **${s.scores.performance}** · Accessibility ${s.scores.accessibility}`
        + ` · Best practices ${s.scores['best-practices']} · SEO ${s.scores.seo}`, '');
      for (const [id, m] of Object.entries(s.metrics)) lines.push(`- ${id}: **${m.value}**`);
      if (s.opportunities.length) {
        lines.push('', 'Opportunities:');
        for (const o of s.opportunities) lines.push(`- ${o.title} — ~${o.savingsMs}ms`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

async function main() {
  const report = {
    baseUrl: BASE,
    startedAt: new Date().toISOString(),
    breakpoints: BREAKPOINTS,
    checks: RUN,
    warnings: [],
    pages: [],
  };

  const browser = await chromium.launch();
  const context = await browser.newContext({ deviceScaleFactor: 2, hasTouch: true });
  const page = await context.newPage();

  let paths;
  try {
    paths = await discoverPages(page);
  } catch (err) {
    console.error(`\nCannot reach ${BASE} — ${err.message}`);
    console.error('Is the site running? For local, start it with `node run.js` from the project root.\n');
    await browser.close();
    process.exit(2);
  }

  // Lighthouse against a Vite dev server measures unminified, uncompressed
  // modules — the numbers look alarming and mean nothing. Say so rather than
  // letting someone act on them.
  if (RUN.speed) {
    const html = await page.content();
    if (html.includes('/@vite/client')) {
      report.warnings.push('Speed was measured against a Vite **dev server**. Those numbers are not '
        + 'representative — run `npm run build && npm run preview` in `client/`, or point `--url` at the '
        + 'deployed site, before drawing any performance conclusions.');
    }
  }

  console.log(`\nAuditing ${paths.length} pages on ${BASE}\n`);

  for (const p of paths) {
    const url = `${BASE}${p === '/' ? '' : p}`;
    const entry = { path: p, url };
    process.stdout.write(`  ${p} … `);
    try {
      if (RUN.ada) {
        entry.ada = {};
        for (const width of [Math.min(...BREAKPOINTS), Math.max(...BREAKPOINTS)]) {
          entry.ada[width] = await runAda(page, url, width);
        }
      }
      if (RUN.responsive) entry.responsive = await runResponsive(page, url);
      console.log('done');
    } catch (err) {
      entry.error = err.message;
      console.log(`failed — ${err.message}`);
    }
    report.pages.push(entry);
  }

  await browser.close();

  if (RUN.speed) {
    console.log('\nRunning Lighthouse (this is slower — one full load per page)\n');
    // Reuse Playwright's Chromium so there's exactly one browser binary to trust.
    process.env.CHROME_PATH = chromium.executablePath();
    const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
    try {
      for (const entry of report.pages) {
        if (entry.error) continue;
        process.stdout.write(`  ${entry.path} … `);
        entry.speed = [];
        try {
          entry.speed.push(await runSpeed(entry.url, chrome.port, 'mobile'));
          if (SPEED_DESKTOP) entry.speed.push(await runSpeed(entry.url, chrome.port, 'desktop'));
          console.log(`perf ${entry.speed[0].scores.performance}`);
        } catch (err) {
          console.log(`failed — ${err.message}`);
          report.warnings.push(`Lighthouse failed on ${entry.path}: ${err.message}`);
        }
      }
    } finally {
      await chrome.kill();
    }
  }

  const totals = summarise(report);
  report.totals = totals;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = report.startedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(OUT_DIR, `audit-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, `audit-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, toMarkdown(report));

  console.log(`\n${totals.critical} critical, ${totals.serious} serious`);
  for (const w of report.warnings) console.log(`\n⚠️  ${w}`);
  console.log(`\nJSON  ${jsonPath}\nText  ${mdPath}\n`);

  process.exit(totals.critical + totals.serious > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
