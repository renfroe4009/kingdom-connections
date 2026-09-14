// =============================================================================
// templateSeeder.js — seeds / updates system email templates on server startup
//
// VERSIONING
//   Each template carries a `version` number.  The seeder compares it to the
//   `seeder_version` column in the DB row and re-applies subject + body when
//   the stored value is lower (preserving is_active so admin toggles survive).
//   Bump `version` whenever a template's body or subject changes.
// =============================================================================
const { db } = require('../db');

// =============================================================================
// HTML builder helpers
// =============================================================================

/**
 * Full email shell — brand header (accent stripe + logo), content slot, footer.
 *
 * @param {string} preheader  Short sentence shown in inbox preview pane.
 * @param {string} bodyHtml   Inner content section.
 */
function wrapEmail(preheader, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>{{business.name}}</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">

  <!-- Pre-header: visible in inbox preview, invisible in body -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f0f2f5;line-height:1px;white-space:nowrap">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0f2f5">
    <tr>
      <td align="center" style="padding:36px 16px 52px">

        <!-- ═══ Email card ═══ -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 28px rgba(0,0,0,.09)">

          <!-- Thin secondary-color top stripe -->
          <tr>
            <td style="background:{{business.secondary_color}};height:4px;font-size:4px;line-height:4px">&nbsp;</td>
          </tr>

          <!-- Header: primary-color band + logo -->
          <tr>
            <td align="center" style="background:{{business.primary_color}};padding:28px 40px 26px">
              <img src="{{business.logo_url}}" alt="{{business.name}}" width="180"
                style="max-width:180px;max-height:52px;width:auto;height:auto;display:block;margin:0 auto">
            </td>
          </tr>

          <!-- Body content -->
          <tr>
            <td style="padding:40px 40px 36px">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fb;border-top:1px solid #e8eaf0;padding:24px 40px 28px;text-align:center">
              <p style="margin:0 0 5px;font-size:13px;font-weight:600;color:#4a5568;letter-spacing:.2px">{{business.name}}</p>
              <p style="margin:0 0 4px;font-size:12px;color:#a0aec0;line-height:1.7">{{business.address}}&nbsp; {{business.city}}, {{business.state}} {{business.zip}}</p>
              <p style="margin:0 0 12px;font-size:12px;color:#a0aec0;line-height:1.7">
                {{business.phone}}&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="mailto:{{business.email}}" style="color:{{business.secondary_color}};text-decoration:none">{{business.email}}</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="{{business.website}}" style="color:#a0aec0;text-decoration:none">{{business.website}}</a>
              </p>
              <p style="margin:0;font-size:11px;color:#c4cad6;line-height:1.6">This email was sent to {{contact.email}}</p>
            </td>
          </tr>

        </table>
        <!-- ═══ End email card ═══ -->

      </td>
    </tr>
  </table>

</body>
</html>`;
}

/**
 * Full-width colored status banner — sits at the very top of the body content.
 * bgColor / textColor are literal CSS values (not tokens) because they vary per template.
 */
function statusBanner(icon, label, bgColor, textColor) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 32px;border-radius:8px;overflow:hidden">
  <tr>
    <td align="center" style="background:${bgColor};padding:14px 24px">
      <p style="margin:0;font-size:13px;font-weight:700;color:${textColor};letter-spacing:.8px;text-transform:uppercase">${icon}&ensp;${label}</p>
    </td>
  </tr>
</table>`;
}

/**
 * Bordered two-column summary table.
 * Each row: { label, value, bold?, large?, color?, mono?, capitalize? }
 * color may be a CSS value OR a {{token}} — either is fine, render() handles tokens.
 */
function summaryTable(rows) {
  const rowsHtml = rows.map((r, i) => {
    const bg         = i % 2 === 0 ? 'background:#f7fafc;' : '';
    const borderTop  = i > 0 ? 'border-top:1px solid #e8ecf0;' : '';
    const fontSize   = r.large ? '19px' : '14px';
    const fontWeight = r.bold  ? '700'  : '500';
    const color      = r.color || '#2d3748';
    const extra      = [
      r.mono       ? 'font-family:monospace;'    : '',
      r.capitalize ? 'text-transform:capitalize;': '',
    ].join('');
    return `  <tr style="${bg}">
    <td style="padding:12px 20px;font-size:13px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:.4px;${borderTop}">${r.label}</td>
    <td style="padding:12px 20px;font-size:${fontSize};font-weight:${fontWeight};color:${color};text-align:right;${borderTop}${extra}">${r.value}</td>
  </tr>`;
  }).join('\n');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e8ecf0;border-radius:8px;overflow:hidden;margin-bottom:28px">
${rowsHtml}
</table>`;
}

/**
 * Centered CTA button block.
 * noteHtml: optional small-print line rendered below the button (may contain HTML).
 */
function ctaButton(url, label, noteHtml) {
  const bottomMargin = noteHtml ? '10px' : '28px';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:${bottomMargin}">
  <tr>
    <td align="center">
      <a href="${url}" style="display:inline-block;padding:15px 40px;background:{{business.secondary_color}};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:.3px">${label}</a>
    </td>
  </tr>
</table>${noteHtml ? `\n<p style="margin:0 0 28px;text-align:center;font-size:13px;color:#718096">${noteHtml}</p>` : ''}`;
}

/** Thin horizontal rule */
function divider() {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0 24px">
  <tr><td style="border-top:1px solid #e8ecf0;font-size:1px;line-height:1px">&nbsp;</td></tr>
</table>`;
}

/** Standard help-line footer (inside body, above the card footer) */
function helpLine() {
  return `<p style="margin:0;font-size:13px;color:#a0aec0;line-height:1.8;text-align:center">
  Questions? Contact us at&nbsp;
  <a href="mailto:{{business.email}}" style="color:{{business.secondary_color}};text-decoration:none;font-weight:600">{{business.email}}</a>
  &ensp;&middot;&ensp;
  <a href="tel:{{business.phone}}" style="color:#718096;text-decoration:none">{{business.phone}}</a>
</p>`;
}

// =============================================================================
// Template definitions
// =============================================================================

const TEMPLATES = [

  // ── 1. Account Invitation ─────────────────────────────────────────────────
  {
    version: 3,
    slug:     'user_account_created',
    name:     'Account Invitation',
    category: 'System',
    channel:  'email',
    subject:  "You've been invited to {{business.name}}",
    body: wrapEmail(
      "You've been invited to join {{business.name}} — accept your invitation to get started.",
      `
${statusBanner('✉', 'You&rsquo;re Invited', '#ebf4ff', '#1a56db')}

<h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Welcome, {{contact.first_name}}!
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  You've been invited to join <strong style="color:#1a202c">{{business.name}}</strong>. Click the button below to set up your account — it only takes a minute.
</p>

${ctaButton('{{invite.accept_url}}', 'Accept Invitation &rarr;')}

<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#4a5568">Button not working?</p>
<p style="margin:0 0 24px;font-size:12px;color:#718096;line-height:1.6">Copy and paste this link into your browser:</p>
<div style="padding:12px 16px;background:#f7fafc;border:1px solid #e8ecf0;border-radius:6px;margin-bottom:28px">
  <a href="{{invite.accept_url}}" style="font-size:12px;font-family:'Courier New',monospace;color:{{business.secondary_color}};word-break:break-all;text-decoration:none">{{invite.accept_url}}</a>
</div>

${divider()}

<p style="margin:0;font-size:12px;color:#a0aec0;line-height:1.8;text-align:center">
  This invitation expires on <strong style="color:#718096">{{invite.expires_at}}</strong>.<br>
  If you did not expect this email, no action is needed — simply ignore it.
</p>
`
    ),
  },

  // ── 2. Invoice Sent ───────────────────────────────────────────────────────
  {
    version: 3,
    slug:     'invoice_sent',
    name:     'Invoice',
    category: 'System',
    channel:  'email',
    subject:  'Invoice {{invoice.invoice_number}} — ${{invoice.balance_due}} due {{invoice.due_date}}',
    body: wrapEmail(
      'Invoice {{invoice.invoice_number}} for ${{invoice.balance_due}} from {{business.name}} is ready for payment.',
      `
${statusBanner('&#9993;', 'Invoice Ready for Payment', '#ebf4ff', '#1a56db')}

<h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Invoice {{invoice.invoice_number}}
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  Hi {{contact.first_name}}, please find your invoice from <strong style="color:#1a202c">{{business.name}}</strong> below. You can view the full details and pay securely online.
</p>

${summaryTable([
  { label: 'Invoice #',   value: '{{invoice.invoice_number}}', bold: true },
  { label: 'Issue Date',  value: '{{invoice.issue_date}}' },
  { label: 'Due Date',    value: '{{invoice.due_date}}',    bold: true, color: '#c05621' },
  { label: 'Amount Due',  value: '$\{{invoice.balance_due}}', bold: true, large: true, color: '{{business.secondary_color}}' },
])}

${ctaButton(
  '{{invoice.pay_url}}',
  'View &amp; Pay Invoice',
  'or <a href="{{invoice.pay_url}}" style="color:{{business.secondary_color}};text-decoration:underline">view invoice details without paying</a>'
)}

${divider()}

${helpLine()}
`
    ),
  },

  // ── 3. Payment Receipt ────────────────────────────────────────────────────
  {
    version: 4,
    slug:     'payment_receipt',
    name:     'Payment Receipt',
    category: 'System',
    channel:  'email',
    subject:  'Payment Confirmed — Invoice {{invoice.invoice_number}}',
    body: wrapEmail(
      'Payment of ${{payment.amount}} received for invoice {{invoice.invoice_number}}. Thank you!',
      `
${statusBanner('&#10003;', 'Payment Confirmed', '#f0fff4', '#276749')}

<h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Thank you, {{contact.first_name}}!
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  We've received your payment. Your receipt is included below — you can also download a permanent copy using the button.
</p>

${summaryTable([
  { label: 'Invoice #',      value: '{{invoice.invoice_number}}', bold: true },
  { label: 'Amount Paid',    value: '$\{{payment.amount}}', bold: true, large: true, color: '#276749' },
  { label: 'Payment Method', value: '{{payment.method}}', capitalize: true },
  { label: 'Transaction ID', value: '{{payment.provider_txn_id}}', mono: true },
  { label: 'Date',           value: '{{payment.received_at}}' },
])}

${ctaButton('{{payment.receipt_url}}', 'Download Receipt')}

${divider()}

<p style="margin:0 0 20px;font-size:15px;font-weight:600;color:#276749;text-align:center">
  &#10003;&ensp;Your invoice is now settled. Thank you for your business!
</p>

<p style="margin:0 0 16px;font-size:14px;color:#4a5568;line-height:1.7;text-align:center">
  Want to see this alongside your full giving history and manage recurring gifts?
  <a href="{{portal.register_url}}" style="color:{{business.secondary_color}};font-weight:600;text-decoration:underline">Create your free account &rarr;</a>
</p>

${helpLine()}
`
    ),
  },

  // ── 4. Void Notice ────────────────────────────────────────────────────────
  {
    version: 3,
    slug:     'void_receipt',
    name:     'Void Notice',
    category: 'System',
    channel:  'email',
    subject:  'Invoice {{invoice.invoice_number}} Has Been Voided',
    body: wrapEmail(
      'Invoice {{invoice.invoice_number}} from {{business.name}} has been voided. No payment is required.',
      `
${statusBanner('&#8856;', 'Invoice Voided &mdash; No Payment Required', '#fffaf0', '#c05621')}

<h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Invoice Voided
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  Hi {{contact.first_name}}, this is a confirmation that the invoice below has been voided by <strong style="color:#1a202c">{{business.name}}</strong>. <strong>No payment is owed.</strong>
</p>

${summaryTable([
  { label: 'Invoice #',       value: '{{invoice.invoice_number}}', bold: true },
  { label: 'Original Amount', value: '$\{{invoice.total}}' },
  { label: 'Issue Date',      value: '{{invoice.issue_date}}' },
  { label: 'Status',          value: 'Voided', bold: true, color: '#c05621' },
])}

<div style="padding:14px 20px;background:#fffaf0;border:1px solid #fbd38d;border-radius:8px;margin-bottom:28px">
  <p style="margin:0;font-size:14px;color:#7b341e;line-height:1.7;text-align:center">
    <strong>No further action is required on your part.</strong><br>
    If you believe this void was made in error, please contact us right away.
  </p>
</div>

${divider()}

${helpLine()}
`
    ),
  },

  // ── 5. Refund Receipt ─────────────────────────────────────────────────────
  {
    version: 3,
    slug:     'refund_receipt',
    name:     'Refund Receipt',
    category: 'System',
    channel:  'email',
    subject:  'Refund of ${{payment.amount}} Processed — Invoice {{invoice.invoice_number}}',
    body: wrapEmail(
      'A refund of ${{payment.amount}} for invoice {{invoice.invoice_number}} has been processed.',
      `
${statusBanner('&#8617;', 'Refund Processed', '#ebf8ff', '#2b6cb0')}

<h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Your Refund is on the Way
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  Hi {{contact.first_name}}, we've processed a refund for the invoice below. Depending on your bank or card issuer, funds typically appear within <strong style="color:#2b6cb0">3&ndash;7 business days</strong>.
</p>

${summaryTable([
  { label: 'Invoice #',     value: '{{invoice.invoice_number}}', bold: true },
  { label: 'Refund Amount', value: '$\{{payment.amount}}', bold: true, large: true, color: '#2b6cb0' },
  { label: 'Processed On',  value: '{{payment.received_at}}' },
  { label: 'Est. Timeline', value: '3&ndash;7 business days', bold: true },
])}

<div style="padding:14px 20px;background:#ebf8ff;border:1px solid #bee3f8;border-radius:8px;margin-bottom:28px">
  <p style="margin:0;font-size:14px;color:#2b6cb0;line-height:1.7;text-align:center">
    &#8617;&ensp;<strong>Refunds typically appear within 3–7 business days</strong> depending on your financial institution. Processing times may vary.
  </p>
</div>

${divider()}

${helpLine()}
`
    ),
  },

  // ── 6. Donation Receipt ───────────────────────────────────────────────────
  {
    version: 1,
    slug:     'donation_receipt',
    name:     'Donation Receipt',
    category: 'Fundraising',
    channel:  'email',
    subject:  'Thank You for Your Gift to {{donation.fund_name}}',
    body: wrapEmail(
      'Thank you for your generous gift of ${{payment.amount}} to {{donation.fund_name}}.',
      `
${statusBanner('&#10084;', 'Gift Received', '#fff5f5', '#c53030')}

<h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Thank you, {{contact.first_name}}!
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  Your generosity makes our work possible. Here is your receipt for this gift to <strong style="color:#1a202c">{{donation.fund_name}}</strong>.
</p>

${summaryTable([
  { label: 'Fund',            value: '{{donation.fund_name}}', bold: true },
  { label: 'Gift Amount',     value: '$\{{payment.amount}}', bold: true, large: true, color: '#c53030' },
  { label: 'Tax-Deductible',  value: '$\{{donation.deductible_amount}}' },
  { label: 'Date',            value: '{{payment.received_at}}' },
])}

<div style="padding:14px 20px;background:#f7fafc;border:1px solid #e8ecf0;border-radius:8px;margin-bottom:28px">
  <p style="margin:0;font-size:13px;color:#4a5568;line-height:1.7;text-align:center">
    No goods or services were provided in exchange for this gift beyond the value noted above, unless otherwise stated. {{business.name}} is a tax-exempt organization, EIN {{business.tax_ein}}. Please retain this receipt for your tax records.
  </p>
</div>

${ctaButton('{{payment.receipt_url}}', 'Download Receipt')}

${divider()}

<p style="margin:0 0 16px;font-size:14px;color:#4a5568;line-height:1.7;text-align:center">
  See your full giving history and manage recurring gifts anytime.
  <a href="{{portal.register_url}}" style="color:{{business.secondary_color}};font-weight:600;text-decoration:underline">Create your free account &rarr;</a>
</p>

${helpLine()}
`
    ),
  },

  // ── 7. Membership Renewed ─────────────────────────────────────────────────
  {
    version: 1,
    slug:     'membership_renewed',
    name:     'Membership Renewed',
    category: 'Fundraising',
    channel:  'email',
    subject:  'Your {{membership.tier_name}} Membership Was Renewed',
    body: wrapEmail(
      'Your {{membership.tier_name}} membership was renewed for ${{payment.amount}}.',
      `
${statusBanner('&#10003;', 'Membership Renewed', '#f0fff4', '#276749')}

<h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Thanks for staying a member, {{contact.first_name}}!
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  Your <strong style="color:#1a202c">{{membership.tier_name}}</strong> membership with {{business.name}} has been renewed.
</p>

${summaryTable([
  { label: 'Membership Tier', value: '{{membership.tier_name}}', bold: true },
  { label: 'Amount Charged',  value: '$\{{payment.amount}}', bold: true, large: true, color: '#276749' },
  { label: 'Payment Method',  value: '{{payment.method}}', capitalize: true },
  { label: 'Next Renewal',    value: '{{membership.next_run_date}}' },
])}

${ctaButton('{{payment.receipt_url}}', 'Download Receipt')}

${divider()}

<p style="margin:0 0 16px;font-size:14px;color:#4a5568;line-height:1.7;text-align:center">
  Manage your membership and view past charges anytime.
  <a href="{{portal.register_url}}" style="color:{{business.secondary_color}};font-weight:600;text-decoration:underline">Create your free account &rarr;</a>
</p>

${helpLine()}
`
    ),
  },

  // ── 8. Donor Portal Welcome (admin-granted access) ───────────────────────
  {
    version: 1,
    slug:     'donor_portal_welcome',
    name:     'Donor Portal Welcome',
    category: 'Fundraising',
    channel:  'email',
    subject:  'Your {{business.name}} Portal Access Is Ready',
    body: wrapEmail(
      'Your donor portal account is ready — sign in to view your giving history and manage recurring gifts.',
      `
${statusBanner('&#128273;', 'Portal Access Ready', '#ebf4ff', '#1a56db')}

<h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Welcome, {{contact.first_name}}!
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  Your donor portal for <strong style="color:#1a202c">{{business.name}}</strong> is ready. From your portal you can view your giving history, download receipts, and manage recurring gifts.
</p>

${ctaButton('{{portal.login_url}}', 'Sign In &rarr;')}

${summaryTable([
  { label: 'Email',    value: '{{contact.email}}' },
  { label: 'Password', value: '{{portal.temp_password}}', mono: true },
])}

<p style="margin:0 0 24px;font-size:12px;color:#718096;line-height:1.6;text-align:center">Please change your password after signing in.</p>

${divider()}

${helpLine()}
`
    ),
  },

  // ── 9. Donor Portal Email Verification (self-registration) ───────────────
  {
    version: 1,
    slug:     'donor_portal_verify_email',
    name:     'Donor Portal Email Verification',
    category: 'Fundraising',
    channel:  'email',
    subject:  'Verify Your Email to Finish Setting Up Your Account',
    body: wrapEmail(
      'Confirm your email to finish setting up your donor portal account.',
      `
${statusBanner('&#9993;', 'Confirm Your Email', '#ebf4ff', '#1a56db')}

<h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Almost there, {{contact.first_name}}!
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  Confirm your email address to finish setting up your {{business.name}} donor portal account.
</p>

${ctaButton('{{portal.verify_url}}', 'Verify Email &rarr;')}

${divider()}

<p style="margin:0;font-size:12px;color:#a0aec0;line-height:1.8;text-align:center">
  This link expires in 24 hours.<br>
  If you did not create this account, no action is needed — simply ignore it.
</p>
`
    ),
  },

  // ── 10. Membership Renewal Reminder (automation example) ─────────────────
  {
    version: 1,
    slug:     'membership_renewal_reminder',
    name:     'Membership Renewal Reminder',
    category: 'Fundraising',
    channel:  'email',
    subject:  'Your {{membership.tier_name}} Membership Renews Soon',
    body: wrapEmail(
      'Your {{membership.tier_name}} membership renews on {{membership.next_run_date}}.',
      `
${statusBanner('&#128337;', 'Renewal Coming Up', '#fffaf0', '#c05621')}

<h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Your membership renews soon
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  Hi {{contact.first_name}}, just a heads up — your <strong style="color:#1a202c">{{membership.tier_name}}</strong> membership with {{business.name}} will renew automatically on <strong style="color:#c05621">{{membership.next_run_date}}</strong>.
</p>

<p style="margin:0 0 24px;font-size:14px;color:#4a5568;line-height:1.7;text-align:center">
  No action is needed if you'd like to continue — your card on file will be charged automatically. Want to make changes first?
  <a href="{{portal.register_url}}" style="color:{{business.secondary_color}};font-weight:600;text-decoration:underline">Manage your membership &rarr;</a>
</p>

${divider()}

${helpLine()}
`
    ),
  },

  // ── 11. Post-Gift Thank-You Follow-Up (automation example) ───────────────
  {
    version: 1,
    slug:     'donation_followup_thankyou',
    name:     'Post-Gift Thank-You Follow-Up',
    category: 'Fundraising',
    channel:  'email',
    subject:  'The Difference Your Gift Makes',
    body: wrapEmail(
      'A quick note about the impact of your recent gift.',
      `
<h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  {{contact.first_name}}, thank you again
</h1>
<p style="margin:0 0 24px;font-size:15px;color:#4a5568;line-height:1.7">
  We wanted to follow up on your recent gift to <strong style="color:#1a202c">{{donation.fund_name}}</strong> with a quick word about the impact it makes. Supporters like you are the reason we can keep showing up for our community.
</p>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  If you ever have questions about where your gift goes, or want to get more involved, just reply to this email — we'd love to hear from you.
</p>

${divider()}

${helpLine()}
`
    ),
  },

  // ── 12. Pledge Installment Reminder (automation example) ─────────────────
  {
    version: 1,
    slug:     'pledge_installment_reminder',
    name:     'Pledge Installment Reminder',
    category: 'Fundraising',
    channel:  'email',
    subject:  'Your Pledge Installment to {{pledge.fund_name}} Is Coming Up',
    body: wrapEmail(
      'Your next pledge installment to {{pledge.fund_name}} is due soon.',
      `
${statusBanner('&#128337;', 'Installment Coming Up', '#fffaf0', '#c05621')}

<h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Your next pledge installment is coming up
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  Hi {{contact.first_name}}, just a heads up — your next installment of
  <strong style="color:#c05621">$\{{pledge.amount}}</strong> toward your pledge to
  <strong style="color:#1a202c">{{pledge.fund_name}}</strong> is due on
  <strong style="color:#c05621">{{pledge.due_date}}</strong>.
</p>

<p style="margin:0 0 24px;font-size:14px;color:#4a5568;line-height:1.7;text-align:center">
  If you have a payment method on file, no action is needed — it will be charged automatically. Want to check on your pledge or make changes?
  <a href="{{portal.register_url}}" style="color:{{business.secondary_color}};font-weight:600;text-decoration:underline">Manage your giving &rarr;</a>
</p>

${divider()}

${helpLine()}
`
    ),
  },

  // ── 13. Volunteer Compliance Expiring (automation example) ───────────────
  {
    version: 1,
    slug:     'volunteer_compliance_expiring',
    name:     'Volunteer Compliance Expiring',
    category: 'Fundraising',
    channel:  'email',
    subject:  'Your {{compliance.type}} Is Expiring Soon',
    body: wrapEmail(
      'Your volunteer compliance item is expiring soon — please renew it.',
      `
${statusBanner('&#9888;', 'Renewal Needed', '#fffaf0', '#c05621')}

<h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Time to renew your {{compliance.type}}
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  Hi {{contact.first_name}}, your <strong style="color:#1a202c">{{compliance.type}}</strong> on file with
  {{business.name}} expires on <strong style="color:#c05621">{{compliance.expiry_date}}</strong>. Please renew it
  soon so you can keep volunteering without interruption.
</p>

${divider()}

${helpLine()}
`
    ),
  },

  // ── 14. Password Reset ────────────────────────────────────────────────────
  // Sent by POST /api/auth/forgot-password to staff and portal users alike.
  // It used to be hand-written inline in routes/auth.js with the boilerplate
  // product's name and colour baked in; as a template it inherits this org's
  // logo, colours and footer like every other system email. The recipient
  // isn't necessarily a CRM contact, so the route passes contact.first_name /
  // contact.email and reset.url through renderBySlug()'s `extra` argument.
  {
    version: 1,
    slug:     'password_reset',
    name:     'Password Reset',
    category: 'System',
    channel:  'email',
    subject:  'Reset your {{business.name}} password',
    body: wrapEmail(
      'Use the link inside to choose a new password. It expires in 1 hour.',
      `
${statusBanner('&#128274;', 'Password Reset', '#ebf4ff', '#1a56db')}

<h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:#1a202c;letter-spacing:-.3px;line-height:1.2">
  Hi {{contact.first_name}},
</h1>
<p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.7">
  We received a request to reset the password for your <strong style="color:#1a202c">{{business.name}}</strong> account.
</p>

${ctaButton('{{reset.url}}', 'Reset Password &rarr;', 'This link expires in <strong>1 hour</strong>.')}

<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#4a5568">Button not working?</p>
<p style="margin:0 0 12px;font-size:12px;color:#718096;line-height:1.6">Copy and paste this link into your browser:</p>
<div style="padding:12px 16px;background:#f7fafc;border:1px solid #e8ecf0;border-radius:6px;margin-bottom:28px">
  <a href="{{reset.url}}" style="font-size:12px;font-family:'Courier New',monospace;color:{{business.secondary_color}};word-break:break-all;text-decoration:none">{{reset.url}}</a>
</div>

${divider()}

<p style="margin:0;font-size:12px;color:#a0aec0;line-height:1.8;text-align:center">
  If you didn't request a password reset, you can safely ignore this email — your password won't change.
</p>
`
    ),
  },

];

// =============================================================================
// Seeder — insert (first run) or update (version bump) system templates
// =============================================================================

async function seedSystemTemplates() {
  for (const tpl of TEMPLATES) {
    const tplVersion = tpl.version || 1;

    const [[existing]] = await db.query(
      'SELECT id, seeder_version FROM message_templates WHERE slug = :slug LIMIT 1',
      { slug: tpl.slug }
    );

    if (!existing) {
      const [ins] = await db.query(
        `INSERT INTO message_templates
           (channel, name, slug, category, subject, body, merge_fields,
            is_active, is_system, seeder_version, created_by)
         VALUES
           (:channel, :name, :slug, :category, :subject, :body, NULL,
            1, 1, :seeder_version, NULL)`,
        {
          channel:        tpl.channel,
          name:           tpl.name,
          slug:           tpl.slug,
          category:       tpl.category,
          subject:        tpl.subject,
          body:           tpl.body,
          seeder_version: tplVersion,
        }
      );
      // eslint-disable-next-line no-console
      console.log(`[templateSeeder] seeded "${tpl.slug}" → id=${ins.insertId}`);
      continue;
    }

    const storedVersion = Number(existing.seeder_version || 0);
    if (storedVersion >= tplVersion) {
      // eslint-disable-next-line no-console
      console.log(`[templateSeeder] "${tpl.slug}" up-to-date (v${storedVersion})`);
      continue;
    }

    // Stored version is older — re-apply canonical subject + body.
    // is_active is left untouched so admin enable/disable choices survive.
    await db.query(
      `UPDATE message_templates
          SET subject        = :subject,
              body           = :body,
              seeder_version = :seeder_version
        WHERE id = :id`,
      {
        subject:        tpl.subject,
        body:           tpl.body,
        seeder_version: tplVersion,
        id:             existing.id,
      }
    );
    // eslint-disable-next-line no-console
    console.log(`[templateSeeder] updated "${tpl.slug}" v${storedVersion} → v${tplVersion}`);
  }
}

module.exports = { seedSystemTemplates };
