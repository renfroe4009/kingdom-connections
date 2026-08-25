// Starter templates.
//
// These produce Craft's own serialized format directly, so a new page opens in
// the builder already laid out and fully editable — no conversion step.
//
// ⚠️ PLACEHOLDER COPY ONLY. Never put a real organisation's staff names, bios,
// testimonials, client logos or award claims in here. A template ships to every
// project that uses this CMS.

let counter = 0;

/**
 * Build one serialized Craft node. `children` are nested nodes; `canvas` marks
 * a node that accepts drops.
 */
function n(type, props = {}, children = [], canvas = false) {
  counter += 1;
  return {
    _id: `n${counter}`,
    type,
    props,
    canvas,
    children,
  };
}

/** Flatten the nested helper form into the `{ ROOT: {...}, id: {...} }` map Craft deserializes. */
function tree(children, rootProps = {}) {
  counter = 0;
  const nodes = {};

  const walk = (node, parentId) => {
    const id = node._id;
    nodes[id] = {
      type: { resolvedName: node.type },
      isCanvas: node.canvas,
      props: node.props,
      displayName: node.type,
      custom: {},
      parent: parentId,
      hidden: false,
      nodes: node.children.map((child) => child._id),
      linkedNodes: {},
    };
    node.children.forEach((child) => walk(child, id));
    return id;
  };

  const built = children.map((child) => walk(child, 'ROOT'));

  nodes.ROOT = {
    type: { resolvedName: 'PageRoot' },
    isCanvas: true,
    props: { background: '', textColor: '', maxWidth: '', ...rootProps },
    displayName: 'PageRoot',
    custom: {},
    parent: null,
    hidden: false,
    nodes: built,
    linkedNodes: {},
  };

  return nodes;
}

/* ── Shorthands ───────────────────────────────────────────────────────────── */

const section = (props, children) => n('Section', { customId: '', customClass: '', paddingTop: 64, paddingBottom: 64, paddingX: 24, fullBleed: false, overlay: true, overlayColor: 'rgb(0 0 0 / 0.45)', ...props }, children, true);
const row = (props, children) => n('Row', { customId: '', customClass: '', mode: 'grid', gap: 24, align: 'stretch', justify: 'flex-start', wrap: true, ...props }, children, true);
const col = (props, children) => n('Column', { customId: '', customClass: '', span: 12, spanTablet: '', spanMobile: '', padding: {}, gap: 16, verticalAlign: 'flex-start', horizontalAlign: 'stretch', textAlign: '', ...props }, children, true);
const heading = (props) => n('Heading', { customId: '', customClass: '', level: 'h2', size: '', weight: '', align: '', color: '', eyebrow: '', eyebrowColor: '', ...props });
const text = (props) => n('TextBlock', { customId: '', customClass: '', size: '', align: '', color: '', maxWidth: '', ...props });
const button = (props) => n('ButtonBlock', { customId: '', customClass: '', variant: 'solid', size: 'md', icon: '', iconPosition: 'right', background: '', textColor: '', radius: '', fullWidth: false, align: 'flex-start', link: { url: '', newTab: false }, ...props });
const spacer = (height = 32) => n('Spacer', { customId: '', customClass: '', height, heightMobile: '' });

const PLACEHOLDER_CARDS = [
  { title: 'First point', text: 'Replace this with a short description.', icon: 'star', image: '', linkLabel: '', link: { url: '', newTab: false } },
  { title: 'Second point', text: 'Replace this with a short description.', icon: 'bolt', image: '', linkLabel: '', link: { url: '', newTab: false } },
  { title: 'Third point', text: 'Replace this with a short description.', icon: 'heart', image: '', linkLabel: '', link: { url: '', newTab: false } },
];

const cards = (props = {}) => n('CardGrid', { customId: '', customClass: '', cards: PLACEHOLDER_CARDS, columns: 3, gap: 24, media: 'icon', cardBackground: '', hover: true, iconColor: '', ...props });

/* ── Templates ────────────────────────────────────────────────────────────── */

export const PAGE_TEMPLATES = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'One empty section. Start from nothing.',
    icon: 'mdi:file-outline',
    build: () =>
      tree([
        section({ customId: '' }, [row({}, [col({ span: 12 }, [heading({ text: 'Your page heading' }), text({ html: '<p>Write your first paragraph here.</p>' })])])]),
      ]),
  },
  {
    id: 'landing',
    label: 'Landing page',
    description: 'Hero, three highlights, and a closing call to action.',
    icon: 'mdi:rocket-launch-outline',
    build: () =>
      tree([
        section({ customId: 'hero', paddingTop: 96, paddingBottom: 96 }, [
          row({}, [
            col({ span: 12, textAlign: 'center', horizontalAlign: 'center' }, [
              heading({ text: 'A clear promise in one line', eyebrow: 'Eyebrow', level: 'h1', size: '3rem', align: 'center' }),
              text({ html: '<p>One or two sentences explaining what you do and who it is for.</p>', align: 'center', maxWidth: '60ch' }),
              button({ label: 'Get started', align: 'center' }),
            ]),
          ]),
        ]),
        section({ customId: 'highlights' }, [
          row({}, [col({ span: 12 }, [heading({ text: 'What we offer', align: 'center' }), spacer(16), cards()])]),
        ]),
        section({ customId: 'cta', paddingTop: 72, paddingBottom: 72 }, [
          row({}, [
            col({ span: 12, textAlign: 'center', horizontalAlign: 'center' }, [
              heading({ text: 'Ready to talk?', align: 'center' }),
              text({ html: '<p>Add a sentence that makes the next step feel easy.</p>', align: 'center' }),
              button({ label: 'Contact us', align: 'center', link: { url: '/contact', newTab: false } }),
            ]),
          ]),
        ]),
      ]),
  },
  {
    id: 'about',
    label: 'About',
    description: 'Story on the left, image on the right, then key numbers.',
    icon: 'mdi:information-outline',
    build: () =>
      tree([
        section({ customId: 'intro' }, [
          row({ gap: 40 }, [
            col({ span: 7, spanMobile: 12, verticalAlign: 'center' }, [
              heading({ text: 'About us', eyebrow: 'Who we are' }),
              text({ html: '<p>Replace this with your story: what you do, why you started, and who you serve.</p><p>A second paragraph gives readers something to settle into.</p>' }),
            ]),
            col({ span: 5, spanMobile: 12 }, [n('ImageBlock', { customId: '', customClass: '', src: '', alt: '', caption: '', fit: 'cover', radius: '8px', ratio: '4 / 3', maxWidth: '', link: { url: '', newTab: false } })]),
          ]),
        ]),
        section({ customId: 'numbers' }, [
          row({}, [
            col({ span: 12 }, [
              n('Stats', {
                customId: '',
                customClass: '',
                columns: 4,
                valueColor: '',
                items: [
                  { value: '100+', label: 'Describe the number' },
                  { value: '25', label: 'Describe the number' },
                  { value: '15 yrs', label: 'Describe the number' },
                  { value: '98%', label: 'Describe the number' },
                ],
              }),
            ]),
          ]),
        ]),
      ]),
  },
  {
    id: 'services',
    label: 'Services',
    description: 'Intro plus a grid of what you offer.',
    icon: 'mdi:view-grid-outline',
    build: () =>
      tree([
        section({ customId: 'services' }, [
          row({}, [
            col({ span: 12, textAlign: 'center', horizontalAlign: 'center' }, [
              heading({ text: 'What we do', align: 'center' }),
              text({ html: '<p>A sentence introducing the list below.</p>', align: 'center', maxWidth: '60ch' }),
            ]),
          ]),
          row({}, [col({ span: 12 }, [spacer(16), cards({ columns: 3 })])]),
        ]),
      ]),
  },
  {
    id: 'contact',
    label: 'Contact',
    description: 'Contact form beside your details and a map.',
    icon: 'mdi:email-outline',
    build: () =>
      tree([
        section({ customId: 'contact' }, [
          row({ gap: 40 }, [
            col({ span: 7, spanMobile: 12 }, [
              heading({ text: 'Get in touch' }),
              text({ html: '<p>Tell us what you need and we will reply shortly.</p>' }),
              n('FormEmbed', { customId: '', customClass: '', formSlug: '', textColor: '', maxWidth: '' }),
            ]),
            col({ span: 5, spanMobile: 12 }, [
              heading({ text: 'Our details', level: 'h3', size: '1.35rem' }),
              n('ContactDetails', { customId: '', customClass: '', items: [], useBusinessProfile: true, iconColor: '' }),
              n('MapBlock', { customId: '', customClass: '', query: '', zoom: 14, ratio: '4 / 3', useBusinessAddress: true }),
            ]),
          ]),
        ]),
      ]),
  },
  {
    id: 'faq',
    label: 'FAQ',
    description: 'A heading and an expandable question list.',
    icon: 'mdi:frequently-asked-questions',
    build: () =>
      tree([
        section({ customId: 'faq' }, [
          row({}, [
            col({ span: 12, horizontalAlign: 'center' }, [
              heading({ text: 'Frequently asked questions', align: 'center' }),
              spacer(16),
              n('Accordion', {
                customId: '',
                customClass: '',
                allowMultiple: false,
                openFirst: true,
                items: [
                  { question: 'First question', answer: '<p>Replace this with the answer.</p>' },
                  { question: 'Second question', answer: '<p>Replace this with the answer.</p>' },
                  { question: 'Third question', answer: '<p>Replace this with the answer.</p>' },
                ],
              }),
            ]),
          ]),
        ]),
      ]),
  },
  {
    id: 'shop',
    label: 'Shop',
    description: 'Product grid pulled live from your store.',
    icon: 'mdi:storefront-outline',
    build: () =>
      tree([
        section({ customId: 'shop' }, [
          row({}, [
            col({ span: 12, horizontalAlign: 'center', textAlign: 'center' }, [
              heading({ text: 'Shop', align: 'center' }),
              text({ html: '<p>A short line about what you sell.</p>', align: 'center' }),
            ]),
          ]),
          row({}, [
            col({ span: 12 }, [
              spacer(16),
              n('ProductList', { customId: '', customClass: '', category: '', limit: 9, columns: 3, showPrice: true, showAddToCart: true, emptyText: 'No products to show yet.' }),
            ]),
          ]),
        ]),
      ]),
  },
];

/** Resolve a template id to the serialized tree a new page should start from. */
export function buildTemplate(id) {
  const template = PAGE_TEMPLATES.find((t) => t.id === id) || PAGE_TEMPLATES[0];
  return template.build();
}
