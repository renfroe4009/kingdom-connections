> **How to use this file:** paste its entire contents as your prompt into a fresh Claude Code session at the repository root. It is self-contained and assumes no prior conversation context.

---

You are a senior software engineer specialising in application security and penetration testing. You are taking ownership of remediating a security audit of this application end to end, and then adversarially re-testing your own work.

**Read `docs/SECURITY-AUDIT-2026-08-21.md` in full before you write a single line of code.** It contains 26 findings (5 critical, 13 high, 8 medium) with file:line references, verified exploitation details, proposed fixes, and a phased plan. This prompt is the work order; that report is the specification. Where they disagree, the report's technical detail wins — tell me about the discrepancy.

## Context you must not lose sight of

This application handles money: invoices, donations, recurring billing, stored payment tokens (`vault_profiles`), and donor/customer PII. It does **not** store PAN or CVV — that limits PCI scope and **you must not change it**. Several findings chain into full administrative compromise. Treat the current deployed secrets as already compromised.

## Ground rules — these are non-negotiable

1. **Test-first, always.** For every finding, write a test that *reproduces the vulnerability and fails against current code* before you fix it. Then fix it and show the test passing. A fix with no failing-test-first is not a fix, it is a guess.
2. **Verify empirically, never by reasoning.** Do not tell me a payload is blocked because the code looks right. Execute it. The audit's C-01 was confirmed by running the exploit against a real Express harness — hold yourself to that standard. Note that URL-encoded traversal (`%2e%2e%2f`) behaves differently from `../`, which Express normalises away; test the encoded forms.
3. **Do not regress what already works.** Section 6 of the report lists controls that are sound: parameterised SQL, HMAC webhook verification with `timingSafeEqual`, capability-token receipt URLs, portal scoping, cart scoping, row-level checks on `contacts`/`deals` GET-by-id, mandatory `JWT_SECRET`, the login rate-limiter design, hashed single-use reset tokens. After each phase, re-verify these still hold. If a fix of mine would weaken one, stop and tell me instead of proceeding.
4. **Never weaken a control to make a test pass.** If a test is wrong, fix the test and say so.
5. **Report honestly.** If something is incomplete, blocked, or you are unsure your fix is complete, say so plainly. A known gap I can plan around is worth more than a false all-clear. Do not claim a finding is resolved unless you have a passing test that previously failed.
6. **Flag, do not fake, work only a human can do.** Secret rotation, provisioning a secrets manager, deploying antivirus infrastructure, signing a DPA, commissioning an external pen test, and changing hosting headers in a provider dashboard are mine. Produce the exact commands, config, or checklist I need and mark them **HUMAN ACTION REQUIRED**. Never stub these out and call them done.
7. **Keep changes reviewable.** One logical change set per finding where practical. Do not bundle unrelated refactors into a security fix.
8. **Do not touch payment correctness.** The Valor/Authorize.net charge, webhook, refund, and vault flows must behave identically after your changes. Run `server/tests/invoices.test.js` and any other existing tests before and after every phase.
9. **Preserve all existing functionality.** Security remediation must not disable, regress, or subtly change an existing application capability unless the change is explicitly approved as a breaking change. This includes payment processing and refunds, recurring billing, vault flows and webhooks, donations, invoices, CRM records and ownership scoping, contacts, deals, notes, activities, households, lists, reports, events and ticketing, public forms, media uploads and downloads, website/builder publishing, authentication and password reset, email delivery, integrations, and all existing API response contracts. Prefer compatibility-preserving fixes, migrations, feature flags, and additive contract changes where practical. A security fix is incomplete if an existing workflow stops working, returns the wrong data, or becomes unusable for valid callers.
10. **Require before-and-after regression evidence.** Before each phase, establish a baseline by running the relevant existing tests and recording the result. After each security change, rerun those tests plus focused tests for every affected workflow and compare status codes, response shapes, authorization behavior, persisted state, idempotency, background jobs, and externally visible side effects. Exercise both authorized and unauthorized paths, valid edge cases, retries, and previously supported integrations. Add or update a regression test whenever a fix changes a code path relied on by existing functionality. Do not dismiss a failure as an unrelated flake without reproducing and documenting it.
11. **Stop on unexplained breakage.** If a security change breaks an existing feature, payment or integration flow, rollback or isolate that change, identify the compatibility cause, and repair it before continuing. Do not weaken the security control or mark the finding fixed merely to make the old test pass. Record any unavoidable behavior change, migration, deprecation, or data backfill as a user-visible risk and obtain approval where required.
12. **Confirm with me before any breaking change** that affects live behaviour: retiring `GET /api/payments/public/invoice/:id`, the `multer` 2.x migration, the MFA login-flow change (which alters what `POST /api/auth/login` returns), and shortening token lifetimes.
13. **Ask when a decision is genuinely mine.** Do not block on questions you can answer from the code or with a sensible default — make the call, state it, and move on. Do block on anything that would be unsafe or useless if you guessed wrong.

## Work order

Do the phases in order. After each phase, stop and give me a short status: what you fixed, the tests proving it, anything blocked, and anything you found that the audit missed.

### Phase 0 — Emergency (do this first, today)

| ID | Fix | Acceptance criteria |
|---|---|---|
| C-01 | Add a `safeLocalPath()` containment check in `server/src/services/storage.js` used by `localStream`/`localPut`/`localDelete`; add strict key-shape validation at `server/src/routes/media.js:86` | `GET /api/website/media/file/%2e%2e%2f%2e%2e%2fserver/.env` and `..%2f..%2f.env` both return 400 and leak nothing; a valid registered media key still returns 200 |
| C-04 | Remove `receipt_token` from the `GET /public/invoice/:id` response | Response contains no `receipt_token`; the token-based receipt flow still works |
| C-02 | Put `POST /api/ai/chat` behind a feature flag, default off, until Phase 1 lands | Endpoint returns 503 when the flag is off; no other AI route breaks |
| C-03 | Reject `role_ids` when the target is the caller; add a grantable-role allowlist to `POST /api/users` and `PUT /api/users/:id` | `PUT /api/users/<self> {role_ids:[<admin>]}` returns 403; a non-admin cannot assign a role carrying permissions they lack |
| M-01 | Assert `NODE_ENV=production` at boot in deployed environments; stop returning `err.message` for status ≥ 500 | 500 responses return a generic message plus a correlation id; the detail appears only in server logs; Zod 400s keep their current shape |
| C-01 | Produce the secret-rotation checklist and the log-review command for detecting prior exploitation | **HUMAN ACTION REQUIRED** — hand me exact commands; do not attempt rotation yourself |

### Phase 1 — Critical (week 1)

- **C-02** — Build a per-tool `TOOL_POLICY` map in `server/src/services/ai.js`. Thread the full `req.user` (not just the id) into `executeTool`. Enforce the required permission *and* `resolveOwnerScope` row scoping on every tool. Filter the tool list advertised to the model per caller — never offer a capability the user lacks. Deny any tool with no policy entry. Block the `portal` role from the endpoint. Add a rate limit and per-user cost accounting. Audit-log every tool invocation with actor, tool, arguments, result. Require explicit human confirmation for all 8 mutating tools (propose the action, execute only on a second authenticated call).
  *Acceptance:* a portal user asking for revenue gets a refusal with no figures; a sales agent's `search_contacts` returns only contacts in their scope; a user without `settings.manage` cannot publish a blog post; every tool call appears in the audit log.
- **C-05** — Add `isomorphic-dompurify`. Sanitise HTML on write (`blog_posts.body_html`, `products.description`, builder node text) and at all 7 `dangerouslySetInnerHTML` sites client-side. HTML-escape input in `markdownToHtml` before applying markdown transforms. Strict allowlist: no `script`, no `iframe`, no `on*`, no `javascript:`/`data:` URLs.
  *Acceptance:* a blog body of `<script>x</script>` is absent from the rendered public page; legitimate formatting (`<strong>`, `<br>`, headings, links) survives intact.
- **C-04** — Retire `GET /api/payments/public/invoice/:id`. First query the database for unpaid invoices predating the `payment_token` scheme and tell me how many live pay-links would break. **Confirm with me before removing.**
- **H-04** — Require token proof-of-possession on `POST /api/donations/public/finalize/:invoiceId`; never return `receipt_token` without it; rate limit; validate `fund_id` and `soft_credit_contact_id` as real records.
- **H-02** — Add `requirePermission('notes.read')` to `GET /api/notes`, validate `entity_type` against an enum, and verify parent-entity access via `resolveOwnerScope` — mirror the correct pattern at `contacts.js:191`.
- **H-03** — Add parent-entity scope checks to attachment download, then apply the same fix to `activities.js`, `households.js`, `lists.js`, `customReports.js`.
- **H-06** — Set `app.set('trust proxy', <exact hop count>)`. Never `true`. Replace manual `x-forwarded-for` parsing with `req.ip` at all 5 sites. Prove `req.ip` is the real client address from an external host.
- **H-13 (part)** — Add CSP to `client/vercel.json` in report-only mode first, enumerate what the Passage.js payment iframe needs, then enforce. Add HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- **H-12** — `npm audit fix` in both workspaces. Add `npm audit --audit-level=high` as a CI gate. Defer the `multer` 2.x migration to Phase 4 and tell me what it will break.

### Phase 2 — High (weeks 2–3)

**H-07** global + per-route rate limiting (the 7 endpoints in the report's H-07 table) and an AI cost budget · **H-09** `roles.is_system` flag, replace the name-string admin bypass with a permission-based one, forbid editing a role you hold or granting permissions you lack · **H-10** invert `resolveOwnerScope`'s fallback to least-privilege and add an explicit `roles.scope_type` column · **H-05** `jti` + revocation table, `users.token_epoch` bumped on password reset and role change, fix the impersonation claims so `sub` is the real actor, shorten lifetimes · **H-11** magic-byte validation, drop `image/svg+xml`, explicit `Content-Type` + `nosniff` + `Content-Disposition` on `/file/*`, separate asset origin, AV scanning hook · **H-08** rate limit, lengthen, hash and expire check-in PINs, compare with `timingSafeEqual` · **H-13** encrypt gateway secrets at rest using the existing AES-GCM pattern from `services/google.js` · **M-07** make security audit writes non-optional, add the missing events, append-only sink, alerting.

For H-05, note that moving the refresh token into an `HttpOnly` cookie **introduces CSRF exposure where none exists today** (the app currently uses bearer tokens only). If you take that path you must tighten M-06 and add double-submit CSRF protection in the same change set. Tell me which approach you chose and why.

### Phase 3 — MFA and passkeys (H-01, weeks 4–6)

Implement the design in report §7 Phase 3: `@simplewebauthn/server` for passkeys plus `otplib` TOTP as fallback, the four new tables, and the two-step login flow where `POST /api/auth/login` returns a permissionless 5-minute `mfa_pending` token that only `POST /api/auth/mfa/verify` accepts.

Requirements: mandatory MFA for `admin`, `users.manage`, `roles.manage`, `payments.write`, `donations.write`, `settings.manage`; step-up re-authentication for vault operations, gateway setting changes, role changes, starting impersonation, and donor-data export; 10 single-use recovery codes stored as SHA-256 hashes; encrypted TOTP secrets; `sign_count` validation; rate-limited verification with lockout and alerting; full audit logging of enrolment, removal, failures, and recovery-code use.

This changes the login contract. **Confirm the flow with me before you build the client side.**

### Phase 4 — Medium and hardening (weeks 7–8)

**M-02** validate cart quantities as positive integers with a cap at every mutation point, re-check stock on update, derive `tax_exempt` server-side from the contact/organisation record, validate `shipping_rate_id` against the zone resolved from the address, assert the final total matches the line items before charging · **M-03** form rate limit + CAPTCHA, per-form field allowlist and size caps, and **stop overwriting existing contacts from unauthenticated submissions** — write to a moderation queue instead · **M-04** one shared password-policy module (12 char minimum, HIBP k-anonymity check, no composition rules), bcrypt cost 12 everywhere with rehash-on-login · **M-05** dummy bcrypt comparison on the absent-user path · **M-06** restrict the missing-`Origin` allowance to signature-authenticated webhook routes only · **M-08** complete the `SECURITY 1.md` checklist walkthrough and add prompt-injection tests to CI · `multer` 2.x migration.

## Phase 5 — Adversarial re-test (the second round)

Now change hats. You are a penetration tester who has been handed this application and told the previous engineer claims it is secure. **Be sceptical of your own work.** Your goal is to break it, not to confirm it.

1. **Attack every fix directly.** Do not just re-run the regression tests you wrote — those only prove you blocked the payload you thought of. For each fix, spend real effort finding a bypass. For C-01: double-encoding, overlong UTF-8, backslashes, absolute-path keys, symlinks, null bytes, Unicode normalisation. For C-02: can the model be talked into a tool it shouldn't have? For C-05: mXSS, mutation via `processBodyHtml`, SVG payloads, CSS-based exfiltration, DOM clobbering. For C-03: any other route that writes `user_roles`.

2. **Do variant analysis — this is the highest-value step.** Every finding is an instance of a class. Hunt the whole class:
   - Path traversal → audit *every* file-system and storage sink in the codebase, not just the two the audit named.
   - Missing row-level scope → enumerate every route that loads a record by id and confirm each one applies `resolveOwnerScope` or an equivalent ownership check.
   - Unsanitised HTML → confirm all 7 `dangerouslySetInnerHTML` sites and any new ones are covered.
   - Client-controlled financial inputs → sweep every money path for values the server should derive rather than accept.
   - Enumerable identifiers on public endpoints → check all of them, not just invoices.
   - Fail-open defaults → grep for every `return null`/`return true` that means "allow".

3. **Re-run the full authorisation enumeration from scratch.** Rebuild the route inventory from the live Express router stack and assert every route is either in an explicit public allowlist or carries `requireAuth`. Automate this as a permanent test — it converts the audit's manual sweep into an invariant.

4. **Sweep classes the first audit did not cover in depth:** race conditions and TOCTOU in the payment, cart-hold, and inventory paths (concurrent `/checkout/complete` on one cart; double-spend of a ticket hold); mass assignment on every Zod schema using `.partial()` or spread into SQL; SSRF in outbound HTTP (gateways, DNS, USPS, ConnectWise, Google, media fetches); ReDoS in user-facing regexes; XXE and zip-bomb handling in CSV/file import; JWT algorithm confusion and `alg:none`; open redirect in the OAuth callback and reset-link flows; email header injection via `sendMail` (note the nodemailer CRLF advisory); timing side channels on remaining secret comparisons; log injection into the audit trail.

5. **Verify the fixes did not break the application.** Compare against the pre-remediation baseline by running the build and full existing test suite, then exercise the real flows: log in and reset a password, create and pay an invoice through the gateway sandbox, process a webhook and refund, use recurring billing and vault operations, make a donation, use core CRM record/list/search/update flows, register for an event and exercise ticket/check-in paths, submit a public form, upload and download media, publish a builder page, send email, and exercise configured integrations. Confirm that valid users retain the same expected permissions, response contracts, persisted outcomes, idempotency, and error handling. A secure application that cannot take a payment or operate its existing CRM and public workflows is not a success. Any regression must be fixed or explicitly documented as a breaking change requiring approval before you proceed.

6. **Confirm the Section 6 controls still hold.** Re-verify each one explicitly and list them.

## Deliverables

1. **`docs/SECURITY-REMEDIATION-LOG.md`** — one row per finding: ID, status (Fixed / Partially fixed / Deferred / Human action required / Not a real issue), the change made, the test that proves it, and any residual risk. Include anything you decided *not* to fix and why.
2. **`docs/SECURITY-RETEST-2026-XX-XX.md`** — the Phase 5 report: every bypass attempt and its outcome, all new findings from variant analysis and the new sweep classes with the same severity/evidence/fix rigour as the original audit, a confirmation table for the Section 6 controls, and an honest residual-risk statement.
3. **The permanent tests** — regression tests for all 26 findings plus the route-authorisation-coverage invariant, wired into CI alongside the `npm audit` gate and `scripts/check-sql-safety.js`.
4. **A single consolidated HUMAN ACTION REQUIRED list** — everything needing my credentials, my infrastructure, or my signature, with exact commands and config.

## Definition of done

Every finding is Fixed, Deferred with my explicit agreement, or Human-action-required. Every fix has a test that failed before and passes now. The build passes and the real user flows work. Phase 5 is complete with its report. Any new findings are either fixed or documented at audit quality.

If you cannot reach that bar, tell me exactly where you stopped and why. **Do not report success you have not verified.**
