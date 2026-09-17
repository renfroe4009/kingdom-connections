# Mobile API — Praying Planet Integration

Kingdom Connections (KC) is the source of truth for organizations and
members. This document describes the secured server-to-server API and
webhook system that lets the Praying Planet mobile app's backend read that
data and write back the parts it owns.

**Scope for this phase:** server-to-server only. End users keep logging into
Praying Planet with Praying Planet's own accounts — KC is not (yet) an SSO/
identity provider. Groups, community connections, posts/comments/likes stay
in Praying Planet's own database; KC only exposes organizations and members.

---

## 1. Authentication

All calls are made by Praying Planet's *backend*, never directly by the
mobile app or an end user. Authentication is OAuth2 client-credentials style:

```
POST /api/mobile/oauth/token
Content-Type: application/json

{ "client_id": "pp_xxxxxxxxxxxx", "client_secret": "..." }
```

Response:

```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scopes": ["organizations:read", "members:read", "members:write", "members:delete"]
}
```

- Tokens expire after **1 hour** — request a new one when yours expires
  (a 401 on a data call means expired/invalid, not necessarily revoked).
- Send it on every subsequent call: `Authorization: Bearer <access_token>`.
- Rate limited to protect against credential-guessing (20 attempts / 15 min
  per `client_id`). Not something a correctly-configured integration should
  ever hit.
- Credentials are provisioned by KC staff out of band (not self-service in
  this phase) and shown to you once. If you lose the secret, ask KC to
  rotate it — there is no recovery flow.

### Scopes

| Scope | Grants |
|---|---|
| `organizations:read` | `GET /organizations` |
| `members:read` | `GET /organizations/:id/members`, `GET /members/:id` |
| `members:write` | `PATCH /members/:id/app-profile` |
| `members:delete` | `POST /members/:id/delete-request` |

Your credential is issued with only the scopes it needs — a request to an
endpoint outside your granted scopes returns `403`.

---

## 2. Data model

KC only ever exposes **organizations that a KC staff admin has explicitly
enabled** for this integration. An org you don't have access to — or a
member of one — returns `404`, not `403`: KC does not confirm the existence
of anything outside your scope.

### Organization

```json
{ "id": 12, "name": "First Church", "city": "Austin", "state": "TX" }
```

### Member

```json
{
  "id": 4501,
  "organization_id": 12,
  "first_name": "Jordan",
  "last_name": "Lee",
  "email": "jordan@example.com",
  "updated_at": "2026-09-10 14:22:01",
  "app_profile": {
    "avatar_url": "https://...",
    "bio": "...",
    "display_name_override": null,
    "notification_consent": true,
    "status": "active"
  }
}
```

`app_profile` is data Praying Planet owns and writes back (see §4). A member
never carries donation, financial, or other internal CRM fields — that data
exists in KC but is intentionally never exposed here.

---

## 3. Reading data

### List enabled organizations

```
GET /api/mobile/v1/organizations
```

### List members of an organization (paginated, incremental-sync friendly)

```
GET /api/mobile/v1/organizations/:id/members?limit=100&cursor=0&updated_since=2026-09-01T00:00:00Z
```

- `cursor` — pass back the previous response's `next_cursor` to get the next
  page; omit/`0` for the first page.
- `updated_since` — optional; only returns members changed after this
  timestamp, for incremental sync instead of a full re-pull.
- `next_cursor` in the response is `null` once you've reached the end.

### Get one member

```
GET /api/mobile/v1/members/:id
```

---

## 4. Writing data back

Onboarding is intended to happen through KC (a person becomes a KC contact
first); Praying Planet writes back only the profile fields it owns:

```
PATCH /api/mobile/v1/members/:id/app-profile
Content-Type: application/json

{
  "avatar_url": "https://cdn.example/avatar.png",
  "bio": "Hi, I'm Jordan!",
  "display_name_override": "J-Dawg",
  "push_token": "apns-or-fcm-token",
  "notification_consent": true
}
```

All fields are optional — send only what changed. Anything outside this
allowlist is rejected regardless of what you send (KC never lets this
endpoint touch donation, financial, or other internal CRM fields). A
successful write fires a `member.updated` webhook (see §6) so any other
system watching KC also picks it up.

---

## 5. Deleting a member's app data (App Store / Play Store compliance)

Both app stores require that a user can delete their personal data from
within the app at any time. Call this when a user requests it:

```
POST /api/mobile/v1/members/:id/delete-request
```

**What this does:** erases `app_profile` (avatar, bio, display name
override, push token, notification consent) and marks the app account
`deleted`. Fires a `member.app_data_deleted` webhook.

**What this does NOT do:** delete the underlying KC contact record, or any
donation/membership history. Nonprofits are legally required to retain that
data regardless of what a mobile app profile does — this endpoint only
erases the data Praying Planet itself is responsible for. If a person also
wants their full CRM record addressed, that's a separate conversation with
KC staff, outside this API.

This call is idempotent — call it again and it's a no-op, not an error.

---

## 6. Webhooks (KC → Praying Planet)

KC pushes these events to the URL(s) registered for your client:

| Event | Fired when |
|---|---|
| `member.created` | A new member is added to one of your enabled orgs |
| `member.updated` | A member's record or app profile changes |
| `member.app_data_deleted` | A delete-request (§5) completes |

### Payload shape

```json
{
  "event": "member.updated",
  "data": {
    "entity_type": "contact",
    "id": 4501,
    "organization_id": 12,
    "first_name": "Jordan",
    "last_name": "Lee",
    "email": "jordan@example.com",
    "updated_at": "2026-09-10 14:22:01"
  }
}
```

(`member.app_data_deleted` carries only `entity_type`, `id`, `organization_id` — no PII, since the point of the event is that the PII is gone.)

### Verifying the signature

Every delivery carries an `X-KC-Signature` header:

```
X-KC-Signature: t=1757000000,v1=5257a869...
```

Verify it before trusting the payload:

```js
const crypto = require('crypto');

function verify(rawBody, header, signingSecret) {
  const [tPart, vPart] = header.split(',');
  const timestamp = tPart.split('=')[1];
  const signature = vPart.split('=')[1];

  // Reject anything older than 5 minutes — bounds replay of a captured request.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const expected = crypto
    .createHmac('sha256', signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

Use the **raw request body** (before JSON-parsing) — signing is computed
over the exact bytes sent.

### Delivery & retries

- KC expects a `2xx` response within 10 seconds.
- A failed delivery is retried with backoff: 1 min, 5 min, 15 min, 1 hour, 3
  hours (5 attempts total), then left failed for manual review on KC's side.
  Design your endpoint to be safely callable more than once for the same
  event (idempotent on `data.id` + `event`).
- KC will only ever register a webhook target that's a public `http(s)`
  address — internal/private network addresses are rejected at
  registration time.

---

## 7. Errors

| Status | Meaning |
|---|---|
| `400` | Malformed request body |
| `401` | Missing/invalid/expired token, or invalid client credentials |
| `403` | Token doesn't have the required scope |
| `404` | Not found, OR exists but outside your org scope (KC deliberately doesn't distinguish these) |
| `429` | Rate limited — back off and retry later |

## 8. Rate limits

120 requests/minute per credential across all `/api/mobile/v1/*` endpoints.
The token endpoint has its own separate limit (see §1).

---

## Known limitations of this phase

- One set of scopes/org visibility per credential — there's currently a
  single partner, so per-partner org restriction wasn't built. Ask KC if you
  need multiple credentials scoped to different org subsets.
- No SSO — Praying Planet manages its own end-user sessions.
- No self-service credential/webhook management UI — reach out to KC staff
  for provisioning or rotation.
