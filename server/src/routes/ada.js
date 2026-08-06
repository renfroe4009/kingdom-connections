const express  = require('express');
const { db }   = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const router   = express.Router();

// ── DB-based audit (for CMS pages) ────────────────────────────────────────────
// Fetching the SPA URL only returns the shell HTML; we audit the source data instead.

router.get('/check-page/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [[page]] = await db.query('SELECT * FROM website_pages WHERE id = :id', { id });
    if (!page) return res.status(404).json({ error: 'Page not found' });

    let puckData = page.puck_data;
    if (typeof puckData === 'string') try { puckData = JSON.parse(puckData); } catch {}
    const blocks = puckData?.content || [];

    const issues   = [];
    const warnings = [];
    const passes   = [];

    // ── Meta title (browser tab / WCAG 2.4.2) ──────────────────────────────
    if (!page.meta_title?.trim()) {
      issues.push({
        id: 'page-title', impact: 'serious', wcag: '2.4.2',
        fixable: true, fixType: 'meta_title', currentValue: '',
        msg: 'Page is missing a meta title — used as the browser tab title and by screen readers.',
      });
    } else {
      passes.push({ id: 'page-title', msg: `Meta title: "${page.meta_title}"` });
    }

    // ── Meta description ────────────────────────────────────────────────────
    if (!page.meta_desc?.trim()) {
      warnings.push({
        id: 'meta-desc', impact: 'moderate', wcag: '2.4.2',
        fixable: true, fixType: 'meta_desc', currentValue: '',
        msg: 'Page is missing a meta description — improves discoverability and context for assistive technology.',
      });
    } else {
      passes.push({ id: 'meta-desc', msg: `Meta description set (${page.meta_desc.length} chars).` });
    }

    // ── ImageBlock alt text (WCAG 1.1.1) ────────────────────────────────────
    const imageBlocks = blocks.filter(b => b.type === 'ImageBlock');
    if (imageBlocks.length === 0) {
      passes.push({ id: 'img-alt', msg: 'No ImageBlock images on this page.' });
    } else {
      let imgBad = 0;
      imageBlocks.forEach(block => {
        const src     = block.props?.src || '';
        const alt     = block.props?.alt || '';
        const blockId = block.props?.id || '';
        if (!alt.trim()) {
          imgBad++;
          issues.push({
            id: 'img-alt', impact: 'critical', wcag: '1.1.1',
            fixable: true, fixType: 'img_alt', blockId, currentValue: '',
            previewSrc: src,
            msg: `Image missing alt text: ${src.split('/').pop() || src.slice(-50)}`,
          });
        }
      });
      if (imgBad === 0) {
        passes.push({ id: 'img-alt', msg: `All ${imageBlocks.length} image(s) have alt text.` });
      }
    }

    // ── Content structure (needs page editor) ───────────────────────────────
    // Heading order, link text, button names require rendered HTML review.
    warnings.push({
      id: 'manual-check', impact: 'minor', wcag: '1.3.1',
      fixable: false,
      msg: 'Heading hierarchy, link text quality, and button names must be reviewed inside the page editor.',
    });

    const score = Math.max(0, 100 - (issues.length * 15) - (warnings.length * 5));

    res.json({
      pageId: page.id,
      slug: page.slug,
      pageTitle: page.meta_title || page.title,
      score, issues, warnings, passes,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Fix a specific ADA issue ───────────────────────────────────────────────────
router.patch('/fix/:id', requireAuth, requirePermission('settings.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    const { fixType, value = '', blockId } = req.body;

    if (fixType === 'meta_title') {
      await db.query('UPDATE website_pages SET meta_title = :v, updated_by = :uid WHERE id = :id',
        { v: value, uid: req.user?.id || null, id });
      return res.json({ ok: true });
    }

    if (fixType === 'meta_desc') {
      await db.query('UPDATE website_pages SET meta_desc = :v, updated_by = :uid WHERE id = :id',
        { v: value, uid: req.user?.id || null, id });
      return res.json({ ok: true });
    }

    if (fixType === 'img_alt') {
      if (!blockId) return res.status(400).json({ error: 'blockId required for img_alt fix' });

      const [[page]] = await db.query('SELECT puck_data FROM website_pages WHERE id = :id', { id });
      if (!page) return res.status(404).json({ error: 'Page not found' });

      let puckData = page.puck_data;
      if (typeof puckData === 'string') try { puckData = JSON.parse(puckData); } catch {}

      const blocks = puckData?.content || [];
      const block  = blocks.find(b => b.props?.id === blockId);
      if (!block) return res.status(404).json({ error: 'Block not found' });

      // Save version before mutating
      await db.query(
        'INSERT INTO website_versions (page_id, puck_data, snapshot_label, created_by, user_name) VALUES (:pid, :pd, :lbl, :uid, :uname)',
        {
          pid: id,
          pd: typeof page.puck_data === 'string' ? page.puck_data : JSON.stringify(page.puck_data),
          lbl: 'ADA fix — img alt',
          uid: req.user?.id || null,
          uname: req.user ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() : 'ADA Fix',
        }
      );

      block.props.alt = value;
      await db.query(
        'UPDATE website_pages SET puck_data = :pd, updated_by = :uid WHERE id = :id',
        { pd: JSON.stringify(puckData), uid: req.user?.id || null, id }
      );
      return res.json({ ok: true });
    }

    res.status(400).json({ error: `Unknown fixType: ${fixType}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Legacy URL-based check (kept for external/non-CMS URLs) ───────────────────
function attr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
}
function hasAttr(tag, name) { return new RegExp(`\\b${name}\\b`, 'i').test(tag); }
function innerText(html)     { return html.replace(/<[^>]+>/g, '').trim(); }

router.get('/check', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param required' });

  let html;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'SPA-ADA-Checker/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return res.status(502).json({ error: `Upstream ${r.status}: ${r.statusText}` });
    html = await r.text();
  } catch (e) {
    return res.status(502).json({ error: `Fetch failed: ${e.message}` });
  }

  const issues = [], warnings = [], passes = [];

  const htmlTag = (html.match(/<html[^>]*>/i) || [''])[0];
  const lang = attr(htmlTag, 'lang');
  if (!lang) issues.push({ id: 'html-lang', impact: 'critical', msg: '<html> element is missing a lang attribute.', wcag: '3.1.1' });
  else passes.push({ id: 'html-lang', msg: `Page language declared: "${lang}"` });

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle  = titleMatch ? titleMatch[1].trim() : '';
  if (!pageTitle) issues.push({ id: 'page-title', impact: 'serious', msg: 'Page is missing a <title> element.', wcag: '2.4.2' });
  else passes.push({ id: 'page-title', msg: `Page title: "${pageTitle}"` });

  const imgTags = html.match(/<img[^>]*>/gi) || [];
  let imgNoAlt = 0, imgEmptyAlt = 0, imgOk = 0;
  imgTags.forEach(tag => {
    if (!hasAttr(tag, 'alt')) { imgNoAlt++; issues.push({ id: 'img-alt', impact: 'critical', msg: `Image missing alt attribute: ${(attr(tag, 'src') || '').slice(-60)}`, wcag: '1.1.1' }); }
    else { const v = attr(tag, 'alt'); if (v === '') imgEmptyAlt++; else imgOk++; }
  });
  if (imgNoAlt === 0 && imgTags.length > 0) passes.push({ id: 'img-alt', msg: `All ${imgTags.length} image(s) have alt attributes (${imgEmptyAlt} decorative, ${imgOk} descriptive).` });

  const anchorRe  = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const badLinkText = ['click here', 'read more', 'learn more', 'here', 'link', 'more'];
  let m, emptyLinks = 0, vagueLinks = 0;
  while ((m = anchorRe.exec(html)) !== null) {
    const content = innerText(m[2]);
    const hasAria = /aria-label\s*=/i.test(m[1]);
    if (!content && !hasAria) { emptyLinks++; issues.push({ id: 'link-name', impact: 'serious', msg: `Link has no accessible text: href="${attr(m[1], 'href') || ''}"`, wcag: '2.4.4' }); }
    else if (badLinkText.includes(content.toLowerCase()) && !hasAria) { vagueLinks++; warnings.push({ id: 'link-name-vague', impact: 'moderate', msg: `Link text "${content}" is non-descriptive.`, wcag: '2.4.4' }); }
    if (/target\s*=\s*["']_blank["']/i.test(m[1])) {
      const hasNotice = /aria-label[^=]*=\s*["'][^"']*(new tab|new window)/i.test(m[1]) || /title\s*=\s*["'][^"']*(new tab|new window)/i.test(m[1]);
      if (!hasNotice) warnings.push({ id: 'link-new-tab', impact: 'minor', msg: `Link opens in new tab without notifying users.`, wcag: '3.2.2' });
    }
  }
  if (emptyLinks === 0 && vagueLinks === 0) passes.push({ id: 'link-name', msg: 'All links have accessible text.' });

  const h1s = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1s === 0) issues.push({ id: 'heading-order', impact: 'serious', msg: 'Page has no <h1> element.', wcag: '1.3.1' });
  else if (h1s > 1) warnings.push({ id: 'heading-order', impact: 'moderate', msg: `Page has ${h1s} <h1> elements — best practice is exactly one.`, wcag: '1.3.1' });
  else passes.push({ id: 'heading-order', msg: 'Page has exactly one <h1> heading.' });

  const inputTags = html.match(/<input[^>]*>/gi) || [];
  let unlabelled = 0;
  inputTags.forEach(tag => {
    const type = (attr(tag, 'type') || 'text').toLowerCase();
    if (['hidden','submit','button','reset','image'].includes(type)) return;
    const inputId = attr(tag, 'id');
    const labelForThis = inputId && new RegExp(`for\\s*=\\s*["']${inputId}["']`, 'i').test(html);
    if (!/aria-label\s*=/i.test(tag) && !/aria-labelledby\s*=/i.test(tag) && !labelForThis) {
      unlabelled++;
      warnings.push({ id: 'label', impact: 'serious', msg: `Input (type="${type}") has no associated label.`, wcag: '1.3.1' });
    }
  });

  const btnRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let emptyBtns = 0;
  while ((m = btnRe.exec(html)) !== null) {
    if (!innerText(m[2]) && !/aria-label\s*=/i.test(m[1])) { emptyBtns++; issues.push({ id: 'button-name', impact: 'critical', msg: 'Button has no accessible name.', wcag: '4.1.2' }); }
  }
  if (emptyBtns === 0) passes.push({ id: 'button-name', msg: 'All buttons have accessible names.' });

  const hasSkipLink = /skip.*main|skip.*content|skip.*nav/i.test(html);
  if (!hasSkipLink) warnings.push({ id: 'skip-link', impact: 'moderate', msg: 'No skip navigation link detected.', wcag: '2.4.1' });
  else passes.push({ id: 'skip-link', msg: 'Skip navigation link found.' });

  const score = Math.max(0, 100 - (issues.length * 15) - (warnings.length * 5));
  res.json({ url, pageTitle, score, issues, warnings, passes });
});

module.exports = router;
