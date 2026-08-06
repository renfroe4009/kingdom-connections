'use strict';
// =============================================================================
// kbSeeder.js — Seed the ai_knowledge_base table with comprehensive help articles.
// Safe to re-run: uses INSERT ... ON DUPLICATE KEY UPDATE matched on (module, title).
// Run via: node -e "require('./src/services/kbSeeder').seed()"
//          or call seed() on app startup if you want auto-seeding.
// =============================================================================
const { db } = require('../db');

// ─────────────────────────────────────────────────────────────────────────────
// Article definitions
// Each entry: { module, title, content, sort_order }
// ─────────────────────────────────────────────────────────────────────────────
const ARTICLES = [

  // ── Dashboard ───────────────────────────────────────────────────────────────
  {
    module: 'dashboard',
    sort_order: 0,
    title: 'Dashboard Overview',
    content: `The Dashboard shows a real-time snapshot of your business activity. The metric cards at the top display:
- Open Deals / Deals: total value of active orders in your pipelines
- Invoices Due: outstanding balance across unpaid invoices
- Active Subscriptions: count of subscriptions currently billing
- New Contacts (30d): contacts added in the last 30 days

Below the cards you will find a Recent Activity feed showing the latest actions across your team, and a quick-links section for common tasks.

To refresh dashboard data, reload the page. Metrics update in real time as records change.

If a card shows zero when you expect data, check that your user role has the relevant read permission (contacts.read, invoices.read, etc.) — admins see all data.`,
  },

  // ── Contacts ────────────────────────────────────────────────────────────────
  {
    module: 'contacts',
    sort_order: 0,
    title: 'Managing Contacts',
    content: `Contacts are individual people in your CRM.

CREATE: Click "New Contact" on the Contacts list page. Add manually by filling in the form.

EDIT: Open a contact and click the Edit button, or click the pencil icon on the list.

DELETE: Click the trash icon on the list. Deletion is permanent and removes all linked activity.

SEARCH: Use the search bar at the top of the Contacts list to search by name, email, or phone.

LIFECYCLE STAGES: Each contact has a stage (lead, mql, sql, customer, evangelist, other). Update it on the contact detail page to track where they are in your sales process.

TAGS: Add tags to contacts for grouping and filtering. Tags are managed under Admin → Tags.

CUSTOM FIELDS: Extra fields (configured under Admin → Custom Fields) appear at the bottom of the contact detail page.

ORGANIZATION LINK: Link a contact to an organization (company) so they appear on the org detail page. Set this in the Edit Contact form.`,
  },
  {
    module: 'contacts',
    sort_order: 1,
    title: 'Contact Detail Page',
    content: `The Contact Detail page shows everything about a contact in one place.

TABS / SECTIONS:
- Overview: name, email, phone, title, organization, lifecycle stage, owner, address
- Notes: internal notes visible only to your team
- Activities: a log of every action taken on this contact
- Deals / Deals: orders linked to this contact's organization
- Attachments: uploaded files (PDFs, images, etc.)
- Google Drive: linked Drive folder for this contact (if Google Workspace is connected)
- Tasks: tasks associated with this contact

QUICK ACTIONS in the header:
- Send Email / SMS buttons open the communication modal directly on the contact
- Edit button opens the full edit form

OWNER: Assign a team member as the contact owner from the edit form. Owners control which deals the contact appears on for scoped users.`,
  },
  {
    module: 'contacts',
    sort_order: 2,
    title: 'CSV Import',
    content: `To import contacts from a spreadsheet, go to CSV Import in the sidebar.

1. Download the sample CSV template to see the expected column headers.
2. Fill in your data. Required columns: first_name, last_name. Optional: email, phone, title, organization_name, lifecycle_stage, lead_source, address_line1, city, state, postal_code, country.
3. Upload the file. The importer shows a preview of the first rows.
4. Map columns if the headers do not exactly match.
5. Click Import. A summary shows how many rows were created vs skipped (skipped usually means a duplicate email was found).

TIP: organization_name values are matched against existing organizations by name. If no match is found, a new organization is created automatically.`,
  },

  // ── Organizations ───────────────────────────────────────────────────────────
  {
    module: 'organizations',
    sort_order: 0,
    title: 'Managing Organizations (Companies)',
    content: `Organizations represent companies or accounts you do business with.

CREATE: Click "New Organization" on the Organizations list page.

FIELDS: Name (required), website, phone, industry, address, owner, lifecycle stage.

CONTACTS: Contacts linked to this org appear on the org detail page under the Contacts tab. Link contacts via the Edit Contact form (set the Organization field).

DEALS: Deals linked to this org appear under the Deals tab. When creating a deal, set the organization field to link it.

GOOGLE DRIVE: Link a Google Drive folder to an organization on the detail page. Once linked, the folder's files are listed directly in the CRM. Requires Google Workspace to be connected.

BILLING HISTORY: Invoices and payment history for the organization appear under the Billing tab on the org detail page.`,
  },

  // ── Deals ──────────────────────────────────────────────────────
  {
    module: 'deals',
    sort_order: 0,
    title: 'Creating and Managing Deals',
    content: `Deals track sales opportunities and build commitments.

CREATE: Click "New Deal" on the Deals list or from an organization/contact detail page. Required: deal name. Recommended: organization, value, expected close date, pipeline stage.

FIELDS:
- Name: descriptive title for the deal (e.g. "Acme Corp — Managed IT Contract")
- Organization: the company this deal is for
- Value: expected or actual revenue ($)
- Close Date: when you expect to close or deliver
- Pipeline / Stage: which stage the order is in (e.g. Proposal, Deposit Paid, Kit Shipped, Complete)
- Owner: team member responsible

EDIT: Open an order and click Edit, or click the pencil icon on the list.

CLOSE ORDERS: Set the stage to your "Won" or "Lost" stage (configured in Admin → Pipelines). Won orders indicate a completed sale.

NOTES & ACTIVITIES: Add notes from the order detail page. All edits are logged in the activity feed.`,
  },
  {
    module: 'deals',
    sort_order: 1,
    title: 'Pipeline Board (Kanban View)',
    content: `The Pipeline page shows all deals as cards on a Kanban board, grouped by stage.

DRAG AND DROP: Grab an order card and drag it to a different column to change its stage. The change saves immediately.

FILTER: Use the pipeline selector at the top to switch between different pipelines (if you have more than one configured).

CARD INFO: Each card shows order name, organization, value, and close date.

CLICK: Click an order card to open the full detail page.

ADD ORDER FROM BOARD: Click the "+ Deal" button at the bottom of any column to create a new order pre-set to that stage.

COLUMNS: Columns match your configured pipeline stages. To add, rename, or reorder stages, go to Admin → Pipelines.`,
  },

  // ── Tasks ───────────────────────────────────────────────────────────────────
  {
    module: 'tasks',
    sort_order: 0,
    title: 'Managing Tasks',
    content: `Tasks are action items for your team.

CREATE: Click "New Task" on the Tasks page. Fields: title (required), description, assigned to, due date, related contact or deal.

COMPLETE: Check the checkbox next to a task to mark it complete. Completed tasks can be filtered in or out using the status filter.

FILTER: Use the filters at the top of the Tasks list to show All, Open, or Completed tasks. Filter by assigned user to see your own tasks.

DUE DATES: Tasks past their due date show a red due date badge. Sort by due date to see what needs attention.

RELATED RECORDS: A task linked to a contact or deal will also appear on that record's detail page, so the context is always visible.

GOOGLE CALENDAR SYNC: If Google Workspace is connected and calendar sync is enabled, tasks with due dates sync to Google Calendar.`,
  },

  // ── Invoices ────────────────────────────────────────────────────────────────
  {
    module: 'invoices',
    sort_order: 0,
    title: 'Creating Invoices',
    content: `Invoices bill customers for products or services.

CREATE: Click "New Invoice" on the Invoices list. Select the organization (required), then:
- Set issue date and due date
- Add line items: description, quantity, unit price
- Apply a discount (optional): fixed amount or percentage
- Set tax rate if applicable
- Add internal notes or customer-facing notes

INVOICE NUMBER: Auto-generated sequentially. You can override it manually.

SAVE AS DRAFT: The invoice starts in Draft status. You can edit it freely before sending.

SEND: Click "Send Invoice" to email the invoice to the contact linked to the organization. This changes status to Sent and triggers an email with a payment link.

STATUSES: Draft → Sent → Partially Paid → Paid (or Void if cancelled).`,
  },
  {
    module: 'invoices',
    sort_order: 1,
    title: 'Online Invoice Payment',
    content: `Customers can pay invoices online without logging in.

HOW IT WORKS: When you send an invoice by email, it includes a unique payment link. The customer clicks the link, sees the invoice, and pays by card.

PAYMENT PAGE: Shows invoice details, amount due, and a secure payment form. Customers can use a saved card (if they have a portal account) or enter new card details.

PAYMENT GATEWAYS: Payments process through your configured gateway (Authorize.net or Valor PayTech). Configure under Settings → Payment Gateways.

RECORDING MANUAL PAYMENT: To record a check or cash payment, open the invoice and click "Record Payment". Enter the amount, method, and date. This updates the balance due.

PARTIAL PAYMENTS: The system supports partial payments. Each payment is recorded individually. Balance due decreases with each payment.

RECEIPTS: Customers receive an automatic email receipt after each payment. Configure the receipt email template under Business → Email Templates.`,
  },
  {
    module: 'invoices',
    sort_order: 2,
    title: 'Recurring Invoices',
    content: `Recurring invoices automatically generate invoices on a schedule.

CREATE: Go to Billing → Recurring Invoices → New Recurring Invoice. Set:
- Organization and contact
- Line items (same as a regular invoice)
- Frequency: weekly, monthly, quarterly, annually
- Start date and optional end date
- Auto-send: whether to email the customer automatically when each invoice generates

HOW IT WORKS: A background job runs daily and generates invoices when they are due based on the schedule. Each generated invoice appears in the regular Invoices list.

PAUSE / RESUME: Open a recurring invoice and toggle the Active status to pause or resume the schedule.

EDIT: Changes to the template apply to future invoices only. Past invoices are not affected.`,
  },

  // ── Billing / Transactions ──────────────────────────────────────────────────
  {
    module: 'billing',
    sort_order: 0,
    title: 'Payment Transactions',
    content: `All payment activity is recorded in Billing → Transactions.

FILTER: Search by date range, organization, payment method, status (approved, declined, refunded).

COLUMNS: Transaction ID, organization, amount, gateway (Authorize.net or Valor), method (card brand / last 4), status, date.

REFUNDS: Click a transaction to view details. If the gateway supports it, you can initiate a refund from the transaction detail view.

EXPORT: Use the date range filter and then export to CSV for accounting.

RECONCILIATION: Use Billing → Reconciliation to match CRM payments against batch deposits from your payment gateway. This helps identify discrepancies.`,
  },
  {
    module: 'billing',
    sort_order: 1,
    title: 'Sales Tax Report',
    content: `The Sales Tax Report shows tax collected by date range, useful for filing state sales tax returns.

ACCESS: Billing → Sales Tax.

FILTERS: Select a date range (issue date of the invoices). Optionally filter by organization.

REPORT SHOWS: Tax collected by invoice, organization name, taxable amount, tax rate, tax amount. A summary row shows totals.

EXPORT: Click Export to download as CSV.

NOTE: Tax is calculated based on the tax rate applied to each invoice line item at the time of invoicing. If you change tax rates, historical invoices reflect the rate at the time they were created.`,
  },

  // ── Subscriptions ───────────────────────────────────────────────────────────
  {
    module: 'subscriptions',
    sort_order: 0,
    title: 'Managing Subscriptions',
    content: `Subscriptions are ongoing service agreements with automatic billing.

CREATE: Click "New Subscription" from the Subscriptions list or from an organization detail page. Set: organization, plan name, amount, billing frequency, start date.

STATUSES:
- Active: billing normally
- Paused: billing is suspended; resume when ready
- Cancelled: ended, no more billing

BILLING: When a subscription billing date arrives, a charge is automatically attempted against the customer's saved payment method on file. If no payment method is saved, an invoice is generated for manual collection.

CUSTOMER VIEW: Customers can see their subscriptions in the Customer Portal under the Subscriptions tab and can update their payment method.

CANCEL: Open a subscription and click Cancel. You can choose to cancel immediately or at the end of the current period.`,
  },

  // ── Communications ──────────────────────────────────────────────────────────
  {
    module: 'communications',
    sort_order: 0,
    title: 'Sending Email and SMS',
    content: `You can send email or SMS directly from any Contact, Organization, or Deal detail page.

EMAIL: Click the "Send Email" button. A compose modal opens with the contact's email pre-filled. You can type a message directly or choose a saved template. Select a template to load its subject and body, then customize before sending. The sent email is logged in the contact's activity.

SMS: Click the "Send SMS" button on a contact detail page. Type your message (160 chars recommended for single segment). Select a template or type directly. Requires your SMS provider to be configured under Settings → SMS.

BULK: To send to multiple contacts at once, use the Campaigns feature.

INBOX: All sent and received emails and SMS messages appear in Communications → Inbox for a unified view.`,
  },
  {
    module: 'communications',
    sort_order: 1,
    title: 'Contact Lists',
    content: `Lists group contacts for bulk communications.

CREATE: Go to Communications → Lists → New List. Give it a name and description.

ADD CONTACTS: After creating the list, click into it and use the "Add contacts" button. You can search for specific contacts or add by tag.

DYNAMIC FILTER (optional): Set filter criteria (lifecycle stage, tag, organization) and the list will auto-include matching contacts.

USE IN CAMPAIGNS: When composing a campaign, select a list as the recipient group.

UNSUBSCRIBES: Contacts who unsubscribe from campaigns are automatically excluded from future sends to that list.`,
  },
  {
    module: 'communications',
    sort_order: 2,
    title: 'Email Campaigns',
    content: `Campaigns send bulk emails to a contact list.

CREATE: Communications → Campaigns → New Campaign. Steps:
1. Name your campaign (internal label)
2. Select a contact list as recipients
3. Compose the email: subject, body (supports merge fields like {{first_name}}, {{organization}})
4. Preview how the email looks
5. Schedule: send now or pick a future date/time
6. Send / Schedule

MERGE FIELDS: Use {{first_name}}, {{last_name}}, {{email}}, {{organization}} to personalize each email.

RESULTS: After sending, the Campaign Detail page shows sent count, open rate (if tracking enabled), and any bounces.

TEMPLATES: Start from a saved template (Communications → Templates) to reuse content.`,
  },
  {
    module: 'communications',
    sort_order: 3,
    title: 'Email and SMS Templates',
    content: `Templates save reusable message content with merge fields.

CREATE: Communications → Templates → New Template. Choose type (Email or SMS). For email: enter subject and body using the rich text editor. For SMS: enter the message text.

MERGE FIELDS: Insert {{first_name}}, {{last_name}}, {{organization}}, {{invoice_number}}, {{amount_due}}, {{payment_link}} where applicable. These are replaced with real values when the template is sent.

SYSTEM TEMPLATES: Some templates (invoice sent, payment receipt, password reset, etc.) are system templates. Edit these under Business → Email Templates to customize what customers receive.

USE: When sending from a contact page or composing a campaign, click "Use template" to load a saved template into the compose form.`,
  },
  {
    module: 'communications',
    sort_order: 4,
    title: 'Building Workflow Automations',
    content: `Automations trigger actions automatically based on events in the CRM.

CREATE: Communications → Automations → New Automation.

TRIGGERS (what starts the automation):
- Contact created
- Deal stage changed
- Deal won / lost
- Invoice sent / paid
- Contact tag added

CONDITIONS (optional filters): Only run if the contact is in a specific stage, has a certain tag, or the deal value is above a threshold.

ACTIONS (what happens):
- Send email to the contact
- Send SMS to the contact
- Create a task and assign it to a team member
- Add or remove a tag

TEST: Before activating, use the "Test" button to run the automation against a sample contact to verify it works as expected.

ACTIVATE: Toggle the automation to Active. It will run automatically going forward. Disable it at any time by toggling it off.`,
  },

  // ── Portal ──────────────────────────────────────────────────────────────────
  {
    module: 'portal',
    sort_order: 0,
    title: 'Customer Portal Overview',
    content: `The Customer Portal is a self-service web portal for your customers.

WHAT CUSTOMERS CAN DO:
- View and pay their invoices online
- Download invoice PDFs
- View their active subscriptions
- Manage their saved payment methods (add, remove, set default)
- View their profile and update their password

ACCESS URL: Customers visit /portal/login. They log in with the email and password you set for them.

SEND PAYMENT LINK: On any invoice, click "Send Invoice" to email the customer a direct payment link. They do not need a portal account to pay — the link is public and does not require login.

PORTAL vs. PAYMENT LINK: A portal account gives full self-service. A payment link is for one-time payment without an account. Both are available.`,
  },
  {
    module: 'portal',
    sort_order: 1,
    title: 'Managing Portal Users',
    content: `Portal users are customer-facing accounts separate from your internal team.

CREATE: Admin → Portal Users → Add Portal User. Enter:
- Email (the customer will log in with this)
- First and last name
- Temporary password (customer can change after first login)
- Link to organization (required so they see the right invoices)

CUSTOMER LOGIN: Customer goes to /portal/login, enters email and password. They see only data linked to their organization.

PASSWORD RESET: Customers can use "Forgot password?" on the portal login page to reset via email. Requires SMTP to be configured.

DEACTIVATE: Toggle a portal user to inactive to block their access without deleting their account.

MULTIPLE USERS PER ORG: You can create multiple portal users linked to the same organization (e.g. accounts payable contact and a manager can both see invoices).`,
  },

  // ── Admin ───────────────────────────────────────────────────────────────────
  {
    module: 'admin',
    sort_order: 0,
    title: 'User Management',
    content: `Internal team users are managed under Admin → Users.

INVITE: Click "Invite User". Enter their email address and select their role. They receive an invitation email with a link to set their password and activate their account.

ROLES: Each user has one or more roles that control what they can see and do. Common roles: Admin (full access), Sales Manager, Sales Agent. Custom roles are configured under Admin → Roles.

DEACTIVATE: Toggle a user to inactive to prevent login without deleting their history.

IMPERSONATE: Admins can click the impersonate icon on any user to temporarily log in as that user. A banner at the top shows you are impersonating. Click "Stop impersonating" to return to your own account.

PASSWORD RESET: Users can use "Forgot password?" on the login page. Admins cannot see or set passwords directly, but can revoke access by deactivating the account.`,
  },
  {
    module: 'admin',
    sort_order: 1,
    title: 'Roles and Permissions',
    content: `Roles group permissions together and are assigned to users.

VIEW/EDIT: Admin → Roles. Click a role to see its permissions. Toggle checkboxes to grant or remove access.

KEY PERMISSIONS:
- contacts.read / contacts.write / contacts.delete
- organizations.read / organizations.write
- deals.read / deals.write / deals.delete
- invoices.read / invoices.write
- payments.read
- reports.view
- comms.read / comms.write / comms.templates.manage
- automations.read / automations.write
- campaigns.read / campaigns.write
- subscriptions.read / subscriptions.write
- users.manage (can invite/deactivate team members)
- roles.manage (can edit role permissions)
- settings.manage (can change all integration settings)
- portal.manage (can manage portal user accounts)
- import.csv (can import contacts via CSV)

ADMIN ROLE: Users with the Admin role bypass all permission checks and see everything.

SCOPE: Roles can also define a scope — "all" sees every record, "team" sees records owned by their team, "own" sees only records they own.`,
  },
  {
    module: 'admin',
    sort_order: 2,
    title: 'Custom Fields',
    content: `Custom fields add extra data fields to Contacts, Organizations, or Deals.

CREATE: Admin → Custom Fields → New Field. Choose:
- Entity type: Contact, Organization, or Deal
- Field name: the label users see
- Field type: text, number, date, dropdown, checkbox, url
- Required: whether the field must be filled in
- Dropdown options: if type is dropdown, list the choices (one per line)

WHERE THEY APPEAR: Custom fields appear at the bottom of the detail page for that entity type. They also appear in the edit form.

EDIT/DELETE: Click a custom field to edit its label or options. Deleting a field removes it from all records permanently.

IMPORT: Custom field values can be included in CSV imports by using the field name as the column header.`,
  },
  {
    module: 'admin',
    sort_order: 3,
    title: 'Pipeline Configuration',
    content: `Pipelines organize deals by sales stage. You can have multiple pipelines (e.g. New Builds, Service Orders).

ACCESS: Admin → Pipelines.

CREATE PIPELINE: Click "New Pipeline". Give it a name.

ADD STAGES: Within the pipeline, add stages in order. Each stage has:
- Name (e.g. Prospect, Proposal Sent, In Progress, Complete)
- Color (for the Kanban board column)
- Won/Lost flag: mark one stage as the Won stage and one as the Lost stage

REORDER: Drag stages to reorder them. The order determines the Kanban column order.

DEFAULT PIPELINE: The first pipeline is the default shown on the Pipeline board. Users can switch pipelines using the selector at the top of the Pipeline page.`,
  },

  // ── Settings ────────────────────────────────────────────────────────────────
  {
    module: 'settings',
    sort_order: 0,
    title: 'Configuring SMTP Email',
    content: `SMTP is used to send all emails from the application (invoices, campaigns, password resets, etc.).

SETUP: Settings → Integrations → SMTP tab. Enter:
- Host: your mail server (e.g. smtp.gmail.com, smtp.office365.com)
- Port: 587 (TLS) or 465 (SSL) are most common
- Username: your email address or SMTP username
- Password: your email password or app-specific password
- From Email: the address that appears in the From field
- From Name: the display name (e.g. "LIT-CRM")

TEST: Click "Send Test Email" to send a test to your own email. If it fails, check that your host/port/credentials are correct and that the server allows SMTP relay.

NOTE: If SMTP is not configured in Settings, the server falls back to environment variable SMTP settings (if set by the administrator).`,
  },
  {
    module: 'settings',
    sort_order: 1,
    title: 'Google Workspace Integration',
    content: `Connect your Google Workspace account for Google Drive folder linking and Calendar sync.

CONNECT: Settings → Integrations → Google Workspace tab → Connect with Google. You will be redirected to Google to authorize access. You must sign in with your Google Workspace (G Suite) account.

GOOGLE DRIVE: Once connected, each Contact, Organization, and Deal detail page shows a Google Drive tab. Click "Browse Drive" to:
1. Select a Shared Drive from your Workspace
2. Select a customer folder within that drive
3. The folder is linked to the CRM record and its files are listed directly

DISCONNECT: Click Disconnect in the Google Workspace settings tab to remove the connection. This removes access but does not delete any Drive files.

SCOPES REQUIRED: drive.readonly (to list and browse files), calendar.events (for task sync).`,
  },
  {
    module: 'settings',
    sort_order: 2,
    title: 'Payment Gateway Setup',
    content: `The app supports two payment gateways: Authorize.net and Valor PayTech.

AUTHORIZE.NET: Settings → Integrations → Payment Gateways → Authorize.net tab. Enter:
- Login ID and Transaction Key (from your Authorize.net merchant portal)
- Signature Key (for webhook verification)
- Toggle Sandbox for testing before going live

VALOR PAYTECH (Vault): Enter your EPI ID and API Key from Valor. Valor supports tokenized saved payment methods (vault). Enable vault on your EPI account through your Valor representative.

PROCESSING FEES: Optionally configure a processing fee percentage or flat amount that is automatically added to payments.

WHICH GATEWAY RUNS: The gateway configured and marked active is used for all new transactions. You can have both configured but only one active at a time.`,
  },
  {
    module: 'settings',
    sort_order: 3,
    title: 'SMS Provider Configuration',
    content: `SMS settings connect the app to a text message provider for sending SMS messages.

SETUP: Settings → Integrations → SMS tab. Enter:
- Account SID and Auth Token (from your Twilio or compatible provider dashboard)
- API Key (some providers use this instead of Auth Token)
- From Number: the phone number or short code messages are sent from

TEST: Click "Send Test SMS" to send a test text to your phone number. Verify it arrives before using in production.

OUTBOUND: Once configured, SMS can be sent from contact detail pages or via Campaigns. Templates under Communications → Templates can be used for SMS.

COMPLIANCE: Ensure your contacts have opted in to receive SMS per applicable regulations (TCPA in the US, GDPR in EU).`,
  },

  // ── Website Builder (Puck) ──────────────────────────────────────────────────
  {
    module: 'website_builder',
    sort_order: 0,
    title: 'Website Builder Overview',
    content: `The Website Builder is a visual, drag-and-drop page editor powered by Puck. It lets you create and publish professional web pages without writing code.

ACCESS: Go to Website → Pages in the admin sidebar.

TWO EDITORS AVAILABLE:
1. Website Builder (Puck): Full visual drag-and-drop builder. Use this for marketing pages, landing pages, product pages, and any page with rich layouts and components.
2. CMS Pages (TipTap): A simpler rich-text editor. Use this for blog-style content and simple text-based pages.

HOW IT WORKS: Each page is built from "blocks" (also called components). You drag blocks from the left panel onto the canvas, then configure each block using the settings panel on the right. The page live-previews as you build.

PUBLISHING: Pages can be saved as Draft or Published. Published pages are live at their slug URL (e.g. /our-services). Drafts are not publicly accessible.

MOBILE PREVIEW: While editing, use the preview toggle at the top of the editor to switch between desktop and mobile views.`,
  },
  {
    module: 'website_builder',
    sort_order: 1,
    title: 'Creating and Editing Pages',
    content: `PAGE LIST: Website → Pages shows all your website pages with their slug, status, and last-updated date.

CREATE A NEW PAGE:
1. Click "New Page" (top right).
2. The "Choose a Template" dialog opens. Select a template to start with pre-built content, or choose "Blank Page" to start from scratch.
3. Enter a page title. The slug is auto-generated from the title (e.g. "Our Services" → /our-services). You can change it manually.
4. Click Create. The page editor opens immediately.

EDITING A PAGE:
- Left panel: component library — drag any block onto the canvas.
- Canvas (center): live preview of your page. Click any block to select it.
- Right panel: settings for the selected block. Change colors, text, images, and behavior here.
- Top bar: Undo/Redo, Preview, Save (Draft or Publish).

SAVE: Click Save → Publish to make the page live. Save → Draft saves without publishing.

SLUG: The slug is the URL path. Change it under the page's settings (gear icon in the page list). Must be unique across all pages.

DELETE: Click the trash icon on the page list. Deletion is permanent.`,
  },
  {
    module: 'website_builder',
    sort_order: 2,
    title: 'Using the Component Library',
    content: `The left panel in the page editor contains all available blocks (components). Scroll through them or search by name.

DRAG AND DROP: Click and hold any component from the left panel, drag it to the canvas, and drop it in the desired position. A blue insertion indicator shows where the block will land.

REORDER BLOCKS: On the canvas, hover over a block to reveal drag handles on its left edge. Drag the handle up or down to reorder.

SELECT A BLOCK: Click any block on the canvas to select it. The right panel updates to show that block's settings.

DELETE A BLOCK: Select the block, then press the Delete key, or use the delete button in the right panel settings area.

DUPLICATE A BLOCK: Right-click a block on the canvas to see options including Duplicate.

UNDO/REDO: Use Ctrl+Z / Ctrl+Y (or Cmd+Z / Cmd+Y on Mac) to undo or redo changes. The editor tracks full undo history.

COMPONENTS OVERVIEW: Every block has a set of configurable fields in the right panel. Common fields include background color, text color, padding, and animation settings.`,
  },
  {
    module: 'website_builder',
    sort_order: 3,
    title: 'Hero Banner Block',
    content: `The Hero Banner is the full-width banner block typically placed at the top of a page.

FIELDS:
- Headline: main large text
- Subtext: supporting description below the headline
- Background Image: URL to a full-width background image
- Background Color: solid color if no image is used
- Overlay: semi-transparent dark overlay on top of the image (0–100%)
- Height: how tall the banner is (e.g. 50vh, 75vh, 100vh)
- Alignment: center or left-align the text
- CTA Button: label, URL, and color for the primary call-to-action button
- Button Radius: corner radius of the button
- Animation: entrance animation type (slideUp, fadeIn, none)
- Animation Delay: delay in milliseconds before the animation plays

TIPS:
- Use a high-resolution wide image (1920px or wider) for best results
- Set overlay to 40–60% if the image is busy and makes text hard to read
- The CTA button URL can be an internal path (/contact) or external URL`,
  },
  {
    module: 'website_builder',
    sort_order: 4,
    title: 'CTA Banner Block',
    content: `The CTA (Call-to-Action) Banner is a full-width strip with a headline, subtext, and one or two buttons.

FIELDS:
- Headline / Subtext: the main message and supporting description
- Background Color: solid color (or use Background Image for a photo background)
- Background Image + Overlay: optional image with overlay dimming
- Text Color: color for headline and subtext
- Button 1: label, URL, background color, and text color
- Button 2 (optional): secondary action button with its own styling
- Button Radius: corner rounding

COMMON USES:
- End-of-section "get in touch" prompt
- Promotional offer strip
- "Learn more" transition between sections

TIP: Use contrasting background and button colors for maximum click-through. A white button on a dark background or a brand-color button on a light background works well.`,
  },
  {
    module: 'website_builder',
    sort_order: 5,
    title: 'Icon Feature Grid Block',
    content: `The Icon Feature Grid displays a set of feature cards in a grid layout, each with an icon, title, and body text.

FIELDS:
- Heading / Subtext: section title and optional description
- Columns: 2, 3, or 4 columns (responsive on mobile)
- Items (array): each item has:
  - Icon: an Iconify icon name (e.g. solar:shield-check-bold-duotone)
  - Title: card heading
  - Body: description text
- Icon Background Color: color behind the icon
- Icon Color: icon fill color
- Background Color: section background
- Text Color: title and body text color
- Padding: section padding (e.g. 4rem 2rem)
- Text Alignment: center or left
- Animation / Delay: entrance animation

USE CASES:
- "Why choose us" feature list
- Service overview cards
- Team values or benefits section
- Step-by-step process grid`,
  },
  {
    module: 'website_builder',
    sort_order: 6,
    title: 'Stats Row Block',
    content: `The Stats Row displays key numbers or metrics in a horizontal band across the page.

FIELDS:
- Items (array): each stat has Value, Label, Prefix (text before the value), and Suffix (text after the value). Example: Prefix="" Value="500" Suffix="+" Label="Clients Served"
- Background Color: section background
- Text Color: value text color
- Label Color: label text color
- Padding: section padding
- Divider: style between stats — "line" (vertical rule) or "dot" or "none"
- Animation / Delay: entrance animation

TIPS:
- Use bold stats for social proof: "500+ kits delivered", "20 years in business"
- High-contrast background (dark blue, black) with white text makes stats pop
- Keep values short — "500+" reads better than "over five hundred"`,
  },
  {
    module: 'website_builder',
    sort_order: 7,
    title: 'Testimonials Block',
    content: `The Testimonials block displays customer quotes in a grid of cards.

FIELDS:
- Heading / Subtext: section title
- Items (array): each testimonial has:
  - Quote: the customer's words (no quotation marks needed — they are added automatically)
  - Author: customer name
  - Role: job title or company
  - Avatar: URL to a profile photo (optional)
  - Rating: 1–5 star rating shown as filled stars
- Columns: 2 or 3 columns
- Background Color: section background
- Card Background: color of each testimonial card
- Text Color: quote and author text color
- Accent Color: star color
- Padding: section padding
- Animation / Delay: entrance animation

TIPS:
- Use real quotes from real customers — specificity is more credible than generic praise
- Include the author's role for authority (e.g. "Office Manager, Acme Logistics")
- 3 testimonials in 3 columns is a classic and effective layout`,
  },
  {
    module: 'website_builder',
    sort_order: 8,
    title: 'Two Column Block',
    content: `The Two Column block splits the page into a left column (rich text / HTML) and a right column (image or content).

FIELDS:
- Left Content: HTML content for the left column (use the rich text editor built into the field)
- Right Image: URL of the image shown on the right
- Left / Right Background Color: column backgrounds (can be different)
- Left / Right Text Color: text color per column
- Left / Right Padding: padding for each side
- Reversed: swap left and right columns
- Vertical Alignment: top, center, or bottom align within each column
- Animation / Delay: entrance animation

TIPS:
- Alternate reversed and non-reversed Two Column blocks to create a visually engaging alternating layout
- Use the right image as a product photo or team photo
- The left HTML supports any styling — headings, lists, links, buttons
- Leave Right Image empty if you want a two-text-column layout`,
  },
  {
    module: 'website_builder',
    sort_order: 9,
    title: 'Announcement Banner Block',
    content: `The Announcement Banner is a thin bar at the very top of a page, used for alerts, promotions, or notices.

FIELDS:
- Text: the announcement message
- CTA Text / CTA URL: optional clickable button or link within the banner
- Background Color: banner background
- Text Color: message text color
- CTA Background: color of the optional CTA button
- Dismissable: yes/no — whether to show an X button to close the banner
- Sticky: yes/no — whether the banner sticks to the top of the screen as the user scrolls

TIPS:
- Use for limited-time offers: "Sale ends Sunday — 10% off all kits"
- Use for important notices: "Holiday closure Dec 25–Jan 1"
- Set Dismissable = yes for promotional banners (users can close it)
- Set Sticky = yes for announcements you want visible throughout the page`,
  },
  {
    module: 'website_builder',
    sort_order: 10,
    title: 'Form Embed Block',
    content: `The Form Embed block embeds a public-facing form (created in the Forms module) directly into a page.

FIELDS:
- Form Slug: the slug of the form to embed (e.g. "contact-us"). Find the slug on the form's settings page in the Forms module.
- Heading: optional text shown above the form
- Background Color: section background
- Padding: section padding

HOW IT WORKS: The block fetches the form definition from the Forms API and renders the fields inline. Submissions go into the Forms → Submissions inbox.

TIPS:
- Use this block to add contact forms, quote request forms, or event registration forms to any page
- You can embed the same form on multiple pages
- Forms can include any field types: text, email, phone, textarea, select, checkbox, file upload

SEE ALSO: Forms module (for creating and managing forms).`,
  },
  {
    module: 'website_builder',
    sort_order: 11,
    title: 'Video Hero Block',
    content: `The Video Hero block shows a full-screen or section-height background video with a headline, sub-headline, and CTA buttons overlaid on top.

FIELDS:
- Video URL: YouTube URL, Vimeo URL, or direct MP4 URL
- Video Type: YouTube, Vimeo, or MP4/Direct
- Headline / Sub-headline: overlay text
- CTA Text / URL: primary button
- Secondary CTA Text / URL: optional second button (ghost style)
- Overlay Opacity (0–90): how dark the video overlay is — higher = darker = text is more readable
- Overlay Color: the overlay color (usually black)
- Text Color: headline and sub-headline color
- Height: Full screen (100vh), Large (80vh), or Medium (60vh)
- Text Alignment: Center or Left
- Primary CTA Background Color

HOW VIDEO WORKS:
- YouTube and Vimeo: the video plays automatically, muted, on a loop with controls hidden. The video ID is extracted from the URL automatically.
- MP4: the file URL is used directly. The video must be hosted somewhere publicly accessible (e.g. your CDN or a cloud storage URL).

TIPS:
- Use 50–65% overlay opacity for text legibility on busy videos
- YouTube videos may not autoplay in all browsers — have a fallback background color set
- Left-aligned text with a left-side CTA button is good for modern minimal hero designs`,
  },
  {
    module: 'website_builder',
    sort_order: 12,
    title: 'Services List Block',
    content: `The Services List block shows a list of services or products in one of three layout styles.

FIELDS:
- Heading / Subheading: section header
- Layout:
  - Cards: grid of cards with a colored top stripe, icon, title, description, price, and link
  - Rows: horizontal rows with an icon on the left, title, description, price, and link
  - Featured: alternating large image+text rows (best for 2–4 services with strong visuals)
- Columns (cards only): 2, 3, or 4 columns
- Services (array): each service has:
  - Icon: emoji or Iconify icon name
  - Title: service name
  - Description: what the service includes
  - Price: pricing info (e.g. "From $350" or "Custom Quote")
  - Link URL / Link Text: "Learn More" link for that service
  - Image URL (featured layout only): photo for the featured alternating layout
- Background / Text / Accent Colors
- Section CTA: optional button at the bottom of the entire section
- Animation / Delay

TIPS:
- Cards layout works well for 3–6 similar services with short descriptions
- Rows layout works well for 4–8 services with pricing (like a menu or rate card)
- Featured layout works well for 2–4 flagship services where you want visual impact`,
  },
  {
    module: 'website_builder',
    sort_order: 13,
    title: 'Payment Block',
    content: `The Payment Block embeds a full payment form on any page, powered by Valor PayTech / Passage.js. When a customer pays, the system automatically creates a contact record, optionally an organization record, an order record, and a payment record — all linked together.

FIELDS:
- Heading / Description: text shown above the form
- Product / Service Name: shown in the form header (e.g. "Onboarding Deposit")
- Amount Mode: Fixed (you set the amount) or Variable (customer enters their own amount)
- Fixed Amount: the charge amount in Fixed mode
- Min / Max Amount: boundaries for Variable mode
- Currency: default USD
- Show Company Field: yes/no — adds a "Company Name" input to the form
- Success Message: text shown after a successful payment
- Redirect URL: optional redirect after payment (leave blank to show success message in place)
- Background / Card Background / Accent Color

HOW IT WORKS:
1. The form shows a two-step checkout: (1) customer info, (2) secure card entry via Valor Passage.js iframe
2. On submit, the server creates: contact (find-or-create by email), organization (if company name provided), order record, and payment record
3. Credit card data never touches your server — it stays within Valor's PCI-compliant iframe

REQUIREMENT: Valor payment gateway must be configured in Settings → Payment Gateways.`,
  },
  {
    module: 'website_builder',
    sort_order: 14,
    title: 'Google Map Block',
    content: `The Google Map block embeds a Google Map iframe to show your business location.

FIELDS:
- Embed URL: the full Google Maps embed URL (from Google Maps → Share → Embed a map → copy the src URL)
- Height: map height in pixels (e.g. 380px)
- Background Color: area around the map
- Padding: section padding
- Radius: corner radius for the map iframe
- Animation / Delay

HOW TO GET THE EMBED URL:
1. Go to maps.google.com and search for your location
2. Click Share → Embed a map
3. Copy only the src URL from the iframe code (it starts with https://www.google.com/maps/embed?...)
4. Paste that URL into the Embed URL field

TIPS:
- Use height 380–500px for a standard map section
- Place the map after your contact information section for context
- Maps are responsive and scale to the container width`,
  },
  {
    module: 'website_builder',
    sort_order: 15,
    title: 'Using Page Templates',
    content: `Page templates give you a pre-built starting point when creating a new page, so you are not starting from a blank canvas.

ACCESSING TEMPLATES: Click "New Page" on the Website → Pages list. The "Choose a Template" dialog appears with all available templates.

TEMPLATE CATEGORIES:
- Blank: empty canvas
- E-Commerce: Product Catalog, Product Detail, Payment Page, Order Thank You
- List Pages: Blog / News Listing, FAQ Page
- Services: Services Landing, Service Detail
- Landing Pages: Video Hero Landing, Dark Minimal Hero
- General: Landing Page, Promo / Sale Page, About Us, Contact Page

HOW TO USE A TEMPLATE:
1. Click a template card to preview its description
2. Enter the page title (the slug is auto-generated)
3. Click Create — the editor opens with all the template's blocks pre-loaded
4. Click each block on the canvas to select it, then edit its settings in the right panel
5. Replace placeholder text, images, colors, and URLs with your real content
6. When ready, click Save → Publish

TIPS:
- Templates are starting points — every block is fully editable after creation
- The Payment Page template includes a pre-configured PaymentBlock pointing at your Valor gateway
- The Video Hero Landing template has a VideoHero block with an empty video_url field — paste your YouTube or Vimeo URL in the right panel after the page is created`,
  },
  {
    module: 'website_builder',
    sort_order: 16,
    title: 'Publishing and SEO',
    content: `Every website page has a status (Draft or Published) and an SEO settings panel.

PUBLISH: In the editor, click Save → Publish to make the page live. The status badge on the page list changes from "draft" to "published".

UNPUBLISH: To take a page offline without deleting it, click Save → Save as Draft in the editor. The page reverts to draft status.

SEO SETTINGS: On the page list, click the gear icon for a page to open its SEO settings:
- Title Tag: the <title> shown in browser tabs and search results (60 chars max)
- Meta Description: the snippet shown in Google search results (155 chars max)
- OG Image: the image used when the page is shared on social media
- No-Index: check to prevent search engines from indexing this page

SLUG (URL): The page slug is the URL path (/about-us, /services/annual-inspection). Change it on the page list by editing the slug field. Changing a slug breaks any existing links to the old URL — plan slug changes carefully.

CANONICAL URLS: Pages use their slug as the canonical URL. Avoid duplicate content by using no-index on thank-you and confirmation pages.`,
  },

  // ── CMS Pages ───────────────────────────────────────────────────────────────
  {
    module: 'cms_pages',
    sort_order: 0,
    title: 'CMS Pages Overview',
    content: `CMS Pages (accessed via Website → CMS Pages) is a rich-text editor for creating simple content pages.

DIFFERENCE FROM WEBSITE BUILDER: CMS Pages uses a TipTap-based rich text editor — similar to a word processor. It is ideal for:
- Blog articles and news posts
- Policy and legal pages (Privacy Policy, Terms of Service)
- Simple text-heavy content pages

Use the Website Builder (Website → Pages) for marketing pages with complex visual layouts, hero banners, feature grids, and other visual components.

CREATE: Click "New Page" on the CMS Pages list. Enter a title, and the slug is auto-generated. You are taken directly to the TipTap editor.

EDIT: Click the pencil icon on the page list to re-open the editor for that page.

STATUS: Pages can be Draft or Published. Only published pages are accessible via their public URL.`,
  },
  {
    module: 'cms_pages',
    sort_order: 1,
    title: 'Using the CMS Rich Text Editor',
    content: `The CMS page editor is a full-featured rich text editor powered by TipTap.

TOOLBAR: The toolbar at the top provides formatting options:
- Bold, Italic, Underline, Strikethrough
- Heading levels (H1, H2, H3)
- Ordered and unordered lists
- Blockquote
- Code block (inline and fenced)
- Insert Link (Ctrl+K)
- Insert Image (paste a URL or upload)
- Insert Table
- Horizontal Rule

KEYBOARD SHORTCUTS:
- Ctrl+B: Bold
- Ctrl+I: Italic
- Ctrl+K: Insert/edit link
- Ctrl+Z: Undo, Ctrl+Y: Redo

IMAGES: Click the image button in the toolbar to insert an image by URL. For best results use full-width images (at least 900px wide).

TABLES: Insert a table from the toolbar. Right-click a cell for table operations (add row, add column, delete).

SAVE / PUBLISH: Use the Save button to save as draft, or Publish to make it live. The status is shown at the top of the editor.`,
  },

  // ── Forms ───────────────────────────────────────────────────────────────────
  {
    module: 'forms',
    sort_order: 0,
    title: 'Forms Builder Overview',
    content: `The Forms module lets you build custom web forms and embed them on your website pages.

ACCESS: Website → Forms in the admin sidebar.

USE CASES:
- Contact and quote request forms
- Event registration
- Service consultation requests
- Feedback or survey forms
- File upload forms (e.g. request a quote with supporting documents)

HOW IT WORKS:
1. Create a form in the Forms admin
2. Add fields by dragging from the field type list
3. Configure the form's settings (email notifications, success message)
4. Embed the form on any website page using the Form Embed block, or link to the public form URL
5. View submissions in Forms → Submissions

SUBMISSIONS: Every form submission is stored in the database and can be viewed, exported, or trigger email notifications.`,
  },
  {
    module: 'forms',
    sort_order: 1,
    title: 'Building a Form',
    content: `CREATING A FORM: Go to Website → Forms → New Form. Enter a name (internal) and a title (shown to users).

ADDING FIELDS: The form builder shows a drag-and-drop field list. Available field types:
- Short Text: single-line text input
- Long Text / Textarea: multi-line text
- Email: email address with validation
- Phone: phone number
- Number: numeric input with optional min/max
- Select / Dropdown: choose one option from a list
- Checkbox: single yes/no checkbox
- Checkbox Group: multiple checkboxes (pick many)
- Radio Group: radio buttons (pick one)
- File Upload: attach a file (PDF, image, etc.)
- Date: date picker
- Hidden: hidden field with a fixed value (useful for tracking source)

CONFIGURING FIELDS: Click any field to edit its label, placeholder, required status, and options (for select/radio/checkbox).

REORDER FIELDS: Drag the handle on the left of each field row to reorder.

DELETE FIELDS: Click the trash icon on a field to remove it.

FORM SETTINGS:
- Success Message: text shown after a successful submit
- Redirect URL: optional redirect after submit (instead of showing a success message)
- Email Notification: send an email alert to a team address on each submission
- Submit Button Label: change the button text (default: "Submit")

SAVE: Click Save to save the form. The form is immediately accessible via its public URL and embeddable via the Form Embed block.`,
  },
  {
    module: 'forms',
    sort_order: 2,
    title: 'Viewing Form Submissions',
    content: `SUBMISSIONS INBOX: Forms → Submissions shows all form submissions across all forms.

FILTER: Filter by form name, date range, or search by email/name.

SUBMISSION DETAIL: Click a submission row to see all field values submitted.

EXPORT: Export submissions to CSV for import into Excel or a CRM.

EMAIL NOTIFICATIONS: If you configured a notification email on the form, an email is sent to that address each time someone submits the form. The email includes all field values.

SPAM: Submissions from the same IP that come in very quickly may be flagged. Check your form settings for rate limiting options.

AUTO-CONTACT CREATION: If the form has an email field, the system can automatically create or update a contact record in the CRM from each submission. Enable this in the form settings.`,
  },

  // ── Blog ────────────────────────────────────────────────────────────────────
  {
    module: 'blog',
    sort_order: 0,
    title: 'Blog Management Overview',
    content: `The Blog module lets you publish articles, news posts, and updates on your website.

ACCESS: Website → Blog in the admin sidebar.

BLOG POSTS: Each post has a title, content (rich text), featured image, category, tags, author, publish date, and status.

STATUSES:
- Draft: not publicly visible
- Published: live on the website at /blog/{slug}
- Scheduled: will auto-publish at a future date/time

CATEGORIES AND TAGS: Organize posts with categories (e.g. "Tips", "News", "Product Updates") and tags for cross-cutting topics (e.g. "avionics", "first-flight").

SEO: Each post has meta title, meta description, and OG image fields for search engine and social sharing optimization.

PUBLIC URL: Published posts appear at /blog/{slug} and are listed on your blog index page if you have one set up in the website builder.`,
  },
  {
    module: 'blog',
    sort_order: 1,
    title: 'Writing and Publishing Blog Posts',
    content: `CREATE: Website → Blog → New Post. Enter a title — the slug is auto-generated.

EDITOR: The blog post editor is a rich text editor (TipTap) with a full toolbar:
- Bold, italic, underline, code
- Headings (H2, H3)
- Lists (ordered and unordered)
- Blockquote
- Insert image (by URL)
- Insert link (Ctrl+K)
- Insert horizontal rule

FEATURED IMAGE: Upload or enter a URL for the post's hero/thumbnail image. This image appears at the top of the post and in social sharing previews.

CATEGORY: Select or create a category to classify the post.

TAGS: Add tags for content organization. Multiple tags per post are supported.

AUTHOR: Select the staff member credited as author.

PUBLISH DATE: Set the publish date. For scheduled posts, set a future date and the system will auto-publish at that time.

SAVE / PUBLISH: Click Save → Publish to make the post live immediately, or Save → Draft to save without publishing.

SEO FIELDS: Scroll to the SEO section to enter a custom meta title (60 chars), meta description (155 chars), and OG image URL.`,
  },

  // ── Social Media ────────────────────────────────────────────────────────────
  {
    module: 'social',
    sort_order: 0,
    title: 'Social Media Posting',
    content: `The Social Media module lets you compose and publish posts to Facebook, Instagram, and LinkedIn directly from the admin.

ACCESS: Marketing → Social Media.

CONNECTED ACCOUNTS: Before posting, connect your social accounts under Settings → Integrations → Social Media. You can connect:
- Facebook Page (requires Facebook app credentials + page access token)
- Instagram Business Account (via Facebook API)
- LinkedIn Company Page (requires LinkedIn app credentials)

COMPOSE: Go to Social → New Post. Write your post content, attach an image (optional), and select which platforms to post to.

SCHEDULE: Choose "Post Now" to publish immediately, or "Schedule" to pick a future date and time. Scheduled posts appear in the Social → Scheduled queue.

POST HISTORY: All published and failed posts are in Social → History. Failed posts show the error message from the platform.

CHARACTER LIMITS: Facebook has no official character limit for page posts. Instagram captions can be up to 2,200 characters. LinkedIn posts can be up to 3,000 characters. The composer shows a character count.`,
  },

  // ── SEO & Analytics ─────────────────────────────────────────────────────────
  {
    module: 'seo',
    sort_order: 0,
    title: 'SEO Settings',
    content: `SEO settings control how your website appears in search engines.

ACCESS: Marketing → SEO.

GLOBAL SETTINGS:
- Site Title: used as the default meta title pattern (e.g. "LIT-CRM — Managed IT Services")
- Meta Description: default description used when pages have no custom meta description
- OG Image: default social sharing image for pages without a custom one
- Robots.txt: control which pages/directories search engines can crawl
- Sitemap: auto-generated sitemap at /sitemap.xml listing all published pages

PER-PAGE SEO: Each page in the Website Builder and CMS has its own SEO fields:
- Title Tag (up to 60 characters)
- Meta Description (up to 155 characters)
- OG Image (for social sharing)
- No-Index (to hide a page from search engines)

GOOGLE SEARCH CONSOLE: Connect your site to Google Search Console to monitor indexing and search performance. Add the verification meta tag via SEO → Verification Tags.

TIPS:
- Every page should have a unique title tag and meta description
- Target one primary keyword per page — use it in the title and in the first paragraph
- Publish consistently to the blog — fresh content signals activity to search engines`,
  },
  {
    module: 'seo',
    sort_order: 1,
    title: 'Traffic and Analytics',
    content: `The Analytics dashboard gives you a snapshot of your website traffic.

ACCESS: Marketing → Analytics.

METRICS SHOWN:
- Total pageviews (selected period)
- Unique visitors
- Top pages by views
- Traffic sources (direct, organic search, referral, social)
- Geographic breakdown

DATE RANGE: Use the date picker to select any date range. Default is the last 30 days.

GOOGLE ANALYTICS INTEGRATION: For full analytics, connect Google Analytics. Enter your Measurement ID (G-XXXXXXXX) under Settings → SEO → Analytics. Once connected, traffic data flows into GA4 and appears in your Google Analytics dashboard.

BUILT-IN TRACKING: The app also records pageviews internally. These counts appear in the Marketing → Analytics page without needing an external service.

EXPORT: Click Export to download the analytics summary as a CSV.`,
  },

  // ── AI Assistant ────────────────────────────────────────────────────────────
  {
    module: 'ai',
    sort_order: 0,
    title: 'AI Assistant Overview',
    content: `The AI Assistant is a built-in chat interface that helps you work more efficiently in the application.

ACCESS: Click the AI chat bubble in the bottom right corner of any page in the admin, or navigate to Admin → AI Assistant.

WHAT IT CAN HELP WITH:
- Explaining how any module or feature works
- Drafting email or SMS templates
- Writing blog post content or page copy
- Answering questions about your deals, customers, or invoices
- Suggesting workflows and automations
- Helping compose social media posts

HOW IT WORKS: The assistant has access to the knowledge base articles for this application (the information you are reading now). When you ask a question, it searches the relevant articles and uses them to answer accurately for your specific application.

CONTEXT: You can ask context-specific questions while on a specific page (e.g. "how do I add a payment block to this page?" while in the website builder) and the assistant will tailor its answer to the current module.

LIMITATIONS: The assistant cannot take actions in the application on your behalf (it cannot create records, send emails, or make changes). It can only answer questions and help you draft content.`,
  },
  {
    module: 'ai',
    sort_order: 1,
    title: 'Managing Knowledge Base Articles',
    content: `The Knowledge Base (KB) is the set of help articles the AI assistant reads to answer your questions.

ACCESS: Admin → AI Assistant → Knowledge Base.

ARTICLES: Each article belongs to a module (contacts, invoices, website_builder, etc.) and has a title and content. The content is plain text with clear structure.

ADD ARTICLE: Click "New Article". Enter:
- Module: which part of the app this applies to (matches the sidebar module names)
- Title: concise topic name
- Content: the help text — use plain text with newlines for readability
- Sort Order: lower numbers appear first within a module
- Active: toggle to include or exclude the article from AI responses

EDIT: Click any article row to edit it inline.

DELETE: Click the trash icon to remove an article.

BEST PRACTICES FOR ARTICLE CONTENT:
- Be specific and actionable: "Click New Contact → Fill in the form → Click Save"
- Use ALL CAPS for section headers within an article to help the AI identify structure
- Include the exact field names, menu paths, and button labels as they appear in the UI
- Keep articles focused on one topic — multiple smaller articles are better than one huge one`,
  },
  {
    module: 'ai',
    sort_order: 2,
    title: 'AI Settings',
    content: `Configure the AI assistant's behavior under Admin → AI Assistant → Settings.

API KEY: Enter your Claude API key (from console.anthropic.com). Without this, the AI assistant is disabled.

MODEL: Select which Claude model to use. Faster/cheaper models (Haiku) are good for routine Q&A. More capable models (Sonnet, Opus) give better results for complex writing tasks.

SYSTEM PROMPT: Optionally customize the assistant's personality and instructions. The default prompt instructs the assistant to act as a helpful support agent for your business.

KNOWLEDGE BASE SEARCH: The assistant automatically searches the KB for relevant articles when answering questions. You can optionally restrict it to only answer from KB articles (no general knowledge) for a stricter factual assistant.

USAGE: If you have an API key configured, usage is billed per-token to your Anthropic account. Monitor usage at console.anthropic.com.`,
  },

  // ── Email Templates ──────────────────────────────────────────────────────────
  {
    module: 'email_templates',
    sort_order: 0,
    title: 'System Email Templates',
    content: `System email templates control the HTML emails automatically sent by the application (invoices, receipts, notifications, etc.).

ACCESS: Business → Email Templates.

AVAILABLE SYSTEM TEMPLATES:
- invoice_sent: email sent when you click "Send Invoice"
- payment_receipt: email sent to the customer after a successful payment
- portal_access: email sent when you create a portal user account for a customer
- subscription_created: notification when a new subscription is set up
- contact_welcome: optional welcome email sent when a new contact is created
- invoice_past_due: reminder email for overdue invoices
- appointment_confirmation: appointment booking confirmation
- form_inquiry_received: notification when a contact form is submitted

EDITING: Click a template to open the HTML editor. The editor shows the full HTML of the email. Common merge tags:
- {{business.name}}, {{business.logo_url}}, {{business.primary_color}}
- {{contact.first_name}}, {{contact.last_name}}, {{contact.email}}
- {{invoice.number}}, {{invoice.total}}, {{invoice.due_date}}, {{invoice.payment_link}}
- {{payment.amount}}, {{payment.last4}}, {{payment.brand}}

RESET: If you break a template, use "Reset to Default" to restore the original system template.

NOTE: Custom (non-system) email and SMS templates are in Communications → Templates.`,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK-BASED STEP-BY-STEP ARTICLES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Invoices — Tasks ────────────────────────────────────────────────────────
  {
    module: 'invoices',
    sort_order: 10,
    title: 'How to Create a New Invoice',
    content: `Step 1. Click "Invoices" in the left sidebar.
Step 2. Click "New Invoice" in the top right corner.
Step 3. Select the Organization from the dropdown. This is required.
Step 4. The contact associated with that org is auto-filled; change it if needed.
Step 5. Set the Issue Date (today by default) and the Due Date.
Step 6. Click "Add Line Item". Enter a description, quantity, and unit price. The line total calculates automatically.
Step 7. Click "Add Line Item" again to add more items.
Step 8. Optional: Enter a discount (flat dollar amount or percentage) in the Discount field.
Step 9. Optional: Enter a tax rate percentage in the Tax Rate field. Tax applies to the subtotal after discount.
Step 10. Optional: Add internal notes (visible only to your team) or a customer-facing message in the Notes fields.
Step 11. Click "Save". The invoice is created in Draft status with an auto-generated invoice number.

The invoice is now a draft. To send it, see "How to Send an Invoice".`,
  },
  {
    module: 'invoices',
    sort_order: 11,
    title: 'How to Send an Invoice to a Customer',
    content: `Before sending, the invoice must be in Draft or Sent status. Open the invoice first.

Step 1. Open the invoice you want to send (click it from the Invoices list).
Step 2. Verify the line items, totals, and customer email address are correct.
Step 3. Click "Send Invoice" (the blue button near the top of the page).
Step 4. A confirmation dialog appears showing the recipient email and a preview of the email subject. Confirm and click Send.
Step 5. The invoice status changes from Draft to Sent.
Step 6. The customer receives an email with the invoice details and a unique payment link. They can click the link to pay online with a credit card.

To re-send the invoice (e.g. the customer lost the email):
- Open the invoice and click "Send Invoice" again. A new email is sent to the same address.

To copy the payment link manually:
- Open the invoice. Click "Copy Payment Link" to copy the URL. You can share it via any channel.`,
  },
  {
    module: 'invoices',
    sort_order: 12,
    title: 'How to Record a Manual Payment on an Invoice',
    content: `Use this when a customer pays by check, cash, ACH transfer, or any method outside the online payment link.

Step 1. Open the invoice from the Invoices list.
Step 2. Click "Record Payment" (button on the invoice detail page).
Step 3. Enter the Payment Amount. For a full payment, this is the balance due. For a partial payment, enter only the amount received.
Step 4. Select the Payment Method from the dropdown: Check, Cash, ACH, Wire Transfer, Other.
Step 5. Set the Payment Date (defaults to today).
Step 6. Optional: Enter a reference number (check number, ACH confirmation ID, etc.) in the Notes field.
Step 7. Click Save.

The payment is recorded and the invoice balance due decreases. If the payment equals the full balance, the invoice status changes to Paid. If partial, it becomes Partially Paid. You can record multiple payments against the same invoice.`,
  },
  {
    module: 'invoices',
    sort_order: 13,
    title: 'How to Issue a Refund on an Invoice',
    content: `Refunds can be issued for card payments made through the payment gateway, or recorded manually for check/cash refunds.

FOR CARD PAYMENTS (gateway refund):
Step 1. Open the invoice that was paid.
Step 2. Click "Payments" or scroll to the Payments section. Click the payment you want to refund.
Step 3. On the payment detail page, click "Refund".
Step 4. Enter the refund amount (full or partial). A partial refund is allowed.
Step 5. Click Confirm Refund.
Step 6. The gateway processes the refund back to the customer's card (typically 3-5 business days). The payment record updates to show Refunded status.

FOR MANUAL PAYMENTS (check/cash/ACH):
- There is no automated gateway refund. Record the refund manually by opening the invoice and clicking "Record Payment", entering a negative amount (e.g. -500.00) with method "Refund" to reverse the balance.

TO VOID AN INVOICE ENTIRELY:
Step 1. Open the invoice.
Step 2. Click "Void Invoice". You will be prompted to confirm.
Step 3. The invoice status changes to Void. No further payments can be recorded against it. Voiding does not automatically refund any payments already made — issue the refund separately first.`,
  },
  {
    module: 'invoices',
    sort_order: 14,
    title: 'How to Set Up a Recurring Invoice',
    content: `Recurring invoices automatically generate and send invoices on a schedule.

Step 1. Go to Billing → Recurring Invoices in the left sidebar.
Step 2. Click "New Recurring Invoice".
Step 3. Select the Organization and Contact.
Step 4. Add line items the same way as a regular invoice: description, quantity, unit price.
Step 5. Set the billing Frequency: Weekly, Monthly, Quarterly, or Annually.
Step 6. Set the Start Date — the date the first invoice should be generated.
Step 7. Optional: Set an End Date if the recurring billing should stop at a specific date. Leave blank for ongoing.
Step 8. Toggle "Auto-Send" to Yes if you want the system to automatically email the invoice to the customer when it is generated. Leave it off if you want to review before sending.
Step 9. Click Save.

The recurring invoice is now active. A background job checks daily and generates invoices when they are due. Each generated invoice appears in the regular Invoices list. To pause billing, open the recurring invoice and toggle it to Inactive.`,
  },

  // ── Contacts — Tasks ─────────────────────────────────────────────────────────
  {
    module: 'contacts',
    sort_order: 10,
    title: 'How to Create a New Contact',
    content: `Step 1. Click "Contacts" in the left sidebar.
Step 2. Click "New Contact" in the top right corner.
Step 3. Fill in the contact's details:
   - First Name and Last Name (required)
   - Email address
   - Phone number
   - Job Title
   - Organization: select an existing company or type a new name to create one
   - Lifecycle Stage: set to Lead, MQL, SQL, Customer, etc.
   - Lead Source: where this contact came from
   - Owner: the team member responsible for this contact
Step 4. Optional: Enter address information (street, city, state, zip, country).
Step 5. Click Save.

The contact is created and you are taken to their detail page. From there you can add notes, send emails or SMS, create tasks, and attach files.`,
  },
  {
    module: 'contacts',
    sort_order: 11,
    title: 'How to Edit or Delete a Contact',
    content: `EDITING A CONTACT:
Step 1. Open the contact from the Contacts list (click their name).
Step 2. Click the "Edit" button at the top right of the contact detail page.
Step 3. Make your changes in the edit form.
Step 4. Click Save.

EDITING INLINE: Some fields (like Lifecycle Stage and Owner) can be changed directly on the detail page without opening the full edit form. Click the field value to edit it in place.

DELETING A CONTACT:
Step 1. On the Contacts list, find the contact you want to remove.
Step 2. Click the trash icon on the right side of the row.
Step 3. A confirmation dialog appears. Click Delete to confirm.

WARNING: Deletion is permanent and removes all associated activities, notes, and links. If the contact has invoices or deals, those records remain but the contact link is removed. Consider deactivating or adding a "churned" tag instead of deleting.`,
  },
  {
    module: 'contacts',
    sort_order: 12,
    title: 'How to Add a Note to a Contact',
    content: `Notes let you record internal information about a contact that is visible to your team.

Step 1. Open the contact from the Contacts list.
Step 2. Click the "Notes" tab (or scroll to the Notes section on the detail page).
Step 3. Click "Add Note".
Step 4. Type your note in the text field.
Step 5. Click Save.

The note appears in the contact's Notes section with a timestamp and the name of the team member who wrote it.

EDITING OR DELETING A NOTE: Click the pencil icon next to a note to edit it, or the trash icon to delete it. Only the author or an admin can edit or delete notes.`,
  },
  {
    module: 'contacts',
    sort_order: 13,
    title: 'How to Send an Email or SMS to a Contact',
    content: `SEND AN EMAIL:
Step 1. Open the contact's detail page.
Step 2. Click "Send Email" in the action buttons at the top.
Step 3. The compose modal opens with the contact's email pre-filled.
Step 4. Optional: Click "Use Template" to load a saved email template. The subject and body fill in automatically.
Step 5. Edit the subject and body as needed.
Step 6. Click Send.

The email is sent immediately and logged in the contact's activity feed.

SEND AN SMS:
Step 1. Open the contact's detail page.
Step 2. Click "Send SMS" in the action buttons.
Step 3. Type your message (keep under 160 characters for a single SMS segment).
Step 4. Optional: Click "Use Template" to load a saved SMS template.
Step 5. Click Send.

REQUIREMENT: SMS requires an SMS provider (e.g. Twilio) configured under Settings → SMS. If the button is missing or grayed out, SMS is not yet configured.`,
  },
  {
    module: 'contacts',
    sort_order: 14,
    title: 'How to Import Contacts from a CSV File',
    content: `Step 1. Click "CSV Import" in the left sidebar (under Contacts or Tools).
Step 2. Download the sample CSV template by clicking "Download Sample" to see the correct column headers.
Step 3. Open the template in Excel or Google Sheets. Fill in your contacts. Required columns: first_name, last_name. Common optional columns: email, phone, title, organization_name, lifecycle_stage.
Step 4. Save your file as a .csv file.
Step 5. Back in the app, click "Upload CSV" and select your file.
Step 6. The importer shows a preview of the first several rows. Verify it looks correct.
Step 7. If any columns did not match automatically, use the column mapping step to match your column headers to the system fields.
Step 8. Click "Import". A progress bar appears.
Step 9. When complete, a summary shows: X contacts created, Y skipped (duplicates by email), Z errors.

TIPS:
- Contacts are matched by email address. If an email already exists, the row is skipped to avoid duplicates.
- If organization_name is filled in, the system matches to an existing org by name, or creates a new one.
- Tags can be included in a column named "tags" as comma-separated values.`,
  },

  // ── Organizations — Tasks ────────────────────────────────────────────────────
  {
    module: 'organizations',
    sort_order: 10,
    title: 'How to Create an Organization (Company)',
    content: `Step 1. Click "Companies" (Organizations) in the left sidebar.
Step 2. Click "New Organization" in the top right corner.
Step 3. Enter the Organization Name (required).
Step 4. Fill in additional details as available:
   - Website URL
   - Phone number
   - Industry
   - Owner (team member responsible)
   - Lifecycle Stage
   - Address
Step 5. Click Save.

The organization is created. From the org detail page you can:
- Link contacts to this org (from each contact's edit page, set their Organization field)
- Create invoices directly for this org
- Create deals linked to this org
- Attach files and Google Drive folders`,
  },
  {
    module: 'organizations',
    sort_order: 11,
    title: 'How to View an Organization\'s Billing History',
    content: `Step 1. Click "Companies" in the left sidebar.
Step 2. Find the organization and click its name to open the detail page.
Step 3. Click the "Billing" tab on the org detail page.

The Billing tab shows:
- All invoices issued to this organization (invoice number, date, amount, status)
- All payments received from this organization
- Outstanding balance

From this tab you can also:
- Click any invoice to open it
- Click "New Invoice" to create a new invoice directly for this org (the org is pre-filled)

To see individual payment transactions:
- Go to Billing → Transactions in the sidebar and filter by this organization's name.`,
  },

  // ── Deals — Tasks ────────────────────────────────────────────────────────
  {
    module: 'deals',
    sort_order: 10,
    title: 'How to Create a Deal',
    content: `Step 1. Click "Deals" in the left sidebar.
Step 2. Click "New Deal" in the top right corner.
Step 3. Fill in the deal details:
   - Name: a descriptive title (e.g. "Acme Corp — Network Upgrade")
   - Organization: the company this deal is for (required)
   - Contact: the individual contact at that company
   - Value: the dollar amount of the order
   - Expected Close Date: when you expect the order to be finalized or delivered
   - Pipeline: select the pipeline (e.g. "Kit Sales")
   - Stage: the current stage (e.g. "Proposal", "Deposit Paid")
   - Owner: the team member managing this order
Step 4. Click Save.

The deal appears on both the Deals list and the Pipeline board. Add notes and track activity from the order detail page.`,
  },
  {
    module: 'deals',
    sort_order: 11,
    title: 'How to Move a Deal to a New Stage',
    content: `METHOD 1 — Pipeline Board (drag and drop):
Step 1. Click "Deals" → Pipeline view.
Step 2. Find the order card on the board.
Step 3. Click and hold the card, then drag it to the column for the new stage.
Step 4. Release. The stage updates immediately and saves automatically.

METHOD 2 — From the order detail page:
Step 1. Open the deal (click its name from the list or board).
Step 2. Click the Stage field showing the current stage.
Step 3. Select the new stage from the dropdown.
Step 4. The stage saves automatically.

METHOD 3 — Inline from the list:
Step 1. On the Deals list, find the order row.
Step 2. Click the Stage badge to open a stage selector dropdown.
Step 3. Choose the new stage. It saves immediately.`,
  },
  {
    module: 'deals',
    sort_order: 12,
    title: 'How to Close a Deal (Won or Lost)',
    content: `MARK AS WON:
Step 1. Open the deal.
Step 2. Change the Stage to your "Won" stage (e.g. "Complete", "Kit Shipped"). The Won stage is configured in Admin → Pipelines.
Step 3. The order is marked as Won. Won orders typically trigger automations like a congratulations email or a task to create an invoice.

MARK AS LOST:
Step 1. Open the deal.
Step 2. Change the Stage to your "Lost" stage (e.g. "Lost", "Cancelled").
Step 3. A dialog may appear asking for a loss reason. Select or type the reason and confirm.
Step 4. The order is marked Lost and removed from active pipeline views.

To see lost deals: On the Deals list, use the Stage filter and select your Lost stage, or use the "Show Lost" toggle if available.`,
  },

  // ── Billing / Payments — Tasks ────────────────────────────────────────────────
  {
    module: 'billing',
    sort_order: 10,
    title: 'How to Issue a Refund on a Card Payment',
    content: `Step 1. Go to Billing → Transactions in the left sidebar.
Step 2. Find the transaction you want to refund. You can search by date, organization name, or amount.
Step 3. Click the transaction row to open the transaction detail page.
Step 4. Click "Refund" (or "Issue Refund") button on the detail page.
Step 5. Enter the refund amount:
   - Full refund: leave the amount as-is (equals the original charge)
   - Partial refund: change the amount to only refund part of the charge
Step 6. Optional: Enter a reason for the refund (internal note).
Step 7. Click "Confirm Refund".

The gateway processes the refund. The customer's card is credited within 3–5 business days. The transaction record updates to show "Refunded" or "Partially Refunded" status.

IF THE REFUND BUTTON IS MISSING: The payment was recorded manually (cash/check) and has no gateway transaction to reverse. Record the refund by adjusting the invoice balance instead.

NOTE: Refunds can only be issued for the original amount or less. You cannot refund more than was originally charged.`,
  },
  {
    module: 'billing',
    sort_order: 11,
    title: 'How to View and Export Transaction History',
    content: `VIEW TRANSACTIONS:
Step 1. Go to Billing → Transactions in the left sidebar.
Step 2. The list shows all payment transactions sorted by most recent.

FILTER the list:
- Date range: set a start and end date to see transactions in a period
- Organization: type an org name to filter by customer
- Status: filter by Approved, Declined, Refunded, or Voided
- Gateway: filter by payment gateway (Authorize.net, Valor, Manual)

CLICK a transaction to see full detail including card brand, last 4 digits, authorization code, gateway transaction ID, and fee breakdown.

EXPORT TO CSV:
Step 1. Apply any filters you want (e.g. date range for the month).
Step 2. Click "Export" (top right of the transactions list).
Step 3. A CSV file downloads with all transactions matching your current filters. Open it in Excel for reconciliation or accounting.`,
  },

  // ── Subscriptions — Tasks ─────────────────────────────────────────────────────
  {
    module: 'subscriptions',
    sort_order: 10,
    title: 'How to Create a Subscription',
    content: `Step 1. Go to Billing → Subscriptions in the left sidebar.
Step 2. Click "New Subscription".
Step 3. Select the Organization (required).
Step 4. Select the Contact (the billing contact at that org).
Step 5. Enter the Plan Name (e.g. "Monthly Support Contract" or "Annual Maintenance Plan").
Step 6. Enter the Amount — the recurring charge amount per billing cycle.
Step 7. Select the Billing Frequency: Weekly, Monthly, Quarterly, or Annually.
Step 8. Set the Start Date — when the first charge should occur.
Step 9. Optional: Set an End Date if the subscription has a fixed term.
Step 10. Confirm the customer has a saved payment method on file. If not, the system will generate an invoice instead of auto-charging.
Step 11. Click Save.

The subscription is now active. A background job runs daily and charges the customer when the billing date arrives.`,
  },
  {
    module: 'subscriptions',
    sort_order: 11,
    title: 'How to Pause, Resume, or Cancel a Subscription',
    content: `PAUSE A SUBSCRIPTION (temporarily stop billing):
Step 1. Open the subscription from Billing → Subscriptions.
Step 2. Click "Pause". Billing stops immediately. The subscription stays in place and can be resumed.

RESUME A PAUSED SUBSCRIPTION:
Step 1. Open the paused subscription.
Step 2. Click "Resume". The next billing date is recalculated from today based on the billing frequency.

CANCEL A SUBSCRIPTION:
Step 1. Open the subscription.
Step 2. Click "Cancel Subscription".
Step 3. A dialog appears with two options:
   - Cancel Immediately: stops billing now. The subscription ends today.
   - Cancel at Period End: the subscription continues through the current billing period and then cancels.
Step 4. Choose your option and confirm.

Cancelled subscriptions cannot be reactivated. Create a new subscription if billing needs to restart.`,
  },

  // ── Communications — Tasks ────────────────────────────────────────────────────
  {
    module: 'communications',
    sort_order: 10,
    title: 'How to Send a Bulk Email Campaign',
    content: `Step 1. First, make sure you have a contact list ready. Go to Communications → Lists and create a list if you do not have one. Add the contacts you want to reach.
Step 2. Go to Communications → Campaigns.
Step 3. Click "New Campaign".
Step 4. Enter a Campaign Name (internal label — customers do not see this).
Step 5. Select the Contact List as your recipient group.
Step 6. Choose whether to start from a saved Template or compose from scratch.
Step 7. Enter the Email Subject line.
Step 8. Write the email body. Use merge fields to personalize:
   - {{first_name}} — recipient's first name
   - {{last_name}} — recipient's last name
   - {{organization}} — their company name
Step 9. Click "Preview" to see how the email will look.
Step 10. Choose when to send:
   - Send Now: the campaign goes out immediately after you confirm.
   - Schedule: pick a future date and time.
Step 11. Click "Send" (or "Schedule" if scheduling).

After sending, the Campaign detail page shows sent count, opens, and bounces.`,
  },
  {
    module: 'communications',
    sort_order: 11,
    title: 'How to Create an Email Template',
    content: `Step 1. Go to Communications → Templates in the left sidebar.
Step 2. Click "New Template".
Step 3. Choose the template type: Email or SMS.
Step 4. Give the template a Name (internal label).
Step 5. For Email templates:
   - Enter the Subject line. You can use merge fields in the subject: {{first_name}}, {{organization}}.
   - Write the Body using the rich text editor. Format with bold, headings, lists, and links as needed.
   - Insert merge fields using the merge field picker or type them directly: {{first_name}}, {{last_name}}, {{invoice_number}}, {{amount_due}}, {{payment_link}}.
Step 6. For SMS templates:
   - Write the message text (160 characters or fewer for a single SMS segment).
   - Merge fields work the same way.
Step 7. Click Save.

The template is now available when sending email from a contact page or when composing a campaign. Click "Use Template" to load it.`,
  },
  {
    module: 'communications',
    sort_order: 12,
    title: 'How to Build a Workflow Automation',
    content: `Automations automatically send emails, SMS, or create tasks when something happens in the CRM.

Step 1. Go to Communications → Automations.
Step 2. Click "New Automation".
Step 3. Give the automation a Name (e.g. "New Contact Welcome Email").
Step 4. Select a Trigger — what event starts the automation:
   - Contact Created
   - Deal Stage Changed (select which pipeline and from/to stage)
   - Deal Won
   - Invoice Sent
   - Invoice Paid
   - Tag Added to Contact
Step 5. Optional: Add Conditions to filter when the automation runs (e.g. only if the contact has tag "hot-lead" or the deal value is over $5,000).
Step 6. Click "Add Action" and choose what should happen:
   - Send Email: choose or compose an email to the contact
   - Send SMS: send a text message to the contact's phone
   - Create Task: assign a follow-up task to a team member
   - Add Tag / Remove Tag: update the contact's tags
Step 7. Add a Delay if needed (e.g. "wait 2 days before sending").
Step 8. Add multiple actions in sequence if needed.
Step 9. Click "Test" to run the automation against a sample contact and verify it works.
Step 10. Toggle the automation to Active.

The automation now runs automatically whenever the trigger fires.`,
  },

  // ── Portal — Tasks ────────────────────────────────────────────────────────────
  {
    module: 'portal',
    sort_order: 10,
    title: 'How to Create a Customer Portal Account',
    content: `Step 1. Go to Admin → Portal Users in the left sidebar.
Step 2. Click "Add Portal User".
Step 3. Enter the customer's Email address. This is what they will use to log in.
Step 4. Enter their First Name and Last Name.
Step 5. Set a temporary Password. The customer can change this after logging in.
Step 6. Select the Organization to link this portal user to. They will see invoices, subscriptions, and data for that organization only.
Step 7. Click Save.

Step 8. Send the customer their login credentials. You can do this manually (email them the URL and credentials) or use the "Send Access Email" button if available — this sends an automated email with a link to the portal and instructions for their first login.

The customer visits /portal/login and logs in with their email and the temporary password.`,
  },
  {
    module: 'portal',
    sort_order: 11,
    title: 'How to Reset a Portal User\'s Password',
    content: `IF THE CUSTOMER FORGOT THEIR PASSWORD:
Step 1. Ask the customer to go to /portal/login.
Step 2. They click "Forgot password?".
Step 3. They enter their email address and click Submit.
Step 4. They receive a password reset email (requires SMTP to be configured).
Step 5. They click the link in the email and set a new password.

IF YOU NEED TO RESET IT MANUALLY (admin reset):
Step 1. Go to Admin → Portal Users.
Step 2. Find the portal user and click their name.
Step 3. Click "Reset Password" or "Set New Password".
Step 4. Enter a new temporary password.
Step 5. Click Save.
Step 6. Communicate the new temporary password to the customer.

IF PORTAL LOGIN IS NOT WORKING:
- Check that the portal user's status is Active (not Inactive).
- Check that their organization is linked.
- Check that SMTP is configured if they are trying the forgot-password flow.`,
  },

  // ── Admin — Tasks ─────────────────────────────────────────────────────────────
  {
    module: 'admin',
    sort_order: 10,
    title: 'How to Invite a New Team Member',
    content: `Step 1. Go to Admin → Users in the left sidebar.
Step 2. Click "Invite User".
Step 3. Enter the new user's Email address.
Step 4. Select their Role from the dropdown (e.g. Admin, Sales Manager, Sales Agent). Roles control what they can see and do.
Step 5. Click "Send Invite".

The invited user receives an email with a link to activate their account and set their password. The link is valid for 48 hours. If they miss it, you can re-invite from the same Users page.

After they accept:
- They appear in the Users list with Active status.
- They can log in at the main app URL.
- Their permissions are determined by the role you assigned.

To change a user's role after they have joined: Click their name in the Users list → Edit → change the Role → Save.`,
  },
  {
    module: 'admin',
    sort_order: 11,
    title: 'How to Create a Custom Role',
    content: `Step 1. Go to Admin → Roles in the left sidebar.
Step 2. Click "New Role".
Step 3. Enter a Role Name (e.g. "Support Agent", "Billing Only", "Field Technician").
Step 4. Set the Scope:
   - All: the user can see all records in the system
   - Team: the user can see records owned by their team
   - Own: the user can only see records they own personally
Step 5. Toggle the permissions you want this role to have. Common permissions:
   - contacts.read / contacts.write / contacts.delete
   - organizations.read / organizations.write
   - deals.read / deals.write
   - invoices.read / invoices.write
   - payments.read
   - comms.write (send emails and SMS)
   - settings.manage (access all settings)
Step 6. Click Save.

Step 7. To assign this role to a user: Go to Admin → Users → click the user → Edit → change their Role to the new role → Save.`,
  },

  // ── Settings — Tasks ──────────────────────────────────────────────────────────
  {
    module: 'settings',
    sort_order: 10,
    title: 'How to Configure SMTP Email',
    content: `SMTP is required for all outgoing emails (invoices, campaigns, password resets). Without it, emails will not send.

Step 1. Go to Settings → Integrations (or Settings → Email) in the left sidebar.
Step 2. Click the SMTP tab.
Step 3. Enter your mail server details:
   - Host: your SMTP server address (e.g. smtp.gmail.com or smtp.office365.com)
   - Port: 587 is the most common (TLS). Use 465 for SSL.
   - Encryption: TLS or SSL (must match the port)
   - Username: your full email address or SMTP login
   - Password: your email password or app-specific password (for Gmail: generate an App Password in Google Account settings)
   - From Email: the address that appears as the sender
   - From Name: the display name (e.g. "LIT-CRM Support")
Step 4. Click "Send Test Email". Enter your own email address when prompted.
Step 5. Check your inbox. If the test email arrives, SMTP is working.
Step 6. Click Save.

TROUBLESHOOTING:
- Gmail: enable "Less secure app access" or use an App Password with 2FA enabled.
- Office 365: may require allowing SMTP AUTH in Microsoft 365 admin center.
- If port 587 does not work, try port 465 with SSL.`,
  },
  {
    module: 'settings',
    sort_order: 11,
    title: 'How to Set Up the Valor Payment Gateway',
    content: `Step 1. Log in to your Valor PayTech merchant portal and find your EPI number and API key.
Step 2. In the app, go to Settings → Integrations → Payment Gateways.
Step 3. Click the Valor PayTech tab.
Step 4. Enter your EPI ID (your merchant account identifier from Valor).
Step 5. Enter your API Key from the Valor portal.
Step 6. Toggle Mode: set to Sandbox for testing, Live for real transactions.
Step 7. Optional: Enter a Processing Fee — a percentage (e.g. 3.0 for 3%) or flat amount added to each transaction to cover gateway costs.
Step 8. Click "Test Connection". A success message confirms your credentials work.
Step 9. Click Save.

VAULT / TOKENIZATION: To save customer cards for recurring billing, Valor Vault must be enabled on your EPI account. Contact your Valor representative and ask them to enable vault on EPI [your number].

WEBSITE PAYMENT PAGES: Once Valor is configured, any PaymentBlock on your website automatically uses these credentials for Passage.js card entry.`,
  },
  {
    module: 'settings',
    sort_order: 12,
    title: 'How to Connect Google Workspace',
    content: `Step 1. Go to Settings → Integrations → Google Workspace.
Step 2. Click "Connect with Google".
Step 3. You are redirected to Google's OAuth consent screen. Sign in with your Google Workspace (G Suite) account — use the admin email for your organization's Workspace.
Step 4. Review the permissions requested:
   - View files in Google Drive (for browsing and linking Drive folders)
   - Manage Calendar events (for syncing tasks)
Step 5. Click Allow / Accept.
Step 6. You are redirected back to the app. The Google Workspace tab now shows your connected account email and a green "Connected" status.

TO USE GOOGLE DRIVE LINKING:
- Open any Contact, Organization, or Deal detail page.
- Click the "Google Drive" tab.
- Click "Browse Drive" to select a Shared Drive and folder to link.
- The linked folder's files appear in the CRM record.

TO DISCONNECT:
- Go to Settings → Integrations → Google Workspace → click Disconnect.`,
  },

  // ── Website Builder — Tasks ────────────────────────────────────────────────────
  {
    module: 'website_builder',
    sort_order: 20,
    title: 'How to Create a New Website Page',
    content: `Step 1. Go to Website → Pages in the left sidebar.
Step 2. Click "New Page" in the top right corner.
Step 3. The "Choose a Template" dialog appears. Browse the template categories:
   - Blank: empty canvas
   - E-Commerce: shop, product detail, payment, thank-you pages
   - List Pages: blog listing, FAQ
   - Services: services landing, service detail
   - Landing Pages: video hero, dark minimal hero
Step 4. Click a template card to select it (or click "Blank Page" to start empty).
Step 5. Enter the Page Title at the top of the dialog. The URL slug auto-generates from the title (e.g. "Our Services" → /our-services).
Step 6. Click "Create Page".

The page editor opens with the template's blocks pre-loaded. Start editing each block by clicking it on the canvas.`,
  },
  {
    module: 'website_builder',
    sort_order: 21,
    title: 'How to Add a Block to a Page',
    content: `Step 1. Open the page editor (Website → Pages → click the pencil icon on a page, or create a new page).
Step 2. The left panel shows the Component Library — all available blocks you can add.
Step 3. Scroll through the left panel to find the block you want (e.g. "Hero Banner", "Testimonials", "CTA Banner").
Step 4. Click and hold the block in the left panel, then drag it onto the canvas in the center.
Step 5. A blue line appears showing where the block will drop. Drop it between existing blocks to insert it at that position.
Step 6. Release the mouse. The block appears on the canvas with its default settings.
Step 7. The right panel immediately shows the new block's settings. Edit the text, colors, and content there.

ALTERNATIVE: You can also click (not drag) a block in the left panel to add it at the bottom of the page.

After adding and configuring blocks, click Save → Publish to make the page live.`,
  },
  {
    module: 'website_builder',
    sort_order: 22,
    title: 'How to Edit a Block\'s Content and Colors',
    content: `Step 1. Open the page editor.
Step 2. Click any block on the canvas to select it. A blue border appears around the selected block.
Step 3. The right panel shows all the settings for that block.
Step 4. Edit the settings:
   - Text fields: click the field and type your content
   - Color fields: click the color swatch to open the color picker. Enter a hex code or use the picker.
   - Number fields: type a value or use the up/down arrows
   - Dropdown fields: click and select from the options
   - Array fields (like "Items" in a feature grid): click "Add Item" to add a row, fill in the fields, and drag to reorder.
Step 5. The canvas updates live as you change settings — you can see the result immediately.
Step 6. When done, click Save → Publish (or Save → Draft to save without publishing).

UNDO: Press Ctrl+Z (Cmd+Z on Mac) to undo changes. Ctrl+Y (Cmd+Y) to redo.`,
  },
  {
    module: 'website_builder',
    sort_order: 23,
    title: 'How to Reorder or Delete Blocks',
    content: `REORDER BLOCKS:
Step 1. Open the page editor.
Step 2. Hover over any block on the canvas. A drag handle (six dots icon) appears on the left edge of the block.
Step 3. Click and hold the drag handle.
Step 4. Drag the block up or down to the new position. A blue indicator line shows the drop position.
Step 5. Release. The block moves to the new position.

DELETE A BLOCK:
Method 1 — Select and delete:
Step 1. Click the block on the canvas to select it.
Step 2. Press the Delete key on your keyboard.
Step 3. The block is removed immediately. Press Ctrl+Z to undo if needed.

Method 2 — Right-click:
Step 1. Right-click the block on the canvas.
Step 2. Choose "Delete" from the context menu.

Method 3 — Via the right panel:
Step 1. Select the block.
Step 2. In the right panel, scroll to the bottom and click the Delete button (trash icon).`,
  },
  {
    module: 'website_builder',
    sort_order: 24,
    title: 'How to Publish or Unpublish a Website Page',
    content: `PUBLISH A PAGE (make it live):
Step 1. Open the page editor (Website → Pages → pencil icon on the page).
Step 2. Click "Save" at the top right of the editor.
Step 3. A dropdown appears with two options:
   - Publish: makes the page live immediately at its URL (e.g. /our-services)
   - Save as Draft: saves your changes but keeps the page hidden from the public
Step 4. Click "Publish". The page is now live.

UNPUBLISH A PAGE (take it offline):
Step 1. Open the page in the editor.
Step 2. Click "Save" → "Save as Draft". The page status reverts to Draft and is no longer publicly accessible.

CHECK THE PAGE STATUS:
- On the Website → Pages list, each page shows a status badge: "published" (green) or "draft" (gray).
- Click the external link icon next to a published page to open it in a new browser tab.

NOTE: The page is accessible at /{slug}. For example, a page with slug "services" is live at yourwebsite.com/services.`,
  },
  {
    module: 'website_builder',
    sort_order: 25,
    title: 'How to Set Up a Payment Page',
    content: `A payment page lets customers pay online from your website. The system automatically creates a contact, order, and payment record.

BEFORE YOU START: Valor PayTech must be configured in Settings → Payment Gateways.

Step 1. Go to Website → Pages → New Page.
Step 2. Select the "Payment Page" template from the E-Commerce category.
Step 3. Enter a page title (e.g. "Pay Your Deposit" or "Kit Payment").
Step 4. Click Create. The editor opens with a Hero Banner and a Payment Block.
Step 5. Click the Payment Block on the canvas to select it.
Step 6. In the right panel, configure the Payment Block:
   - Heading: e.g. "Complete Your Payment"
   - Product / Service Name: what the customer is paying for (e.g. "Onboarding Deposit")
   - Amount Mode: select Fixed (you set the amount) or Variable (customer enters amount)
   - Fixed Amount: enter the charge amount if using Fixed mode (e.g. 2500 for $2,500)
   - Show Company Field: Yes if you want to capture a company name
   - Success Message: message shown after successful payment
   - Accent Color: your brand color for the Pay button
Step 7. Click the Hero Banner block and update the headline and background color to match your branding.
Step 8. Click Save → Publish.

Share the page URL with customers. When they pay, you will see a new contact, order, and payment automatically created in the CRM.`,
  },
  {
    module: 'website_builder',
    sort_order: 26,
    title: 'How to Add a Video Hero to a Page',
    content: `The Video Hero block plays a background video (YouTube, Vimeo, or MP4) behind your headline and CTA buttons.

Step 1. In the page editor, find "Video Hero" in the left panel component library.
Step 2. Drag it onto the canvas at the top of the page (or wherever you want it).
Step 3. Click the Video Hero block to select it. The right panel shows its settings.
Step 4. Enter the Video URL:
   - For YouTube: paste the full YouTube watch URL (e.g. https://www.youtube.com/watch?v=XXXXXXXXXXX)
   - For Vimeo: paste the full Vimeo URL (e.g. https://vimeo.com/123456789)
   - For a direct MP4 file: paste the direct URL to your .mp4 file
Step 5. Set the Video Type to match: YouTube, Vimeo, or MP4/Direct.
Step 6. Set the Overlay Opacity to make the video darker so text is readable. Start at 50–60%.
Step 7. Enter your Headline and Sub-headline text.
Step 8. Set the CTA Button text and URL.
Step 9. Set the Height: Full Screen (100vh), Large (80vh), or Medium (60vh).
Step 10. Save and publish.

NOTE: YouTube and Vimeo videos autoplay muted on loop — they do not show controls. The video ID is extracted from the URL automatically. If the URL is wrong, the block shows a dark background fallback.`,
  },
  {
    module: 'website_builder',
    sort_order: 27,
    title: 'How to Update a Page\'s SEO Title and Description',
    content: `Step 1. Go to Website → Pages in the left sidebar.
Step 2. Find the page you want to update.
Step 3. Click the settings (gear) icon on the right side of the page row — this opens the SEO settings panel without opening the full editor.
Step 4. Update the following fields:
   - SEO Title: the title shown in browser tabs and Google search results. Keep it under 60 characters. Example: "Annual Network Health Check | LIT-CRM"
   - Meta Description: the snippet shown under the title in Google results. Keep it under 155 characters. Example: "Full experimental annual inspections from $450. Written report and A&P sign-off included."
   - OG Image URL: the image shown when this page is shared on social media (Facebook, LinkedIn). Use a wide image, at least 1200x630px.
Step 5. Click Save.

BEST PRACTICE:
- Each page should have a unique SEO title and description.
- Put your most important keyword near the start of the title.
- The description should be a genuine sentence that makes someone want to click.`,
  },

  // ── Forms — Tasks ─────────────────────────────────────────────────────────────
  {
    module: 'forms',
    sort_order: 10,
    title: 'How to Create a Contact Form',
    content: `Step 1. Go to Website → Forms in the left sidebar.
Step 2. Click "New Form".
Step 3. Enter a Form Name (internal label, e.g. "Contact Form") and a Form Title (shown to users above the form, e.g. "Get in Touch").
Step 4. Add fields by clicking on field types in the left panel or clicking "Add Field":
   - Add a "Short Text" field → label it "Full Name", mark as Required
   - Add an "Email" field → label it "Email Address", mark as Required
   - Add a "Phone" field → label it "Phone Number"
   - Add a "Long Text" field → label it "Message"
Step 5. Click each field to edit its label, placeholder text, and whether it is required.
Step 6. Drag fields up or down to reorder them.
Step 7. Go to the Form Settings tab:
   - Success Message: what the user sees after submitting (e.g. "Thank you! We'll be in touch within 1 business day.")
   - Notification Email: enter a team email address to receive an alert for each submission
Step 8. Click Save.

The form is ready. Now embed it on a website page using the Form Embed block.`,
  },
  {
    module: 'forms',
    sort_order: 11,
    title: 'How to Embed a Form on a Website Page',
    content: `Step 1. First, create your form in Website → Forms. Note the form's slug (shown on the forms list, e.g. "contact-form").
Step 2. Open the page where you want to embed the form (Website → Pages → pencil icon).
Step 3. In the left panel component library, find "Form Embed".
Step 4. Drag the Form Embed block onto the canvas where you want the form to appear.
Step 5. Click the Form Embed block to select it.
Step 6. In the right panel, enter the Form Slug — the slug of the form you created (e.g. "contact-form"). This is the key that connects the block to your form.
Step 7. Optional: Add a Heading above the form (e.g. "Send Us a Message").
Step 8. Adjust background color and padding if needed.
Step 9. Click Save → Publish.

The form is now embedded on the page. Visitors can fill it out and submit. Submissions appear in Website → Forms → Submissions.`,
  },
  {
    module: 'forms',
    sort_order: 12,
    title: 'How to View and Export Form Submissions',
    content: `VIEW SUBMISSIONS:
Step 1. Go to Website → Forms in the left sidebar.
Step 2. Click on the form name to open it.
Step 3. Click the "Submissions" tab. All submissions for this form appear here with the date and a preview of the key fields.
Step 4. Click any submission row to see the full detail — all field values the user submitted.

OR use the global submissions view:
Step 1. Go to Website → Forms → Submissions (if there is a top-level Submissions link in the sidebar).
Step 2. Filter by form name, date range, or search by email.

EXPORT TO CSV:
Step 1. Open the form's Submissions tab.
Step 2. Click "Export" in the top right.
Step 3. A CSV file downloads with all submissions. Each row is one submission; each column is a form field.

DELETE A SUBMISSION:
Step 1. Click the submission to open its detail view.
Step 2. Click Delete. Confirm the dialog. Deletion is permanent.`,
  },

  // ── Blog — Tasks ──────────────────────────────────────────────────────────────
  {
    module: 'blog',
    sort_order: 10,
    title: 'How to Write and Publish a Blog Post',
    content: `Step 1. Go to Website → Blog in the left sidebar.
Step 2. Click "New Post".
Step 3. Enter the Post Title. The URL slug auto-generates (e.g. "How to Read Blueprints" → /blog/how-to-read-blueprints). You can edit the slug.
Step 4. Write the post content in the editor. Use the toolbar to format:
   - Bold / Italic for emphasis
   - Heading 2 and 3 for section titles
   - Bullet lists and numbered lists
   - Insert Link (Ctrl+K) to add clickable links
   - Insert Image to add a photo in the body (paste the image URL)
Step 5. Set a Featured Image: enter the URL of the hero image for this post (shown at top of post and in blog listing cards).
Step 6. Select a Category (e.g. "Build Tips", "News"). Create categories as needed.
Step 7. Add Tags for cross-topic organization (optional).
Step 8. Select the Author from the dropdown.
Step 9. Set the Publish Date. For immediate publishing, leave it as today. For scheduled publishing, set a future date.
Step 10. Fill in SEO fields (scroll down): Meta Title, Meta Description, OG Image.
Step 11. Click "Publish" to make the post live immediately, or "Save Draft" to save without publishing.`,
  },
  {
    module: 'blog',
    sort_order: 11,
    title: 'How to Schedule a Blog Post for Future Publishing',
    content: `Step 1. Write your blog post following the same steps as "How to Write and Publish a Blog Post".
Step 2. Before saving, set the Publish Date field to a future date and time (e.g. July 10, 2026 at 9:00 AM).
Step 3. Click "Save" → "Schedule" (or "Save as Scheduled" if that option appears).

The post status changes to "Scheduled". It is not live yet. A background job checks daily and publishes posts when their publish date arrives.

TO CHECK SCHEDULED POSTS:
- Go to Website → Blog. Filter by status "Scheduled" to see all upcoming posts.
- Click a scheduled post to edit it or change the publish date.

TO PUBLISH A SCHEDULED POST IMMEDIATELY:
- Open the scheduled post.
- Change the Publish Date to today (or any past date).
- Click Save → Publish.`,
  },

  // ── Social Media — Tasks ──────────────────────────────────────────────────────
  {
    module: 'social',
    sort_order: 10,
    title: 'How to Post to Social Media',
    content: `BEFORE YOU START: Connect at least one social account under Settings → Integrations → Social Media.

Step 1. Go to Marketing → Social Media in the left sidebar.
Step 2. Click "New Post".
Step 3. Write your post content in the text area. Keep in mind character limits: Instagram 2,200, LinkedIn 3,000, Facebook is generous.
Step 4. Optional: Click "Add Image" or "Upload Image" to attach a photo. Images significantly increase engagement on all platforms.
Step 5. Select which platforms to post to by checking the boxes: Facebook, Instagram, LinkedIn.
   - Note: Instagram requires an image to post.
Step 6. Choose when to post:
   - Post Now: click "Publish" to post immediately to all selected platforms.
   - Schedule: click "Schedule", pick a date and time, then confirm.
Step 7. Click "Publish" or "Schedule".

To see your post history: Go to Marketing → Social Media → History.
To see scheduled posts: Marketing → Social Media → Scheduled.`,
  },

  // ── SEO — Tasks ──────────────────────────────────────────────────────────────
  {
    module: 'seo',
    sort_order: 10,
    title: 'How to Configure Global SEO Settings',
    content: `Step 1. Go to Marketing → SEO in the left sidebar.
Step 2. Fill in the global settings:
   - Site Title / Title Pattern: the format for all page titles (e.g. "{{page_title}} | LIT-CRM"). This is used as a fallback when a page has no custom SEO title.
   - Default Meta Description: used when a page has no custom description. Keep it under 155 characters.
   - Default OG Image: the image used for social sharing when no page-specific image is set. Use a 1200x630px image.
Step 3. Google Search Console Verification: if you need to verify your site with Google, enter the verification meta tag content here. The tag is added to every page automatically.
Step 4. Click Save.

TO SET SEO FOR AN INDIVIDUAL PAGE:
- Website Builder pages: gear icon on the page list → edit Title, Description, OG Image.
- Blog posts: scroll to the SEO section in the blog post editor.

SITEMAP: Your sitemap is auto-generated at /sitemap.xml. Submit this URL to Google Search Console to help Google discover your pages faster.`,
  },

  // ── AI Assistant — Tasks ──────────────────────────────────────────────────────
  {
    module: 'ai',
    sort_order: 10,
    title: 'How to Use the AI Assistant',
    content: `Step 1. Click the chat bubble icon in the bottom-right corner of any admin page, or navigate to Admin → AI Assistant.
Step 2. The chat panel opens. Type your question in the input field at the bottom.
Step 3. Press Enter or click Send. The AI assistant responds, typically within 2–5 seconds.
Step 4. Continue the conversation — the assistant remembers context within a session, so you can follow up: "Can you make that more formal?" or "What about for SMS instead?"

EXAMPLE QUESTIONS:
- "How do I create a recurring invoice?"
- "Write me a follow-up email for a customer whose deal is in 'Deposit Paid' stage."
- "What merge fields can I use in email templates?"
- "How do I set up a payment page in the website builder?"
- "Draft a LinkedIn post announcing our new managed services plan."
- "What is the difference between the website builder and CMS pages?"

The assistant draws from the knowledge base to give accurate, app-specific answers. If it does not know something, it will say so.

LIMITATIONS: The assistant cannot create records, send emails, or make changes in the app — it can only give guidance and draft content for you.`,
  },
  {
    module: 'ai',
    sort_order: 11,
    title: 'How to Add or Edit a Knowledge Base Article',
    content: `Step 1. Go to Admin → AI Assistant → Knowledge Base.
Step 2. The list shows all existing articles organized by module.

TO ADD A NEW ARTICLE:
Step 1. Click "New Article".
Step 2. Select the Module — which section of the app this article is about (e.g. "invoices", "website_builder").
Step 3. Enter the Title — a clear, specific topic (e.g. "How to create a recurring invoice").
Step 4. Write the Content. Use plain text with clear structure:
   - Number the steps: "Step 1. Go to... Step 2. Click..."
   - Use ALL CAPS for section headers within the article
   - Include exact button names, menu paths, and field names as they appear in the UI
Step 5. Set Sort Order — a number controlling order within the module. Lower numbers appear first.
Step 6. Make sure Active is toggled On.
Step 7. Click Save.

TO EDIT AN EXISTING ARTICLE:
Step 1. Click the article row.
Step 2. Edit the content directly.
Step 3. Click Save.

TO DEACTIVATE (hide from AI without deleting):
Step 1. Click the article.
Step 2. Toggle Active to Off.
Step 3. Save. The AI will no longer include this article in its responses.`,
  },

  // ── Email Templates — Tasks ────────────────────────────────────────────────────
  {
    module: 'email_templates',
    sort_order: 10,
    title: 'How to Customize a System Email Template',
    content: `System email templates control the HTML emails the app sends automatically (invoices, receipts, etc.).

Step 1. Go to Business → Email Templates (or Settings → Email Templates) in the left sidebar.
Step 2. Find the template you want to edit. Common templates:
   - invoice_sent: the email customers receive when you click "Send Invoice"
   - payment_receipt: the email customers receive after paying
   - portal_access: the email sent when you create a portal account for a customer
Step 3. Click the template name to open the editor.
Step 4. The editor shows the full HTML email. Edit the text sections to match your brand voice:
   - Change the greeting text
   - Update the body paragraphs
   - Add your business address or phone number
   - Do NOT remove merge tags like {{invoice.number}} or {{contact.first_name}} — these are replaced with real data when the email sends
Step 5. Common merge tags you can use:
   - {{business.name}} — your company name
   - {{contact.first_name}} — customer's first name
   - {{invoice.number}}, {{invoice.total}}, {{invoice.due_date}}
   - {{invoice.payment_link}} — the clickable "Pay Now" link
   - {{payment.amount}}, {{payment.last4}}, {{payment.brand}}
Step 6. Click Save to save your changes.

IF YOU BREAK THE TEMPLATE: Click "Reset to Default" to restore the original system template.`,
  },
  {
    module: 'email_templates',
    sort_order: 11,
    title: 'How to Preview and Test an Email Template',
    content: `Step 1. Open the email template from Business → Email Templates.
Step 2. Look for a "Preview" button or tab in the editor. This shows how the email renders with placeholder data substituted for merge tags.
Step 3. Review the email on desktop view. Check:
   - Does the logo appear? (requires business logo to be set in Business Settings)
   - Are your brand colors correct? (set by {{business.primary_color}})
   - Is the text readable and correctly formatted?
   - Are all merge tags replaced with plausible-looking placeholder values?

TO SEND A TEST EMAIL:
Step 1. Click "Send Test" (if this button exists on the template editor).
Step 2. Enter your own email address when prompted.
Step 3. Click Send. The email arrives in your inbox with the actual HTML rendering.
Step 4. Check how it looks in email clients. Gmail and Outlook can render HTML differently.

AFTER EDITING: Make sure to save the template. Changes take effect immediately for all future automated emails — they do not affect emails that have already been sent.`,
  },

  // ── Tasks (in-app tasks) — Task Articles ─────────────────────────────────────
  {
    module: 'tasks',
    sort_order: 10,
    title: 'How to Create and Assign a Task',
    content: `Step 1. Go to Tasks in the left sidebar.
Step 2. Click "New Task".
Step 3. Enter the Task Title (required) — a clear, actionable description (e.g. "Follow up on network upgrade quote — Acme Corp").
Step 4. Optional: Write a more detailed Description explaining what needs to be done.
Step 5. Select the Assigned To field — pick the team member responsible for completing the task.
Step 6. Set the Due Date.
Step 7. Link to a related record (optional):
   - Related Contact: link to a contact (the task then appears on that contact's detail page)
   - Related Deal: link to a deal (the task then appears on that order's detail page)
Step 8. Click Save.

The task appears on the Tasks list and on any linked record's detail page. The assigned team member sees it in their task list. Tasks past their due date show a red "Overdue" badge.

TO COMPLETE A TASK:
- From the Tasks list: click the checkbox next to the task. It is marked complete immediately.
- From a contact or deal page: click the checkbox next to the task in the Tasks section.`,
  },

];

// ─────────────────────────────────────────────────────────────────────────────
// Seed function — upsert all articles
// ─────────────────────────────────────────────────────────────────────────────
async function seed() {
  console.log(`Seeding ${ARTICLES.length} KB articles…`);
  let inserted = 0;
  let updated  = 0;

  for (const a of ARTICLES) {
    const [result] = await db.query(
      `INSERT INTO ai_knowledge_base (module, title, content, sort_order, active)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         content     = VALUES(content),
         sort_order  = VALUES(sort_order),
         active      = 1,
         updated_at  = NOW()`,
      [a.module, a.title, a.content, a.sort_order ?? 0],
    );
    if (result.insertId) inserted++;
    else updated++;
  }

  console.log(`KB seed complete — ${inserted} inserted, ${updated} updated.`);
}

module.exports = { seed };

// Allow running directly: node src/services/kbSeeder.js
if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
