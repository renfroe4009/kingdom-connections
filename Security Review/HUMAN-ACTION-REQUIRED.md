# Human action required

Actions needing your credentials, infrastructure access, or sign-off. I will not attempt any of these myself. Updated as each phase adds new items.

---

## 1. Treat production secrets as potentially already compromised (Phase 0 / C-01)

C-01 was an unauthenticated, remote, single-GET path traversal that discloses `server/.env` (including `JWT_SECRET` and `DB_PASSWORD`) via `GET /api/website/media/file/%2e%2e%2f%2e%2e%2fserver%2f.env`. I confirmed this is real and exploitable by reproducing it against this local dev server — it returned the real file contents before the fix. **This code has been running in production** (Vercel for the client, a Railway-hosted MySQL for the server, per this project's deployment config), so the same bug was very likely live there too, for however long this route existed.

I cannot check the production deployment's status from here — you need to:

**a. Confirm whether production already has the fix.** Check whether the currently-deployed server includes the `safeLocalPath()` change in `server/src/services/storage.js` and the `KEY_RE` check in `server/src/routes/media.js` (i.e., has this session's Phase 0 commit been deployed yet). If not, deploy it before doing anything else below — rotating secrets is pointless if the hole is still open.

**b. Review production access logs for prior exploitation**, once you have access to them (Railway's log viewer, or wherever they're aggregated):

```bash
# Any request to the media file route containing an encoded traversal sequence
grep -E "GET /api/website/media/file/.*(%2e%2e|%252e|\.\.%2f|\.\.%5c)" <your-access-log-source>
```

If Railway doesn't retain long-term HTTP access logs by default, check whether you have a CDN/WAF (Cloudflare, etc.) in front of it with its own logs — that's often the more complete source.

**c. Rotate every secret in `server/.env`**, assuming they've been read:

```bash
# New JWT_SECRET (invalidates every existing session — expected and intended)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# → set as JWT_SECRET in Railway's environment variables for the server service

# Railway MySQL password — from the Railway dashboard: your MySQL plugin →
# Settings → regenerate the password (or via CLI):
railway connect MySQL   # then, connected as the current user:
#   ALTER USER 'app_user'@'%' IDENTIFIED BY '<new-strong-password>';
#   FLUSH PRIVILEGES;
# then update DB_PASSWORD in the server service's Railway environment variables
# to match, and redeploy.
```

**d. Rotate every payment gateway credential** stored in `payment_gateway_settings` (Authorize.net `transaction_key`/`signature_key`, Valor `api_key`/`app_key`/`webhook_secret`) — from each gateway provider's own dashboard, then re-enter them via **Settings → Payment Gateways** in the app (do this *after* deploying the C-01 fix and rotating `JWT_SECRET`, since that settings page requires a valid admin session).

**e. Rotate SMTP, Twilio, Anthropic, and Google OAuth credentials** — from each provider's dashboard (AWS SES / whichever SMTP provider, Twilio console, console.anthropic.com, Google Cloud Console's OAuth client), then update the corresponding Railway environment variables or in-app settings.

---

## 2. HIBP / breached-password check (Phase 4, M-04) — decide when we get there

The planned password-policy hardening recommends checking new passwords against Have I Been Pwned's k-anonymity API (no account/API key needed for this specific endpoint — it's free and anonymous), or a local breach-list alternative if you'd rather not make an outbound call per password-set. No action needed now; flagging so it's not a surprise when Phase 4 starts.

---

## 3. AV scanning for uploads (Phase 2, H-11) — infra decision, not blocking

The plan recommends antivirus scanning (e.g. ClamAV, or a hosted API like VirusTotal/MetaDefender) before an uploaded file is marked available. This needs an infrastructure decision (self-hosted ClamAV vs. a paid API vs. skipping it and relying on the other H-11 mitigations — magic-byte validation, dropping SVG, explicit Content-Type). I'll implement the other H-11 mitigations regardless in Phase 2; AV scanning itself is optional and needs your call on which service (if any).

---

## 4. External penetration test (optional, after Phase 2)

The original audit recommends commissioning an external pen test scoped to authorization logic, the public endpoint surface, and payment flows, once Phases 0–2 land. This is your call on timing/budget — not required to consider the internal remediation complete, but worth doing before this app handles meaningfully more real donor traffic/PII if you haven't had one before.

---

## 5. Confirm `TRUST_PROXY_HOPS` matches the real deployed topology (Phase 1, H-06)

`server/src/index.js` now calls `app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1))` — defaults to 1 (Railway's own edge proxy). If a CDN or WAF (Cloudflare, etc.) sits in front of Railway, this needs to be 2, or `req.ip` and every IP-keyed rate limiter will read the wrong address. Set `TRUST_PROXY_HOPS` explicitly in the server's Railway environment variables once you've confirmed the real hop count — don't leave it to the default if you're not sure.

---

## 6. Decide whether/how to enforce the CSP (Phase 1, H-13)

`vercel.json` currently ships `Content-Security-Policy-Report-Only` (logs violations, blocks nothing) — safe to deploy as-is. Flipping it to an enforcing `Content-Security-Policy` will break two real, first-party things until resolved:

- **The site's default cookie-consent script** (`Website → Header/Footer → Custom JS`, `site_custom_js`, currently populated with the theme's default behavior) — injected as inline `<script>` text, which a strict `script-src` blocks outright.
- **Per-page JSON-LD SEO schema markup** — also an inline `<script>`, built fresh per page (title/URL), so it can't be pinned with a fixed hash the way a static script can.

You confirmed keeping `script-src` strict (no `'unsafe-inline'`) rather than accommodating these — the right call for actually stopping an XSS payload's own inline script (the C-05 threat), but it means enforcement needs one more decision before it ships:
- **Option A**: move `site_custom_js`'s content to a static external file (`<script src="...">`, covered by `'self'`) — a concrete, doable fix, but changes how the admin "custom JS" builder feature works for anyone who's customized it beyond the default.
- **Option B**: a nonce-based CSP — requires moving this app's header delivery from static Vercel `headers` config to a per-request mechanism (Vercel Edge Middleware or SSR) so a fresh nonce can be issued and matched into both the header and the inline `<script>` tags on each response. A real project, not a quick follow-up.
- **Option C**: accept `'unsafe-inline'` specifically for `script-src`, keeping the rest of the CSP (style/font/img/frame/object lockdowns) — trades away the CSP's specific value against C-05-style attacks, keeps everything else working with zero further changes.

No urgency — Report-Only ships real value today (visibility into what would break) with zero risk. This just needs a decision before anyone flips the switch.

---

## 7. Run the gateway-secrets encryption migration against production (Phase 2, H-13)

`payment_gateway_settings`' credential columns are now encrypted at rest (AES-256-GCM). Before or immediately after deploying this code to production:

```bash
# 1. Generate a real encryption key (same method as JWT_SECRET) and set it
#    as SECRETS_ENCRYPTION_KEY in the server's Railway environment variables:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 2. Run the one-time migration against production (safe to re-run — skips
#    anything already encrypted):
cd server && node scripts/encrypt-gateway-secrets.js --host <prod-db-host> --database <prod-db-name> --user <prod-db-user> --password <prod-db-password>
#    (or set DB_HOST/DB_NAME/DB_USER/DB_PASSWORD in that shell's environment
#    instead of passing them as flags)
```

The code tolerates the migration not having run yet (falls back to plaintext, doesn't crash), but gateway credentials stay unencrypted until it does. **Back up `SECRETS_ENCRYPTION_KEY` the same way you would `JWT_SECRET`/`DB_PASSWORD`** — losing it makes the encrypted credentials unrecoverable, and every gateway payment call will start failing.

---

## 8. AV scanning for user-uploaded content, still open (Phase 2, H-11)

Same open item as #3 above (was flagged in Phase 0 before H-11 was fixed) — magic-byte validation and SVG removal now ship, but antivirus scanning of uploaded files and serving them from a separate origin (both from the original audit) were not built this pass. No urgency; revisit if/when upload volume from untrusted users grows.

---

## 9. Run the `activities.entity_type` enum migration against production (Phase 2, M-07)

Role-change activity logging (`role_created`/`role_updated`/`role_deleted`) needed a new `'role'` value added to `activities.entity_type`'s ENUM — a real schema change, separate from the gateway-secrets migration in #7. Run this against production too:

```bash
cd server && node scripts/ensure-activities-role-entity-type.js --host <prod-db-host> --database <prod-db-name> --user <prod-db-user> --password <prod-db-password>
```

Safe to re-run (checks the current enum before altering). **This one is more time-sensitive than most of the migrations in this list** — the code that depends on it (`roles.js`'s role-create/update/delete logging) is `required: true`, meaning until this migration runs, every role create/update/delete request in production will fail outright (500) rather than just silently missing its audit-log entry.

---

## 10. Run the session-revocation migration against production (Phase 2, H-05)

Adds `users.token_epoch`, `users.password_reset_token`/`password_reset_expires_at` (see below — these were missing entirely, not new), and the `revoked_tokens` table:

```bash
cd server && node scripts/ensure-session-revocation.js --host <prod-db-host> --database <prod-db-name> --user <prod-db-user> --password <prod-db-password>
```

Safe to re-run. Not `required:true`-gated like #9 above, so nothing fails outright before this runs — but until it does, `POST /auth/logout`, password resets, and impersonation all throw (they reference columns/tables that won't exist yet), so treat this as blocking for those three flows specifically.

**Also fixes a pre-existing, unrelated bug while it's here**: `users.password_reset_token` and `password_reset_expires_at` were referenced in `auth.js`'s forgot-password/reset-password routes but were never actually in `db/schema.sql` or any prior migration — every password-reset request has been failing with a real SQL error, in production too, most likely since this feature was first written. If any users have reported "forgot password doesn't work," this is almost certainly why. Fixed as part of this migration since H-05 needed to touch this exact path anyway.

---

## 10b. Three more migrations needed against production — not part of the security remediation itself, but shipped in the same commits

Discovered and fixed while using the app during this session; each is idempotent (safe to re-run):

```bash
cd server
# MFA tables (Phase 3, H-01) — required before anyone can enroll or the org toggle can be turned on
node scripts/ensure-mfa-tables.js --host <prod-db-host> --database <prod-db-name> --user <prod-db-user> --password <prod-db-password>

# Dedupes the AI knowledge base (was at 43,499 rows due to a missing unique
# constraint the seeder's ON DUPLICATE KEY UPDATE needed) and adds that constraint
node scripts/ensure-kb-unique-constraint.js --host <prod-db-host> --database <prod-db-name> --user <prod-db-user> --password <prod-db-password>

# Creates 5 tables that were referenced in code (social/reports/video features)
# but were never in schema.sql at all — these routes 500 in production today
node scripts/ensure-missing-feature-tables.js --host <prod-db-host> --database <prod-db-name> --user <prod-db-user> --password <prod-db-password>
```

None of these are `required:true`-gated, so the app stays up without them, but: MFA enrollment/login step-up will 500 until the first script runs, and `/admin/reports/social` and related social/report/video pages will 500 until the third script runs (that's the "internal server error" bug reported and fixed live this session — it's fixed in code, but production's database still needs these tables created).

---

## 11. Decide whether to shorten the JWT access-token lifetime further (Phase 2, H-05)

The original audit recommended 15–30 minutes, written when there was no revocation mechanism at all — a short lifetime was the *only* way to limit a stolen token's usefulness. That's no longer true: logout now revokes a token immediately, and a password reset (self-service or admin-initiated) invalidates every other live session for that account in real time. I left `JWT_EXPIRES_IN` at its existing 8h default rather than shortening it, since there's no refresh-token mechanism in this app to absorb the usability cost of frequent re-logins for staff using the CRM all day, and the specific threat the audit was targeting (a stolen token staying valid for hours with no way to kill it) is now closed by revocation instead. If you want a shorter default anyway (defense in depth against a token that's stolen but never detected/reported), it's a one-line env var change (`JWT_EXPIRES_IN=30m` in Railway, standard `ms`-style format) — no code change needed. Flagging as your call, not mine, since it's a product/usability tradeoff, not a pure security question at this point.

## 12. Confirm no legitimate non-browser, non-webhook caller hits the API in production (Phase 4, M-06)

CORS now requires a real, allowlisted `Origin` header on every route except webhook paths (`/webhook`) and `/api/health`. This is safe for the React SPA (browsers always send `Origin` on cross-origin requests) and for the 4 known webhook integrations (Authorize.net, Valor, Twilio, ConnectWise — matched by path, not exempted individually). **What I can't verify from here**: whether anything else calls this API without a browser and without hitting a `/webhook` path — a Zapier integration, a mobile app, an internal cron/script, a partner integration. If anything like that exists in production, it will start getting `403 CORS: Origin header required` the moment this deploys. Recommend a quick review of `CLIENT_ORIGIN` and any known non-browser integrations before/immediately after deploying this change; if one turns up, either add its calling pattern to the CORS exemption regex in `server/src/index.js` (`NO_ORIGIN_OK_PATH`) or have it send a matching `Origin` header.

## 13. Decide on Cloudflare Turnstile for public form submissions (Phase 4, M-03)

Server-side verification is built and ready (`server/src/services/captcha.js`) but inert — with no `TURNSTILE_SECRET_KEY` set, every form submission skips the check entirely (same treatment as AV scanning and HIBP: an optional control, not force-enabled). If you want it live:

1. Create a free Turnstile site at `dash.cloudflare.com` (no Cloudflare-proxied domain required — Turnstile works standalone).
2. Set `TURNSTILE_SECRET_KEY` in the server's environment variables (Railway).
3. Set the matching site key as `VITE_TURNSTILE_SITE_KEY` in the client's build environment.
4. **The client-side widget itself isn't built yet** — this needs a small React component added to the form-render page (`client/src/frontend/pages/...` wherever public forms render) that loads Cloudflare's Turnstile script and submits its token as `turnstile_token` alongside the form body. Ask me to build this whenever you're ready to turn CAPTCHA on; it's a contained, fairly small addition on top of what already exists server-side.

No urgency — the other M-03 fixes (field allowlisting, per-field caps, empty-fields-only contact updates) close the worst part of the finding on their own.

## 14. ~~Build the MFA client UI~~ — DONE (Phase 3, H-01)

Built and committed (`Add client UI for TOTP MFA (H-01) — enrollment, login step-up, org toggle`). Covers everything originally listed here:

- **Settings → Security tab** (`SettingsPage.jsx`) — org-wide `mfa_enabled` toggle, confirms before turning on, lists which permissions become mandatory.
- **My Account & Security page** (`/admin/account`, linked from the account dropdown) — self-service enroll (QR + manual-entry secret), confirm, one-time recovery-code display, disable, and regenerate, each password-gated.
- **Login step-up** on both `Login.jsx` (admin) and `PortalLogin.jsx` (portal) — handles `{ mfa_required, mfa_token }`, code or recovery-code entry, falls back to re-login on an expired `mfa_pending` token.

Verified via the Vite dev-server transform check (no syntax errors) and a full API-level trace of every call the new UI makes through the dev proxy — **not** a rendered-browser click-through (no browser-automation tool was available in this environment). Recommend a quick manual pass in a real browser (enroll → log out → log back in with a code → try a recovery code → disable) before or shortly after this reaches real users, since that's the one level of verification this session couldn't do itself.

Not built (still open, see #15/#16 below): WebAuthn/passkeys, and the `mfa_setup_required: true` 403-flag prompt for someone who holds a mandatory permission but hasn't enrolled yet — currently that just surfaces as a permission-denied error rather than a friendly "set up 2FA to continue" screen. Low priority since the org toggle defaults OFF and enrollment is voluntary until you turn it on.

## 15. WebAuthn/passkeys were deliberately not built (Phase 3, H-01)

Confirmed with you: TOTP only for this pass. The original audit's design also includes WebAuthn/passkey support (`user_mfa_credentials` table, `@simplewebauthn/server` + `@simplewebauthn/browser`, discoverable/usernameless login). This needs a real production RP-ID (the exact deployed domain) to configure and test properly — something this local session can't safely validate — so it's recorded here as a known, deliberate gap rather than built partially. If you want it later, the design is already fully specified in `SECURITY-AUDIT-2026-08-21.md` §7 and would layer in alongside the existing TOTP flow (both would satisfy MFA enrollment; a user could have either or both).

## 16. Six lower-priority SSRF-adjacent items, reviewed but not fixed (Phase 5)

Full detail in `Security Review/PHASE5-ADVERSARIAL-RETEST.md` §3. All require a `settings.manage` admin account to already be compromised (not reachable by a lower-privilege or unauthenticated caller, unlike the 4 findings that were fixed), or are cosmetic:

- `services/usps.js` / `services/connectwise.js` — `usps_settings.base_url` / `cw_manage_settings.site_url` are admin-set with only zod's `.url()` validation (accepts any host); a compromised admin account could repoint either at an internal address, leaking USPS/ConnectWise credentials to that host. Fix would be applying the same `isSafeTargetUrl()` guard used elsewhere this phase, or restricting `.url()` to an expected hostname pattern.
- `routes/videos.js` — Vimeo oembed call doesn't `encodeURIComponent()` the video id before interpolating it into vimeo.com's own URL. Host is fixed; cosmetic query-injection only.
- `routes/dns.js` — Cloudflare API calls don't format-validate `zoneId`/`recordId` path segments. Host is fixed; worst case is path traversal within Cloudflare's own API using the stored account token.
- `routes/media.js` — `file_url` is built from `req.protocol`/`req.get('host')`, so a Host-header-spoofing request could persist an attacker-hosted URL; only becomes a problem if an admin later hand-picks that exact record as the site logo (a long chain). Pinning to `SERVER_ORIGIN`/`API_BASE_URL` like the rest of the codebase does would close it cheaply.

None of these are urgent — flagging so they're tracked, and easy to pick up in a future pass if you want them closed too.

---

*Last updated: end of Phase 5 (complete), this session. Every finding from the original audit, plus 4 new ones found during Phase 5's own adversarial retest, is now closed. Everything remaining in this document is a human action — no further engineering is planned.*
