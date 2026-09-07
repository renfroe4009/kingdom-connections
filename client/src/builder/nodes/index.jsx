// The node registry.
//
// ⚠️ The KEYS in `NODES` are written into every saved page's JSON. Renaming a
// key orphans every page that used it, so add new keys rather than renaming
// old ones.

import { Element } from '@craftjs/core';

import PageRoot from './PageRoot.jsx';
import Section from './Section.jsx';
import Row from './Row.jsx';
import Column from './Column.jsx';
import Heading from './Heading.jsx';
import TextBlock from './TextBlock.jsx';
import ImageBlock from './ImageBlock.jsx';
import ButtonBlock from './ButtonBlock.jsx';
import { Divider, Spacer } from './Spacing.jsx';
import CardGrid from './CardGrid.jsx';
import Accordion from './Accordion.jsx';
import Tabs from './Tabs.jsx';
import VideoBlock from './VideoBlock.jsx';
import { Gallery, LogoStrip, Stats, Testimonials } from './Showcase.jsx';
import HtmlBlock from './HtmlBlock.jsx';
import FormEmbed from './FormEmbed.jsx';
import ProductList from './ProductList.jsx';
import ProductDetail from './ProductDetail.jsx';
import DonationBlock from './DonationBlock.jsx';
import MembershipBlock from './MembershipBlock.jsx';
import EventListBlock from './EventListBlock.jsx';
import { ContactDetails, MapBlock } from './ContactSection.jsx';

export const NODES = {
  PageRoot,
  Section,
  Row,
  Column,
  Heading,
  TextBlock,
  ImageBlock,
  ButtonBlock,
  Divider,
  Spacer,
  CardGrid,
  Accordion,
  Tabs,
  VideoBlock,
  Gallery,
  LogoStrip,
  Stats,
  Testimonials,
  HtmlBlock,
  FormEmbed,
  ProductList,
  ProductDetail,
  DonationBlock,
  MembershipBlock,
  EventListBlock,
  ContactDetails,
  MapBlock,
};

export {
  PageRoot,
  Section,
  Row,
  Column,
  Heading,
  TextBlock,
  ImageBlock,
  ButtonBlock,
  Divider,
  Spacer,
  CardGrid,
  Accordion,
  Tabs,
  VideoBlock,
  Gallery,
  LogoStrip,
  Stats,
  Testimonials,
  HtmlBlock,
  FormEmbed,
  ProductList,
  ProductDetail,
  DonationBlock,
  MembershipBlock,
  EventListBlock,
  ContactDetails,
  MapBlock,
};

/**
 * What the Toolbox offers, grouped the way a non-technical user thinks about a
 * page. `element` is what actually gets dragged in — layout entries ship with
 * sensible children so a dropped Section is usable immediately.
 */
export const TOOLBOX = [
  {
    category: 'Layout',
    items: [
      {
        key: 'Section',
        label: 'Section',
        icon: 'fa-solid fa-square',
        hint: 'A full-width band. Everything else goes inside one.',
        element: (
          <Element is={Section} canvas>
            <Element is={Row} canvas>
              <Element is={Column} canvas span={12} />
            </Element>
          </Element>
        ),
      },
      {
        key: 'Row',
        label: 'Columns',
        icon: 'fa-solid fa-table-columns',
        hint: 'Split a section into columns.',
        element: (
          <Element is={Row} canvas>
            <Element is={Column} canvas span={6} />
            <Element is={Column} canvas span={6} />
          </Element>
        ),
      },
      { key: 'Spacer', label: 'Spacer', icon: 'fa-solid fa-arrows-up-down', element: <Element is={Spacer} /> },
      { key: 'Divider', label: 'Divider', icon: 'fa-solid fa-grip-lines', element: <Element is={Divider} /> },
    ],
  },
  {
    category: 'Content',
    items: [
      { key: 'Heading', label: 'Heading', icon: 'fa-solid fa-heading', element: <Element is={Heading} /> },
      { key: 'TextBlock', label: 'Text', icon: 'fa-solid fa-align-left', element: <Element is={TextBlock} /> },
      { key: 'ButtonBlock', label: 'Button', icon: 'fa-solid fa-hand-pointer', element: <Element is={ButtonBlock} /> },
      { key: 'CardGrid', label: 'Card Grid', icon: 'fa-solid fa-grip', element: <Element is={CardGrid} /> },
      { key: 'Accordion', label: 'Accordion / FAQ', icon: 'fa-solid fa-list', element: <Element is={Accordion} /> },
      { key: 'Tabs', label: 'Tabs', icon: 'fa-solid fa-folder', element: <Element is={Tabs} /> },
      { key: 'Stats', label: 'Stats', icon: 'fa-solid fa-chart-simple', element: <Element is={Stats} /> },
      { key: 'Testimonials', label: 'Testimonials', icon: 'fa-solid fa-quote-left', element: <Element is={Testimonials} /> },
    ],
  },
  {
    category: 'Media',
    items: [
      { key: 'ImageBlock', label: 'Image', icon: 'fa-solid fa-image', element: <Element is={ImageBlock} /> },
      { key: 'Gallery', label: 'Gallery', icon: 'fa-solid fa-images', element: <Element is={Gallery} /> },
      { key: 'VideoBlock', label: 'Video', icon: 'fa-solid fa-play', element: <Element is={VideoBlock} /> },
      { key: 'LogoStrip', label: 'Logo Strip', icon: 'fa-solid fa-ribbon', element: <Element is={LogoStrip} /> },
    ],
  },
  {
    category: 'Features',
    items: [
      { key: 'FormEmbed', label: 'Form', icon: 'fa-solid fa-list-check', element: <Element is={FormEmbed} /> },
      { key: 'ProductList', label: 'Shop Listing', icon: 'fa-solid fa-bag-shopping', element: <Element is={ProductList} /> },
      { key: 'ProductDetail', label: 'Product', icon: 'fa-solid fa-tag', element: <Element is={ProductDetail} /> },
      { key: 'DonationBlock', label: 'Donation / Payment', icon: 'fa-solid fa-hand-holding-dollar', element: <Element is={DonationBlock} /> },
      { key: 'MembershipBlock', label: 'Membership', icon: 'fa-solid fa-id-card', element: <Element is={MembershipBlock} /> },
      { key: 'EventListBlock', label: 'Event Listing', icon: 'fa-solid fa-calendar-days', element: <Element is={EventListBlock} /> },
      { key: 'ContactDetails', label: 'Contact Details', icon: 'fa-solid fa-address-card', element: <Element is={ContactDetails} /> },
      { key: 'MapBlock', label: 'Map', icon: 'fa-solid fa-map-location-dot', element: <Element is={MapBlock} /> },
    ],
  },
  {
    category: 'Advanced',
    items: [
      { key: 'HtmlBlock', label: 'HTML', icon: 'fa-solid fa-code', hint: 'Paste markup that renders exactly as written.', element: <Element is={HtmlBlock} /> },
    ],
  },
];

/** An empty page — one section with a heading and a paragraph, no real copy. */
export const BLANK_PAGE = (
  <Element is={PageRoot} canvas>
    <Element is={Section} canvas>
      <Element is={Row} canvas>
        <Element is={Column} canvas span={12}>
          <Element is={Heading} text="Your page heading" />
          <Element is={TextBlock} />
        </Element>
      </Element>
    </Element>
  </Element>
);
