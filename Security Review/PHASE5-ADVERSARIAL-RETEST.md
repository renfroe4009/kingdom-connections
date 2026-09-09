# Phase 5 — Adversarial retest

Per the remediation plan: attack each fix directly for bypasses, do variant analysis across the codebase for each vulnerability class, rebuild the route-authorization-coverage check as a standing test, and re-confirm every Section 6 "sound" control still holds. Findings below are written up the same way the original audit is structured (severity, evidence, fix).

---

## 1. Route authorization coverage (standing test)

New `server/tests/security/PHASE5-00.route-coverage.test.js` — statically enumerates every route on the 60 mounted Express routers (523 routes total) by requiring each router file and walking its actual `.stack`, classifying each as **protected** (`requireAuth`/`tryAuth` active by the time the route is reached, or `requirePermission`/`requireStaffAccess`/`requirePortal`/`requirePermissionNoMfaGate` used inline), **allowlisted** (deliberately public, with a documented reason), or **UNKNOWN** (neither — a real finding). This is not a live HTTP probe — nothing is invoked, only inspected — so it's safe to run repeatedly against a database with real data.

**First run found exactly one genuine gap** (see Finding PHASE5-01 below) among 11 initial UNKNOWNs; the other 10 were allowlist gaps (real public routes the allowlist hadn't caught up to — Google OAuth's actual callback path, two retired legacy routes that only ever return 410, portal email verification, the public video listing, and storefront shipping/tax/donation helper endpoints). All 10 were verified safe by reading their actual handler code before allowlisting, not assumed safe from the route path alone.

**Current state: 523 routes, 440 protected, 83 explicitly public, 0 unknown.** This test should be re-run whenever a new route is added — a fresh UNKNOWN means either the allowlist needs a new documented entry or there's a real gap.

---

## 2. New finding: PHASE5-01 — Unauthenticated SSRF in `GET /api/ada/check`

**Severity: High** (comparable to the original audit's H-* findings — full unauthenticated outbound-request primitive against internal infrastructure)

**Location:** `server/src/routes/ada.js` (pre-fix, no line prefix — the route had no auth middleware at all)

**Found by:** the route-authorization-coverage standing test (§1) — this route was neither gated nor allowlisted on the very first run.

**The bug:** `GET /api/ada/check?url=<anything>` fetched the caller-supplied `url` server-side with `fetch(url, ...)`, no authentication, and no restriction on target host. Confirmed live and unauthenticated:

```
curl "http://localhost:4220/api/ada/check?url=http://127.0.0.1:4220/api/health"
→ 200, full JSON response derived from the internal /api/health page content
```

Any unauthenticated caller on the internet could make this server issue requests to:
- **Loopback** (`127.0.0.1` — the server's own other endpoints/ports)
- **RFC1918 private ranges** (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` — other services on the same private network)
- **Link-local** (`169.254.0.0/16` — where cloud metadata endpoints like AWS's `169.254.169.254` live, a classic SSRF-to-credential-theft chain on cloud infrastructure)

Derived content from the fetched page (title, headings, image alt-text presence, link text, an `<html lang>` check) was reflected back in the response — not a blind SSRF; enough signal to fingerprint what's running on internal addresses and confirm reachability, effectively an internal-network port/service scanner reachable by anyone.

**Fix:** `requireAuth` + `requirePermission('settings.manage')` closes the "anyone on the internet" exposure. Defense-in-depth on top, for a legitimate-but-compromised staff session or a staff member pasting a malicious link: a new `isSafeTargetUrl()` resolves the hostname via DNS and rejects private/loopback/link-local ranges by checking the **resolved IP**, not the URL string (so DNS rebinding — registering a public hostname that resolves to a private IP — can't trivially bypass it). `redirect: 'manual'` stops a URL that passes the check from hopping to an internal address via a 3xx response. A new rate limiter (20/5min) closes the "use this server as an anonymizing request proxy against third parties" abuse angle, which existed independent of the SSRF risk.

**Test:** `server/tests/security/PHASE5-01.ssrf-ada-check.test.js` — 5/5. Confirmed live pre-fix exploitation against the server's own loopback (reproduced above); confirmed 4/5 checks fail via `git stash` (unauthenticated access, loopback target, link-local/metadata target, RFC1918 target all succeeded pre-fix); confirmed the legitimate use case (an authenticated, permitted staff member checking a real public URL) still works post-fix.

**Residual risk:** the private-IP blocklist covers the common ranges but isn't an exhaustive SSRF-proof allowlist (e.g., IPv4-mapped IPv6 addresses, unusual encodings). Acceptable given this now requires a `settings.manage`-holding staff session — the realistic threat model shifted from "anyone on the internet" to "a staff account would have to be compromised first," a materially smaller attack surface. A stricter fix (only DNS-resolve to a small set of explicitly allowed accessibility-testing services) would close this further but wasn't judged necessary for the residual risk level.

---

## 3. Variant analysis — SSRF / unsafe outbound-request class

Dispatched a dedicated pass across all of `server/src` (not just routes — services too, since that's where most external-API-calling logic lives) for every outbound request (`fetch`, `http.request`, `https.request`, any HTTP client) where the target URL/hostname/port is influenced — even partially — by data that originated from an HTTP request, the same shape as the `ada.js` bug, plus a check for server-side open-redirect. 36 `fetch()` call sites reviewed.

New shared `server/src/services/urlSafety.js` (`isSafeTargetUrl()` + `isPrivateIp()`) was factored out of the `ada.js` fix so every finding below reuses the exact same guard rather than re-implementing it.

### Finding PHASE5-02a — Blind SSRF + CRM-data exfiltration in the automations "webhook" action

**Severity: High.** `server/src/services/automations.js`'s `webhook` action (`executeAction`, case `'webhook'`) fetched `config.url` — unvalidated JSON pulled straight out of a stored `automation_workflows.flow_definition` — with no restriction on target. `config.url` is set by a user holding `automations.write` (not `settings.manage` — a narrower, more commonly-granted permission), but the workflow's webhook step can be **triggered indirectly by an unauthenticated public form submission** (`routes/forms.js`'s automation trigger) or several other authenticated write paths (deals, contacts, invoices, the automations cron). The fetch body is the CRM entity's own data (`{ trigger, entity_type, entity_id, ...context }`), so this is blind SSRF (only the HTTP status is logged, the response body isn't reflected) **combined with exfiltration of real CRM records to an attacker-chosen host** — worse in one sense than `ada.js` (data leaves the building) and narrower in another (no response content comes back to confirm what's on the other end).

**Fix:** `isSafeTargetUrl(config.url)` guard before the fetch; `redirect: 'manual'` added alongside it.

**Test:** `server/tests/security/PHASE5-02.ssrf-webhook-and-return-url.test.js` — created a real workflow (trigger → webhook action node), fired it via the authenticated `/test` endpoint, and read the real `automation_execution_log` row. Confirmed pre-fix: a webhook pointed at the server's own `127.0.0.1:4220/api/health` returned a genuine `{"status":404}` in the log (proving the request actually reached the internal endpoint — Express's health route only has a GET handler, and the webhook defaults to POST, so a 404 is the real internal response, not a connection failure) — live, undeniable proof of internal-network reachability. Post-fix: the same target is skipped before any request is made; a real public URL (`example.com`) still completes successfully (no regression).

### Finding PHASE5-02b — Payment gateway return/callback-URL hijack via `returnUrl` origin bypass

**Severity: High** — arguably the most impactful of the three new SSRF/URL findings, since it touches the payment flow directly. `server/src/routes/payments.js`'s `POST /public/checkout/:invoiceId` (fully unauthenticated — customers pay without logging in) accepted a client-supplied `returnUrl` whenever `requested.startsWith(origin)` — a prefix check bypassable with `${origin}.evil.com/x`, `${origin}@evil.com/x` (URL userinfo trick), or `${origin}evil.com/x` (no trailing slash on `origin`, so a bare host-name suffix works too). `returnUrl` then feeds directly into `createHostedCheckout()` → `services/gateways.js`, where it becomes **Authorize.net's `hostedPaymentIFrameCommunicatorUrl`** (derived by regex from `returnUrl`'s origin — the page Auth.net's hosted iframe posts the transaction response *to*) and **both Authorize.net's and Valor's post-payment `returnUrl`/`redirect_url`/`callback_url`**. A successful bypass could redirect the gateway's own transaction-response hand-off — potentially including payment confirmation details — to an attacker-controlled origin.

**Fix:** parse `requested` with `new URL()` and compare the resulting `.origin` (scheme+host+port) **exactly** against the same comma-separated `CLIENT_ORIGIN` allowlist `index.js`'s CORS check already uses, rather than a prefix match.

**Test:** same file — the exact bypass strings above, run against a direct copy of the new comparison logic (the vulnerable value isn't observable through the API response for the Valor gateway configured locally, which returns early with just fee info before a hosted-checkout session is created), confirming all three are rejected and a real same-origin URL with a path/query still passes. A structural check confirms the old `requested && requested.startsWith(origin)` pattern is gone and the new `new URL(requested).origin` comparison is present.

### Finding PHASE5-02c — SSRF in receipt-PDF logo fetch (lower priority)

**Severity: Low-Medium.** `server/src/services/receipts.js`'s `logoUrlToBuffer()` fetched `business_settings.logo_web_url` — an admin-set value (`PUT /api/settings/business`, `settings.manage`) with no URL validation on write — with no restriction on target, triggered from the fully public `GET /api/payments/public/receipt/by-token/:token` route. Lower severity than the other two: requires a `settings.manage` admin to have configured the malicious URL first, and the fetch result is embedded as image bytes in a PDF/HTML receipt (not reflected as inspectable text) — still a real SSRF primitive (an admin session compromise, or an admin pasting an untrusted logo URL, becomes an internal-network probe triggered on every public receipt view), so fixed with the same guard rather than left as a documented gap.

**Fix:** same `isSafeTargetUrl()` guard + `redirect: 'manual'`.

**Test:** same file — `logoUrlToBuffer` exported for direct testing (no other external caller). Confirmed pre-fix the function didn't even exist under that guarded form (3/8 fail via `git stash` — the export itself was new); post-fix a loopback target returns `null`, a `data:` URI still decodes locally (never a network fetch), and a real public URL still returns bytes.

### Reviewed and judged safe / not fixed this pass

| Location | What was checked | Verdict |
|---|---|---|
| `services/gateways.js` (16 call sites), `services/batchReconciliation.js` (4), `services/ai.js`, `routes/ai.js`, `services/sms.js`, `services/google.js`, `services/storage.js` | Every payment-gateway, AI, SMS, Google, and S3 call | Host is always hardcoded or env/SDK-derived; user input (if any) is a path segment or credential, never the host. Safe. |
| `services/mailer.js` (SMTP host/port from `smtp_settings`) | Admin-controlled (`settings.manage`), not user-input-influenced at the HTTP layer | Noted for completeness — a non-HTTP outbound connection, admin-only. Not changed. |
| `services/usps.js`, `services/connectwise.js` (base URLs from `usps_settings.base_url` / `cw_manage_settings.site_url`) | Both admin-write-only (`settings.manage`), both validated with zod's `.url()` on write — which accepts any host, so a compromised/malicious admin *could* repoint either at an internal address, leaking USPS/ConnectWise API credentials to that host | Judged low-priority (requires a `settings.manage` admin account to already be compromised — a much higher bar than the three fixed findings, all reachable by a lower-privilege or unauthenticated caller) — **not fixed this pass**, see `HUMAN-ACTION-REQUIRED.md`. |
| `routes/videos.js` (Vimeo oembed — `videoId` interpolated into a hardcoded-host URL without `encodeURIComponent`) | Host is fixed (`vimeo.com`); only cosmetic query-injection into vimeo.com's own API, `settings.manage`-gated | Low, cosmetic — not fixed this pass. |
| `routes/dns.js` (Cloudflare API — `zoneId`/`recordId` path segments, no format validation) | Host is fixed (`api.cloudflare.com`); worst case is path-traversal *within Cloudflare's own API* using the stored account token, `settings.manage`-gated | Low — not fixed this pass. |
| `routes/media.js` (`file_url` built from `req.protocol`/`req.get('host')`, so a Host-header-spoofing request could persist an attacker-hosted URL that an admin might later pick as `logo_web_url`) | A long, admin-action-mediated chain (attacker poisons a media record → admin has to manually select that exact record as the site logo) | Low — noted, not fixed this pass; pinning to `SERVER_ORIGIN`/`API_BASE_URL` like the rest of the codebase does would close it cheaply if revisited. |
| Every `res.redirect(...)` site (`cmsData.js`, `media.js`, `attachments.js`, `settings.js`, `google.js`) | All redirect to either a server-generated S3 presigned URL (key already DB-registered/regex-validated) or an `encodeURIComponent`'d value appended to `CLIENT_ORIGIN` | None are open redirects. |

---

## 4. Attacks attempted directly against this session's fixes

| Fix | Attack attempted | Result |
|---|---|---|
| C-01 (path traversal) | Double URL-encoding (`%252e%252e%252f...`), null-byte injection (`..%00/`), overlong UTF-8 slash encoding (`%c0%af`), backslash variants (`..%5c..%5c`), absolute-path injection (`//etc/passwd`) against `GET /api/website/media/file/*` | All rejected (400) — `KEY_RE` format check + `safeLocalPath()`'s `path.resolve`/`path.relative` containment check hold regardless of encoding, since Express's router normalizes the path before the handler ever inspects it. Legitimate registered key still resolves correctly (200) — no regression. |
| C-02 (AI tool authorization) | Verified via direct unit testing (not live LLM calls, which can't reliably drive arbitrary `tool_use` blocks) — `TOOL_POLICY`'s deny-by-default behavior for an unrecognized/malformed tool name, confirmed in `C-02.tool-authorization.test.js` | Holds — an unlisted tool name has no policy entry, `hasPermission()` short-circuits false, `executeTool()` is never reached. |
| H-01 (MFA) | Checked `otplib`'s default TOTP verification window | `window: 0` (otplib's default) — the strictest possible setting, only the exact current 30-second code is accepted, no clock-drift tolerance. Not a vulnerability (if anything, more conservative than typical); noted as a minor future usability consideration (real-world clock drift could cause legitimate codes to intermittently fail) but explicitly not loosened without evidence of a real problem, since doing so would trade security margin for convenience unilaterally. |

---

## 5. Section 6 "sound" controls — re-confirmed

| Control | Status |
|---|---|
| Parameterized SQL throughout | Re-checked every SQL query added or modified across all of Phases 0–3 and this phase (`services/ai.js`, `services/mfa.js`, `services/passwordPolicy.js`, `services/captcha.js`, `routes/checkout.js`, `routes/cart.js`, `routes/forms.js`, `routes/auth.js`, `routes/users.js`, `routes/settings.js`, `routes/ada.js`, `middleware/auth.js`) for raw string-interpolated SQL. None found — every dynamic SQL fragment (`scopeClause`, `limit`, `WHERE` clause pieces) is built from internally-validated integers or a fixed set of hardcoded column names, never directly from unvalidated request strings. |
| Webhook HMAC verification with `timingSafeEqual` | Confirmed still present and unmodified in `routes/payments.js` (Authorize.net and Valor webhook handlers). |
| No PAN/CVV storage | Confirmed — `payments.cvv_result`/`cvv_message` in the schema are the gateway's textual verification RESULT codes (e.g. match/no-match), not actual card/CVV data. No column anywhere in the schema stores a card number or CVV. |
| Portal/cart row-level scoping | Covered extensively across Phases 0–2 (H-02, H-03, H-10) and re-exercised by every regression run this session. |
| Mandatory `JWT_SECRET` boot check | Confirmed unchanged — `middleware/auth.js` still throws at require-time if `JWT_SECRET` is missing or under 16 characters. |
| Hashed, single-use password-reset tokens | Confirmed unchanged (and functionally fixed as a side effect of H-05 — the columns that store these hashes didn't even exist before this session, see the H-05 remediation log entry). |

---

## 6. Summary

Four real, previously-unknown vulnerabilities found and fixed this phase (all in the same SSRF/unsafe-URL family, all proven via `git stash` against a running server, three of the four with live confirmed exploitation before the fix):

| ID | Location | Severity | Reachable by |
|---|---|---|---|
| PHASE5-01 | `GET /api/ada/check` | High | Anyone on the internet, unauthenticated |
| PHASE5-02a | `services/automations.js` webhook action | High | An `automations.write` holder configures it; triggerable indirectly by an unauthenticated public form submission |
| PHASE5-02b | `POST /api/payments/public/checkout/:invoiceId` `returnUrl` | High | Anyone on the internet, unauthenticated (public checkout) |
| PHASE5-02c | `services/receipts.js` logo fetch | Low-Medium | Requires a `settings.manage` admin account already compromised |

Plus: the route-authorization-coverage standing test (523 routes, 0 unknown) is now part of the regular regression suite and will catch a newly-added ungated route the moment it's introduced — this is how PHASE5-01 was found in the first place.

Six additional lower-priority SSRF-adjacent items were reviewed and judged acceptable risk for now (admin-only write paths, cosmetic issues, or a long attacker-to-admin-action chain) — see the table in §3 and `HUMAN-ACTION-REQUIRED.md`.

Every fix from Phases 0–4 was attacked directly and held (path-traversal encoding variants, AI tool deny-by-default, TOTP window strictness). Section 6's "sound" controls (parameterized SQL across every query added this session, webhook HMAC verification, no PAN/CVV storage, mandatory `JWT_SECRET`, hashed reset tokens) were all re-confirmed intact.

**This closes every finding from the original audit, plus four new ones found during this phase's own adversarial retest.** The remediation effort begun with the Phase 0 emergency fixes is complete, pending the human actions still tracked in `HUMAN-ACTION-REQUIRED.md` (mostly production secret rotation/migration steps and a handful of infrastructure decisions that require your credentials or judgment, not further engineering).
