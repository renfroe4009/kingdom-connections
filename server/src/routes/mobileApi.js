// =============================================================================
// Secured mobile API for the Praying Planet integration — KC is source of
// truth for organizations/members. Server-to-server only (client-credentials,
// see middleware/apiClientAuth.js); no end-user SSO in this phase.
//
// Every route here:
//   1. requires a bearer token with the specific scope it needs
//   2. is rate-limited per api_client (not per IP — see mobileRateLimit)
//   3. only ever exposes/touches orgs with organizations.app_enabled = 1
//   4. logs to pp_sync_log for audit
//
// PII minimization is deliberate throughout: member responses carry name,
// email and app-profile fields only — never donation/financial/custom-field
// data, regardless of what a caller asks for.
// =============================================================================
const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { z } = require('zod');
const { db } = require('../db');
const { requireApiClient, issueToken, tokenLimiter } = require('../middleware/apiClientAuth');
const { notifyMemberChange, fireWebhookEvent } = require('../services/ppWebhooks');
const { upsertAppProfile, eraseAppProfile } = require('../services/appProfile');
const { logPpSync } = require('../services/ppSyncLog');
const { logActivity } = require('../services/activity');

const router = express.Router();

// Per-client, not per-IP — a single partner backend server is expected to
// make many requests from one IP, so IP-based limiting would either be too
// loose (shared NAT) or punish the one legitimate caller. Same reasoning as
// services/checkinPin.js's per-event limiter.
const mobileRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => `mobile-api:${req.apiClient?.clientId || ipKeyGenerator(req, res)}`,
  message: { error: 'Too many requests. Please slow down and try again shortly.' },
});

router.use(mobileRateLimit);

const MEMBER_FIELDS = `
  c.id, c.organization_id, c.first_name, c.last_name, c.email, c.updated_at,
  p.avatar_url, p.bio, p.display_name_override, p.notification_consent, p.app_account_status
`;

function shapeMember(row) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    updated_at: row.updated_at,
    app_profile: {
      avatar_url: row.avatar_url,
      bio: row.bio,
      display_name_override: row.display_name_override,
      notification_consent: !!row.notification_consent,
      status: row.app_account_status || 'active',
    },
  };
}

// ---------------------------------------------------------------------------
// GET /organizations — orgs this integration is allowed to see
// ---------------------------------------------------------------------------
router.get('/organizations', requireApiClient('organizations:read'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, city, state FROM organizations WHERE app_enabled = 1 ORDER BY id`
    );
    await logPpSync({ apiClientId: req.apiClient.id, direction: 'in', eventType: 'organizations.list', status: 'success' });
    res.json({ organizations: rows });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /organizations/:id/members — paginated, incremental-sync friendly
// ---------------------------------------------------------------------------
router.get('/organizations/:id/members', requireApiClient('members:read'), async (req, res, next) => {
  try {
    const orgId = Number(req.params.id);
    const [[org]] = await db.query('SELECT id FROM organizations WHERE id = :id AND app_enabled = 1', { id: orgId });
    if (!org) return res.status(404).json({ error: 'Not found' });

    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const cursor = req.query.cursor ? Number(req.query.cursor) : 0;
    const updatedSince = req.query.updated_since || null;

    const [rows] = await db.query(
      `SELECT ${MEMBER_FIELDS}
         FROM contacts c
         LEFT JOIN contact_app_profiles p ON p.contact_id = c.id
        WHERE c.organization_id = :orgId
          AND c.id > :cursor
          AND (:updatedSince IS NULL OR c.updated_at > :updatedSince)
        ORDER BY c.id ASC
        LIMIT :limit`,
      { orgId, cursor, updatedSince, limit }
    );

    await logPpSync({ apiClientId: req.apiClient.id, direction: 'in', eventType: 'members.list',
      entityType: 'organization', entityId: orgId, status: 'success' });

    res.json({
      members: rows.map(shapeMember),
      next_cursor: rows.length === limit ? rows[rows.length - 1].id : null,
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /members/:id
// ---------------------------------------------------------------------------
router.get('/members/:id', requireApiClient('members:read'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[row]] = await db.query(
      `SELECT ${MEMBER_FIELDS}
         FROM contacts c
         JOIN organizations o ON o.id = c.organization_id AND o.app_enabled = 1
         LEFT JOIN contact_app_profiles p ON p.contact_id = c.id
        WHERE c.id = :id`,
      { id }
    );
    // A contact in a non-app-enabled org must 404 exactly like a
    // nonexistent one — never reveal it exists but is out of scope.
    if (!row) return res.status(404).json({ error: 'Not found' });

    await logPpSync({ apiClientId: req.apiClient.id, direction: 'in', eventType: 'member.get',
      entityType: 'contact', entityId: id, status: 'success' });
    res.json(shapeMember(row));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PATCH /members/:id/app-profile — Praying Planet writes back app-owned
// fields only. Server-side allowlist regardless of payload contents (same
// discipline as routes/forms.js's public submit route).
// ---------------------------------------------------------------------------
const appProfileSchema = z.object({
  avatar_url: z.string().url().max(500).nullish(),
  bio: z.string().max(2000).nullish(),
  display_name_override: z.string().max(150).nullish(),
  push_token: z.string().max(255).nullish(),
  notification_consent: z.boolean().optional(),
}).strict();

router.patch('/members/:id/app-profile', requireApiClient('members:write'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = appProfileSchema.parse(req.body);

    const [[contact]] = await db.query(
      `SELECT c.id, c.organization_id, c.first_name, c.last_name, c.email, c.updated_at
         FROM contacts c JOIN organizations o ON o.id = c.organization_id AND o.app_enabled = 1
        WHERE c.id = :id`,
      { id }
    );
    if (!contact) return res.status(404).json({ error: 'Not found' });

    const fields = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    await upsertAppProfile(id, fields);

    await logPpSync({ apiClientId: req.apiClient.id, direction: 'in', eventType: 'member.app_profile_updated',
      entityType: 'contact', entityId: id, request: fields, status: 'success' });

    notifyMemberChange('member.updated', contact).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /members/:id/delete-request — App Store/compliance "delete my data".
// Erases ONLY the app-owned profile row; the underlying CRM contact and any
// donation/membership history are retained (legally required nonprofit
// recordkeeping) and are never touched by this endpoint.
// ---------------------------------------------------------------------------
router.post('/members/:id/delete-request', requireApiClient('members:delete'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    // Same app_enabled-org gate as every other member route — a client must
    // never be able to touch (or even learn the existence of) a contact
    // outside the orgs it was granted visibility into, even for a
    // deletion request.
    const [[contact]] = await db.query(
      `SELECT c.id, c.organization_id, c.first_name, c.last_name, c.email, c.updated_at
         FROM contacts c JOIN organizations o ON o.id = c.organization_id AND o.app_enabled = 1
        WHERE c.id = :id`,
      { id }
    );
    if (!contact) return res.status(404).json({ error: 'Not found' });

    await eraseAppProfile(id);

    // Security remediation-style discipline: this is a compliance-relevant
    // event (App Store "delete my data" requirement) — a silently-dropped
    // audit entry here would leave no trace an erasure request happened at
    // all, so this one propagates on failure (required: true) rather than
    // being swallowed.
    await logActivity({
      entityType: 'contact', entityId: id, action: 'app_data_deleted',
      description: 'Praying Planet app profile data erased on user request', required: true,
    });
    await logPpSync({ apiClientId: req.apiClient.id, direction: 'in', eventType: 'member.delete_request',
      entityType: 'contact', entityId: id, status: 'success' });

    fireWebhookEvent('member.app_data_deleted', {
      entity_type: 'contact', id: contact.id, organization_id: contact.organization_id,
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = { router, issueToken, tokenLimiter, MEMBER_FIELDS, shapeMember };
