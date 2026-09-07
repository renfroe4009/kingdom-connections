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

*Last updated: end of Phase 0, this session.*
