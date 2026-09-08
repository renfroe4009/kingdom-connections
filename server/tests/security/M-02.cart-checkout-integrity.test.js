// =============================================================================
// M-02 — financial integrity gaps in the public storefront cart/checkout.
// POST /api/cart/items accepted Number(qty) with no floor or cap: a negative
// quantity produced a negative line total (cartPayload sums unit_price * qty
// unconditionally), letting a shopper discount or zero out their cart.
// PUT /api/cart/items/:id updated quantity with no stock check at all for
// products (only the ticket-hold path checked availability). tax_exempt was
// a client-supplied boolean trusted straight into calcTax — any shopper
// could self-declare exemption.
//
// Fixed: a shared qtySchema (z.number().int().min(1).max(100)) applied at
// every cart mutation point; PUT now re-checks stock_qty for tracked
// products the same way POST always did; tax_exempt is now resolved
// server-side from the contact's linked organization (resolveTaxExempt in
// checkout.js) and is no longer even an accepted field in the request
// schemas — a client sending tax_exempt:true is silently ignored.
//
// Run:  node server/tests/security/M-02.cart-checkout-integrity.test.js
// =============================================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

const API_BASE = process.env.API_BASE || 'http://localhost:4220';
const ORIGIN_HEADER = { Origin: (process.env.CLIENT_ORIGIN || 'http://localhost:5220').split(',')[0].trim() };

function request(method, pathname, { token, body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(new URL(API_BASE + pathname), {
      method,
      headers: { ...ORIGIN_HEADER,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers || {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let db;
let pass = 0, fail = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}

(async () => {
  db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    namedPlaceholders: true,
  });

  console.log('== M-02 cart/checkout financial integrity ==');

  // --- fixtures ---
  let productId, taxRateId;
  await check('setup: create a tracked-inventory product (stock 2) and an active 10% US tax rate', async () => {
    const [p] = await db.query(
      `INSERT INTO products (sku, name, slug, price, taxable, track_inventory, stock_qty, is_active)
       VALUES ('sectest-m02', 'M-02 Test Widget', 'sectest-m02-widget', 20.00, 1, 1, 2, 1)`
    );
    productId = p.insertId;
    const [t] = await db.query(
      `INSERT INTO tax_rates (name, country, state, rate_pct, is_active) VALUES ('M-02 test rate', 'US', NULL, 10.000, 1)`
    );
    taxRateId = t.insertId;
  });

  // --- POST /api/cart/items qty validation ---
  await check('POST /cart/items: a negative qty is rejected (400), not silently accepted', async () => {
    const r = await request('POST', '/api/cart/items', { body: { product_id: productId, qty: -5 } });
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${r.body}`);
  });

  await check('POST /cart/items: qty=0 is rejected (400)', async () => {
    const r = await request('POST', '/api/cart/items', { body: { product_id: productId, qty: 0 } });
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${r.body}`);
  });

  await check('POST /cart/items: a fractional qty is rejected (400)', async () => {
    const r = await request('POST', '/api/cart/items', { body: { product_id: productId, qty: 1.5 } });
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${r.body}`);
  });

  await check('POST /cart/items: a qty over the cap (100) is rejected (400)', async () => {
    const r = await request('POST', '/api/cart/items', { body: { product_id: productId, qty: 999 } });
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${r.body}`);
  });

  // --- PUT /api/cart/items/:id stock enforcement (previously entirely missing) ---
  let cartToken, cartItemId;
  await check('setup: add 1 of the tracked product to a fresh cart', async () => {
    const r = await request('POST', '/api/cart/items', { body: { product_id: productId, qty: 1 } });
    if (r.status !== 200) throw new Error(`add-to-cart failed: ${r.status} ${r.body}`);
    const payload = JSON.parse(r.body);
    cartToken = payload.session_key;
    cartItemId = payload.items.find((it) => it.product_id === productId)?.id;
    if (!cartItemId) throw new Error('could not find the cart item id after adding');
  });

  await check('PUT /cart/items/:id: raising qty past stock_qty (2) is rejected (400)', async () => {
    const r = await request('PUT', `/api/cart/items/${cartItemId}`, {
      body: { qty: 5 }, headers: { ...ORIGIN_HEADER, 'X-Cart-Token': cartToken },
    });
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${r.body}`);
    const [[row]] = await db.query('SELECT qty FROM cart_items WHERE id = :id', { id: cartItemId });
    if (row.qty !== 1) throw new Error(`cart item qty changed to ${row.qty} despite the rejected update — DB was mutated anyway`);
  });

  await check('PUT /cart/items/:id: raising qty to exactly stock_qty (2) still works (no regression)', async () => {
    const r = await request('PUT', `/api/cart/items/${cartItemId}`, {
      body: { qty: 2 }, headers: { ...ORIGIN_HEADER, 'X-Cart-Token': cartToken },
    });
    if (r.status !== 200) throw new Error(`expected 200, got ${r.status}: ${r.body}`);
  });

  // --- tax_exempt no longer trusted from the client ---
  await check('POST /checkout/estimate: a client-declared tax_exempt:true is ignored — tax is still charged', async () => {
    const r = await request('POST', '/api/checkout/estimate', {
      body: {
        session_key: cartToken,
        shipping_country: 'US',
        tax_exempt: true, // no longer a schema field at all — sent anyway, to prove it's inert
      },
    });
    if (r.status !== 200) throw new Error(`estimate failed: ${r.status} ${r.body}`);
    const est = JSON.parse(r.body);
    if (!(est.tax > 0)) throw new Error(`expected tax > 0 (self-declared exemption should be ignored), got tax=${est.tax}`);
  });

  await check('checkout.js: tax_exempt is no longer read from the parsed request body anywhere', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'routes', 'checkout.js'), 'utf8');
    if (/d\.tax_exempt/.test(src)) throw new Error('found a remaining d.tax_exempt reference — client input is still trusted somewhere');
  });

  await check('checkout.js: buildPendingOrder asserts the total/subtotal cannot be negative before an order is created', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'routes', 'checkout.js'), 'utf8');
    if (!/total < 0 \|\| subtotal < 0/.test(src)) throw new Error('expected a final total/subtotal sanity assertion in buildPendingOrder');
  });

  // --- cleanup ---
  await check('cleanup: remove fixtures', async () => {
    if (cartItemId) await db.query('DELETE FROM cart_items WHERE id = :id', { id: cartItemId });
    if (productId) await db.query('DELETE FROM products WHERE id = :id', { id: productId });
    if (taxRateId) await db.query('DELETE FROM tax_rates WHERE id = :id', { id: taxRateId });
  });

  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
