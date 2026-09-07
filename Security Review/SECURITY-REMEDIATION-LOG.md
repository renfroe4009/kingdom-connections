# Security remediation log

Tracks the status of every finding from `SECURITY-AUDIT-2026-08-21.md`, re-verified against this fork (`kingdom-connections`) per the plan in this session. One row per finding. Status values: **Fixed**, **Deferred**, **Human action required**, **Not applicable**, **Not started**.

Test scripts live in `server/tests/security/`, one file per finding, runnable standalone via `node server/tests/security/<file>.test.js`. Each was written and run against the *unpatched* code first (via `git stash` on just the relevant file) to empirically confirm it fails before the fix, then re-run after restoring the fix to confirm it passes — per the audit's own methodology requirement.

---

## Phase 0 — Emergency (complete)

| ID | Status | Change | Test | Residual risk |
|---|---|---|---|---|
| C-01 | **Fixed** | `server/src/services/storage.js`: added `safeLocalPath()` containment check (`path.resolve` + `path.relative` test) used by `localStream`/`localPut`/`localDelete`. `server/src/routes/media.js`: added `KEY_RE` shape validation at the `/file/*` route boundary, plus a `media_files` DB-registration lookup before ever streaming (layer 3 from the audit's fix — only ever serves keys this app itself registered). | `server/tests/security/C-01.path-traversal.test.js` — 5/5. Empirically reproduced the exploit first: `GET /api/website/media/file/%2e%2e%2f%2e%2e%2fserver%2f.env` returned real `JWT_SECRET`/`DB_PASSWORD` contents pre-fix (200); confirmed 400 post-fix. | None identified locally. **Must be confirmed against the production deployment separately — see Human Action list below.** |
| C-04 | **Fixed** | `server/src/routes/payments.js`: `GET /public/invoice/:id`'s `latestPayment` query no longer selects `receipt_token` at all. | `server/tests/security/C-04.invoice-token-leak.test.js` — 2/2. Confirmed `receipt_token` present pre-fix, absent post-fix; other fields (invoice total, payment amount) unaffected. | The route itself (unauthenticated, sequential id, still leaks invoice total/balance/memo/org name) is retired in Phase 1, not this phase — see C-04 (Phase 1) below. |
| C-02 (interim) | **Partially fixed** — full fix is Phase 1 | `server/src/routes/ai.js`: added `requireStaffAccess` middleware in front of `POST /chat` — blocks the `portal` role explicitly and requires the caller hold `contacts.read` (held by every staff role, no portal account) or `admin`. Does **not** yet add per-tool permission/row-scope enforcement inside `executeTool` — that's Phase 1's `TOOL_POLICY` work. | `server/tests/security/C-02.ai-chat-interim-gate.test.js` — 2/2. Confirmed portal account reached `streamChat` pre-fix (200, would reach `executeTool` with a real API key configured); confirmed 403 post-fix. Confirmed a legitimate staff account (sales role) is not blocked by the gate. | **Still vulnerable to a sales/manager/readonly-scoped staff account using the assistant to read organisation-wide data outside their own scope** — the interim gate only blocks portal; per-tool scoping is Phase 1. |
| C-03 | **Fixed** | `server/src/routes/users.js`: added `assertGrantableRoles()` — a non-admin caller can only assign roles whose permissions are a subset of what they already hold, and can never assign the `admin` role by name. Added an unconditional self-role-modification block on `PUT /:id` (`id === req.user.id` with `role_ids` present → 403), independent of the scope check. Both `POST /` and `PUT /:id` now call the allowlist. | `server/tests/security/C-03.privilege-escalation.test.js` — 4/4, using a purpose-built non-admin custom role holding only `users.manage` (matching the audit's exact threat model — this permission is not admin-exclusive). Confirmed self-promotion, granting a report the admin role, and creating a new admin account via `POST /` all succeeded pre-fix; all blocked post-fix. Confirmed a same-privilege role grant still works (no regression). | None identified in the self-escalation vector. `resolveOwnerScope`'s fail-open default for uncategorized roles (H-10, Phase 2) means a custom `users.manage`-holding role currently has *unrestricted* scope over which users it can target in the first place — orthogonal to this fix, tracked separately. |
| M-01 | **Fixed** | `server/src/middleware/errorHandler.js`: 5xx responses now always return `{error: 'Internal server error', correlation_id}` with no `err.message` or stack, in any environment — full detail goes to the server console only, keyed by the correlation id. 4xx responses (Zod validation, intentional `Forbidden`/`Not found`/etc.) are unchanged. `server/src/index.js`: refuses to boot when `RAILWAY_ENVIRONMENT` is set (Railway's own deployment marker) but `NODE_ENV !== 'production'`. | `server/tests/security/M-01.error-handler-leak.test.js` — 3/3. Triggered a genuine uncaught DB exception (`GET /api/payments/public/invoice/abc` → `Number('abc')` = NaN → mysql2 throws "Unknown column 'NaN'"); confirmed the raw message leaked pre-fix, generic message + correlation id post-fix. Confirmed Zod 400s and intentional 401s are unchanged. | None identified. The boot assertion only fires on Railway; it cannot detect misconfiguration on a different host — if the app is ever moved off Railway, this specific check stops helping (the errorHandler fix itself has no such gap). |

**Dev tooling note**: `server/tests/invoices.test.js` (the pre-existing test) required `supertest`, which was referenced by the file but never actually installed — added as a devDependency so the existing test can run at all. Baseline before *and* after Phase 0: **6/15 passing**, same 9 pre-existing failures, unrelated to this remediation (stale test fixtures vs. the invoice route's evolved behavior — out of scope for security work).

**Test fixtures created** (local dev DB only, clearly named, safe to leave in place for future test runs):
- `sectest-staff@localcrm.local` (id varies) — `sales` role, used by the C-02 test to prove staff access isn't blocked.
- `sectest-manager@localcrm.local` + a custom role `sectest_user_admin` (holds only `users.manage`, not admin) — used by C-03.
- `sectest-report@localcrm.local` — `sales` role, manager's report, used by C-03 as the escalation target.
- A registered `media_files` row + matching on-disk file at `media/library/2026-09-07/aaaa...aaaa.png` — used by C-01 to prove legitimate media reads still work.

---

## Phase 1 — Critical

Not started this session. Next up: C-02 full `TOOL_POLICY` fix, C-05 (XSS sanitization), C-04 route retirement (pending confirmation), H-04, H-02, H-03, H-06, H-13 (CSP half), H-12 (`npm audit fix`).

## Phases 2–5

Not started. See the approved plan (`/Users/timrenfroe/.claude/plans/glimmering-wibbling-abelson.md`) for full scope.

---

## Human action required (cumulative)

See **HUMAN-ACTION-REQUIRED.md** in this same folder for the full, current list with exact commands.
