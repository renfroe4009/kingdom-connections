// =============================================================================
// Invoice route test harness
// -----------------------------------------------------------------------------
// Runs the real src/routes/invoices.js handlers against an in-memory DB mock
// so we don't need a live MySQL. Exercises:
//
//   TC-1 Create New Invoice  — happy path (tax + discount math, numbering, owner)
//   TC-2 Create — validation (missing line_items, bad date)
//   TC-3 Create — zero-quantity line, large decimal qty
//   TC-4 Update Invoice       — replace line items, recompute totals
//   TC-5 Update — scalar-only update leaves line items alone, totals still refresh
//   TC-6 Update — reject paid/void invoices (400)
//   TC-7 Update — 404 on unknown id
//
// Run:   node server/tests/invoices.test.js
// Exits nonzero if any test fails.
// =============================================================================

const path = require('path');
const Module = require('module');

// ------ mocks ---------------------------------------------------------------

const state = {
  invoices: new Map(),
  lineItems: new Map(),
  payments: new Map(),
  activities: [],
  _next: { invoices: 1, lineItems: 1, payments: 1, activities: 1 },
  reset() {
    this.invoices.clear();
    this.lineItems.clear();
    this.payments.clear();
    this.activities = [];
    this._next = { invoices: 1, lineItems: 1, payments: 1, activities: 1 };
  },
};

// Very small SQL pattern dispatcher. Only knows the shapes the invoices route
// emits — if a new query is added to the route, add a handler here.
function normalize(sql) { return sql.replace(/\s+/g, ' ').trim(); }

async function mockQuery(sql, params = {}) {
  const s = normalize(sql);

  // moduleSettings.get('invoices') — nextInvoiceNumber's prefix lookup. No
  // stored row in this mock, so callers always get moduleSettings.js's
  // built-in DEFAULTS (invoice_prefix: 'INV').
  if (/^SELECT value_json FROM settings WHERE `key` = :k$/i.test(s)) {
    return [[]];
  }

  // nextInvoiceNumber — SELECT invoice_number ... LIKE :p ORDER BY id DESC LIMIT 1
  if (/^SELECT invoice_number FROM invoices\s+WHERE invoice_number LIKE :p\s+ORDER BY id DESC LIMIT 1$/i.test(s)) {
    const prefix = String(params.p).replace('%', '');
    const matches = [...state.invoices.values()]
      .filter((r) => r.invoice_number.startsWith(prefix))
      .sort((a, b) => b.id - a.id);
    return [matches[0] ? [{ invoice_number: matches[0].invoice_number }] : []];
  }

  // INSERT INTO invoices (...) VALUES (...)
  if (/^INSERT INTO invoices\s*\(/i.test(s)) {
    const id = state._next.invoices++;
    const row = {
      id,
      invoice_number: params.invoice_number,
      contact_id: params.contact_id,
      organization_id: params.organization_id,
      deal_id: params.deal_id,
      owner_id: params.owner_id,
      issue_date: params.issue_date,
      due_date: params.due_date,
      currency: params.currency,
      subtotal: params.subtotal,
      tax_rate: params.tax_rate,
      tax_amount: params.tax_amount,
      discount_rate: params.discount_rate,
      discount_amount: params.discount_amount,
      total: params.total,
      amount_paid: 0,
      balance_due: params.total,
      status: 'draft',
      memo: params.memo,
      terms: params.terms,
      sent_at: null,
      paid_at: null,
    };
    state.invoices.set(id, row);
    return [{ insertId: id, affectedRows: 1 }];
  }

  // INSERT INTO invoice_line_items
  if (/^INSERT INTO invoice_line_items/i.test(s)) {
    const id = state._next.lineItems++;
    state.lineItems.set(id, {
      id,
      invoice_id: params.iid,
      description: params.desc,
      quantity: params.qty,
      unit_price: params.price,
      amount: params.amount,
      sort_order: params.sort,
    });
    return [{ insertId: id, affectedRows: 1 }];
  }

  // SELECT * FROM invoices WHERE id = :id  (PUT handler pre-check)
  if (/^SELECT \* FROM invoices WHERE id = :id$/i.test(s)) {
    const row = state.invoices.get(params.id);
    return [row ? [row] : []];
  }

  // refreshInvoiceTotals: SELECT tax_rate, discount_rate FROM invoices WHERE id = :id
  if (/^SELECT tax_rate, discount_rate FROM invoices WHERE id = :id$/i.test(s)) {
    const row = state.invoices.get(params.id);
    return [row ? [{ tax_rate: row.tax_rate, discount_rate: row.discount_rate }] : []];
  }

  // refreshInvoiceTotals: SELECT quantity, unit_price FROM invoice_line_items WHERE invoice_id = :id
  if (/^SELECT quantity, unit_price FROM invoice_line_items WHERE invoice_id = :id$/i.test(s)) {
    const rows = [...state.lineItems.values()]
      .filter((l) => l.invoice_id === params.id)
      .map((l) => ({ quantity: l.quantity, unit_price: l.unit_price }));
    return [rows];
  }

  // refreshInvoiceTotals: SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE ...
  if (/^SELECT COALESCE\(SUM\(amount\),0\) AS paid FROM payments WHERE invoice_id = :id AND status IN/i.test(s)) {
    const paid = [...state.payments.values()]
      .filter((p) => p.invoice_id === params.id && (p.status === 'captured' || p.status === 'authorized'))
      .reduce((acc, p) => acc + Number(p.amount || 0), 0);
    return [[{ paid }]];
  }

  // refreshInvoiceTotals: UPDATE invoices SET subtotal=:...
  if (/^UPDATE invoices\s+SET subtotal = :subtotal/i.test(s)) {
    const row = state.invoices.get(params.id);
    if (row) {
      Object.assign(row, {
        subtotal: params.subtotal,
        tax_amount: params.tax_amount,
        discount_amount: params.discount_amount,
        total: params.total,
        amount_paid: params.amount_paid,
        balance_due: params.balance_due,
      });
    }
    return [{ affectedRows: row ? 1 : 0 }];
  }

  // PUT /:id scalar update:  UPDATE invoices SET k1 = :k1, ... WHERE id = :id
  if (/^UPDATE invoices SET .* WHERE id = :id$/i.test(s)) {
    const row = state.invoices.get(params.id);
    if (row) {
      for (const [k, v] of Object.entries(params)) {
        if (k === 'id') continue;
        row[k] = v;
      }
    }
    return [{ affectedRows: row ? 1 : 0 }];
  }

  // automations.js's triggerWorkflow() — fire-and-forget after create/payment;
  // no workflows configured in this mock, so it's always a no-op match.
  if (/^SELECT \* FROM automation_workflows WHERE status = 'active' AND trigger_type = :tt$/i.test(s)) {
    return [[]];
  }

  // DELETE FROM invoice_line_items WHERE invoice_id = :id
  if (/^DELETE FROM invoice_line_items WHERE invoice_id = :id$/i.test(s)) {
    let n = 0;
    for (const [k, v] of [...state.lineItems.entries()]) {
      if (v.invoice_id === params.id) { state.lineItems.delete(k); n++; }
    }
    return [{ affectedRows: n }];
  }

  throw new Error(`mock DB got an unexpected query:\n${s}\nparams=${JSON.stringify(params)}`);
}

// Inject mocks into require() cache BEFORE requiring the route.
function mockModule(id, exports) {
  const resolved = require.resolve(id);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const serverSrc = path.resolve(__dirname, '..', 'src');
mockModule(path.join(serverSrc, 'db.js'), { db: { query: mockQuery } });
mockModule(path.join(serverSrc, 'middleware', 'auth.js'), {
  requireAuth: (req, _res, next) => { req.user = { id: 1, email: 'test@x' }; next(); },
  requirePermission: () => (_req, _res, next) => next(),
  signToken: () => 'test-token',
});
mockModule(path.join(serverSrc, 'services', 'activity.js'), {
  logActivity: async (a) => { state.activities.push(a); },
});
mockModule(path.join(serverSrc, 'services', 'mailer.js'), {
  sendMail: async () => {},
});

// ------ now pull in the real route ------------------------------------------

const express = require('express');
const request = require('supertest');
const invoicesRouter = require(path.join(serverSrc, 'routes', 'invoices.js'));

const app = express();
app.use(express.json());
app.use('/api/invoices', invoicesRouter);
// Global error handler so failures surface as proper HTTP responses (matches src/index.js)
app.use((err, _req, res, _next) => {
  if (err?.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', issues: err.issues });
  res.status(500).json({ error: err.message });
});

// ------ tiny test runner ----------------------------------------------------

const results = [];
async function test(name, fn) {
  state.reset();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    if (err.stack && process.env.VERBOSE) console.log(err.stack);
  }
}

function assertEq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg || 'assertEq'}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }

// ------ test cases -----------------------------------------------------------

async function run() {
  console.log('\n== Create New Invoice ==');

  await test('TC-1 Create: happy path — tax + discount math correct', async () => {
    const payload = {
      contact_id: 1, organization_id: 1,
      issue_date: '2026-04-01', due_date: '2026-04-15',
      tax_rate: 8.25, discount_rate: 10,
      memo: 'Test invoice',
      line_items: [
        { description: 'Widget',  quantity: 10, unit_price: 100 },   // 1000
        { description: 'Service', quantity: 2,  unit_price: 250 },   //  500
      ],
    };
    const r = await request(app).post('/api/invoices').send(payload);
    assertEq(r.status, 201, 'status');
    assert(/^INV-\d{4}-\d{6}$/.test(r.body.invoice_number), 'invoice_number format');
    // subtotal 1500, discount 150, taxable 1350, tax 111.375 → 111.38, total 1461.38
    assertEq(r.body.subtotal, 1500, 'subtotal');
    assertEq(r.body.discount_amount, 150, 'discount');
    assertEq(r.body.tax_amount, 111.38, 'tax');
    assertEq(r.body.total, 1461.38, 'total');
    // owner defaulted to current user
    const row = state.invoices.get(r.body.id);
    assertEq(row.owner_id, 1, 'owner defaulted from req.user');
    assertEq(row.status, 'draft', 'status defaults to draft');
  });

  await test('TC-2 Create: missing line_items → 400', async () => {
    const r = await request(app).post('/api/invoices').send({
      issue_date: '2026-04-01', due_date: '2026-04-15',
    });
    assertEq(r.status, 400, 'status');
  });

  await test('TC-2b Create: empty line_items array → 400 (schema min(1))', async () => {
    const r = await request(app).post('/api/invoices').send({
      issue_date: '2026-04-01', due_date: '2026-04-15', line_items: [],
    });
    assertEq(r.status, 400, 'status');
  });

  await test('TC-3 Create: zero-qty + large-decimal qty lines compute correctly', async () => {
    const r = await request(app).post('/api/invoices').send({
      issue_date: '2026-04-01', due_date: '2026-04-15',
      tax_rate: 0, discount_rate: 0,
      line_items: [
        { description: 'Free trial',    quantity: 0,     unit_price: 99 },   //  0
        { description: 'Hourly billed', quantity: 12.5,  unit_price: 80 },   // 1000
      ],
    });
    assertEq(r.status, 201);
    assertEq(r.body.total, 1000, 'zero-qty line does not corrupt totals');
  });

  await test('TC-3b Create: sequential invoice numbers increment', async () => {
    const mk = () => request(app).post('/api/invoices').send({
      issue_date: '2026-04-01', due_date: '2026-04-15',
      line_items: [{ description: 'X', quantity: 1, unit_price: 10 }],
    });
    const a = await mk(); const b = await mk(); const c = await mk();
    const seq = (n) => Number(n.split('-').pop());
    assert(seq(b.body.invoice_number) === seq(a.body.invoice_number) + 1, 'b=a+1');
    assert(seq(c.body.invoice_number) === seq(b.body.invoice_number) + 1, 'c=b+1');
  });

  console.log('\n== Update Invoice ==');

  async function createBase() {
    const r = await request(app).post('/api/invoices').send({
      contact_id: 1, organization_id: 1,
      issue_date: '2026-04-01', due_date: '2026-04-15',
      tax_rate: 10, discount_rate: 0,
      line_items: [{ description: 'Base', quantity: 1, unit_price: 100 }],
    });
    return r.body.id;
  }

  await test('TC-4 Update: replace line items → totals recompute', async () => {
    const id = await createBase();
    const r = await request(app).put(`/api/invoices/${id}`).send({
      line_items: [
        { description: 'New A', quantity: 3, unit_price: 50 },   // 150
        { description: 'New B', quantity: 1, unit_price: 20 },   //  20
      ],
    });
    assertEq(r.status, 200, 'status');
    assertEq(r.body.totals.subtotal, 170, 'subtotal');
    assertEq(r.body.totals.tax_amount, 17, 'tax 10% of 170');
    assertEq(r.body.totals.total, 187, 'total');
    // Old line items are gone, new ones in their place
    const lines = [...state.lineItems.values()].filter((l) => l.invoice_id === id);
    assertEq(lines.length, 2, 'exactly two new line items');
  });

  await test('TC-5 Update: scalar-only (memo + tax_rate) — totals still refresh from existing lines', async () => {
    const id = await createBase(); // subtotal 100, tax 10, total 110
    const r = await request(app).put(`/api/invoices/${id}`).send({
      memo: 'Updated memo', tax_rate: 0,
    });
    assertEq(r.status, 200);
    assertEq(r.body.totals.subtotal, 100, 'subtotal unchanged');
    assertEq(r.body.totals.tax_amount, 0, 'tax cleared to 0');
    assertEq(r.body.totals.total, 100, 'total now matches subtotal');
    const row = state.invoices.get(id);
    assertEq(row.memo, 'Updated memo', 'memo updated');
  });

  await test('TC-6 Update: reject paid/void invoices', async () => {
    const id = await createBase();
    state.invoices.get(id).status = 'paid';
    const r = await request(app).put(`/api/invoices/${id}`).send({ memo: 'nope' });
    assertEq(r.status, 400);
    assert(String(r.body.error).includes('paid'), 'error mentions status');
  });

  await test('TC-7 Update: 404 on unknown id', async () => {
    const r = await request(app).put('/api/invoices/99999').send({ memo: 'x' });
    assertEq(r.status, 404);
  });

  await test('TC-8 Update: partial — update only due_date, totals refresh unchanged', async () => {
    const id = await createBase();
    const r = await request(app).put(`/api/invoices/${id}`).send({ due_date: '2026-05-15' });
    assertEq(r.status, 200);
    const row = state.invoices.get(id);
    assertEq(row.due_date, '2026-05-15', 'due_date updated');
    assertEq(row.total, 110, 'total unchanged');
  });

  console.log('\n== Edge cases (looking for bugs) ==');

  await test('TC-E1 Create: bogus date string ("banana") should 400, not 500', async () => {
    const r = await request(app).post('/api/invoices').send({
      issue_date: 'banana', due_date: 'not-a-date',
      line_items: [{ description: 'X', quantity: 1, unit_price: 10 }],
    });
    // Ideal: 400 from schema. Currently accepted → MySQL would reject → 500 in prod.
    assert(r.status !== 500, `expected <500, got ${r.status} — route forwards bad date straight to DB`);
    assertEq(r.status, 400, 'dates should be validated by the schema');
  });

  await test('TC-E2 Create: discount_rate > 100 should 400 (or clamp)', async () => {
    const r = await request(app).post('/api/invoices').send({
      issue_date: '2026-04-01', due_date: '2026-04-15',
      tax_rate: 0, discount_rate: 150,
      line_items: [{ description: 'X', quantity: 1, unit_price: 100 }],
    });
    // A discount rate > 100% is nonsense — the book should refuse.
    // Current code silently caps taxable at 0 but still writes discount_amount = subtotal * 1.5
    assertEq(r.status, 400, 'server should reject discount_rate > 100');
  });

  await test('TC-E3 Create: tax_rate > 100 should 400 (sanity cap)', async () => {
    const r = await request(app).post('/api/invoices').send({
      issue_date: '2026-04-01', due_date: '2026-04-15',
      tax_rate: 9999, discount_rate: 0,
      line_items: [{ description: 'X', quantity: 1, unit_price: 100 }],
    });
    assertEq(r.status, 400, 'server should reject impossible tax_rate');
  });

  await test('TC-E4 Update: sending line_items: [] should 400 (min 1)', async () => {
    const id = await createBase();
    const r = await request(app).put(`/api/invoices/${id}`).send({ line_items: [] });
    assertEq(r.status, 400, 'empty array should fail schema validation');
  });

  await test('TC-E5 Update: negative tax_rate should 400', async () => {
    const id = await createBase();
    const r = await request(app).put(`/api/invoices/${id}`).send({ tax_rate: -5 });
    assertEq(r.status, 400, 'negative rate rejected by nonnegative()');
  });

  // ------ summary -----------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nFailures:');
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.err.message}`));
    process.exit(1);
  }
}

run().catch((e) => { console.error('harness error:', e); process.exit(2); });
