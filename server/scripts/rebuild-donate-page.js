#!/usr/bin/env node
/* =============================================================================
 * rebuild-donate-page.js
 *
 * website_pages.slug='donate' (id 11) was never migrated off the old
 * pre-Craft.js "Puck" format ({root, zones, content:[{type:'PageHeroBanner'},
 * {type:'DonationCard'}]}) when the site moved to Craft.js. The current
 * renderer (PageRenderer.jsx's normalize()) requires a `ROOT` key and returns
 * null without one, so /donate has been rendering "This page has no content
 * yet." this whole time. This script replaces puck_data with a real Craft.js
 * tree — a hero section (built the same way the live /join page's hero is:
 * ordinary Section/Row/Column/Heading/TextBlock nodes with customClass/
 * importedClass set to the real site design classes, not generic bx-*) plus
 * one real DonationBlock instance — carrying over the real Kingdom
 * Connections copy that was sitting unused in the dead legacy JSON.
 *
 * Idempotent — if puck_data already has a ROOT key (i.e. already migrated,
 * by this script or by hand in the builder), this is a no-op.
 *
 * Run: cd server && node scripts/rebuild-donate-page.js
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

const HERO_COPY = {
  eyebrow: 'Give',
  headline: 'Support the Movement',
  subtext: 'Your giving supports the Praying Planet app, global prayer networks, and resources that help churches, ministries and Kingdom businesses connect and grow.',
};

const PANEL_COPY = {
  heading: 'Make a Donation',
  blurb: 'Your gift helps connect and equip believers, churches, ministries, prayer groups and Kingdom businesses worldwide.',
  coverFeesLabel: 'Add a little extra to cover processing fees',
  buttonLabel: 'Donate Securely',
  disclaimerText: 'Payments processed securely. A receipt is sent to your email automatically.',
  thankYouText: 'Thank you — your generous gift has been received. A receipt has been sent to your email.',
};

function section(id, { customClass, sectionType, fullBleed = true }, children) {
  return {
    id,
    node: {
      type: { resolvedName: 'Section' },
      isCanvas: true,
      props: {
        customId: '', customClass,
        background: '', textColor: '', backgroundImage: '',
        overlay: false, overlayColor: 'rgb(0 0 0 / 0.45)',
        paddingTop: '', paddingBottom: '', paddingTopMobile: '', paddingBottomMobile: '', paddingX: '',
        maxWidth: '', fullBleed, sectionType,
      },
      displayName: 'Section',
      custom: { displayName: 'ns-section' },
      parent: 'ROOT',
      hidden: false,
      nodes: children,
      linkedNodes: {},
    },
  };
}

function row(id, parent, { importedClass = '' }, children) {
  return {
    id,
    node: {
      type: { resolvedName: 'Row' },
      isCanvas: true,
      props: { customId: '', customClass: '', mode: 'grid', gap: 0, align: 'stretch', justify: 'flex-start', wrap: true, importedClass },
      displayName: 'Row',
      custom: {},
      parent,
      hidden: false,
      nodes: children,
      linkedNodes: {},
    },
  };
}

function column(id, parent, { span = 12, gap = 0, importedClass = '', importedStyle = '' }, children) {
  return {
    id,
    node: {
      type: { resolvedName: 'Column' },
      isCanvas: true,
      props: {
        customId: '', customClass: '', span, spanTablet: '', spanMobile: '',
        padding: {}, gap, verticalAlign: 'flex-start', horizontalAlign: 'stretch', textAlign: '',
        importedClass, importedStyle,
      },
      displayName: 'Column',
      custom: {},
      parent,
      hidden: false,
      nodes: children,
      linkedNodes: {},
    },
  };
}

function heading(id, parent, { text, eyebrow = '', level = 'h1' }) {
  return {
    id,
    node: {
      type: { resolvedName: 'Heading' },
      isCanvas: false,
      props: { customId: '', customClass: '', text, eyebrow, level, size: '', weight: '', align: '', color: '', eyebrowColor: '', titleClass: '', eyebrowClass: 'eyebrow' },
      displayName: 'Heading',
      custom: {},
      parent,
      hidden: false,
      nodes: [],
      linkedNodes: {},
    },
  };
}

function textBlock(id, parent, { html, customClass = 'textcol_p' }) {
  return {
    id,
    node: {
      type: { resolvedName: 'TextBlock' },
      isCanvas: false,
      props: { customId: '', customClass, html, size: '', align: '', color: '', maxWidth: '' },
      displayName: 'Text',
      custom: {},
      parent,
      hidden: false,
      nodes: [],
      linkedNodes: {},
    },
  };
}

function donationBlock(id, parent) {
  return {
    id,
    node: {
      type: { resolvedName: 'DonationBlock' },
      isCanvas: false,
      props: {
        customId: '', customClass: '',
        heading: PANEL_COPY.heading,
        blurb: PANEL_COPY.blurb,
        amounts: [
          { value: 25, label: '' },
          { value: 50, label: '' },
          { value: 100, label: '' },
          { value: 250, label: '' },
          { value: 500, label: '' },
        ],
        allowCustom: true,
        coverFeesOption: true,
        coverFeesLabel: PANEL_COPY.coverFeesLabel,
        fundSlug: '',
        buttonLabel: PANEL_COPY.buttonLabel,
        thankYouText: PANEL_COPY.thankYouText,
        disclaimerText: PANEL_COPY.disclaimerText,
      },
      displayName: 'Donation / Payment',
      custom: {},
      parent,
      hidden: false,
      nodes: [],
      linkedNodes: {},
    },
  };
}

function buildTree() {
  const nodes = {};
  const put = (n) => { nodes[n.id] = n.node; return n.id; };

  // --- Hero ---
  const heroHeadingId = put(heading('dpHeading', 'dpHeroGridCol', { text: HERO_COPY.headline, eyebrow: HERO_COPY.eyebrow, level: 'h1' }));
  const heroTextId = put(textBlock('dpText', 'dpHeroGridCol', { html: HERO_COPY.subtext }));
  const heroGridColId = put(column('dpHeroGridCol', 'dpHeroGridRow', { span: 12, gap: 16, importedClass: 'ns-block', importedStyle: '--col-start: 1; --col-span: 9' }, [heroHeadingId, heroTextId]));
  const heroGridRowId = put(row('dpHeroGridRow', 'dpHeroCol', { importedClass: 'ns-grid' }, [heroGridColId]));
  const heroColId = put(column('dpHeroCol', 'dpHeroRow', { span: 12 }, [heroGridRowId]));
  const heroRowId = put(row('dpHeroRow', 'dpHero', {}, [heroColId]));
  const heroId = put(section('dpHero', { customClass: 'ns-section page-hero page-hero--join page-hero--tall', sectionType: 'hero' }, [heroRowId]));

  // --- Donation panel ---
  const donationId = put(donationBlock('dpDonation', 'dpContentGridCol'));
  const contentGridColId = put(column('dpContentGridCol', 'dpContentGridRow', { span: 12, importedClass: 'ns-block', importedStyle: '--col-start: 3; --col-span: 8' }, [donationId]));
  const contentGridRowId = put(row('dpContentGridRow', 'dpContentCol', { importedClass: 'ns-grid' }, [contentGridColId]));
  const contentColId = put(column('dpContentCol', 'dpContentRow', { span: 12 }, [contentGridRowId]));
  const contentRowId = put(row('dpContentRow', 'dpContent', {}, [contentColId]));
  const contentId = put(section('dpContent', { customClass: 'page-section section-soft', sectionType: 'content' }, [contentRowId]));

  nodes.ROOT = {
    type: { resolvedName: 'PageRoot' },
    isCanvas: true,
    props: { background: '', textColor: '', maxWidth: '' },
    displayName: 'Page',
    custom: {},
    parent: null,
    hidden: false,
    nodes: [heroId, contentId],
    linkedNodes: {},
  };

  return nodes;
}

async function main() {
  const [[page]] = await db.query("SELECT id, puck_data FROM website_pages WHERE slug = 'donate'");
  if (!page) throw new Error('No website_pages row with slug "donate"');

  const current = typeof page.puck_data === 'string' ? JSON.parse(page.puck_data) : page.puck_data;
  if (current && typeof current === 'object' && current.ROOT) {
    console.log('donate page already has a ROOT node (already migrated) — skipped.');
    process.exit(0);
  }

  const tree = buildTree();
  await db.query('UPDATE website_pages SET puck_data = :data, page_mode = :mode WHERE id = :id', {
    id: page.id,
    data: JSON.stringify(tree),
    mode: 'visual',
  });
  console.log(`Rebuilt donate page (id ${page.id}) with a real Craft.js hero + DonationBlock tree.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
