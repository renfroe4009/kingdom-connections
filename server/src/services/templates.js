// =============================================================================
// Template merge-field renderer
//
// Templates use Mustache-style {{namespace.field}} tokens. We DO NOT pull in
// Mustache itself — the substitution rules here are deliberately narrow:
//   * Lookups are dotted paths into a context object: {{contact.first_name}}
//   * Missing values render as empty string (NOT the raw token), so half-built
//     templates never leak {{deal.value}} into a customer's inbox.
//   * No HTML escaping — email bodies arrive HTML-ready, SMS is plain text.
//     If you need user-supplied HTML inside the template, sanitize at the
//     caller level (we don't render arbitrary user content here).
//
// The CRM context is built from straight DB rows by buildContext() so callers
// don't need to know the column shape — they just hand us IDs.
// =============================================================================
const { db }    = require('../db');
const storage   = require('./storage');

// ── Logo embedding ─────────────────────────────────────────────────────────
// Email clients (Outlook, Gmail app, Apple Mail) can only load images from
// publicly reachable URLs. The logo endpoint (/api/settings/business/logo/web)
// is an internal API that email clients can never reach.  We solve this by
// reading the logo at send-time and embedding it:
//   • Local storage → base64 data URI  (always works; Gmail web strips data
//     URIs but still shows alt text)
//   • S3 → signed URL with 7-day expiry (publicly reachable)
const MIME_MAP = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};

async function streamToBase64DataUri(stream, storageKey) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => {
      const buf  = Buffer.concat(chunks);
      const ext  = (storageKey.split('.').pop() || 'png').toLowerCase();
      const mime = MIME_MAP[ext] || 'image/png';
      resolve(`data:${mime};base64,${buf.toString('base64')}`);
    });
    stream.on('error', reject);
  });
}

// business_settings has two independent ways to set the web logo:
//   • logo_web_storage_key/driver — set by the direct "Upload logo" button;
//     embedded below as base64/signed-URL since local disk has no public URL.
//   • logo_web_url — set by picking a file from the Media Library instead;
//     it's already a path served by the public, unauthenticated
//     /api/website/media/file/* route (or a full S3/R2 URL), so it just
//     needs to be made absolute for external email clients to load it.
// Without this fallback, a logo picked via the Media Library (rather than
// uploaded directly) renders as a broken image in every templated email.
async function resolveBusinessLogoUrl(biz) {
  if (biz.logo_web_storage_key) {
    try {
      return await getEmailLogoUrl(biz.logo_web_storage_key, biz.logo_web_storage_driver);
    } catch (err) {
      // Direct-upload file unreadable (e.g. missing on local disk, volume
      // reset) — fall through to logo_web_url below instead of the dead-end
      // API-path fallback getEmailLogoUrl used to return, which reads this
      // exact same broken source and is guaranteed to also fail.
      // eslint-disable-next-line no-console
      console.warn('[templates] logo storage key unreadable, falling back to logo_web_url:', err.message);
    }
  }
  if (biz.logo_web_url) {
    if (/^https?:\/\//i.test(biz.logo_web_url)) return biz.logo_web_url;
    const apiBase = process.env.API_BASE_URL || 'http://localhost:4000';
    return `${apiBase}${biz.logo_web_url}`;
  }
  // Last resort — neither source worked or was set.
  const apiBase = process.env.API_BASE_URL || 'http://localhost:4000';
  return `${apiBase}/api/settings/business/logo/web`;
}

async function getEmailLogoUrl(storageKey, driver) {
  if (!storageKey) return '';
  const got = await storage.getReadable({
    driver: driver || 'local',
    key:    storageKey,
    // S3: use a 7-day signed URL (max AWS allows) so the image still loads
    // if the recipient opens the email days after it was sent.
    expiresIn: 7 * 24 * 3600,
  });
  if (got.type === 'redirect') {
    // S3 signed URL — publicly reachable for 7 days
    return got.url;
  }
  // Local storage — embed as base64 data URI
  return await streamToBase64DataUri(got.stream, storageKey);
}

function getPath(obj, path) {
  if (obj == null) return undefined;
  return path.split('.').reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

function render(template, ctx) {
  if (!template) return '';
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const v = getPath(ctx, path);
    if (v === undefined || v === null) return '';
    return String(v);
  });
}

/**
 * Build a render context from CRM IDs. Pulls only the columns we expose as
 * merge fields — we keep this list intentionally small so we never accidentally
 * leak a credit card hint or internal flag into a templated email.
 *
 * @param {object} ids { contact_id, deal_id, organization_id, user_id, invoice_id, payment_id }
 * @returns {Promise<object>} context with contact / deal / organization / user / business / invoice / payment namespaces
 */
async function buildContext({ contact_id, deal_id, organization_id, user_id, invoice_id, payment_id } = {}) {
  const ctx = {};

  // Always load business info
  const [[biz]] = await db.query(
    `SELECT business_name, primary_color, secondary_color,
            address, city, state, zip, phone, email, website, tax_ein,
            logo_web_url, logo_web_storage_key, logo_web_storage_driver
       FROM business_settings WHERE id = 1`
  );
  if (biz) {
    ctx.business = {
      name:            biz.business_name || 'Our Company',
      // Embed logo at send-time so external email clients can render it
      // (the /api/settings/business/logo endpoint is not reachable from the web).
      logo_url:        await resolveBusinessLogoUrl(biz),
      primary_color:   biz.primary_color  || '#0A1F3D',
      secondary_color: biz.secondary_color || '#C9A227',
      address:         biz.address  || '',
      city:            biz.city     || '',
      state:           biz.state    || '',
      zip:             biz.zip      || '',
      phone:           biz.phone    || '',
      email:           biz.email    || '',
      website:         biz.website  || '',
      tax_ein:         biz.tax_ein  || '',
    };
  }

  if (contact_id) {
    const [[contact]] = await db.query(
      `SELECT id, first_name, last_name, email, mobile, phone, title,
              CONCAT_WS(' ', first_name, last_name) AS full_name
         FROM contacts WHERE id = :id`,
      { id: contact_id }
    );
    if (contact) {
      ctx.contact = contact;
      // Prefills the portal self-registration form — it already matches by
      // email to this same contact record (server/src/routes/portal.js's
      // /register), so a donor/registrant/buyer who signs up sees this
      // transaction alongside the rest of their history immediately.
      if (contact.email) {
        const clientBase = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
        ctx.portal = { register_url: `${clientBase}/portal/register?email=${encodeURIComponent(contact.email)}` };
      }
    }
  }

  if (organization_id) {
    const [[org]] = await db.query(
      `SELECT id, name, website, phone, address_line1, address_line2,
              city, state, postal_code, country
         FROM organizations WHERE id = :id`,
      { id: organization_id }
    );
    if (org) ctx.organization = org;
  }

  if (deal_id) {
    const [[deal]] = await db.query(
      `SELECT id, name, amount AS value, currency, probability, expected_close_date
         FROM deals WHERE id = :id`,
      { id: deal_id }
    );
    if (deal) ctx.deal = deal;
  }

  if (user_id) {
    const [[user]] = await db.query(
      `SELECT id, first_name, last_name, email,
              CONCAT_WS(' ', first_name, last_name) AS full_name
         FROM users WHERE id = :id`,
      { id: user_id }
    );
    if (user) ctx.user = user;
  }

  if (invoice_id) {
    const [[inv]] = await db.query(
      `SELECT i.id, i.payment_token, i.invoice_number, i.total, i.subtotal, i.tax_amount,
              i.balance_due, i.issue_date, i.due_date, i.currency, i.memo, i.status
         FROM invoices i WHERE i.id = :id`,
      { id: invoice_id }
    );
    if (inv) {
      // CLIENT_ORIGIN may be a comma-separated list — take the first entry.
      // Use payment_token (non-enumerable) instead of integer id for pay URL.
      const clientBase = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
        .split(',')[0].trim();
      ctx.invoice = {
        ...inv,
        pay_url: inv.payment_token
          ? `${clientBase}/pay/${inv.payment_token}`
          : `${clientBase}/pay/${inv.id}`, // fallback for pre-migration rows
      };
    }
  }

  if (payment_id) {
    const [[pay]] = await db.query(
      `SELECT p.id, p.amount, p.fee_amount, p.fee_label, p.method, p.status,
              p.external_txn_id AS provider_txn_id, p.receipt_token,
              DATE_FORMAT(p.received_at, '%M %d, %Y') AS received_at
         FROM payments p WHERE p.id = :id`,
      { id: payment_id }
    );
    if (pay) {
      ctx.payment = pay;
      if (pay.receipt_token) {
        const clientBase = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
          .split(',')[0].trim();
        ctx.payment.receipt_url = `${clientBase}/api/payments/public/receipt/by-token/${pay.receipt_token}`;
      }

      const classified = await classifyPayment(payment_id);
      if (classified.kind === 'donation') {
        const deductible = Number(pay.amount) - Number(classified.quid_pro_quo_value || 0);
        ctx.donation = {
          fund_name: classified.fund_name || 'Undesignated Fund',
          is_in_kind: !!classified.is_in_kind,
          in_kind_description: classified.in_kind_description || '',
          quid_pro_quo_value: Number(classified.quid_pro_quo_value || 0),
          deductible_amount: deductible,
          is_recurring: !!classified.subscription_id,
        };
      } else if (classified.kind === 'membership') {
        ctx.membership = {
          tier_name: classified.tier_name,
          next_run_date: classified.next_run_date
            ? new Date(classified.next_run_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            : '',
        };
      }
    }
  }

  return ctx;
}

/**
 * Classify a payment as a donation, a membership-dues renewal, or neither —
 * shared by buildContext() (to populate the donation/membership namespaces)
 * and by maybeSendReceiptEmail() (to pick the right receipt template). A
 * fund-linked subscription's recurring charges create a real `donations` row
 * each cycle; a membership-tier subscription's charges never do (see
 * billing-cron.js's tagRecurringDonation) — so donation always wins the check.
 *
 * @param {number} paymentId
 * @returns {Promise<{kind: 'donation'|'membership'|'other', ...}>}
 */
async function classifyPayment(paymentId) {
  if (!paymentId) return { kind: 'other' };

  const [[donation]] = await db.query(
    `SELECT d.fund_id, f.name AS fund_name, d.is_in_kind, d.in_kind_description,
            d.quid_pro_quo_value, i.subscription_id
       FROM donations d
       JOIN payments p ON p.id = d.payment_id
       LEFT JOIN funds f ON f.id = d.fund_id
       LEFT JOIN invoices i ON i.id = d.invoice_id
      WHERE d.payment_id = :paymentId`,
    { paymentId }
  );
  if (donation) return { kind: 'donation', ...donation };

  const [[membership]] = await db.query(
    `SELECT mt.id AS tier_id, mt.name AS tier_name, s.next_run_date
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN subscriptions s ON s.id = i.subscription_id
       JOIN membership_tiers mt ON mt.id = s.membership_tier_id
      WHERE p.id = :paymentId`,
    { paymentId }
  );
  if (membership) return { kind: 'membership', ...membership };

  return { kind: 'other' };
}

// Documented merge fields — used by the UI's picker. Keep in sync with
// buildContext() above; anything not listed here can technically be referenced
// in a template, but it won't show up in the admin's auto-suggest list.
const MERGE_FIELDS = {
  contact:      ['first_name', 'last_name', 'full_name', 'email', 'mobile', 'phone', 'title'],
  organization: ['name', 'website', 'phone', 'city', 'state'],
  deal:         ['name', 'value', 'currency', 'probability', 'expected_close_date'],
  user:         ['first_name', 'last_name', 'full_name', 'email'],
  business:     ['name', 'logo_url', 'primary_color', 'secondary_color', 'address', 'city', 'state', 'zip', 'phone', 'email', 'website', 'tax_ein'],
  invoice:      ['invoice_number', 'total', 'balance_due', 'due_date', 'issue_date', 'currency', 'status', 'pay_url'],
  payment:      ['amount', 'method', 'provider_txn_id', 'received_at', 'receipt_url', 'status'],
  portal:       ['register_url'],
  donation:     ['fund_name', 'is_in_kind', 'in_kind_description', 'quid_pro_quo_value', 'deductible_amount', 'is_recurring', 'amount'],
  membership:   ['tier_name', 'next_run_date', 'amount'],
  pledge:       ['fund_name', 'amount', 'due_date'],
  compliance:   ['type', 'expiry_date'],
};

/**
 * Look up a template by slug, build context from the given IDs, render it and
 * return { template_id, subject, html }. Returns null if the slug is not found.
 *
 * @param {string} slug
 * @param {object} contextIds  { contact_id, deal_id, organization_id, user_id, invoice_id, payment_id }
 * @param {object} extra       Optional extra namespaces/fields merged onto the
 *   built context before rendering — e.g. { invite: { accept_url } } or
 *   { portal: { login_url, temp_password } } for one-off values buildContext
 *   has no DB row for. MUST be passed in before render(), not patched onto
 *   the returned html/subject afterward: render() replaces any unresolved
 *   {{token}} with '' in a single pass, so a token missing from ctx is gone
 *   for good by the time this function returns — a post-render string
 *   .replace() for that same token is a silent no-op.
 */
async function renderBySlug(slug, contextIds = {}, extra = {}) {
  const [[tpl]] = await db.query(
    'SELECT id, name, subject, body, is_active FROM message_templates WHERE slug = :slug',
    { slug }
  );
  if (!tpl) return null;
  const ctx = await buildContext(contextIds);
  for (const [ns, fields] of Object.entries(extra)) {
    ctx[ns] = { ...(ctx[ns] || {}), ...fields };
  }
  return {
    template_id: tpl.id,
    subject: render(tpl.subject || '', ctx),
    html:    render(tpl.body    || '', ctx),
  };
}

module.exports = { render, buildContext, renderBySlug, classifyPayment, MERGE_FIELDS, resolveBusinessLogoUrl };
