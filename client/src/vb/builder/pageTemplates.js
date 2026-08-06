// Pre-built Puck page templates for the Website Pages admin.
// Each template contains valid puck_data that can be posted directly
// to POST /api/website/pages on creation.
//
// VCSF branding: deep navy #0A1F3D, badge gold #C9A227, warm cream #F8F5EF.

const NAVY = '#0A1F3D';
const GOLD = '#C9A227';
const CREAM = '#F8F5EF';

export const PAGE_TEMPLATES = [
  {
    id: 'blank',
    label: 'Blank Page',
    description: 'Start from scratch with an empty canvas',
    icon: 'solar:document-add-line-duotone',
    puck_data: {
      root: { props: { pageTitle: '' } },
      zones: {},
      content: [],
    },
  },

  {
    id: 'landing-page',
    label: 'Landing Page (full new-design section set)',
    description: 'Every section from the new site design in one page — hero, stats, mission, photo programs grid, ways-to-help cards, sponsor logos, and final CTA. Delete what you don\'t need.',
    icon: 'solar:layers-minimalistic-bold-duotone',
    puck_data: {
      root: { props: { pageTitle: 'New Landing Page' } },
      zones: {},
      content: [
        {
          type: 'HeroBanner',
          props: {
            id: 'HeroBanner-1',
            eyebrow: 'EST. 2005 • 501(c)(3) NONPROFIT',
            eyebrowBg: 'rgba(255,255,255,0.9)', eyebrowColor: NAVY,
            headline: 'Supporting Our Deputies.\nStrengthening Our Community.',
            headlineColor: '#ffffff',
            headlineSize: 'clamp(2.2rem,5vw,3.5rem)',
            subtext: 'Building community partnerships to enhance public safety in Ventura County.',
            subtextColor: 'rgba(255,255,255,0.9)',
            subtextSize: '1.25rem',
            bgImage: '',
            bgPosition: 'center', bgSize: 'cover',
            bgColor: NAVY, overlay: 0.55, height: '70vh',
            verticalAlign: 'center', textOffsetY: '', align: 'left',
            ctaText: 'Donate Today', ctaUrl: '/support',
            ctaColor: GOLD, ctaTextColor: NAVY,
            ctaText2: 'Learn More →', ctaUrl2: '/about',
            btnRadius: '12px',
            animation: 'none', animDelay: '0',
          },
        },
        {
          type: 'StatsRow',
          props: {
            id: 'StatsRow-1',
            items: [
              { value: '160', prefix: '', suffix: '+', label: 'Children supported in a single event' },
              { value: '10', prefix: '', suffix: '', label: 'Years of community events' },
              { value: '2,500', prefix: '$', suffix: '', label: 'Scholarships awarded to deputy families' },
              { value: '100', prefix: '', suffix: '%', label: 'Of proceeds support our deputies' },
            ],
            bgColor: '#ffffff', textColor: NAVY, labelColor: '#6b7280',
            padding: '3rem 2rem', divider: 'line',
          },
        },
        {
          type: 'TwoColumn',
          props: {
            id: 'TwoColumn-1',
            ratio: '3fr 2fr', gap: '3rem', verticalAlign: 'center',
            containerBgColor: CREAM, containerPadding: '5rem 0', containerMaxWidth: '1280px', containerBgDecoration: '',
            leftContent: `<div style="text-transform:uppercase;letter-spacing:2px;font-size:.75rem;font-weight:600;color:${GOLD};margin-bottom:.75rem;">OUR MISSION</div><h2 style="color:${NAVY};font-size:clamp(2rem,4vw,3rem);font-weight:700;letter-spacing:-1px;margin:0 0 1.5rem;">Add your mission statement here.</h2><p style="color:#4b5563;line-height:1.75;">Describe the organization's mission and impact. Use this space to connect with visitors and explain why their support matters.</p>`,
            leftBgDecoration: '', leftBgImage: '', leftBgColor: '', leftOverlay: 0, leftTextColor: '', leftPadding: '0', leftMinHeight: '', leftBgPosition: 'center center',
            rightContent: `<div style="background:${NAVY};color:#fff;padding:2.25rem;border-radius:1.5rem;"><div style="color:${GOLD};font-size:.75rem;letter-spacing:2px;font-weight:500;margin-bottom:1.25rem;">OUR VISION</div><p style="font-size:1.5rem;line-height:1.3;margin:0;">Add a vision statement or key quote in this highlighted card.</p></div>`,
            rightBgDecoration: '', rightBgImage: '', rightBgColor: '', rightOverlay: 0, rightTextColor: '', rightPadding: '0', rightMinHeight: '', rightBgPosition: 'center center',
            animation: 'none', animDelay: '0',
          },
        },
        {
          type: 'CardGrid',
          props: {
            id: 'CardGrid-programs',
            label: 'WHAT WE DO',
            heading: 'Programs & Impact',
            headingColor: NAVY, subtext: '', subtextColor: '',
            columns: 4, cardStyle: 'plain', bgColor: '#ffffff',
            cardBg: CREAM, cardTitleColor: NAVY, cardTextColor: '#4b5563', cardLinkColor: GOLD,
            iconColor: GOLD, btnRadius: '24px', cardTitleSize: '1.25rem',
            animation: 'none', animDelay: '0',
            items: [
              { image: '', icon: 'fa-solid fa-star', title: 'Program One', text: 'Describe this program and its impact.', link: '/programs', linkText: 'LEARN MORE →' },
              { image: '', icon: 'fa-solid fa-star', title: 'Program Two', text: 'Describe this program and its impact.', link: '/programs', linkText: 'LEARN MORE →' },
              { image: '', icon: 'fa-solid fa-star', title: 'Program Three', text: 'Describe this program and its impact.', link: '/programs', linkText: 'LEARN MORE →' },
              { image: '', icon: 'fa-solid fa-star', title: 'Program Four', text: 'Describe this program and its impact.', link: '/programs', linkText: 'LEARN MORE →' },
            ],
          },
        },
        {
          type: 'CardGrid',
          props: {
            id: 'CardGrid-1',
            label: 'GET INVOLVED',
            heading: 'There are many ways to help.',
            headingColor: NAVY, subtext: '', subtextColor: '',
            columns: 3, cardStyle: 'bordered', bgColor: CREAM,
            cardBg: '#ffffff', cardTitleColor: NAVY, cardTextColor: '#4b5563',
            cardLinkColor: GOLD, iconColor: GOLD, btnRadius: '12px', cardTitleSize: '1.25rem',
            animation: 'none', animDelay: '0',
            items: [
              { icon: 'fa-solid fa-hand-holding-dollar', title: 'Donate', text: 'Describe how donations are used.', link: '/support', linkText: 'GIVE NOW →' },
              { icon: 'fa-solid fa-id-card', title: 'Become a Member', text: 'Describe membership benefits.', link: '/support', linkText: 'JOIN TODAY →' },
              { icon: 'fa-solid fa-handshake', title: 'Sponsor', text: 'Describe sponsorship opportunities.', link: '/contact', linkText: 'CONTACT US →' },
            ],
          },
        },
        {
          type: 'SponsorLogoGrid',
          props: {
            id: 'SponsorLogoGrid-1',
            eyebrow: 'PROUDLY SUPPORTED BY', heading: 'Our Community Partners',
            ctaText: 'Become a sponsor →', ctaUrl: '/contact',
            bgColor: NAVY, textColor: '#ffffff', columns: 6, grayscaleHover: false,
            footnoteText: '',
            logos: [
              { name: 'Sponsor One', image: '', url: '' },
              { name: 'Sponsor Two', image: '', url: '' },
              { name: 'Sponsor Three', image: '', url: '' },
              { name: 'Sponsor Four', image: '', url: '' },
            ],
          },
        },
        {
          type: 'CTABanner',
          props: {
            id: 'CTABanner-1',
            headline: 'Help us continue building a stronger, safer community.',
            headlineColor: NAVY, headlineSize: '2.5rem',
            subtext: 'EVERY CONTRIBUTION MATTERS', subtextColor: GOLD, subtextSize: '0.9rem',
            bgImage: '', bgOverlay: 0, bgColor: CREAM, bgDecoration: '', textColor: NAVY, btnRadius: '16px',
            btn1Text: 'Donate Now', btn1Url: '/support', btn1BgColor: GOLD, btn1TextColor: NAVY,
            btn2Text: 'Learn More', btn2Url: '/about', btn2BgColor: 'transparent', btn2TextColor: NAVY,
          },
        },
      ],
    },
  },

  {
    id: 'content-page',
    label: 'Content Page',
    description: 'Page hero banner plus a rich text section — for simple informational pages',
    icon: 'solar:document-text-bold-duotone',
    puck_data: {
      root: { props: { pageTitle: 'New Page' } },
      zones: {},
      content: [
        {
          type: 'PageHeroBanner',
          props: { id: 'PageHeroBanner-1' },
        },
        {
          type: 'TextBlock',
          props: {
            id: 'TextBlock-1',
            html: `<h2 style="color:${NAVY};">Section Heading</h2><p>Add your content here. You can use HTML for <strong>bold</strong>, <em>italic</em>, <a href="#">links</a>, and more.</p>`,
            maxWidth: '800px', padding: '2rem', bgColor: '', textColor: '', center: 'left',
            animation: 'none', animDelay: '0',
          },
        },
      ],
    },
  },

  {
    id: 'contact-page',
    label: 'Contact Page',
    description: 'Contact section with form embed and direct contact details',
    icon: 'solar:letter-bold-duotone',
    puck_data: {
      root: { props: { pageTitle: 'Contact Us' } },
      zones: {},
      content: [
        { type: 'ContactSection', props: { id: 'ContactSection-1' } },
      ],
    },
  },

  {
    id: 'faq-page',
    label: 'FAQ Page',
    description: 'Frequently asked questions accordion with contact CTA',
    icon: 'solar:question-circle-bold-duotone',
    puck_data: {
      root: { props: { pageTitle: 'FAQ' } },
      zones: {},
      content: [
        { type: 'FAQAccordion', props: { id: 'FAQAccordion-1' } },
      ],
    },
  },

  {
    id: 'donation-campaign',
    label: 'Donation / Campaign Page',
    description: 'Campaign hero + live donation form wired to real checkout — set the fund/campaign designation in the Donation Card once placed.',
    icon: 'solar:hand-heart-bold-duotone',
    puck_data: {
      root: { props: { pageTitle: 'Donation Campaign' } },
      zones: {},
      content: [
        {
          type: 'HeroBanner',
          props: {
            id: 'HeroBanner-campaign',
            eyebrow: '2026 CAMPAIGN', eyebrowBg: 'rgba(255,255,255,0.9)', eyebrowColor: NAVY,
            headline: 'Help Us Reach Our Goal',
            headlineColor: '#ffffff', headlineSize: 'clamp(2.2rem,5vw,3.5rem)',
            subtext: 'Replace this with a sentence or two about what this campaign funds and why it matters.',
            subtextColor: 'rgba(255,255,255,0.9)', subtextSize: '1.25rem',
            bgImage: '', bgPosition: 'center', bgSize: 'cover',
            bgColor: NAVY, overlay: 0.55, height: '55vh',
            verticalAlign: 'center', textOffsetY: '', align: 'left',
            ctaText: '', ctaUrl: '', ctaColor: GOLD, ctaTextColor: NAVY,
            ctaText2: '', ctaUrl2: '', btnRadius: '12px',
            animation: 'none', animDelay: '0',
          },
        },
        {
          type: 'StatsRow',
          props: {
            id: 'StatsRow-campaign',
            items: [
              { value: '0', prefix: '$', suffix: '', label: 'Raised so far — update as the campaign progresses' },
              { value: '0', prefix: '$', suffix: '', label: 'Campaign goal' },
              { value: '0', prefix: '', suffix: '', label: 'Donors so far' },
            ],
            bgColor: '#ffffff', textColor: NAVY, labelColor: '#6b7280',
            padding: '3rem 2rem', divider: 'line',
          },
        },
        {
          type: 'DonationCard',
          props: {
            id: 'DonationCard-campaign',
            eyebrow: 'DIRECT IMPACT',
            heading: 'Make a Donation',
            description: "100% of every gift supports grants, training, Shop with a Cop, scholarships, and community events. Designate your gift or let us direct it where it's needed most.",
            amounts: '25,50,100,250,500',
            showCoverFees: 'yes',
            coverFeesLabel: 'Add a little extra to cover processing fees',
            showMonthlyOption: 'yes',
            monthlyLabel: 'Make this a monthly recurring gift',
            submitText: 'Donate Securely',
            disclaimerText: 'Payments processed securely. Tax receipt sent automatically.',
            successMessage: 'Thank you for your generous gift! A receipt has been sent to your email.',
            bgColor: '#ffffff', sectionBgColor: 'transparent', accentColor: GOLD,
            headingColor: NAVY, textColor: '#4b5563', btnColor: GOLD, btnTextColor: NAVY,
            btnRadius: '16px', animation: 'none', animDelay: '0',
          },
        },
        {
          type: 'CTABanner',
          props: {
            id: 'CTABanner-campaign',
            headline: 'Every gift moves us closer to our goal.',
            headlineColor: NAVY, headlineSize: '2.5rem',
            subtext: 'THANK YOU FOR YOUR SUPPORT', subtextColor: GOLD, subtextSize: '0.9rem',
            bgImage: '', bgOverlay: 0, bgColor: CREAM, bgDecoration: '', textColor: NAVY, btnRadius: '16px',
            btn1Text: '', btn1Url: '', btn1BgColor: GOLD, btn1TextColor: NAVY,
            btn2Text: '', btn2Url: '', btn2BgColor: 'transparent', btn2TextColor: NAVY,
          },
        },
      ],
    },
  },

  {
    id: 'membership-signup',
    label: 'Membership Signup Page',
    description: 'Benefits overview + live membership signup wired to real checkout and auto-renewal.',
    icon: 'solar:medal-ribbons-star-bold-duotone',
    puck_data: {
      root: { props: { pageTitle: 'Become a Member' } },
      zones: {},
      content: [
        {
          type: 'HeroBanner',
          props: {
            id: 'HeroBanner-membership',
            eyebrow: 'JOIN US', eyebrowBg: 'rgba(255,255,255,0.9)', eyebrowColor: NAVY,
            headline: 'Become a Member Today',
            headlineColor: '#ffffff', headlineSize: 'clamp(2.2rem,5vw,3.5rem)',
            subtext: 'Membership dues fund our year-round programs — choose a tier below to join.',
            subtextColor: 'rgba(255,255,255,0.9)', subtextSize: '1.25rem',
            bgImage: '', bgPosition: 'center', bgSize: 'cover',
            bgColor: NAVY, overlay: 0.55, height: '55vh',
            verticalAlign: 'center', textOffsetY: '', align: 'left',
            ctaText: '', ctaUrl: '', ctaColor: GOLD, ctaTextColor: NAVY,
            ctaText2: '', ctaUrl2: '', btnRadius: '12px',
            animation: 'none', animDelay: '0',
          },
        },
        {
          type: 'CardGrid',
          props: {
            id: 'CardGrid-benefits',
            label: 'MEMBER BENEFITS', heading: 'Why Join?',
            headingColor: NAVY, subtext: '', subtextColor: '',
            columns: 3, cardStyle: 'bordered', bgColor: CREAM,
            cardBg: '#ffffff', cardTitleColor: NAVY, cardTextColor: '#4b5563',
            cardLinkColor: GOLD, iconColor: GOLD, btnRadius: '12px', cardTitleSize: '1.25rem',
            animation: 'none', animDelay: '0',
            items: [
              { icon: 'fa-solid fa-id-card', title: 'Membership Card', text: 'Describe a benefit of joining.', link: '', linkText: '' },
              { icon: 'fa-solid fa-newspaper', title: 'Annual Report', text: 'Describe a benefit of joining.', link: '', linkText: '' },
              { icon: 'fa-solid fa-users', title: 'Community', text: 'Describe a benefit of joining.', link: '', linkText: '' },
            ],
          },
        },
        {
          type: 'MembershipCard',
          props: {
            id: 'MembershipCard-signup',
            eyebrow: 'JOIN US',
            heading: 'Become a Member',
            description: 'Choose a membership level below — your support funds our year-round programs, and membership renews automatically each period.',
            submitText: 'Join Now',
            disclaimerText: 'Payments processed securely. Cancel anytime.',
            successMessage: 'Welcome! Your membership is active and a receipt has been sent to your email.',
            bgColor: '#ffffff', sectionBgColor: 'transparent', accentColor: GOLD,
            headingColor: NAVY, textColor: '#4b5563', btnColor: GOLD, btnTextColor: NAVY,
            btnRadius: '16px', animation: 'none', animDelay: '0',
          },
        },
      ],
    },
  },

  {
    id: 'event-registration',
    label: 'Event Registration Page',
    description: 'Event details + live ticket registration wired to real checkout — set which event in the Event Registration Card once placed.',
    icon: 'solar:calendar-bold-duotone',
    puck_data: {
      root: { props: { pageTitle: 'Event Registration' } },
      zones: {},
      content: [
        {
          type: 'HeroBanner',
          props: {
            id: 'HeroBanner-event',
            eyebrow: 'SAVE THE DATE', eyebrowBg: 'rgba(255,255,255,0.9)', eyebrowColor: NAVY,
            headline: 'Event Name Here',
            headlineColor: '#ffffff', headlineSize: 'clamp(2.2rem,5vw,3.5rem)',
            subtext: 'Add the date, time, and location here.',
            subtextColor: 'rgba(255,255,255,0.9)', subtextSize: '1.25rem',
            bgImage: '', bgPosition: 'center', bgSize: 'cover',
            bgColor: NAVY, overlay: 0.55, height: '55vh',
            verticalAlign: 'center', textOffsetY: '', align: 'left',
            ctaText: '', ctaUrl: '', ctaColor: GOLD, ctaTextColor: NAVY,
            ctaText2: '', ctaUrl2: '', btnRadius: '12px',
            animation: 'none', animDelay: '0',
          },
        },
        {
          type: 'EventRegistrationCard',
          props: {
            id: 'EventRegistrationCard-signup',
            eventSlug: '',
            eyebrow: 'SAVE YOUR SPOT',
            heading: 'Register Now',
            description: 'Choose a ticket type below to reserve your spot.',
            submitText: 'Add to Cart',
            disclaimerText: 'Payments processed securely.',
            bgColor: '#ffffff', sectionBgColor: 'transparent', accentColor: GOLD,
            headingColor: NAVY, textColor: '#4b5563', btnColor: GOLD, btnTextColor: NAVY,
            btnRadius: '16px', animation: 'none', animDelay: '0',
          },
        },
        {
          type: 'SponsorLogoGrid',
          props: {
            id: 'SponsorLogoGrid-event',
            eyebrow: 'THANK YOU TO OUR SPONSORS', heading: 'Event Sponsors',
            ctaText: 'Become a sponsor →', ctaUrl: '/contact',
            bgColor: NAVY, textColor: '#ffffff', columns: 6, grayscaleHover: false,
            footnoteText: '',
            logos: [
              { name: 'Sponsor One', image: '', url: '' },
              { name: 'Sponsor Two', image: '', url: '' },
            ],
          },
        },
        {
          type: 'CTABanner',
          props: {
            id: 'CTABanner-event',
            headline: "Can't make it? Support us with a gift instead.",
            headlineColor: NAVY, headlineSize: '2.5rem',
            subtext: 'EVERY CONTRIBUTION MATTERS', subtextColor: GOLD, subtextSize: '0.9rem',
            bgImage: '', bgOverlay: 0, bgColor: CREAM, bgDecoration: '', textColor: NAVY, btnRadius: '16px',
            btn1Text: 'Donate Instead', btn1Url: '/support', btn1BgColor: GOLD, btn1TextColor: NAVY,
            btn2Text: '', btn2Url: '', btn2BgColor: 'transparent', btn2TextColor: NAVY,
          },
        },
      ],
    },
  },

  {
    id: 'event-ticket-purchase',
    label: 'Event Ticket Purchase',
    description: 'Shared ticket-purchase destination for any event — the event shown is driven by a ?event=<slug> URL param, so publish this once and link every event\'s "Get Tickets" button here (e.g. from the Upcoming Events template below). Free tickets register instantly; paid tickets add to the cart and check out like a shop order.',
    icon: 'solar:ticket-bold-duotone',
    puck_data: {
      root: { props: { pageTitle: 'Event Tickets' } },
      zones: {},
      content: [
        {
          type: 'HeroBanner',
          props: {
            id: 'HeroBanner-ticket-purchase',
            eyebrow: 'GET YOUR TICKETS', eyebrowBg: 'rgba(255,255,255,0.9)', eyebrowColor: NAVY,
            headline: 'Event Tickets',
            headlineColor: '#ffffff', headlineSize: 'clamp(2.2rem,5vw,3.5rem)',
            subtext: 'Reserve your spot below.',
            subtextColor: 'rgba(255,255,255,0.9)', subtextSize: '1.25rem',
            bgImage: '', bgPosition: 'center', bgSize: 'cover',
            bgColor: NAVY, overlay: 0.55, height: '45vh',
            verticalAlign: 'center', textOffsetY: '', align: 'left',
            ctaText: '', ctaUrl: '', ctaColor: GOLD, ctaTextColor: NAVY,
            ctaText2: '', ctaUrl2: '', btnRadius: '12px',
            animation: 'none', animDelay: '0',
          },
        },
        {
          type: 'EventRegistrationCard',
          props: {
            id: 'EventRegistrationCard-ticket-purchase',
            eventSlug: '',
            eyebrow: 'SAVE YOUR SPOT',
            heading: 'Register Now',
            description: 'Choose a ticket type below to reserve your spot.',
            submitText: 'Add to Cart',
            disclaimerText: 'Payments processed securely.',
            bgColor: '#ffffff', sectionBgColor: 'transparent', accentColor: GOLD,
            headingColor: NAVY, textColor: '#4b5563', btnColor: GOLD, btnTextColor: NAVY,
            btnRadius: '16px', animation: 'none', animDelay: '0',
          },
        },
        {
          type: 'ProductList',
          props: {
            id: 'ProductList-ticket-upsell',
            heading: 'Add a Keepsake', subheading: 'Bring home something to remember the day.',
            categoryId: '', limit: 4, columns: 4, showPrice: 'yes',
            btnText: 'View Details', viewAllUrl: '/shop',
            cardRadius: '6px', bgColor: '', accentColor: GOLD,
          },
        },
        {
          type: 'CTABanner',
          props: {
            id: 'CTABanner-ticket-purchase',
            headline: "Can't make it? Support us with a gift instead.",
            headlineColor: NAVY, headlineSize: '2.5rem',
            subtext: 'EVERY CONTRIBUTION MATTERS', subtextColor: GOLD, subtextSize: '0.9rem',
            bgImage: '', bgOverlay: 0, bgColor: CREAM, bgDecoration: '', textColor: NAVY, btnRadius: '16px',
            btn1Text: 'Donate Instead', btn1Url: '/support', btn1BgColor: GOLD, btn1TextColor: NAVY,
            btn2Text: '', btn2Url: '', btn2BgColor: 'transparent', btn2TextColor: NAVY,
          },
        },
      ],
    },
  },

  {
    id: 'events-listing',
    label: 'Upcoming Events',
    description: 'Browse-all-events page — pairs with the Event Ticket Purchase template above. Publish that one first at /event-tickets (or update this page\'s Events List block to match wherever you put it).',
    icon: 'solar:calendar-mark-bold-duotone',
    puck_data: {
      root: { props: { pageTitle: 'Upcoming Events' } },
      zones: {},
      content: [
        {
          type: 'HeroBanner',
          props: {
            id: 'HeroBanner-events-listing',
            eyebrow: "WHAT'S HAPPENING", eyebrowBg: 'rgba(255,255,255,0.9)', eyebrowColor: NAVY,
            headline: 'Upcoming Events',
            headlineColor: '#ffffff', headlineSize: 'clamp(2.2rem,5vw,3.5rem)',
            subtext: 'Join us — pick an event below to get your tickets.',
            subtextColor: 'rgba(255,255,255,0.9)', subtextSize: '1.25rem',
            bgImage: '', bgPosition: 'center', bgSize: 'cover',
            bgColor: NAVY, overlay: 0.55, height: '45vh',
            verticalAlign: 'center', textOffsetY: '', align: 'left',
            ctaText: '', ctaUrl: '', ctaColor: GOLD, ctaTextColor: NAVY,
            ctaText2: '', ctaUrl2: '', btnRadius: '12px',
            animation: 'none', animDelay: '0',
          },
        },
        {
          type: 'EventsListBlock',
          props: {
            id: 'EventsListBlock-events-listing',
            heading: 'Upcoming Events', subheading: '',
            limit: 6, columns: 3, purchasePath: '/event-tickets', btnText: 'Get Tickets',
            viewAllUrl: '', cardRadius: '6px', bgColor: '', accentColor: GOLD,
          },
        },
        {
          type: 'CTABanner',
          props: {
            id: 'CTABanner-events-listing',
            headline: "Don't see an event that fits? Support us with a gift instead.",
            headlineColor: NAVY, headlineSize: '2.5rem',
            subtext: 'EVERY CONTRIBUTION MATTERS', subtextColor: GOLD, subtextSize: '0.9rem',
            bgImage: '', bgOverlay: 0, bgColor: CREAM, bgDecoration: '', textColor: NAVY, btnRadius: '16px',
            btn1Text: 'Donate Instead', btn1Url: '/support', btn1BgColor: GOLD, btn1TextColor: NAVY,
            btn2Text: '', btn2Url: '', btn2BgColor: 'transparent', btn2TextColor: NAVY,
          },
        },
      ],
    },
  },
];
