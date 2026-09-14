// =============================================================================
// moduleSettings — read/write per-module JSON config from the settings KV table.
// Keys are namespaced as "module.<name>", e.g. "module.invoices".
// Callers receive a merged object of defaults + stored values so every key is
// always present, even on a fresh install with no saved config.
// =============================================================================
const { db } = require('../db');

const DEFAULTS = {
  invoices: {
    invoice_prefix:        'INV',
    default_terms:         'net30',      // net15 | net30 | net60 | due_on_receipt
    default_memo:          '',
    default_footer:        '',
    auto_send_on_create:   false,
    reminder_enabled:      false,
    reminder_days_before:  [7, 1],
    reminder_days_after:   [3, 7],
    late_fee_enabled:      false,
    late_fee_type:         'percent',    // percent | flat
    late_fee_amount:       0,
    late_fee_grace_days:   5,
    allow_partial_payments: true,
    require_po_number:     false,
    default_currency:      'USD',
    auto_void_days:        null,         // null = never
  },
  // Storefront order numbers are `${order_prefix}-${year}-NNNNNN` and appear in
  // the order-confirmation subject line, so the default must stay neutral.
  shop: {
    order_prefix:            'ORD',
  },
  payments: {
    auto_send_receipt:       true,
    receipt_footer:          '',
    processing_fee_label:    'Processing fee',
    allow_ach:               true,
  },
  contacts: {
    default_lifecycle_stage:     'lead',   // lead | mql | sql | customer | evangelist | other
    require_email:               false,
    require_phone:               false,
    require_organization:        false,
    duplicate_detection_enabled: true,
    duplicate_fields:            ['email'], // email | phone
    show_linkedin:               true,
    show_department:             true,
    default_lead_source:         '',
  },
  organizations: {
    default_owner_id:                 null,
    auto_link_contacts_by_domain:     false,
    require_website:                  false,
    require_phone:                    false,
    require_industry:                 false,
    require_address:                  false,
    duplicate_detection_enabled:      true,
    default_country:                  '',
  },
  deals: {
    default_pipeline_id:        null,
    default_currency:           'USD',
    default_probability:        50,
    require_amount:             false,
    require_close_date:         false,
    require_primary_contact:    false,
    lost_reason_required:       false,
    auto_close_won_tasks:       false,
    auto_close_lost_tasks:      false,
  },
  tasks: {
    default_due_offset_days:  3,      // days from today pre-filled on new task
    default_assignee:         'creator', // creator | specific_user | unassigned
    default_assignee_user_id: null,
    reminder_enabled:         true,
    reminder_hours_before:    24,     // hours before due date to send reminder
  },
  subscriptions: {
    default_billing_cycle:          'monthly',  // monthly | annual
    renewal_reminder_days:          14,         // days before expiry to send reminder
    auto_invoice_on_renewal:        false,
    failed_payment_retry_2_days:    3,
    failed_payment_retry_3_days:    7,
  },
  portal: {
    allow_download_invoices:        true,
    show_balance_history:           true,
    allow_update_payment_method:    false,
    portal_subdomain:               '',
  },
  // Security remediation H-01 (Phase 3) — org-wide MFA toggle. Off by
  // default: some small nonprofits running this app won't want to require
  // it. When true, every user holding one of MFA_MANDATORY_PERMISSIONS
  // (services/mfa.js) must have TOTP enrolled to use the permission that
  // requires it — see requirePermission() in middleware/auth.js. Turning
  // this on never locks anyone out of logging in; it blocks the specific
  // privileged actions until they enroll.
  security: {
    mfa_enabled: false,
  },
};

async function get(module) {
  const defaults = DEFAULTS[module] || {};
  const [[row]] = await db.query(
    'SELECT value_json FROM settings WHERE `key` = :k',
    { k: `module.${module}` }
  );
  const stored = row?.value_json || {};
  return { ...defaults, ...stored };
}

async function set(module, values) {
  await db.query(
    `INSERT INTO settings (\`key\`, value_json) VALUES (:k, CAST(:v AS JSON))
       ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)`,
    { k: `module.${module}`, v: JSON.stringify(values) }
  );
}

module.exports = { get, set, DEFAULTS };
