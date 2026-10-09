// =============================================================================
// Payment gateway adapters — Valor + Authorize.net
// -----------------------------------------------------------------------------
// Both gateways offer a hosted / iframe payment form so card data never touches
// our server (SAQ A scope).
//
//   Authorize.net  — Accept Hosted: server exchanges a transaction request for a
//                    one-time token, the page embeds iframe with token=...
//                    Ref: https://developer.authorize.net/api/reference/features/accept_hosted.html
//
//   Valor PayTech  — Hosted Payment Page: server requests a payment session
//                    (epi-based) and the iframe loads with the session id.
//                    Ref: https://valorapi.readme.io/reference/merchant-api-documentation
//
// B2B enrichment supported by both:
//   * Level 2  — tax amount, PO number, customer code, tax-exempt flag
//   * Level 3  — line items w/ commodity codes (lower interchange for commercial
//                cards). Off for consumer cards; we still send it and the network
//                uses it if the card qualifies.
//   * Processing fee  — surcharge / convenience fee / service fee. Applied to
//                       the invoice total before the checkout session is created.
//
// Both adapters return a shape the client can render without caring which one:
//   { kind: 'authnet' | 'valor', iframeSrc, token, postUrl, fee }
// =============================================================================

const { db } = require('../db');
const { getBrandColors } = require('./brandColors');
const { decrypt, looksEncrypted } = require('./secretsCrypto');

// --------- settings access ---------

// Columns encrypted at rest (security remediation H-13) — public_client_key
// is deliberately excluded, it's a publishable-style key meant to be
// client-visible, not a secret.
const ENCRYPTED_COLUMNS = ['transaction_key', 'signature_key', 'api_key', 'app_key', 'webhook_secret'];

// Decrypts a raw payment_gateway_settings row in place for actual use
// (calling out to the gateway's API), as opposed to the masked display
// copy GET /payments/settings returns. Tolerates rows the one-time
// migration script (scripts/encrypt-gateway-secrets.js) hasn't reached yet
// — a value not in "iv:authTag:ciphertext" shape is treated as legacy
// plaintext and passed through unchanged, so payment processing never
// breaks because encryption was deployed before the migration ran.
function decryptGatewayRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const col of ENCRYPTED_COLUMNS) {
    if (looksEncrypted(out[col])) out[col] = decrypt(out[col]);
  }
  return out;
}

async function getGateway(gateway, mode) {
  const [rows] = await db.query(
    `SELECT * FROM payment_gateway_settings
      WHERE gateway = :gateway
        AND (:mode IS NULL OR mode = :mode)
        AND is_active = 1
      ORDER BY is_default DESC, id DESC LIMIT 1`,
    { gateway, mode: mode || null }
  );
  return decryptGatewayRow(rows[0]) || null;
}

async function getDefaultGateway() {
  const [rows] = await db.query(
    `SELECT * FROM payment_gateway_settings
      WHERE is_active = 1 AND is_default = 1
      ORDER BY id DESC LIMIT 1`
  );
  if (rows[0]) return decryptGatewayRow(rows[0]);
  const [any] = await db.query(
    `SELECT * FROM payment_gateway_settings WHERE is_active = 1 ORDER BY id LIMIT 1`);
  return decryptGatewayRow(any[0]) || null;
}

// --------- B2B: Level 2 / Level 3 builders ---------
//
// These are gateway-agnostic — each adapter reshapes the result into its own
// wire format.
//
// `isB2B` is true when the invoice is billed to an organization (not a bare
// consumer contact). Merchants can flip the gateway's `b2b_only` off to send
// L2/L3 for every transaction.

function buildLevel2({ cfg, invoice, org }) {
  if (!cfg.l2_enabled) return null;
  return {
    tax_amount:      Number(invoice.tax_amount || 0).toFixed(2),
    tax_exempt:      !!(invoice.tax_exempt || org?.tax_exempt),
    po_number:       invoice.customer_po_number || org?.default_po_number || invoice.invoice_number,
    customer_code:   org?.tax_id || cfg.merchant_tax_id || `ORG-${invoice.organization_id || '0'}`,
    destination_zip: invoice.ship_postal_code || invoice.billing_postal_code || null,
  };
}

function buildLevel3({ cfg, invoice, lineItems }) {
  if (!cfg.l3_enabled) return null;
  const fallback = cfg.default_commodity_code || '0000';
  return {
    summary_commodity_code: cfg.summary_commodity_code || fallback,
    discount_amount:        Number(invoice.discount_amount || 0).toFixed(2),
    shipping_amount:        '0.00',
    duty_amount:            '0.00',
    items: (lineItems || []).map((l, i) => ({
      line_number:     i + 1,
      product_code:    l.product_code || `SKU-${l.id || i + 1}`,
      description:     String(l.description || '').slice(0, 26),
      commodity_code:  l.commodity_code || fallback,
      unit_of_measure: l.unit_of_measure || 'EA',
      quantity:        Number(l.quantity || 1),
      unit_price:      Number(l.unit_price || 0).toFixed(2),
      discount_amount: '0.00',
      tax_amount:      '0.00',
      tax_rate:        Number(invoice.tax_rate || 0).toFixed(3),
      total_amount:    Number(l.amount || 0).toFixed(2),
    })),
  };
}

// --------- Processing fee calculator ---------
//
// Applies cfg.fee_percent + cfg.fee_fixed to the invoice balance. Returns:
//   { mode, amount, label, base } or null if no fee configured.
// The caller is expected to persist this on the invoice AND include it in the
// amount charged so the customer sees the fee up front (required for
// surcharge regulatory disclosure).

function computeProcessingFee({ cfg, baseAmount }) {
  if (!cfg || cfg.fee_mode === 'none' || !cfg.supports_surcharge) return null;
  const pct   = Number(cfg.fee_percent || 0) / 100;
  const fixed = Number(cfg.fee_fixed   || 0);
  const raw   = Number(baseAmount) * pct + fixed;
  const amount = Math.round(raw * 100) / 100;
  if (amount <= 0) return null;
  return {
    mode:   cfg.fee_mode,
    amount,
    label:  cfg.fee_label || 'Processing Fee',
    disclosure: cfg.fee_disclosure ||
      'A merchant processing fee is added when paying by card. This is not a fee charged by your card issuer.',
    base:   Number(baseAmount),
  };
}

// --------- Authorize.net Accept Hosted ---------

async function authnetCreateHostedToken(cfg, { invoice, lineItems, org, returnUrl, fee, l2, l3 }) {
  const endpoint = cfg.mode === 'live'
    ? 'https://api.authorize.net/xml/v1/request.api'
    : 'https://apitest.authorize.net/xml/v1/request.api';

  // Auth.net customerType XSD requires strict child-element order:
  //   type -> id -> email -> driversLicense -> taxId
  // Sending fields out of order triggers the exact error:
  //   "invalid child element 'id' ... List of possible elements expected:
  //    'driversLicense, taxId'"
  // Keep id before email, and only include non-empty values.
  let customer;
  const cid = String(invoice.contact_id || '').slice(0, 20);
  if (cid || invoice.contact_email) {
    customer = {};
    if (cid) customer.id = cid;
    if (invoice.contact_email) customer.email = invoice.contact_email;
  }

  // Build a billTo block from whatever billing address pieces we have. Auth.net
  // accepts every field as optional and uses what's present for AVS scoring.
  const billTo = {};
  const bt = invoice.bill_to || {};
  if (invoice.contact_name || bt.firstName || bt.lastName) {
    const first = bt.firstName || (invoice.contact_name || '').split(' ')[0] || '';
    const last  = bt.lastName  || (invoice.contact_name || '').split(' ').slice(1).join(' ') || '';
    if (first) billTo.firstName = first.slice(0, 50);
    if (last)  billTo.lastName  = last.slice(0, 50);
  }
  if (org?.name)               billTo.company  = String(org.name).slice(0, 50);
  if (bt.address1 || invoice.billing_address_line1) billTo.address = (bt.address1 || invoice.billing_address_line1).slice(0, 60);
  if (bt.city  || invoice.billing_city)         billTo.city    = (bt.city  || invoice.billing_city).slice(0, 40);
  if (bt.state || invoice.billing_state)        billTo.state   = (bt.state || invoice.billing_state).slice(0, 40);
  if (bt.zip   || invoice.billing_postal_code)  billTo.zip     = (bt.zip   || invoice.billing_postal_code).slice(0, 20);
  if (bt.country || invoice.billing_country)    billTo.country = (bt.country || invoice.billing_country).slice(0, 60);
  if (invoice.contact_phone)   billTo.phoneNumber = String(invoice.contact_phone).slice(0, 25);

  // Build transactionRequest with optional L2/L3/surcharge augmentation.
  const txReq = {
    transactionType: 'authCaptureTransaction',
    amount: Number(invoice.charge_amount).toFixed(2),   // caller includes fee in charge_amount
    order: {
      invoiceNumber: invoice.invoice_number,
      description:   `Invoice ${invoice.invoice_number}`,
    },
    customer,
  };
  if (Object.keys(billTo).length) txReq.billTo = billTo;
  if (invoice.customer_ip) txReq.customerIP = invoice.customer_ip;

  // QuickBooks sync — Authorize.Net's Merchant Interface has a "Sync to
  // QuickBooks Online" option; when enabled per-merchant, all txns sync. We
  // expose a per-config flag so we ALSO tag the userFields, which lets the
  // merchant filter QB-bound transactions in their reports without flipping
  // the account-level setting. When the flag is OFF we send nothing.
  if (cfg.quickbooks_enabled) {
    txReq.userFields = {
      userField: [
        { name: 'qb_sync',     value: 'true' },
        { name: 'qb_realm_id', value: String(cfg.quickbooks_realm_id || '') },
      ].filter((f) => f.value !== ''),
    };
  }

  if (l2) {
    // Authorize.Net L2 wire format
    txReq.tax = {
      amount: l2.tax_amount,
      name: 'Sales Tax',
      description: 'Sales Tax',
    };
    txReq.poNumber    = l2.po_number;
    txReq.customerIP  = invoice.customer_ip || undefined;
    if (l2.tax_exempt) txReq.tax.amount = '0.00';
  }
  if (l3) {
    // Auth.net accepts up to 30 line items per transaction
    txReq.lineItems = {
      lineItem: l3.items.slice(0, 30).map((it) => ({
        itemId:      String(it.product_code).slice(0, 31),
        name:        it.description || 'Item',
        description: it.description,
        quantity:    String(it.quantity),
        unitPrice:   it.unit_price,
        taxable:     Number(it.tax_amount || 0) > 0 ? 'true' : 'false',
      })),
    };
  }
  if (fee && fee.mode === 'surcharge') {
    // Auth.net has a dedicated surcharge struct
    txReq.surcharge = {
      amount:      fee.amount.toFixed(2),
      description: fee.label,
    };
  }

  const body = {
    getHostedPaymentPageRequest: {
      merchantAuthentication: {
        name: cfg.api_login_id,
        transactionKey: cfg.transaction_key,
      },
      transactionRequest: txReq,
      hostedPaymentSettings: {
        setting: [
          { settingName: 'hostedPaymentReturnOptions',
            settingValue: JSON.stringify({
              showReceipt: true,
              url: returnUrl,
              urlText: 'Back to invoice',
              cancelUrl: returnUrl,
              cancelUrlText: 'Cancel',
            }) },
          { settingName: 'hostedPaymentButtonOptions',
            settingValue: JSON.stringify({ text: 'Pay Now' }) },
          { settingName: 'hostedPaymentStyleOptions',
            settingValue: JSON.stringify({ bgColor: (await getBrandColors()).primary }) },
          { settingName: 'hostedPaymentPaymentOptions',
            settingValue: JSON.stringify({ cardCodeRequired: true, showCreditCard: true, showBankAccount: true }) },
          { settingName: 'hostedPaymentSecurityOptions',
            settingValue: JSON.stringify({ captcha: false }) },
          { settingName: 'hostedPaymentBillingAddressOptions',
            settingValue: JSON.stringify({ show: true, required: false }) },
          { settingName: 'hostedPaymentCustomerOptions',
            settingValue: JSON.stringify({ showEmail: true, requiredEmail: false, addPaymentProfile: false }) },
          // Communicator URL must point at a same-origin static page that
          // bubbles Auth.net's iframe messages up to the grandparent React
          // page. Using returnUrl here (a SPA route) silently dropped the
          // payload because the SPA's bundle loaded inside Auth.net's hidden
          // iframe couldn't bubble back. The static HTML page at
          // /authnet-iframe-communicator.html does exactly that.
          { settingName: 'hostedPaymentIFrameCommunicatorUrl',
            settingValue: JSON.stringify({
              url: (returnUrl.match(/^https?:\/\/[^/]+/)?.[0] || '') + '/authnet-iframe-communicator.html',
            }) },
        ],
      },
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = (await res.text()).replace(/^\uFEFF/, '');
  let json = null;
  try { json = JSON.parse(text); } catch (_e) { json = { raw: text }; }
  if (!res.ok || json?.messages?.resultCode !== 'Ok') {
    throw new Error(
      `Authorize.net hosted token failed: ${json?.messages?.message?.[0]?.text || res.statusText}`
    );
  }
  const postUrl = cfg.mode === 'live'
    ? 'https://accept.authorize.net/payment/payment'
    : 'https://test.authorize.net/payment/payment';
  return {
    kind: 'authnet',
    token: json.token,
    postUrl,
    iframeSrc: null,
  };
}

async function authnetFetchTransaction(cfg, transId) {
  const endpoint = cfg.mode === 'live'
    ? 'https://api.authorize.net/xml/v1/request.api'
    : 'https://apitest.authorize.net/xml/v1/request.api';
  const body = {
    getTransactionDetailsRequest: {
      merchantAuthentication: {
        name: cfg.api_login_id,
        transactionKey: cfg.transaction_key,
      },
      transId,
    },
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = (await res.text()).replace(/^\uFEFF/, '');
  try { return JSON.parse(text); } catch (_e) { return { raw: text }; }
}

// Auth.net — discover the real transId for a given invoice number.
//
// Background: with Accept Hosted, when the customer submits the iframe the
// transaction is processed and the txn id is returned via (a) iframe
// postMessage to the parent page and (b) the webhook. If neither lands, the
// only thing we have locally is the hosted-page TOKEN we generated up-front,
// which Auth.net's getTransactionDetailsRequest does NOT accept. To recover,
// we ask the gateway "what transactions exist for this invoiceNumber?"
//
// We try unsettled first (covers same-day in sandbox/prod), then walk recent
// settled batches as a fallback for older transactions. Returns the most
// recent matching transId (Auth.net allows duplicate invoiceNumbers, so we
// pick latest by submitTimeUTC).
async function authnetSearchByInvoice(cfg, invoiceNumber, { lookbackDays = 14 } = {}) {
  const endpoint = cfg.mode === 'live'
    ? 'https://api.authorize.net/xml/v1/request.api'
    : 'https://apitest.authorize.net/xml/v1/request.api';
  const auth = {
    name: cfg.api_login_id,
    transactionKey: cfg.transaction_key,
  };
  const post = async (req) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    const text = (await res.text()).replace(/^\uFEFF/, '');
    try { return JSON.parse(text); } catch (_e) { return { raw: text }; }
  };

  const inv = String(invoiceNumber || '').trim();
  if (!inv) return null;

  const collectMatches = (json) => {
    // Response shape: { transactions: { transaction: [ {transId, invoiceNumber, submitTimeUTC, ...} ] } }
    // OR with no items: { transactions: '' } depending on serializer.
    const tx = json?.transactions;
    const arr = !tx ? [] : Array.isArray(tx.transaction) ? tx.transaction
                       : tx.transaction ? [tx.transaction] : [];
    return arr.filter((t) => String(t.invoiceNumber || '') === inv);
  };

  // 1) Unsettled list (last 1k).
  const unsettled = await post({
    getUnsettledTransactionListRequest: {
      merchantAuthentication: auth,
      sorting: { orderBy: 'submitTimeUTC', orderDescending: 'true' },
      paging:  { limit: '1000', offset: '1' },
    },
  });
  let matches = collectMatches(unsettled);

  // 2) Walk recent settled batches if no unsettled match.
  if (matches.length === 0) {
    const now = new Date();
    const since = new Date(now.getTime() - lookbackDays * 86400 * 1000);
    const batchList = await post({
      getSettledBatchListRequest: {
        merchantAuthentication: auth,
        firstSettlementDate: since.toISOString(),
        lastSettlementDate:  now.toISOString(),
      },
    });
    const batches = batchList?.batchList?.batch || [];
    const batchArr = Array.isArray(batches) ? batches : (batches ? [batches] : []);
    for (const b of batchArr) {
      if (!b?.batchId) continue;
      const batchTxns = await post({
        getTransactionListRequest: {
          merchantAuthentication: auth,
          batchId: String(b.batchId),
          sorting: { orderBy: 'submitTimeUTC', orderDescending: 'true' },
          paging:  { limit: '1000', offset: '1' },
        },
      });
      const m = collectMatches(batchTxns);
      if (m.length) { matches = m; break; }
    }
  }

  if (!matches.length) return null;
  // Most recent match wins.
  matches.sort((a, b) => String(b.submitTimeUTC || '').localeCompare(String(a.submitTimeUTC || '')));
  return matches[0].transId || null;
}

// Valor — search transactions by our invoice/order number. Used by the
// backfill when we never captured the gateway txn id locally (e.g. customer
// clicked the manual "I've completed payment" fallback). We try a few
// endpoint switches because Valor's reporting API surface varies by API
// version and merchant configuration. Returns the matching transactionId or
// null if Valor has no record for that invoice.
// Search for a Valor transaction by invoice number using the /?txnfetch API.
// Returns the full transaction record (not just the id) so the caller can map
// card details without a second network round-trip.
async function valorSearchByInvoice(cfg, invoiceNumber) {
  if (!invoiceNumber) return null;
  const baseUrl = cfg.mode === 'live'
    ? 'https://securelink.valorpaytech.com:4430'
    : 'https://securelink-staging.valorpaytech.com:4430';
  const inv = String(invoiceNumber);

  // eslint-disable-next-line no-console
  const log = (...a) => console.log('  [valorSearchByInvoice]', ...a);

  // Valor Transaction List API (/?txnfetch) — the correct endpoint for
  // searching transactions by invoice/filter. txn_type must be 'txnfetch'.
  // VT_INVOICE maps to the invoicenumber field we send on the hosted page.
  const body = {
    appid:        cfg.app_id  || '',
    appkey:       cfg.app_key || '',
    epi:          String(cfg.epi_id || ''),
    txn_type:     'txnfetch',
    filter:       'VT_INVOICE',
    filter_text:  inv,
    transaction_status: 'ALL',
    limit:        10,
    offset:       0,
    version:      2,
  };

  log(`searching for inv=${inv} via /?txnfetch filter=VT_INVOICE`);

  let res;
  try {
    res = await fetch(`${baseUrl}/?txnfetch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(body),
    });
  } catch (e) {
    log(`network error: ${e.message}`);
    return null;
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_e) {
    log(`non-JSON response: ${text.slice(0, 200)}`);
    return null;
  }

  log(`/?txnfetch HTTP ${res.status}`, {
    error_no: json?.error_no,
    topKeys:  json ? Object.keys(json) : [],
    dataLen:  Array.isArray(json?.data) ? json.data.length : undefined,
    raw:      JSON.stringify(json)?.slice(0, 500),
  });

  if (!res.ok || (json?.error_no && json.error_no !== 'S00')) {
    log(`search failed: ${json?.mesg || json?.desc || res.statusText}`);
    return null;
  }

  // Walk response — Valor wraps records under data[] in most revisions.
  const rows = Array.isArray(json?.data) ? json.data
             : Array.isArray(json?.data?.transactions) ? json.data.transactions
             : Array.isArray(json?.transactions) ? json.transactions
             : (json?.data && typeof json.data === 'object') ? [json.data]
             : [];

  if (rows.length === 0) {
    log('no records returned');
    return null;
  }

  // Return the first approved record — filter was applied server-side.
  const record = rows[0];
  log(`✓ found record:`, JSON.stringify(record));
  return record;
}

// Valor — direct transaction status lookup. Used by the admin "Refresh from
// gateway" endpoint when the IPN was missed or arrived with sparse data.
//
// Valor exposes transaction status via the same securelink host used for the
// hosted page, with `?txnstatus` (some Valor API revisions use `?gettxn` or
// `?transactionstatus` — if the merchant's account uses a different switch
// the call surfaces a clear error and you can adjust here).
//
// Auth goes in the body alongside the txn id, identical to the hosted-page
// flow. Response shape varies; we return the raw JSON and let the caller map.
async function valorFetchTransaction(cfg, transId) {
  const baseUrl = cfg.mode === 'live'
    ? 'https://securelink.valorpaytech.com:4430'
    : 'https://securelink-staging.valorpaytech.com:4430';
  const endpoint = `${baseUrl}/?txnfetch`;
  const body = {
    appid:       cfg.app_id  || '',
    appkey:      cfg.app_key || '',
    epi:         String(cfg.epi_id || ''),
    txn_type:    'txnfetch',
    filter:      'TXNID',
    filter_text: String(transId),
    limit:       1,
    offset:      0,
    version:     2,
  };
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const cause = e?.cause?.code || e?.code || e?.cause?.message || e?.message || 'unknown';
    throw new Error(`Valor fetch failed before response: ${cause} (endpoint ${endpoint})`);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_e) { json = { raw: text }; }

  // eslint-disable-next-line no-console
  console.log(`[valorFetchTransaction] txnid=${transId} status=${res.status} body=`, json);

  if (!res.ok) {
    const msg = json?.message || json?.error || json?.raw || res.statusText;
    throw new Error(`Valor fetch failed (${res.status}): ${String(msg).slice(0, 300)}`);
  }
  return json;
}

// Map a Valor /?txnstatus response → the field names our payments table uses.
// Centralized so the webhook, manual-confirm, /refresh, and backfill all map
// the same way. Returns null if the response carries no usable card data.
function mapValorTransactionResponse(json) {
  if (!json) return null;
  // Valor wraps real data under `data` in most revisions, but some return it
  // flat at the top. Pull from both.
  const d = (json.data && typeof json.data === 'object') ? json.data : json;
  // If the response is an array (multi-record search), prefer the first.
  const r = Array.isArray(d) ? d[0] : d;
  if (!r || typeof r !== 'object') return null;

  // /?txnfetch returns UPPERCASE field names; other endpoints use camelCase.
  // Support both so this mapper works for all Valor response shapes.
  const txnId  = r.REF_TXN_ID || r.transactionId || r.txnId || r.transaction_id
               || r.txnid || r.id || r.reference || null;

  // PAN comes back as '4111 XXXX XXXX 1111' — extract last 4 digits.
  const pan    = r.PAN || r.cardNumber || r.card_number || '';
  const last4  = r.card_last4 || r.cardLast4 || r.last4 || r.cardNumberLast4 || r.card_last_four
               || (pan ? pan.replace(/\s/g, '').slice(-4) : null) || null;

  const brand  = r.CARD_SCHEME || r.cardBrand || r.brand || r.cardType || r.card_type
               || r.CARD_TYPE || null;

  const auth   = r.AUTH_CODE || r.APPROVAL_CODE || r.authCode || r.auth_code
               || r.approvalCode || r.approval_code || null;

  // EXPIRY_DATE from /?txnfetch; cardExpiry from other endpoints.
  const exp    = r.EXPIRY_DATE || r.cardExpiry || r.expiry || r.expirationDate || null;

  const holder = r.CARDHOLDER_NAME || r.cardHolder || r.cardHolderName
               || r.customer_name || r.cardholder_name || null;

  // BASE_AMOUNT from /?txnfetch is in cents; NET_AMOUNT is also cents.
  // Other endpoints return decimal dollars in `amount`.
  const rawAmt = r.amount || r.authorizedAmount || r.NET_AMOUNT || r.BASE_AMOUNT || 0;
  const amount = rawAmt
    ? (r.NET_AMOUNT || r.BASE_AMOUNT
        ? Number(rawAmt) / 100          // cents → dollars
        : Number(rawAmt))
    : null;

  const statusRaw = String(r.status || r.result || r.transactionStatus
                         || r.TXN_TYPE || '').toLowerCase();
  const status = statusRaw.includes('refund')  ? 'refunded'
               : statusRaw.includes('void')    ? 'voided'
               : statusRaw.includes('declin')  ? 'failed'
               : statusRaw.includes('approv')  ? 'captured'
               : statusRaw.includes('captur')  ? 'captured'
               : statusRaw.includes('settled') ? 'captured'
               : statusRaw.includes('sale')    ? 'captured'
               : statusRaw.includes('auth')    ? 'authorized'
               : null;

  return {
    txnId,
    status,
    amount,
    last4,
    brand,
    auth,
    exp,
    holder,
    avs:     r.avsResult  || r.avs_result  || r.avsResponse  || null,
    avsmsg:  r.avsMessage || r.avs_message || null,
    cvv:     r.cvvResult  || r.cvv_result  || r.cvvResponse  || null,
    cvvmsg:  r.cvvMessage || r.cvv_message || null,
    pmsg:    r.DISPLAY_MESSAGE || r.message || r.responseMessage || r.statusMessage || null,
    pcode:   r.RESPONSE_CODE  || r.responseCode || r.code || null,
    cip:     r.customerIp || r.customer_ip || null,
    batch:   r.BATCH_NO || r.batchId || r.batch_id || null,
    billing: (r.billing_address || r.billingAddress) ? JSON.stringify({
              address: r.billing_address || r.billingAddress,
              city:    r.billing_city    || r.billingCity,
              state:   r.billing_state   || r.billingState,
              zip:     r.billing_zip     || r.billingZip,
              country: r.billing_country || r.billingCountry,
            }) : null,
    raw: json,
  };
}

// --------- Valor PayTech Hosted Payment ---------

async function valorCreateHostedSession(cfg, { invoice, lineItems, org, returnUrl, fee, l2, l3 }) {
  // Valor PayTech Hosted Payment Page endpoint.
  //
  // Real endpoint shape (per valorapi.readme.io):
  //   https://securelink-staging.valorpaytech.com:4430/?hostedpage  (sandbox)
  //   https://securelink.valorpaytech.com:4430/?hostedpage          (production)
  //
  // Auth goes in the BODY as appid/appkey/epi — NOT as headers.
  // Content type is application/json.
  const baseUrl = cfg.mode === 'live'
    ? 'https://securelink.valorpaytech.com:4430'
    : 'https://securelink-staging.valorpaytech.com:4430';
  const endpoint = `${baseUrl}/?hostedpage`;

  // Billing address: pull what we have from the invoice/contact/org. Valor uses
  // these for AVS scoring and surfaces them on the receipt + back-office. We
  // pass everything we can; Valor ignores fields it doesn't recognize.
  const bt = invoice.bill_to || {};
  const billing = {
    billing_address: bt.address1 || invoice.billing_address_line1 || undefined,
    billing_city:    bt.city     || invoice.billing_city          || undefined,
    billing_state:   bt.state    || invoice.billing_state         || undefined,
    billing_zip:     bt.zip      || invoice.billing_postal_code   || undefined,
    billing_country: bt.country  || invoice.billing_country       || 'US',
    phone:           invoice.contact_phone || undefined,
    company_name:    org?.name   || undefined,
  };

  // Conservative payload — only fields Valor's /?hostedpage is known to
  // accept. Adding speculative aliases (invoice_number, invoiceNumber,
  // orderNumber, multiple tax field names, tax_exempt boolean, etc.) caused
  // 400 Bad Request rejections, so we stick to the documented field names
  // and nest L2/L3 enrichment under their own sub-objects only.
  const body = {
    // --- auth ---
    appid:   cfg.app_id  || '',
    appkey:  cfg.app_key || '',
    epi:     String(cfg.epi_id || ''),
    // --- transaction ---
    txn_type:      'sale',
    amount:        Number(Number(invoice.charge_amount).toFixed(2)),
    invoicenumber: String(invoice.invoice_number || ''),
    order_id:      String(invoice.invoice_number || ''),
    description:   `Invoice ${invoice.invoice_number}`,
    email:         invoice.contact_email || undefined,
    customer_name: invoice.contact_name   || invoice.bill_to_name || undefined,
    customer_id:   invoice.contact_id ? String(invoice.contact_id) : undefined,
    customer_ip:   invoice.customer_ip   || undefined,
    epage:         1,                         // flag to return a hosted page URL
    // --- URLs ---
    redirect_url:  returnUrl,
    callback_url:  returnUrl,
    notify_url:    `${process.env.SERVER_ORIGIN || 'http://localhost:4000'}/api/payments/webhook/valor`,
    // --- billing snapshot ---
    ...billing,
    // --- misc ---
    currency:         invoice.currency || 'USD',
    shipping_country: 'US',
  };

  // QuickBooks sync — only attach when the merchant has the integration on for
  // this gateway config. Sending these fields to a non-QuickBooks merchant
  // makes Valor reject or quarantine the transaction in their portal. The
  // exact field name ("qbsync"/"quickbooks"/"quickbooks_sync") varies across
  // Valor API revisions; we send the common set and let the gateway pick.
  if (cfg.quickbooks_enabled) {
    body.qbsync         = 1;
    body.quickbooks     = 1;
    body.quickbooks_sync = true;
    if (cfg.quickbooks_realm_id) body.quickbooks_realm_id = String(cfg.quickbooks_realm_id);
  }

  if (l2) {
    body.level2 = {
      sales_tax:             l2.tax_amount,
      tax_exempt:            !!l2.tax_exempt,
      customer_reference:    l2.po_number,
      destination_postal_code: l2.destination_zip || undefined,
    };
  }
  if (l3) {
    body.level3 = {
      summary_commodity_code: l3.summary_commodity_code,
      discount_amount:        l3.discount_amount,
      shipping_amount:        l3.shipping_amount,
      duty_amount:            l3.duty_amount,
      line_items: l3.items.map((it) => ({
        description:     it.description,
        commodity_code:  it.commodity_code,
        product_code:    it.product_code,
        unit_of_measure: it.unit_of_measure,
        quantity:        it.quantity,
        unit_price:      it.unit_price,
        discount_amount: it.discount_amount,
        total_amount:    it.total_amount,
      })),
    };
  }
  if (fee) {
    if (fee.mode === 'surcharge')              body.surcharge_amount  = Number(fee.amount.toFixed(2));
    else if (fee.mode === 'convenience_fee')   body.convenience_fee   = Number(fee.amount.toFixed(2));
    else if (fee.mode === 'service_fee')       body.service_fee       = Number(fee.amount.toFixed(2));
  }

  // Wrap fetch so we surface the real network error (DNS, TLS, timeout) rather
  // than the bare "fetch failed" Node throws on any transport-layer failure.
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const cause = e?.cause?.code || e?.code || e?.cause?.message || e?.message || 'unknown';
    throw new Error(`Valor request failed before response: ${cause} (endpoint ${endpoint})`);
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_e) { json = { raw: text }; }

  // ===== DIAGNOSTIC LOGGING =====
  // Dump the full hosted-page response so we can see what Valor's API
  // actually returns for this merchant/revision. This is the response that
  // gives us the iframe URL — separate from the postMessage / webhook that
  // fires when the customer COMPLETES the transaction. Useful for confirming
  // (a) which field names are populated, and (b) whether Valor includes
  // any callback/notification metadata we should be persisting.
  // eslint-disable-next-line no-console
  console.log('[valor /?hostedpage] status=' + res.status + ' body=', json);

  if (!res.ok) {
    const msg = json?.message || json?.error || json?.raw || res.statusText;
    throw new Error(`Valor hosted session failed (${res.status}): ${String(msg).slice(0, 300)}`);
  }

  // Response shape varies across Valor API revisions — try common field names.
  // Observed shape (staging, 2026-04-29): { error_no:'S00', url, uid }.
  const sessionId = json?.data?.sessionId || json?.sessionId || json?.session_id
                 || json?.uid || json?.data?.uid
                 || json?.id || json?.token;
  const iframeSrc = json?.data?.hostedPageUrl
                 || json?.hostedPageUrl
                 || json?.data?.redirect_url
                 || json?.redirect_url
                 || json?.data?.checkoutUrl
                 || json?.checkoutUrl
                 || json?.url;

  if (!iframeSrc && !sessionId) {
    throw new Error(`Valor hosted session: unexpected response shape: ${String(text).slice(0, 300)}`);
  }

  return {
    kind: 'valor',
    token: sessionId || null,
    iframeSrc: iframeSrc || null,
    postUrl: null,
  };
}

// --------- Unified entry ---------
//
// Responsibilities:
//   1. Look up the chosen gateway (or default).
//   2. Decide whether this transaction is B2B — presence of org + card method.
//   3. Compute the processing fee (if enabled).
//   4. Build L2/L3 payloads (if enabled & — when b2b_only — the invoice is B2B).
//   5. Hand off to the gateway-specific adapter.
//
// Returns the adapter shape plus { fee, l2, l3, charge_amount } so the caller
// can persist them on the invoice/payment row before showing the iframe.

async function createHostedCheckout({ gateway, invoice, lineItems, org, returnUrl, mode }) {
  const cfg = gateway
    ? await getGateway(gateway, mode)
    : await getDefaultGateway();
  if (!cfg) throw new Error('No active payment gateway configured.');

  const isB2B = Boolean(invoice.organization_id);
  const baseAmount = Number(invoice.balance_due);

  // Fee only applies when: supported, b2b-match ok, and amount > 0
  const feeAllowed = (!cfg.b2b_only || isB2B);
  const fee = feeAllowed ? computeProcessingFee({ cfg, baseAmount }) : null;
  const chargeAmount = Math.round((baseAmount + (fee?.amount || 0)) * 100) / 100;

  const l2 = (!cfg.b2b_only || isB2B) ? buildLevel2({ cfg, invoice, org }) : null;
  const l3 = (!cfg.b2b_only || isB2B) ? buildLevel3({ cfg, invoice, lineItems }) : null;

  const ctx = {
    invoice: { ...invoice, charge_amount: chargeAmount },
    lineItems, org, returnUrl, fee, l2, l3,
  };

  let adapter = null;
  if (cfg.gateway === 'authnet')  adapter = await authnetCreateHostedToken(cfg, ctx);
  else if (cfg.gateway === 'valor') adapter = await valorCreateHostedSession(cfg, ctx);
  else throw new Error(`Unknown gateway: ${cfg.gateway}`);

  return {
    cfg,
    ...adapter,
    fee,
    l2, l3,
    charge_amount: chargeAmount,
    base_amount:   baseAmount,
  };
}

// =============================================================================
// Valor Vault — Passage.js tokenization + customer vault storage
// =============================================================================
//
// Flow:
//   1. valorGetClientToken(cfg)                     → clientToken for Passage.js
//   2. Passage.js (browser)                         → card_token
//   3. valorVaultAddCustomer(cfg, {...})             → valor_vault_id
//   4. valorVaultAddPaymentProfile(cfg, {...})       → valor_payment_profile_id
//   5. valorVaultCharge(cfg, {...})                  → transaction result
//
// Vault base URLs differ from the securelink charging endpoint:
//   Staging:    https://demo.valorpaytech.com/api/valor-vault/
//   Production: confirmed from Valor — update VALOR_VAULT_BASE_URL env var or
//               swap the hard-coded string below once you have it.

function valorVaultBase(cfg) {
  // Production vault base URL pending confirmation from Valor.
  // Set VALOR_VAULT_URL_LIVE in .env once confirmed; falls back to demo.
  if (cfg.mode === 'live') {
    return process.env.VALOR_VAULT_URL_LIVE || 'https://api.valorpaytech.com';
  }
  return 'https://demo.valorpaytech.com';
}

// Step 1 — Generate a Passage.js client token.
// Called server-side; the token is passed to the frontend and consumed by
// the Passage.js V2 constructor (data-clientToken / clientToken param).
async function valorGetClientToken(cfg) {
  const baseUrl = cfg.mode === 'live'
    ? 'https://securelink.valorpaytech.com:4430'
    : 'https://securelink-staging.valorpaytech.com:4430';

  const url = `${baseUrl}/?gptoken`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        appid:    cfg.app_id  || '',
        appkey:   cfg.app_key || '',
        epi:      String(cfg.epi_id || ''),
        txn_type: 'clientToken',
      }),
    });
  } catch (e) {
    const cause = e?.cause?.code || e?.message || 'unknown';
    throw new Error(`Valor GetClientToken network error: ${cause}`);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  // eslint-disable-next-line no-console
  console.log('[valorGetClientToken] status=%s body=', res.status, json);

  // Success marker: error_no === 'S00'
  const ok = res.ok && (!json.error_no || json.error_no === 'S00');
  if (!ok) {
    throw new Error(`Valor GetClientToken failed: ${json.message || json.error_no || res.statusText}`);
  }
  // Field name varies across API revisions — try both.
  const token = json.clientToken || json.client_token;
  if (!token) throw new Error(`Valor GetClientToken: no token in response — ${text.slice(0, 200)}`);
  return token;
}

// Step 3 — Create a customer profile in the Valor Vault.
// Returns valor_vault_id.  One profile per customer; reuse if customer already
// has one (call site checks the vault_profiles table first).
async function valorVaultAddCustomer(cfg, { customer_name, customer_email, customer_phone, address }) {
  const base = valorVaultBase(cfg);

  let res;
  try {
    res = await fetch(`${base}/api/valor-vault/addcustomer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Valor-App-ID':  cfg.app_id  || '',
        'Valor-App-Key': cfg.app_key || '',
      },
      body: (() => {
        // NOTE: epi is NOT a body field for Valor Vault — auth is header-only
        // (Valor-App-ID / Valor-App-Key). Sending epi here causes a 400.
        //
        // Valor vault schema quirks (confirmed by API testing):
        //   - customer_phone must be digits only (no dashes/spaces/+1): "8135550100"
        //   - address_details objects accept ONLY address_label — no address_line1,
        //     city, state, or zip sub-fields (all cause "must NOT have additional
        //     properties" 400). So we send address_details only as a label placeholder.

        // Strip phone to 10 digits only
        const phoneDigits = String(customer_phone || '').replace(/\D/g, '').slice(-10);

        const payload = {
          customer_name: String(customer_name || 'Customer').slice(0, 25),
          ...(customer_email ? { customer_email } : {}),
          ...(phoneDigits.length === 10 ? { customer_phone: phoneDigits } : {}),
        };
        // eslint-disable-next-line no-console
        console.log('[valorVaultAddCustomer] request payload:', JSON.stringify(payload));
        return JSON.stringify(payload);
      })(),
    });
  } catch (e) {
    throw new Error(`Valor VaultAddCustomer network error: ${e?.message || 'unknown'}`);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  // eslint-disable-next-line no-console
  console.log('[valorVaultAddCustomer] status=%s body=', res.status, json);

  const vaultErr = json.error || (json.error_no && json.error_no !== 'S00' ? json.error_no : null);
  if (!res.ok || vaultErr) {
    // Include the raw response so we can see Valor's actual validation message
    const detail = json.message || json.error_description || json.errors
      || vaultErr || res.statusText;
    throw new Error(`Valor VaultAddCustomer failed: ${detail} (HTTP ${res.status}) — ${text.slice(0, 300)}`);
  }
  const vaultId = json.vault_customer_id || json.vault_id || json.data?.vault_id
               || json.data?.vault_customer_id || json.id;
  if (!vaultId) throw new Error(`Valor VaultAddCustomer: no vault_id in response — ${text.slice(0, 200)}`);
  return String(vaultId);
}

// Step 4 — Link a Passage.js card_token to an existing vault customer profile.
// Returns valor_payment_profile_id.
async function valorVaultAddPaymentProfile(cfg, { vault_id, card_token, cardholder_name }) {
  const base = valorVaultBase(cfg);

  let res;
  try {
    res = await fetch(`${base}/api/valor-vault/addpaymentprofiletoken/${vault_id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Valor-App-ID':  cfg.app_id  || '',
        'Valor-App-Key': cfg.app_key || '',
      },
      body: JSON.stringify({
        token:           card_token,
        cardholder_name: cardholder_name || undefined,
      }),
    });
  } catch (e) {
    throw new Error(`Valor VaultAddPaymentProfile network error: ${e?.message || 'unknown'}`);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  // eslint-disable-next-line no-console
  console.log('[valorVaultAddPaymentProfile] status=%s body=', res.status, json);

  const profileErr = json.error || (json.error_no && json.error_no !== 'S00' ? json.error_no : null);
  if (!res.ok || profileErr) {
    throw new Error(`Valor VaultAddPaymentProfile failed: ${json.message || profileErr || res.statusText}`);
  }
  // Response field name varies — try common shapes.
  const profileId = json.payment_profile_id || json.data?.payment_profile_id
                 || json.profile_id         || json.data?.profile_id
                 || json.id                 || json.data?.id;
  // Some Valor revisions return only a success envelope with no sub-id.
  // In that case fall back to the vault_id so the caller has something to store.
  return profileId ? String(profileId) : null;
}

// Step 4b — Link a bank account to an existing vault customer profile, for
// recurring ACH debits (membership/recurring-donation/portal "add payment
// method"). Unlike cards, Passage.js never gives us a reusable token for
// ACH — the raw account/routing numbers themselves are handed to Valor once
// here to store server-side; we never persist them ourselves (vault_profiles
// only keeps last4 + the vault_id reference, same as the card path keeps
// card_token but never a PAN).
//
// Despite Valor's own docs claiming "identified solely by vault_id, no
// separate profile id" for this endpoint, live testing shows it DOES return
// one (`ach_profile_id`) — confirmed by successfully calling it and reading
// back a real id. Capture and return it like valorVaultAddPaymentProfile
// does for cards, since a vault customer that already has an ACH profile
// attached rejects a second addachprofile call outright (seen empirically as
// a non-2xx with no usable error detail) — a real profile id, once we have
// one to reference, is a safer bet for repeat charges than reusing vault_id.
async function valorVaultAddACHProfile(cfg, {
  vault_id, routing_number, account_number, account_type, payee_name, entry_class,
}) {
  const base = valorVaultBase(cfg);

  let res;
  try {
    res = await fetch(`${base}/api/valor-vault/addachprofile/${vault_id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Valor-App-ID':  cfg.app_id  || '',
        'Valor-App-Key': cfg.app_key || '',
      },
      body: JSON.stringify({
        account_number,
        routing_number,
        payee_name:   String(payee_name || 'Customer').slice(0, 30),
        account_type: account_type || 'C',
        entry_class:  entry_class  || 'Personal',
      }),
    });
  } catch (e) {
    throw new Error(`Valor VaultAddACHProfile network error: ${e?.message || 'unknown'}`);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  // eslint-disable-next-line no-console
  console.log('[valorVaultAddACHProfile] status=%s body=', res.status, json);

  const err = json.error || (json.error_no && json.error_no !== 'S00' ? json.error_no : null);
  if (!res.ok || err) {
    const detail = json.message || json.error_description || err || res.statusText;
    throw new Error(`Valor VaultAddACHProfile failed (HTTP ${res.status}): ${detail} — ${text.slice(0, 200)}`);
  }
  const achProfileId = json.ach_profile_id || json.data?.ach_profile_id || json.id || json.data?.id;
  return achProfileId ? String(achProfileId) : null;
}

// Resolve the cardholder name to send Valor from a list of candidates, in
// priority order (e.g. a value the caller already has, then a stored vault
// profile name, then a contact/donor name pulled from the DB). Passage.js's
// own cardholder-name field isn't always populated — the donor left it
// blank, or the embedded iframe never rendered it — and Valor's vault/charge
// endpoints reject a missing/blank name outright (error E08: "INVALID CARD
// HOLDER NAME"), so every Valor charge call site must resolve to a real name
// rather than pass undefined. Centralized here so a new call site can't
// forget it. Returns undefined (never '') so callers can keep using `|| x`.
function resolveCardholderName(...candidates) {
  for (const c of candidates) {
    const trimmed = String(c || '').trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

// Known Valor response/error codes mapped to plain language for the donor —
// the raw gateway string (e.g. "Valor VaultCharge failed (400): E08") is
// useless to a non-technical payer and leaks gateway internals. The raw code
// is preserved separately (thrown error's `.gatewayCode`) for logging and
// payments.processor_code.
const VALOR_ERROR_MESSAGES = {
  E08: 'The name on the card is missing or invalid. Please check the name and try again.',
  E75: 'The saved card details are invalid. Please re-enter your card.',
  A04: 'The account name is invalid.',
};

function describeValorError(code) {
  const key = String(code || '').trim().toUpperCase();
  return VALOR_ERROR_MESSAGES[key]
    || 'Your payment could not be processed. Please check your card details and try again.';
}

// Step 5 — Charge a card_token via /?pagesale.
// Used by the recurring invoice billing cron for auto-pay.
// Returns the raw Valor response; caller is responsible for persisting the
// payment record and mapping transactionId / status.
async function valorVaultCharge(cfg, {
  card_token,
  amount,
  invoicenumber,
  cardholdername,
  email,
  surcharge_amount = 0,
}) {
  const baseUrl = cfg.mode === 'live'
    ? 'https://securelink.valorpaytech.com:4430'
    : 'https://securelink-staging.valorpaytech.com:4430';

  let res;
  try {
    res = await fetch(`${baseUrl}/?pagesale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        appid:              cfg.app_id  || '',
        appkey:             cfg.app_key || '',
        epi:                String(cfg.epi_id || ''),
        txn_type:           'sale',
        amount:             Number(amount).toFixed(2),
        token:              card_token,
        invoicenumber:      String(invoicenumber || '').slice(0, 12),
        surchargeIndicator: '0',
        surchargeAmount:    Number(surcharge_amount).toFixed(2),
        cardholdername:     cardholdername || undefined,
        email:              email          || undefined,
        shipping_country:   'US',
      }),
    });
  } catch (e) {
    const cause = e?.cause?.code || e?.message || 'unknown';
    throw new Error(`Valor VaultCharge network error: ${cause}`);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  // eslint-disable-next-line no-console
  console.log('[valorVaultCharge] invoicenumber=%s status=%s body=', invoicenumber, res.status, json);

  if (!res.ok) {
    const rawCode = json.error_no || json.responseCode || null;
    const rawDetail = json.message || json.error_no || text.slice(0, 200);
    // eslint-disable-next-line no-console
    console.error(`[valorVaultCharge] rejected invoicenumber=%s status=%s code=%s detail=%s`, invoicenumber, res.status, rawCode, rawDetail);
    const err = new Error(describeValorError(rawCode));
    err.gatewayCode = rawCode;
    err.rawMessage = `Valor VaultCharge failed (${res.status}): ${rawDetail}`;
    throw err;
  }
  return json;
}

// Map a Valor /?pagesale vault-charge response to our payments table fields.
//
// ACH is asynchronous, unlike card's instant approve/decline — a healthy ACH
// debit comes back as status "WAITING" / current_state "Pending" (it settles
// over 1-3 business days, confirmed later via the /webhook/valor IPN, same
// as any other 'pending' payment row in this app), NOT an immediate capture.
// Without recognizing that, every real ACH charge fell through to the
// 'failed' default below and got reported to the payer as declined even
// though it hadn't actually failed — confirmed live against Valor's sandbox.
function mapValorVaultChargeResponse(json) {
  if (!json) return null;
  const d = (json.data && typeof json.data === 'object') ? json.data : json;
  const r = Array.isArray(d) ? d[0] : d;
  if (!r) return null;

  const status = String(r.status || r.result || r.transactionStatus || r.error_no || '').toLowerCase();
  const approved = status === 's00'
    || status.includes('approv')
    || status.includes('captur')
    || status.includes('settled');
  const pending = !approved && (
    status.includes('wait')
    || String(r.current_state || '').toLowerCase() === 'pending'
    || String(r.verification_status || '').toLowerCase() === 'waiting'
  );

  return {
    txnId:  r.transactionId || r.txnId || r.transaction_id || r.txnid || r.id || r.reference_number || null,
    status: approved              ? 'captured'
          : pending               ? 'pending'
          : status.includes('declin') ? 'failed'
          : status.includes('void')   ? 'voided'
          : status.includes('ref')    ? 'refunded'
          : 'failed',
    amount:  Number(r.amount || r.authorizedAmount || 0) || null,
    last4:   r.cardLast4 || r.last4 || r.cardNumberLast4 || null,
    brand:   r.cardBrand || r.brand || r.cardType        || null,
    auth:    r.authCode  || r.auth_code || r.approvalCode || r.approval_code || null,
    exp:     r.cardExpiry || r.expiry || r.expirationDate || null,
    holder:  r.cardHolder || r.cardHolderName || r.cardholder_name || null,
    pmsg:    r.message   || r.responseMessage            || null,
    pcode:   r.responseCode || r.error_no                || null,
    raw:     json,
  };
}

// Step 5b — ACH charge via /?pagesale (bank account, no tokenization).
// Passage.js POSTs raw bank fields to our server; we forward them to Valor.
async function valorAchCharge(cfg, {
  routing_number,
  account_number,
  account_type = 'C',
  account_holder_name,
  ach_entry_class = 'Personal',
  ach_txn_type = 'ACHDebit',
  amount,
  invoicenumber,
  email,
}) {
  const baseUrl = cfg.mode === 'live'
    ? 'https://securelink.valorpaytech.com:4430'
    : 'https://securelink-staging.valorpaytech.com:4430';

  let res;
  try {
    res = await fetch(`${baseUrl}/?pagesale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        appid:               cfg.app_id  || '',
        appkey:              cfg.app_key || '',
        epi:                 String(cfg.epi_id || ''),
        txn_type:            ach_txn_type,
        amount:              Number(amount).toFixed(2),
        routing_number,
        account_number,
        account_type,
        // Valor's own field names — confirmed via live sandbox testing (its
        // API returns A04 "PAYEE NAME IS INVALID" if sent as account_holder_name
        // instead of payee_name, and ignores entry_class if sent as ach_entry_class).
        payee_name:          (account_holder_name || 'Customer').slice(0, 30),
        entry_class:         ach_entry_class,
        invoicenumber:       String(invoicenumber || '').slice(0, 12),
        email:               email || undefined,
      }),
    });
  } catch (e) {
    const cause = e?.cause?.code || e?.message || 'unknown';
    throw new Error(`Valor ACH charge network error: ${cause}`);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  // eslint-disable-next-line no-console
  console.log('[valorAchCharge] invoicenumber=%s status=%s body=', invoicenumber, res.status, json);

  if (!res.ok) {
    throw new Error(`Valor ACH charge failed (${res.status}): ${json.message || json.error_no || text.slice(0, 200)}`);
  }
  return json;
}

// Step 5c — Charge a previously-vaulted ACH account (recurring cycle,
// billing-cron.js's attemptAutoCharge) — the ACH counterpart of
// valorVaultCharge's card_token reuse. There's no reusable "token" for ACH
// the way Passage.js gives one for cards, so this charges by vault
// reference instead. Uses Valor's dedicated /?achSale endpoint (not the
// /?pagesale one-time-ACH endpoint valorAchCharge above uses) with
// vaultPaymentInfo — confirmed via live sandbox testing that /?pagesale
// rejects vaultPaymentInfo outright (E75 "INVALID VAULT CUSTOMER INFO").
// payment_profile_id is the ach_profile_id valorVaultAddACHProfile returned
// (despite Valor's docs claiming there isn't one — see that function's
// comment); falls back to vault_id for older rows saved before that field
// was captured.
async function valorVaultAchCharge(cfg, {
  vault_id,
  payment_profile_id,
  amount,
  invoicenumber,
  email,
  ach_txn_type = 'ACHDebit',
}) {
  const baseUrl = cfg.mode === 'live'
    ? 'https://securelink.valorpaytech.com:4430'
    : 'https://securelink-staging.valorpaytech.com:4430';

  let res;
  try {
    res = await fetch(`${baseUrl}/?achSale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        appid:            cfg.app_id  || '',
        appkey:           cfg.app_key || '',
        epi:              String(cfg.epi_id || ''),
        txn_type:         ach_txn_type,
        amount:            Number(amount).toFixed(2),
        invoicenumber:     String(invoicenumber || '').slice(0, 12),
        email:             email || undefined,
        vaultPaymentInfo: { customerProfileID: String(vault_id), paymentProfileID: String(payment_profile_id || vault_id) },
      }),
    });
  } catch (e) {
    const cause = e?.cause?.code || e?.message || 'unknown';
    throw new Error(`Valor VaultAchCharge network error: ${cause}`);
  }

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  // eslint-disable-next-line no-console
  console.log('[valorVaultAchCharge] invoicenumber=%s status=%s body=', invoicenumber, res.status, json);

  if (!res.ok) {
    throw new Error(`Valor VaultAchCharge failed (${res.status}): ${json.message || json.error_no || text.slice(0, 200)}`);
  }
  return json;
}

// ─── Auth.net CIM vault ───────────────────────────────────────────────────────
// createCustomerProfileRequest creates both a customer profile and a payment
// profile in one call when you supply paymentProfiles. If the customer already
// has a profile, use authnetVaultAddPaymentProfile with the existing profileId.

async function authnetVaultCreateProfile(cfg, {
  opaque_data,       // { dataDescriptor, dataValue } from Accept.js
  merchant_customer_id,
  email,
  first_name,
  last_name,
  company,
  address,           // { address, city, state, zip, country }
}) {
  const endpoint = cfg.mode === 'live'
    ? 'https://api.authorize.net/xml/v1/request.api'
    : 'https://apitest.authorize.net/xml/v1/request.api';
  const auth = { name: cfg.api_login_id, transactionKey: cfg.transaction_key };

  const billTo = {};
  if (first_name) billTo.firstName = String(first_name).slice(0, 50);
  if (last_name)  billTo.lastName  = String(last_name).slice(0, 50);
  if (company)    billTo.company   = String(company).slice(0, 50);
  if (address?.address) billTo.address  = String(address.address).slice(0, 60);
  if (address?.city)    billTo.city     = String(address.city).slice(0, 40);
  if (address?.state)   billTo.state    = String(address.state).slice(0, 40);
  if (address?.zip)     billTo.zip      = String(address.zip).slice(0, 20);
  if (address?.country) billTo.country  = String(address.country).slice(0, 60);

  const profile = {
    ...(merchant_customer_id ? { merchantCustomerId: String(merchant_customer_id).slice(0, 20) } : {}),
    ...(email ? { email: String(email).slice(0, 255) } : {}),
    paymentProfiles: {
      customerType: 'individual',
      ...(Object.keys(billTo).length ? { billTo } : {}),
      payment: {
        opaqueData: {
          dataDescriptor: opaque_data.dataDescriptor,
          dataValue:      opaque_data.dataValue,
        },
      },
    },
  };

  const body = {
    createCustomerProfileRequest: {
      merchantAuthentication: auth,
      profile,
      validationMode: cfg.mode === 'live' ? 'liveMode' : 'testMode',
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = (await res.text()).replace(/^﻿/, '');
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  // eslint-disable-next-line no-console
  console.log('[authnetVaultCreateProfile] status=%s body=', res.status, json);

  const result = json.createCustomerProfileResponse || json;
  if (result.messages?.resultCode !== 'Ok') {
    const msg = result.messages?.message?.[0]?.text || text.slice(0, 300);
    throw new Error(`Auth.net createCustomerProfile failed: ${msg}`);
  }
  return {
    customerProfileId:        result.customerProfileId        || null,
    customerPaymentProfileId: result.customerPaymentProfileIdList?.[0] || null,
  };
}

async function authnetVaultAddPaymentProfile(cfg, {
  customer_profile_id,
  opaque_data,
  first_name,
  last_name,
  company,
  address,
}) {
  const endpoint = cfg.mode === 'live'
    ? 'https://api.authorize.net/xml/v1/request.api'
    : 'https://apitest.authorize.net/xml/v1/request.api';
  const auth = { name: cfg.api_login_id, transactionKey: cfg.transaction_key };

  const billTo = {};
  if (first_name) billTo.firstName = String(first_name).slice(0, 50);
  if (last_name)  billTo.lastName  = String(last_name).slice(0, 50);
  if (company)    billTo.company   = String(company).slice(0, 50);
  if (address?.address) billTo.address  = String(address.address).slice(0, 60);
  if (address?.city)    billTo.city     = String(address.city).slice(0, 40);
  if (address?.state)   billTo.state    = String(address.state).slice(0, 40);
  if (address?.zip)     billTo.zip      = String(address.zip).slice(0, 20);
  if (address?.country) billTo.country  = String(address.country).slice(0, 60);

  const body = {
    createCustomerPaymentProfileRequest: {
      merchantAuthentication: auth,
      customerProfileId:      String(customer_profile_id),
      paymentProfile: {
        customerType: 'individual',
        ...(Object.keys(billTo).length ? { billTo } : {}),
        payment: {
          opaqueData: {
            dataDescriptor: opaque_data.dataDescriptor,
            dataValue:      opaque_data.dataValue,
          },
        },
      },
      validationMode: cfg.mode === 'live' ? 'liveMode' : 'testMode',
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = (await res.text()).replace(/^﻿/, '');
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  // eslint-disable-next-line no-console
  console.log('[authnetVaultAddPaymentProfile] status=%s body=', res.status, json);

  const result = json.createCustomerPaymentProfileResponse || json;
  if (result.messages?.resultCode !== 'Ok') {
    const msg = result.messages?.message?.[0]?.text || text.slice(0, 300);
    throw new Error(`Auth.net createCustomerPaymentProfile failed: ${msg}`);
  }
  return result.customerPaymentProfileId || null;
}

// ─── Auth.net CIM vault charge ────────────────────────────────────────────────
// Charges a stored CIM payment profile. Returns our standard payment shape.
async function authnetVaultCharge(cfg, {
  customer_profile_id,
  payment_profile_id,
  amount,
  surcharge_amount = 0,
  invoice_number,
  description,
  customer_ip,
}) {
  const endpoint = cfg.mode === 'live'
    ? 'https://api.authorize.net/xml/v1/request.api'
    : 'https://apitest.authorize.net/xml/v1/request.api';
  const auth = { name: cfg.api_login_id, transactionKey: cfg.transaction_key };

  const txReq = {
    transactionType: 'authCaptureTransaction',
    amount: Number(amount).toFixed(2),
    profile: {
      customerProfileId: String(customer_profile_id),
      paymentProfile: { paymentProfileId: String(payment_profile_id) },
    },
    order: {
      ...(invoice_number ? { invoiceNumber: String(invoice_number).slice(0, 20) } : {}),
      ...(description    ? { description:   String(description).slice(0, 255)   } : {}),
    },
    ...(customer_ip ? { customerIP: customer_ip } : {}),
  };

  if (surcharge_amount > 0) {
    txReq.surcharge = {
      amount:      Number(surcharge_amount).toFixed(2),
      description: 'Processing fee',
    };
  }

  const body = { createTransactionRequest: { merchantAuthentication: auth, transactionRequest: txReq } };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = (await res.text()).replace(/^﻿/, '');
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  // eslint-disable-next-line no-console
  console.log('[authnetVaultCharge] invoiceNumber=%s status=%s body=', invoice_number, res.status, json);
  return json;
}

function mapAuthnetVaultChargeResponse(json) {
  const tx = json?.createTransactionResponse?.transactionResponse || {};
  const msgs = tx.messages?.message || [];
  const errs = tx.errors?.error || [];
  const resultCode = json?.createTransactionResponse?.messages?.resultCode;

  const approved = resultCode === 'Ok' && String(tx.responseCode) === '1';
  return {
    approved,
    external_txn_id:  tx.transId       || null,
    external_auth_code: tx.authCode    || null,
    card_last4:       tx.accountNumber ? String(tx.accountNumber).replace(/X/g, '').replace(/\*/g, '') : null,
    card_brand:       tx.accountType   || null,
    processor_message: msgs[0]?.description || errs[0]?.errorText || null,
    processor_code:    tx.responseCode  || null,
    avs_result:       tx.avsResultCode || null,
    cvv_result:       tx.cvvResultCode || null,
    decline_reason:   approved ? null : (errs[0]?.errorText || msgs[0]?.description || 'Declined'),
    processor_response: json,
  };
}

module.exports = {
  getGateway,
  getDefaultGateway,
  decryptGatewayRow,
  ENCRYPTED_COLUMNS,
  createHostedCheckout,
  authnetFetchTransaction,
  authnetSearchByInvoice,
  authnetVaultCreateProfile,
  authnetVaultAddPaymentProfile,
  authnetVaultCharge,
  mapAuthnetVaultChargeResponse,
  valorFetchTransaction,
  valorSearchByInvoice,
  mapValorTransactionResponse,
  buildLevel2,
  buildLevel3,
  computeProcessingFee,
  // Vault / Passage.js
  valorGetClientToken,
  valorVaultAddCustomer,
  valorVaultAddPaymentProfile,
  valorVaultAddACHProfile,
  valorVaultCharge,
  valorVaultAchCharge,
  valorAchCharge,
  mapValorVaultChargeResponse,
  resolveCardholderName,
  describeValorError,
};
