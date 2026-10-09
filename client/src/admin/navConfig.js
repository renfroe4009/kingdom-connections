// =============================================================================
// Shared nav/module structure — single source of truth for AppLayout's
// sidebar/top-bar AND the Module Manager admin page, so the two never drift.
// A "section" is a top-level module (CRM, Website, Fundraising, ...); each
// section's `items` are its submodules, some of which nest further via
// `children` (e.g. Billing -> Invoices/Transactions/Reconciliation).
// =============================================================================

export const SECTIONS = [
  {
    key: 'crm', label: 'CRM', icon: 'solar:users-group-two-rounded-bold-duotone',
    matchPrefixes: ['/admin/dashboard', '/admin/contacts', '/admin/organizations', '/admin/duplicates', '/admin/deals', '/admin/pipeline',
      '/admin/invoices', '/admin/transactions', '/admin/billing', '/admin/subscriptions', '/admin/maps', '/admin/tasks',
      '/admin/activities', '/admin/import'],
    items: [
      { to: '/admin/dashboard',     label: 'Dashboard',     icon: 'solar:screencast-2-line-duotone' },
      { to: '/admin/contacts',      label: 'Contacts',      icon: 'solar:user-rounded-line-duotone',          perm: 'contacts.read' },
      { to: '/admin/organizations', label: 'Organizations', icon: 'solar:buildings-2-line-duotone',           perm: 'organizations.read' },
      { to: '/admin/duplicates',    label: 'Duplicates',    icon: 'solar:layers-minimalistic-line-duotone',   perm: 'contacts.write' },
      { to: '/admin/deals',         label: 'Deals',         icon: 'solar:dollar-minimalistic-bold-duotone',   perm: 'deals.read' },
      { to: '/admin/pipeline',      label: 'Pipeline',      icon: 'solar:chart-2-line-duotone',               perm: 'deals.read' },
      {
        to: '/admin/invoices', label: 'Billing', icon: 'solar:bill-list-line-duotone', perm: 'invoices.read',
        children: [
          { to: '/admin/invoices',                   label: 'Invoices',        icon: 'solar:document-text-line-duotone' },
          { to: '/admin/transactions',               label: 'Transactions',    icon: 'solar:card-line-duotone',             perm: 'payments.read' },
          { to: '/admin/billing/tax-report',         label: 'Sales Tax',       icon: 'solar:bill-list-line-duotone',        perm: 'reports.view' },
          { to: '/admin/billing/reconciliation',     label: 'Reconciliation',  icon: 'solar:shield-check-line-duotone',     perm: 'reports.view' },
        ],
      },
      { to: '/admin/subscriptions', label: 'Recurring', icon: 'solar:refresh-circle-line-duotone', perm: 'subscriptions.read' },
      { to: '/admin/maps',          label: 'Maps',          icon: 'solar:map-point-line-duotone',   perm: 'maps.view' },
      { to: '/admin/tasks',         label: 'Tasks',         icon: 'solar:checklist-minimalistic-line-duotone', perm: 'tasks.read' },
      { to: '/admin/activities',    label: 'Activity',      icon: 'solar:clock-circle-line-duotone' },
      { to: '/admin/import',        label: 'CSV Import',    icon: 'solar:upload-minimalistic-line-duotone',   perm: 'import.csv' },
    ],
  },
  {
    key: 'website', label: 'Website', icon: 'solar:global-line-duotone',
    matchPrefixes: ['/admin/website', '/admin/blog-posts', '/admin/media', '/admin/reports/seo-settings', '/admin/forms', '/admin/settings/dns'],
    items: [
      { to: '/admin/website/pages',        label: 'Pages',           icon: 'solar:document-line-duotone' },
      { to: '/admin/website/settings',     label: 'Header & Footer', icon: 'solar:widget-line-duotone' },
      { to: '/admin/blog-posts',           label: 'Blog Posts',      icon: 'solar:document-text-line-duotone' },
      { to: '/admin/media',                label: 'Media Library',   icon: 'solar:gallery-wide-line-duotone' },
      { to: '/admin/forms',                label: 'Forms',           icon: 'solar:checklist-minimalistic-line-duotone' },
      { to: '/admin/reports/seo-settings', label: 'SEO',             icon: 'solar:magnifer-line-duotone' },
      { to: '/admin/settings/dns',         label: 'DNS Manager',     icon: 'solar:server-path-line-duotone', perm: 'settings.manage' },
      { to: '/admin/website/global-settings', label: 'Global Website Settings', icon: 'solar:settings-line-duotone', perm: 'settings.manage' },
    ],
  },
  {
    key: 'marketing', label: 'Marketing', icon: 'solar:rocket-2-bold-duotone',
    matchPrefixes: ['/admin/comms', '/admin/marketing'],
    items: [
      {
        to: '/admin/comms', label: 'Communications', icon: 'solar:chat-round-line-duotone', perm: 'comms.read',
        children: [
          { to: '/admin/comms',           label: 'Inbox',     icon: 'solar:inbox-line-duotone' },
          { to: '/admin/comms/lists',     label: 'Lists',     icon: 'solar:users-group-rounded-line-duotone', perm: 'lists.read' },
          { to: '/admin/comms/campaigns', label: 'Campaigns', icon: 'solar:rocket-2-line-duotone',           perm: 'campaigns.read' },
          { to: '/admin/comms/templates',   label: 'Templates',   icon: 'solar:document-add-line-duotone',  perm: 'comms.templates.manage' },
          { to: '/admin/comms/automations', label: 'Automations', icon: 'solar:bolt-circle-line-duotone',    perm: 'automations.read' },
        ],
      },
      {
        to: '/admin/marketing/social-composer', label: 'Social', icon: 'solar:share-circle-line-duotone',
        children: [
          { to: '/admin/marketing/social-composer', label: 'Compose',  icon: 'solar:pen-new-square-line-duotone', perm: 'campaigns.write' },
          { to: '/admin/marketing/post-queue',      label: 'Queue',    icon: 'solar:calendar-line-duotone', perm: 'campaigns.read' },
          { to: '/admin/marketing/accounts',        label: 'Accounts', icon: 'solar:link-circle-line-duotone', perm: 'settings.manage' },
        ],
      },
    ],
  },
  {
    key: 'commerce', label: 'Commerce', icon: 'solar:cart-large-2-bold-duotone',
    matchPrefixes: ['/admin/products', '/admin/categories', '/admin/orders', '/admin/shipping', '/admin/tax', '/admin/processing-fees'],
    items: [
      { to: '/admin/products',        label: 'Products',        icon: 'solar:box-line-duotone',          perm: 'products.read' },
      { to: '/admin/categories',      label: 'Categories',      icon: 'solar:folder-line-duotone',       perm: 'products.read' },
      { to: '/admin/orders',          label: 'Orders',          icon: 'solar:bag-check-line-duotone',    perm: 'orders.read' },
      { to: '/admin/shipping',        label: 'Shipping',        icon: 'solar:delivery-line-duotone',     perm: 'shipping.manage' },
      { to: '/admin/tax',             label: 'Tax Rates',       icon: 'solar:bill-list-line-duotone',    perm: 'tax.manage' },
      { to: '/admin/processing-fees', label: 'Processing Fees', icon: 'solar:card-transfer-line-duotone', perm: 'commerce.settings' },
    ],
  },
  {
    key: 'fundraising', label: 'Fundraising', icon: 'solar:heart-line-duotone',
    matchPrefixes: ['/admin/donations', '/admin/pledges', '/admin/membership', '/admin/events', '/admin/volunteers'],
    items: [
      { to: '/admin/donations',       label: 'Donations',        icon: 'solar:hand-heart-line-duotone', perm: 'donations.read' },
      { to: '/admin/pledges',         label: 'Pledges',          icon: 'solar:calendar-mark-line-duotone', perm: 'donations.read' },
      { to: '/admin/donations/funds', label: 'Funds & Campaigns', icon: 'solar:wallet-line-duotone',     perm: 'donations.read' },
      { to: '/admin/donations/retention', label: 'Donor Retention', icon: 'solar:refresh-circle-line-duotone', perm: 'reports.view' },
      { to: '/admin/donations/text-to-give', label: 'Text to Give', icon: 'solar:chat-round-money-line-duotone', perm: 'settings.manage' },
      { to: '/admin/membership',       label: 'Members',          icon: 'solar:users-group-two-rounded-line-duotone', perm: 'membership.read' },
      { to: '/admin/membership/tiers', label: 'Membership Tiers',  icon: 'solar:medal-ribbons-star-line-duotone',     perm: 'membership.read' },
      { to: '/admin/events',           label: 'Events',           icon: 'solar:calendar-line-duotone',        perm: 'events.read' },
      { to: '/admin/events/calendar',  label: 'Events Calendar',  icon: 'solar:calendar-line-duotone',        perm: 'events.read' },
      { to: '/admin/volunteers',       label: 'Volunteers',       icon: 'solar:user-heart-line-duotone',     perm: 'volunteers.read' },
    ],
  },
  {
    key: 'lms', label: 'Learning', icon: 'solar:square-academic-cap-2-bold-duotone',
    matchPrefixes: ['/admin/lms'],
    items: [
      { to: '/admin/lms/courses', label: 'Courses', icon: 'solar:book-2-line-duotone', perm: 'lms.read' },
      { to: '/admin/lms/cohorts', label: 'Cohorts',  icon: 'solar:users-group-rounded-line-duotone', perm: 'lms.read' },
    ],
  },
  {
    key: 'reports', label: 'Reports', icon: 'solar:chart-line-duotone',
    matchPrefixes: ['/admin/reports'],
    items: [
      { to: '/admin/reports', label: 'Reports', icon: 'solar:chart-2-line-duotone', perm: 'reports.view' },
      { to: '/admin/reports/builder', label: 'Report Builder', icon: 'solar:widget-2-line-duotone', perm: 'reports.view' },
    ],
  },
];

export const adminItems = [
  { to: '/admin/users',              label: 'Users',         icon: 'solar:users-group-rounded-line-duotone', perm: 'users.manage' },
  { to: '/admin/roles',              label: 'Roles',         icon: 'solar:shield-user-line-duotone',         perm: 'roles.manage' },
  { to: '/admin/pipelines',    label: 'Pipelines',     icon: 'solar:chart-square-line-duotone',        perm: 'pipelines.access' },
  { to: '/admin/tags',         label: 'Tags',          icon: 'solar:tag-line-duotone',                 perm: 'settings.manage' },
  { to: '/admin/custom-fields',label: 'Custom Fields', icon: 'solar:widget-add-line-duotone',          perm: 'settings.manage' },
  { to: '/admin/portal',       label: 'Portal Users',  icon: 'solar:user-id-line-duotone',             perm: 'portal.manage' },
  { to: '/admin/settings',           label: 'Integrations',  icon: 'solar:settings-line-duotone',            perm: 'settings.manage' },
  { to: '/admin/settings/business',  label: 'Business',      icon: 'solar:buildings-2-line-duotone',         perm: 'settings.manage' },
  { to: '/admin/settings/modules',   label: 'Module Manager', icon: 'solar:widget-5-line-duotone',          perm: 'settings.manage' },
  { to: '/admin/ai-kb',        label: 'AI Knowledge Base', icon: 'solar:stars-line-duotone',           perm: 'settings.manage' },
];

// Optional integrations that can be hidden entirely when a business doesn't
// use them (e.g. ConnectWise is an MSP/IT-services tool, irrelevant to a
// church/nonprofit). Keys match the `tab` values + IntegrationsContext keys
// used across SettingsPage.jsx. Core payment/email are deliberately NOT
// listed here — a CRM needs those regardless of business type.
export const INTEGRATIONS = [
  { key: 'connectwise', label: 'ConnectWise Manage', tab: 'cw',        icon: 'solar:widget-line-duotone' },
  { key: 'usps',        label: 'USPS Address API',   tab: 'usps',      icon: 'solar:map-point-line-duotone' },
  { key: 'google',      label: 'Google Workspace',    tab: 'google',    icon: 'logos:google' },
  { key: 'sms',         label: 'Twilio / SMS',        tab: 'sms',       icon: 'solar:phone-calling-rounded-line-duotone' },
  { key: 'ai',          label: 'AI Assistant',        tab: 'ai',        icon: 'solar:stars-line-duotone' },
  { key: 'mobileapi',   label: 'Mobile API',          tab: 'mobileapi', icon: 'solar:smartphone-line-duotone' },
];
