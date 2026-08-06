// =============================================================================
// Payment receipts — loads receipt data, renders HTML view + PDF buffer.
// -----------------------------------------------------------------------------
// Two output formats share one data-loader so the PDF and the web view
// never drift apart.
// =============================================================================
const PDFDocument = require('pdfkit');
const { db } = require('../db');
const { resolveBusinessLogoUrl, renderBySlug, classifyPayment } = require('./templates');
const { sendMail } = require('./mailer');
const moduleSettings = require('./moduleSettings');

// --------- brand (business_settings + Media Library) ---------
//
// Pulled fresh per receipt render rather than cached at module load, so an
// org's name/logo/EIN edited in Settings shows up on the very next receipt.
// Logo resolution is shared with templates.js's resolveBusinessLogoUrl(),
// which already handles both ways a logo gets set (direct upload vs. Media
// Library picker) and returns something a browser can load directly: a
// base64 data URI for local storage, or a public/signed URL otherwise.
//
// PDFKit's doc.image() needs actual bytes, not a URL, so logoUrlToBuffer()
// below decodes the data URI locally or fetches the URL once — resolved
// eagerly in the async data loaders (loadReceiptData*/loadYearEndStatementData)
// and cached on `company.logo_buffer` so the (synchronous) PDF renderers
// never need to know how the logo was actually stored.
async function resolveBusinessBranding() {
  const [[biz]] = await db.query(
    `SELECT business_name, tax_ein, logo_web_url, logo_web_storage_key, logo_web_storage_driver
       FROM business_settings WHERE id = 1`
  );
  let logoUrl = '';
  try { if (biz) logoUrl = await resolveBusinessLogoUrl(biz); } catch (_e) { /* logo optional */ }
  return { name: biz?.business_name || '', taxEin: biz?.tax_ein || '', logoUrl };
}

async function logoUrlToBuffer(logoUrl) {
  if (!logoUrl) return null;
  try {
    if (logoUrl.startsWith('data:')) {
      const base64 = logoUrl.split(',')[1];
      return base64 ? Buffer.from(base64, 'base64') : null;
    }
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (_e) {
    return null;
  }
}

// --------- data ---------
//
// Two lookup forms share the same loader body:
//   loadReceiptData(paymentId)         - by sequential id (admin-side use)
//   loadReceiptDataByToken(token)      - by random receipt_token (public URLs)
//
// Public URLs MUST go through the token form so an attacker can't enumerate
// receipts with `/public/receipt/1`, `/public/receipt/2`, ... — the token is
// 256 bits of randomness so guessing one is infeasible.
async function loadReceiptDataInternal(where, params) {
  const [[payment]] = await db.query(
    `SELECT p.*, i.invoice_number, i.currency, i.total AS invoice_total,
            i.subtotal AS invoice_subtotal, i.tax_amount AS invoice_tax,
            i.amount_paid AS invoice_amount_paid, i.balance_due AS invoice_balance,
            i.memo AS invoice_memo, i.issue_date, i.due_date,
            i.contact_id, i.organization_id,
            CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name,
            c.email AS contact_email, c.phone AS contact_phone,
            o.name AS organization_name,
            o.address_line1 AS org_addr1, o.address_line2 AS org_addr2,
            o.city AS org_city, o.state AS org_state, o.postal_code AS org_zip,
            d.id AS donation_id, d.is_in_kind, d.in_kind_description, d.quid_pro_quo_value,
            d.dedication_note AS donation_note, d.is_anonymous AS donation_anonymous,
            f.name AS fund_name
       FROM payments p
       JOIN invoices i      ON i.id = p.invoice_id
       LEFT JOIN contacts c      ON c.id = i.contact_id
       LEFT JOIN organizations o ON o.id = i.organization_id
       LEFT JOIN donations d     ON d.payment_id = p.id
       LEFT JOIN funds f         ON f.id = d.fund_id
      WHERE ${where}`,
    params);
  if (!payment) return null;

  const [lines] = await db.query(
    `SELECT id, description, quantity, unit_price, amount
       FROM invoice_line_items WHERE invoice_id = :id ORDER BY sort_order, id`,
    { id: payment.invoice_id });

  // Compute the *principal*-based balance on the fly so the receipt math is
  // correct even if invoices.balance_due hasn't been refreshed yet (or was
  // refreshed using the gross-amount formula that pre-dated the fee split).
  //
  //   principal = payment.amount - payment.fee_amount        (per row)
  //   principals_paid = SUM of principal for non-failed payments
  //   effective_balance = max(0, invoice.total - principals_paid)
  //
  // Note on `pending`: in local dev (and during the brief window between a
  // gateway callback redirect and the webhook arriving), a payment can sit
  // in `pending` even though the customer was charged. The receipt is itself
  // a claim that the charge happened, so we include `pending` in the credited
  // sum here. We deliberately stay narrower in routes/payments.js's invoice
  // refresh helper, which only credits `authorized` + `captured` because that
  // value lives in the DB long-term.
  const [[balRow]] = await db.query(
    `SELECT COALESCE(SUM(p2.amount - COALESCE(p2.fee_amount, 0)), 0) AS principals_paid
       FROM payments p2
      WHERE p2.invoice_id = :id
        AND p2.status IN ('captured','authorized','pending')`,
    { id: payment.invoice_id });
  const principalsPaid = Number(balRow?.principals_paid || 0);
  payment._principals_paid   = Math.round(principalsPaid * 100) / 100;
  payment._effective_balance = Math.max(
    0,
    Math.round((Number(payment.invoice_total) - principalsPaid) * 100) / 100,
  );

  // Merchant/company info: business_settings is the source of truth for the
  // org's real name/logo/EIN; smtp_settings only fills in the sender email
  // (and the name, as a last resort if business_settings.business_name is
  // somehow blank).
  const branding = await resolveBusinessBranding();
  let company = {
    name: branding.name || 'Our Organization',
    from_email: 'noreply@example.org',
    tax_ein: branding.taxEin,
    logo_url: branding.logoUrl,
    logo_buffer: await logoUrlToBuffer(branding.logoUrl),
  };
  try {
    const [[smtp]] = await db.query(
      'SELECT from_name, from_email FROM smtp_settings WHERE is_active = 1 ORDER BY id DESC LIMIT 1');
    if (smtp) {
      company.from_email = smtp.from_email || company.from_email;
      if (!branding.name && smtp.from_name) company.name = smtp.from_name;
    }
  } catch (_e) { /* table missing is fine */ }

  return { payment, lines, company };
}

async function loadReceiptData(paymentId) {
  return loadReceiptDataInternal('p.id = :id', { id: paymentId });
}
async function loadReceiptDataByToken(token) {
  // Defense-in-depth: only accept canonical hex tokens of the right length.
  // This prevents wildcard-like inputs from sneaking past our placeholder.
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
    return null;
  }
  return loadReceiptDataInternal('p.receipt_token = :tok', { tok: token.toLowerCase() });
}

// --------- HTML render ---------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtMoney(n, cur = 'USD') {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(v);
  } catch (_e) {
    return `$${v.toFixed(2)}`;
  }
}

// IRS-relevant donation acknowledgment language. Only shown when this
// payment is tagged with a `donations` row (see db/migrations/039, 044) —
// regular invoice receipts are untouched.
function donationTaxNote(payment) {
  if (!payment.donation_id) return null;
  const cur = payment.currency;
  if (payment.is_in_kind) {
    return {
      heading: 'In-Kind Gift Acknowledgment',
      lines: [
        `This acknowledges receipt of a non-cash (in-kind) gift described as: ${payment.in_kind_description || 'goods/services'}.`,
        'No goods or services were provided in exchange for this contribution, unless otherwise noted.',
        'The stated value reflects fair market value as provided by the donor — please consult your tax advisor to determine your deductible amount.',
      ],
    };
  }
  const qpq = Number(payment.quid_pro_quo_value || 0);
  const deductible = Math.max(0, Number(payment.amount) - qpq);
  const lines = [];
  if (qpq > 0) {
    lines.push(`In consideration of your gift, you received goods or services valued at ${fmtMoney(qpq, cur)}.`);
    lines.push(`The tax-deductible portion of your contribution is ${fmtMoney(deductible, cur)}.`);
  } else {
    lines.push('No goods or services were provided in exchange for this contribution, in whole or in part.');
    lines.push(`This gift is fully tax-deductible to the extent allowed by law: ${fmtMoney(payment.amount, cur)}.`);
  }
  return { heading: 'Charitable Gift Acknowledgment', lines };
}

// Receipt state helpers — gateway status → visible label + colors.
// A receipt is valid the moment the gateway accepts the transaction; settlement
// just changes the wording. `pending` = authorized, waiting for overnight batch.
function receiptState(status) {
  const s = String(status || '').toLowerCase();
  if (['captured','approved','completed','success','paid'].includes(s)) {
    return { label: 'PAID', bg: '#d1e7dd', fg: '#0f5132',
             subline: 'Payment has settled.', totalLabel: 'Paid this receipt' };
  }
  if (s === 'authorized') {
    return { label: 'AUTHORIZED', bg: '#cfe2ff', fg: '#084298',
             subline: 'Authorized — will settle in the next batch.',
             totalLabel: 'Authorized amount' };
  }
  if (s === 'pending') {
    return { label: 'AUTHORIZED · PENDING SETTLEMENT', bg: '#fff3cd', fg: '#664d03',
             subline: 'Transaction approved. Settlement will occur in the next merchant batch.',
             totalLabel: 'Authorized amount' };
  }
  if (s === 'refunded') {
    return { label: 'REFUNDED', bg: '#f8d7da', fg: '#842029',
             subline: 'This payment has been refunded.',
             totalLabel: 'Refunded amount' };
  }
  if (s === 'voided' || s === 'cancelled') {
    return { label: 'VOIDED', bg: '#e2e3e5', fg: '#41464b',
             subline: 'This payment has been voided.',
             totalLabel: 'Voided amount' };
  }
  if (s === 'failed') {
    return { label: 'FAILED', bg: '#f8d7da', fg: '#842029',
             subline: 'This payment did not complete.',
             totalLabel: 'Attempted amount' };
  }
  return { label: (status || 'RECORDED').toString().toUpperCase(),
           bg: '#e2e3e5', fg: '#41464b',
           subline: '', totalLabel: 'Amount' };
}

function renderReceiptHtml({ payment, lines, company }) {
  const taxNote = donationTaxNote(payment);
  const receiptNo = `RCPT-${String(payment.id).padStart(6, '0')}`;
  const txDate = payment.received_at || payment.created_at;
  const customerName = payment.contact_name || payment.organization_name || '—';
  const addrLines = [];
  if (payment.org_addr1) addrLines.push(payment.org_addr1);
  if (payment.org_addr2) addrLines.push(payment.org_addr2);
  if (payment.org_city || payment.org_state || payment.org_zip) {
    addrLines.push([payment.org_city, payment.org_state, payment.org_zip].filter(Boolean).join(', '));
  }

  const gatewayLabel = {
    valor:   'Valor PayTech',
    authnet: 'Authorize.Net',
  }[payment.gateway] || payment.gateway || '—';

  const state = receiptState(payment.status);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Receipt ${receiptNo}</title>
<style>
  :root { --brand: #F05523; --ink: #212529; --muted: #6c757d; --line: #e5e7eb; }
  * { box-sizing: border-box; }
  /* print-color-adjust forces backgrounds (state pill, brand bar) to render in
     "Save as PDF" — without it Chrome/Safari strip them by default. */
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         color: var(--ink); margin: 0; background: #FAF5F0; }
  .wrap { max-width: 760px; margin: 24px auto; background: #fff; padding: 32px 40px;
          box-shadow: 0 1px 3px rgba(0,0,0,.08); border-radius: 8px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 2px solid var(--brand); }
  h1 { font-size: 28px; margin: 0; color: var(--brand); letter-spacing: .5px; }
  .muted { color: var(--muted); font-size: 14px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px; }
  .grid h6 { text-transform: uppercase; font-size: 11px; letter-spacing: 1px; color: var(--muted); margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  th, td { padding: 10px 8px; text-align: left; border-bottom: 1px solid var(--line); }
  th { font-size: 12px; text-transform: uppercase; color: var(--muted); letter-spacing: .5px; font-weight: 600; }
  td.r, th.r { text-align: right; }
  .totals { margin-top: 16px; margin-left: auto; width: 320px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .amt-row { font-size: 20px; font-weight: 700; margin-top: 8px; padding-top: 8px; border-top: 2px solid var(--line); }
  .badge-state { display: inline-block; padding: 4px 12px; border-radius: 999px; font-weight: 600; font-size: 12px; letter-spacing: .5px; text-transform: uppercase; }
  .state-note { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); text-align: center; }
  .actions-bar { max-width: 760px; margin: 12px auto 0; display: flex; gap: 8px; justify-content: flex-end; }
  .btn-bar { background: var(--brand); color: #fff; border: 0; padding: 8px 16px; border-radius: 4px; cursor: pointer; font: inherit; text-decoration: none; display: inline-block; }
  .btn-bar.secondary { background: #fff; color: var(--ink); border: 1px solid var(--line); }
  /* Predictable margins for "Save as PDF" — without @page the user's last-used
     margin preset gets used, which often clips the brand bar on Letter. */
  @page { size: letter; margin: 0.5in; }
  @media (max-width: 600px) {
    .wrap { padding: 16px; margin: 0; border-radius: 0; box-shadow: none; }
    .actions-bar { margin: 8px; }
    header { flex-direction: column; gap: 12px; }
    header > div:last-child { text-align: left; }
    .grid { grid-template-columns: 1fr; }
    .totals { width: 100%; }
    th, td { padding: 8px 4px; font-size: 13px; }
    h1 { font-size: 22px; }
    .btn-bar { padding: 8px 12px; font-size: 14px; }
  }
  @media print {
    body { background: #fff; }
    .wrap { box-shadow: none; margin: 0; max-width: none; padding: 0; border-radius: 0; }
    .noprint { display: none !important; }
    /* Avoid rows splitting across pages, and keep the header pinned to its content. */
    tr, .totals .row { page-break-inside: avoid; break-inside: avoid; }
    header { page-break-after: avoid; break-after: avoid; }
  }
</style>
</head>
<body>
  <div class="actions-bar noprint">
    <a class="btn-bar secondary" href="${escapeHtml(receiptNo)}" onclick="event.preventDefault(); window.print();">
      Print
    </a>
    <a class="btn-bar" href="/api/payments/public/receipt/by-token/${escapeHtml(payment.receipt_token || '')}.pdf" download="receipt-${escapeHtml(payment.invoice_number)}-${payment.id}.pdf">
      Download PDF
    </a>
  </div>
  <div class="wrap">
    <header>
      <div>
        ${company.logo_url ? `<img src="${company.logo_url}" alt="${escapeHtml(company.name)}" style="height:48px;width:auto;display:block;margin-bottom:12px;" />` : ''}
        <h1>Receipt</h1>
        <div class="muted">${escapeHtml(receiptNo)}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-weight:600;font-size:16px;">${escapeHtml(company.name)}</div>
        <div class="muted">${escapeHtml(company.from_email || '')}</div>
        <div style="margin-top:8px;">
          <span class="badge-state" style="background:${state.bg};color:${state.fg};">${escapeHtml(state.label)}</span>
        </div>
        ${state.subline ? `<div class="state-note">${escapeHtml(state.subline)}</div>` : ''}
      </div>
    </header>

    <div class="grid">
      <div>
        <h6>Billed to</h6>
        <div style="font-weight:600;">${escapeHtml(customerName)}</div>
        ${payment.contact_email ? `<div class="muted">${escapeHtml(payment.contact_email)}</div>` : ''}
        ${addrLines.map((l) => `<div class="muted">${escapeHtml(l)}</div>`).join('')}
      </div>
      <div>
        <h6>Payment Details</h6>
        <div><strong>Date:</strong> ${txDate ? new Date(txDate).toLocaleString() : '—'}</div>
        <div><strong>Method:</strong> ${escapeHtml(payment.method || 'card')}</div>
        <div><strong>Card:</strong> ${payment.card_brand ? escapeHtml(payment.card_brand) : '—'}${payment.card_last4 ? ` ****${escapeHtml(payment.card_last4)}` : ''}</div>
        <div><strong>Gateway:</strong> ${escapeHtml(gatewayLabel)}</div>
        <div><strong>Txn ID:</strong> ${payment.external_txn_id ? `<span class="muted">${escapeHtml(payment.external_txn_id)}</span>` : '—'}</div>
        ${payment.external_auth_code ? `<div><strong>Auth Code:</strong> <span class="muted">${escapeHtml(payment.external_auth_code)}</span></div>` : ''}
        <div><strong>Invoice:</strong> ${escapeHtml(payment.invoice_number)}</div>
        <div><strong>Status:</strong> ${escapeHtml(state.label)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr><th>Description</th><th class="r" style="width:80px;">Qty</th><th class="r" style="width:110px;">Unit</th><th class="r" style="width:110px;">Amount</th></tr>
      </thead>
      <tbody>
        ${(lines || []).map((l) => `<tr>
          <td>${escapeHtml(l.description)}</td>
          <td class="r">${Number(l.quantity)}</td>
          <td class="r">${fmtMoney(l.unit_price, payment.currency)}</td>
          <td class="r"><strong>${fmtMoney(l.amount, payment.currency)}</strong></td>
        </tr>`).join('')}
        ${(!lines || lines.length === 0) ? '<tr><td colspan="4" class="muted">—</td></tr>' : ''}
      </tbody>
    </table>

    <div class="totals">
      <div class="row"><span>Invoice subtotal</span><strong>${fmtMoney(payment.invoice_subtotal, payment.currency)}</strong></div>
      ${Number(payment.invoice_tax) > 0 ? `<div class="row"><span>Tax</span><strong>${fmtMoney(payment.invoice_tax, payment.currency)}</strong></div>` : ''}
      <div class="row"><span>Invoice total</span><strong>${fmtMoney(payment.invoice_total, payment.currency)}</strong></div>
      ${Number(payment.fee_amount) > 0
        ? `<div class="row"><span>${escapeHtml(payment.fee_label || 'Processing Fee')}</span><strong>+ ${fmtMoney(payment.fee_amount, payment.currency)}</strong></div>`
        : ''}
      <div class="row amt-row" style="color:${state.fg};"><span>${escapeHtml(state.totalLabel)}</span><strong>${fmtMoney(payment.amount, payment.currency)}</strong></div>
      ${Number(payment._effective_balance) > 0
        ? `<div class="row" style="color:#dc3545;"><span>Remaining balance</span><strong>${fmtMoney(payment._effective_balance, payment.currency)}</strong></div>`
        : ''}
    </div>

    ${payment.invoice_memo ? `<div style="margin-top:24px;padding:12px;background:#f8f9fa;border-radius:4px;font-size:14px;"><strong>Note:</strong> ${escapeHtml(payment.invoice_memo)}</div>` : ''}

    ${taxNote ? `<div style="margin-top:24px;padding:16px;background:#fff8ee;border:1px solid #f0dcb8;border-radius:4px;font-size:13px;">
      <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(taxNote.heading)}</div>
      ${payment.fund_name ? `<div style="margin-bottom:4px;"><strong>Designated to:</strong> ${escapeHtml(payment.fund_name)}</div>` : ''}
      ${payment.donation_note ? `<div style="margin-bottom:4px;"><strong>Dedication:</strong> ${escapeHtml(payment.donation_note)}</div>` : ''}
      ${taxNote.lines.map((l) => `<div style="margin-top:4px;">${escapeHtml(l)}</div>`).join('')}
      ${company.tax_ein ? `<div style="margin-top:8px;color:${'#6c757d'};">${escapeHtml(company.name)} is a tax-exempt organization. Tax ID (EIN): ${escapeHtml(company.tax_ein)}.</div>` : ''}
    </div>` : ''}

    <div class="footer">
      Thank you for your business. Retain this receipt for your records.<br/>
      Questions? Contact ${escapeHtml(company.from_email || company.name)}.
    </div>
  </div>
</body>
</html>`;
}

// --------- PDF render ---------
async function renderReceiptPdf({ payment, lines, company }) {
  const taxNote = donationTaxNote(payment);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const brand = '#F05523';
    const ink = '#212529';
    const muted = '#6c757d';
    const receiptNo = `RCPT-${String(payment.id).padStart(6, '0')}`;
    const txDate = payment.received_at || payment.created_at;
    const customerName = payment.contact_name || payment.organization_name || '—';
    const gatewayLabel = {
      valor:   'Valor PayTech',
      authnet: 'Authorize.Net',
    }[payment.gateway] || payment.gateway || '—';
    const state = receiptState(payment.status);

    // --- Header ---
    const rightX = doc.page.width - doc.page.margins.right;
    const leftX = 48;

    // Brand logo at top-left. PDFKit honours the PNG aspect ratio when only
    // height is set, so a 400x100 source becomes 144x36 here. We keep things
    // forgiving: if the logo file is missing, we just don't draw it and the
    // "Receipt" title slides back up to its old position.
    const logoH = 36;
    let titleY = 48;
    if (company.logo_buffer) {
      try {
        doc.image(company.logo_buffer, leftX, 48, { height: logoH });
        titleY = 48 + logoH + 12;
      } catch (_e) { /* corrupt/unsupported image — fall through with default titleY */ }
    }

    doc.fillColor(brand).fontSize(26).font('Helvetica-Bold').text('Receipt', leftX, titleY);
    doc.fillColor(muted).fontSize(10).font('Helvetica').text(receiptNo, leftX);

    // Company block (right aligned). Stays anchored to the top-right so the
    // logo on the left and the company text on the right form a balanced
    // brand bar. The state pill sits just under the company text.
    doc.fillColor(ink).fontSize(12).font('Helvetica-Bold')
       .text(company.name || 'Company', 0, 48, { align: 'right' });
    if (company.from_email) {
      doc.fillColor(muted).fontSize(10).font('Helvetica')
         .text(company.from_email, 0, 64, { align: 'right' });
    }
    // State pill — width scales with label length.
    const pillLabel = state.label;
    const pillFontSize = pillLabel.length > 12 ? 8 : 10;
    doc.fontSize(pillFontSize).font('Helvetica-Bold');
    const pillW = Math.max(58, doc.widthOfString(pillLabel) + 16);
    const pillH = 18;
    const pillX = rightX - pillW;
    const pillY = 82;
    doc.save().fillColor(state.bg).roundedRect(pillX, pillY, pillW, pillH, 9).fill().restore();
    doc.fillColor(state.fg).fontSize(pillFontSize).font('Helvetica-Bold').text(pillLabel, pillX, pillY + 5, { width: pillW, align: 'center' });
    if (state.subline) {
      doc.fillColor(muted).fontSize(8).font('Helvetica').text(state.subline, pillX - 160, pillY + pillH + 4, { width: pillW + 160, align: 'right' });
    }

    // Orange separator — sits below whichever side reaches further down
    // (left = logo + title block, right = company block + state pill).
    const leftBottom  = titleY + 26 + 10 + 6;            // h1 + receiptNo + breathing
    const rightBottom = pillY + pillH + (state.subline ? 18 : 0);
    const separatorY = Math.max(leftBottom, rightBottom) + 8;
    doc.moveTo(leftX, separatorY).lineTo(rightX, separatorY).lineWidth(2).strokeColor(brand).stroke();
    doc.moveDown(1.5);

    // --- Details grid ---
    const colW = (rightX - leftX) / 2;
    let gridY = separatorY + 20;

    doc.fillColor(muted).fontSize(9).font('Helvetica-Bold').text('BILLED TO', leftX, gridY);
    doc.fillColor(ink).fontSize(11).font('Helvetica-Bold').text(customerName, leftX, gridY + 14);
    let bilY = gridY + 30;
    if (payment.contact_email) {
      doc.fillColor(muted).fontSize(10).font('Helvetica').text(payment.contact_email, leftX, bilY); bilY += 14;
    }
    if (payment.org_addr1) { doc.text(payment.org_addr1, leftX, bilY); bilY += 14; }
    if (payment.org_addr2) { doc.text(payment.org_addr2, leftX, bilY); bilY += 14; }
    const cityLine = [payment.org_city, payment.org_state, payment.org_zip].filter(Boolean).join(', ');
    if (cityLine) { doc.text(cityLine, leftX, bilY); bilY += 14; }

    // Right column: payment details
    const rcolX = leftX + colW;
    doc.fillColor(muted).fontSize(9).font('Helvetica-Bold').text('PAYMENT DETAILS', rcolX, gridY);
    let dY = gridY + 14;
    const kvp = (label, value) => {
      doc.fillColor(ink).fontSize(10).font('Helvetica-Bold').text(`${label}: `, rcolX, dY, { continued: true });
      doc.font('Helvetica').text(String(value));
      dY += 14;
    };
    kvp('Date', txDate ? new Date(txDate).toLocaleString() : '—');
    kvp('Method', payment.method || 'card');
    const cardStr = (payment.card_brand || '—')
      + (payment.card_last4 ? ` ****${payment.card_last4}` : '');
    kvp('Card', cardStr);
    kvp('Gateway', gatewayLabel);
    kvp('Txn ID', payment.external_txn_id || '—');
    if (payment.external_auth_code) kvp('Auth Code', payment.external_auth_code);
    kvp('Invoice', payment.invoice_number);
    kvp('Status', state.label);

    // --- Line items table ---
    const tableY = Math.max(bilY, dY) + 24;
    const colDesc = leftX;
    const colQty  = rightX - 260;
    const colUnit = rightX - 160;
    const colAmt  = rightX - 60;

    doc.fillColor(muted).fontSize(9).font('Helvetica-Bold');
    doc.text('DESCRIPTION', colDesc, tableY);
    doc.text('QTY',    colQty,  tableY, { width: 70,  align: 'right' });
    doc.text('UNIT',   colUnit, tableY, { width: 90,  align: 'right' });
    doc.text('AMOUNT', colAmt,  tableY, { width: 60,  align: 'right' });
    doc.moveTo(leftX, tableY + 14).lineTo(rightX, tableY + 14).strokeColor('#e5e7eb').lineWidth(1).stroke();

    let rowY = tableY + 22;
    doc.fillColor(ink).fontSize(10).font('Helvetica');
    for (const l of (lines || [])) {
      const descHeight = doc.heightOfString(String(l.description || '—'), { width: colQty - colDesc - 8 });
      const rowH = Math.max(16, descHeight + 4);
      if (rowY + rowH > doc.page.height - 120) { doc.addPage(); rowY = 48; }
      doc.font('Helvetica').text(String(l.description || '—'), colDesc, rowY, { width: colQty - colDesc - 8 });
      doc.text(String(Number(l.quantity)), colQty, rowY, { width: 70, align: 'right' });
      doc.text(fmtMoney(l.unit_price, payment.currency), colUnit, rowY, { width: 90, align: 'right' });
      doc.font('Helvetica-Bold').text(fmtMoney(l.amount, payment.currency), colAmt, rowY, { width: 60, align: 'right' });
      rowY += rowH + 6;
      doc.moveTo(leftX, rowY - 3).lineTo(rightX, rowY - 3).strokeColor('#f1f3f5').stroke();
    }

    // --- Totals box (right-aligned) ---
    const totalsX = rightX - 240;
    const totalsW = 240;
    let tY = rowY + 18;
    const totalRow = (label, value, opts = {}) => {
      doc.fillColor(opts.color || ink).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 10);
      doc.text(label, totalsX, tY, { width: totalsW / 2, align: 'left' });
      doc.text(value, totalsX + totalsW / 2, tY, { width: totalsW / 2, align: 'right' });
      tY += (opts.size || 10) + 6;
    };
    totalRow('Invoice subtotal', fmtMoney(payment.invoice_subtotal, payment.currency));
    if (Number(payment.invoice_tax) > 0) totalRow('Tax', fmtMoney(payment.invoice_tax, payment.currency));
    totalRow('Invoice total', fmtMoney(payment.invoice_total, payment.currency));
    if (Number(payment.fee_amount) > 0) {
      totalRow(payment.fee_label || 'Processing Fee', `+ ${fmtMoney(payment.fee_amount, payment.currency)}`);
    }
    doc.moveTo(totalsX, tY).lineTo(totalsX + totalsW, tY).strokeColor('#dee2e6').lineWidth(1).stroke();
    tY += 6;
    totalRow(state.totalLabel, fmtMoney(payment.amount, payment.currency), { bold: true, color: state.fg, size: 13 });
    if (Number(payment._effective_balance) > 0) {
      totalRow('Remaining balance', fmtMoney(payment._effective_balance, payment.currency), { color: '#dc3545', bold: true });
    }

    // --- Donation tax-acknowledgment box ---
    if (taxNote) {
      let boxY = tY + 20;
      const boxW = rightX - leftX;
      if (boxY > doc.page.height - 220) { doc.addPage(); boxY = 48; }
      doc.fillColor(ink).fontSize(11).font('Helvetica-Bold').text(taxNote.heading, leftX, boxY, { width: boxW });
      let noteY = boxY + 16;
      if (payment.fund_name) {
        doc.fontSize(9).font('Helvetica-Bold').text('Designated to: ', leftX, noteY, { continued: true });
        doc.font('Helvetica').text(payment.fund_name);
        noteY += 13;
      }
      if (payment.donation_note) {
        doc.fontSize(9).font('Helvetica-Bold').text('Dedication: ', leftX, noteY, { continued: true });
        doc.font('Helvetica').text(payment.donation_note);
        noteY += 13;
      }
      doc.fontSize(9).font('Helvetica');
      for (const l of taxNote.lines) {
        doc.text(l, leftX, noteY, { width: boxW });
        noteY += doc.heightOfString(l, { width: boxW }) + 4;
      }
      if (company.tax_ein) {
        doc.fillColor(muted).fontSize(8).text(
          `${company.name} is a tax-exempt organization. Tax ID (EIN): ${company.tax_ein}.`,
          leftX, noteY + 4, { width: boxW }
        );
      }
    }

    // --- Footer ---
    // footerY must leave room for 2 text lines at 9pt + leading before the
    // bottom margin (page.height - 48 = 744). Using -96 keeps the second
    // line at ~718, cursor at ~729 — safely inside the margin and no extra
    // blank page is added by pdfkit.
    const footerY = doc.page.height - 96;
    doc.moveTo(48, footerY).lineTo(rightX, footerY).strokeColor('#e5e7eb').stroke();
    doc.fillColor(muted).fontSize(9).font('Helvetica')
       .text('Thank you for your business. Retain this receipt for your records.', 48, footerY + 8, { align: 'center', width: rightX - 48 });
    if (company.from_email) {
      doc.text(`Questions? Contact ${company.from_email}.`, 48, footerY + 22, { align: 'center', width: rightX - 48 });
    }

    doc.end();
  });
}

// --------- Year-end consolidated giving statement ---------

async function loadYearEndStatementData(contactId, year) {
  const [[contact]] = await db.query(
    `SELECT id, CONCAT_WS(' ', first_name, last_name) AS name, email,
            address_line1, address_line2, city, state, postal_code
       FROM contacts WHERE id = :id`,
    { id: contactId }
  );
  if (!contact) return null;

  const [gifts] = await db.query(
    `SELECT d.id, d.created_at, d.is_in_kind, d.in_kind_description, d.quid_pro_quo_value,
            f.name AS fund_name, p.amount, p.currency
       FROM donations d
       JOIN payments p ON p.id = d.payment_id
       LEFT JOIN funds f ON f.id = d.fund_id
      WHERE d.contact_id = :cid
        AND p.status IN ('captured','authorized')
        AND YEAR(d.created_at) = :year
      ORDER BY d.created_at ASC`,
    { cid: contactId, year }
  );

  const totalGiven = gifts.reduce((a, g) => a + Number(g.amount), 0);
  const totalDeductible = gifts.reduce((a, g) => a + Math.max(0, Number(g.amount) - Number(g.quid_pro_quo_value || 0)), 0);

  const branding = await resolveBusinessBranding();
  let company = {
    name: branding.name || 'Our Organization',
    from_email: 'noreply@example.org',
    tax_ein: branding.taxEin,
    logo_url: branding.logoUrl,
    logo_buffer: await logoUrlToBuffer(branding.logoUrl),
  };
  try {
    const [[smtp]] = await db.query(
      'SELECT from_name, from_email FROM smtp_settings WHERE is_active = 1 ORDER BY id DESC LIMIT 1');
    if (smtp) {
      company.from_email = smtp.from_email || company.from_email;
      if (!branding.name && smtp.from_name) company.name = smtp.from_name;
    }
  } catch (_e) { /* fine */ }

  return { contact, year, gifts, totalGiven, totalDeductible, company };
}

function renderYearEndStatementPdf({ contact, year, gifts, totalGiven, totalDeductible, company }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const brand = '#F05523';
    const ink = '#212529';
    const muted = '#6c757d';
    const leftX = 48;
    const rightX = doc.page.width - doc.page.margins.right;

    const logoH = 36;
    let titleY = 48;
    if (company.logo_buffer) {
      try { doc.image(company.logo_buffer, leftX, 48, { height: logoH }); titleY = 48 + logoH + 12; } catch (_e) { /* ok */ }
    }
    doc.fillColor(brand).fontSize(24).font('Helvetica-Bold').text(`${year} Year-End Giving Statement`, leftX, titleY, { width: rightX - leftX });
    doc.fillColor(muted).fontSize(10).font('Helvetica').text(company.name, leftX);
    doc.moveDown(1);
    doc.moveTo(leftX, doc.y).lineTo(rightX, doc.y).lineWidth(2).strokeColor(brand).stroke();
    doc.moveDown(1);

    doc.fillColor(ink).fontSize(11).font('Helvetica-Bold').text(contact.name);
    doc.font('Helvetica').fontSize(10).fillColor(muted);
    if (contact.email) doc.text(contact.email);
    const addr = [contact.address_line1, contact.address_line2, [contact.city, contact.state, contact.postal_code].filter(Boolean).join(', ')].filter(Boolean);
    addr.forEach((l) => doc.text(l));
    doc.moveDown(1);

    doc.fillColor(ink).fontSize(10).font('Helvetica')
      .text(`This statement summarizes your charitable contributions to ${company.name} for the ${year} calendar year, for your tax records.`, { width: rightX - leftX });
    doc.moveDown(1);

    const colDate = leftX, colFund = leftX + 90, colAmt = rightX - 160, colDed = rightX - 80;
    doc.fillColor(muted).fontSize(9).font('Helvetica-Bold');
    doc.text('DATE', colDate, doc.y, { continued: false });
    let headerY = doc.y - 11;
    doc.text('FUND', colFund, headerY);
    doc.text('GIFT AMOUNT', colAmt, headerY, { width: 80, align: 'right' });
    doc.text('DEDUCTIBLE', colDed, headerY, { width: 80, align: 'right' });
    doc.moveTo(leftX, headerY + 14).lineTo(rightX, headerY + 14).strokeColor('#e5e7eb').stroke();

    let rowY = headerY + 22;
    doc.fillColor(ink).fontSize(9).font('Helvetica');
    for (const g of gifts) {
      if (rowY > doc.page.height - 140) { doc.addPage(); rowY = 48; }
      const deductible = Math.max(0, Number(g.amount) - Number(g.quid_pro_quo_value || 0));
      const dateStr = new Date(g.created_at).toLocaleDateString();
      const label = g.is_in_kind ? `${g.fund_name || 'Undesignated'} (in-kind: ${g.in_kind_description || ''})` : (g.fund_name || 'Undesignated');
      doc.text(dateStr, colDate, rowY, { width: 85 });
      doc.text(label, colFund, rowY, { width: colAmt - colFund - 8 });
      doc.text(fmtMoney(g.amount, g.currency), colAmt, rowY, { width: 80, align: 'right' });
      doc.text(fmtMoney(deductible, g.currency), colDed, rowY, { width: 80, align: 'right' });
      rowY += 16;
    }
    doc.moveTo(leftX, rowY + 2).lineTo(rightX, rowY + 2).strokeColor('#dee2e6').stroke();
    rowY += 10;
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('Total', colFund, rowY, { width: colAmt - colFund - 8 });
    doc.text(fmtMoney(totalGiven), colAmt, rowY, { width: 80, align: 'right' });
    doc.text(fmtMoney(totalDeductible), colDed, rowY, { width: 80, align: 'right' });
    rowY += 28;

    doc.font('Helvetica').fontSize(9).fillColor(muted).text(
      'No goods or services were provided in exchange for these contributions except where noted individually. '
      + 'Please retain this statement for your tax records; consult your tax advisor with any questions.',
      leftX, rowY, { width: rightX - leftX }
    );
    if (company.tax_ein) {
      doc.moveDown(0.5).text(`${company.name} is a tax-exempt organization. Tax ID (EIN): ${company.tax_ein}.`, leftX, doc.y, { width: rightX - leftX });
    }

    doc.end();
  });
}

// =============================================================================
// maybeSendReceiptEmail — the one place that decides IF and WHAT receipt a
// payment gets emailed. Shared by payments.js (checkout / manual-send call
// sites) and billing-cron.js (recurring auto-charge success path) so a
// donation, a membership-dues renewal, and a plain commerce payment always
// get the right template regardless of which code path captured the charge.
// =============================================================================
async function maybeSendReceiptEmail(paymentId) {
  try {
    const cfg = await moduleSettings.get('payments');
    if (!cfg.auto_send_receipt) return;

    const [[pay]] = await db.query(
      `SELECT p.id AS payment_id, p.receipt_token, p.status,
              i.id AS invoice_id, i.contact_id,
              c.email AS contact_email,
              CONCAT_WS(' ', c.first_name, c.last_name) AS contact_name
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN contacts c ON c.id = i.contact_id
        WHERE p.id = :id`, { id: paymentId }
    );
    if (!pay?.receipt_token || !pay?.contact_email) return;
    if (!['captured','authorized'].includes(pay.status)) return;

    // Pick the receipt slug based on what this payment actually is — a
    // donation and a membership-dues renewal both deserve very different
    // copy from a generic commerce invoice receipt (fund name / tax
    // language vs. a plain "invoice settled" line).
    const classified = await classifyPayment(pay.payment_id);
    const slug = classified.kind === 'donation' ? 'donation_receipt'
      : classified.kind === 'membership' ? 'membership_renewed'
      : 'payment_receipt';

    // Try system template first; fall back to raw receipt HTML
    let subject, html;
    try {
      const rendered = await renderBySlug(slug, {
        contact_id: pay.contact_id,
        payment_id: pay.payment_id,
      });
      subject = rendered.subject;
      html    = rendered.html;
    } catch (_) {
      const data = await loadReceiptDataByToken(pay.receipt_token);
      if (!data) return;
      html    = await renderReceiptHtml(data);
      subject = `Receipt — ${data.payment?.invoice_number || 'Payment Received'}`;
    }

    await sendMail({
      to:      pay.contact_email,
      subject: subject || `Receipt — Payment Received`,
      html,
      entityType: 'invoice',
      entityId:   pay.invoice_id,
    });
  } catch (e) {
    // Receipt email failure is non-fatal — log and continue
    console.error('[receipt-email] failed:', e.message);
  }
}

module.exports = {
  loadReceiptData, loadReceiptDataByToken, renderReceiptHtml, renderReceiptPdf,
  loadYearEndStatementData, renderYearEndStatementPdf, maybeSendReceiptEmail,
};
