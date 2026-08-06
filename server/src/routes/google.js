'use strict';
// /api/google — Google Workspace OAuth + status endpoints

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { db }          = require('../db');
const {
  getAuthUrl,
  handleCallback,
  disconnect,
  listDriveFiles,
  parseFolderId,
  listSharedDrives,
  listDriveFolders,
} = require('../services/google');

// ── GET /api/google/status ────────────────────────────────────────────────────
// Returns connection status for the current user.
router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      'SELECT google_email, scopes, updated_at FROM google_tokens WHERE user_id = :uid LIMIT 1',
      { uid: req.user.id },
    );
    if (!row) return res.json({ connected: false });
    res.json({
      connected:    true,
      google_email: row.google_email,
      scopes:       row.scopes,
      updated_at:   row.updated_at,
    });
  } catch (err) { next(err); }
});

// ── GET /api/google/oauth/url ─────────────────────────────────────────────────
// Returns the Google authorization URL to redirect the user to.
router.get('/oauth/url', requireAuth, (req, res, next) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(503).json({ error: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.' });
    }
    const url = getAuthUrl(req.user.id);
    res.json({ url });
  } catch (err) { next(err); }
});

// ── GET /api/google/oauth/callback ────────────────────────────────────────────
// Google redirects here after user grants access. NOT protected by requireAuth
// because it's a browser redirect — user identity comes from the signed state JWT.
router.get('/oauth/callback', async (req, res, next) => {
  const { code, state, error } = req.query;
  const origin = process.env.CLIENT_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5173';

  if (error) {
    return res.redirect(`${origin}/settings?tab=google&error=${encodeURIComponent(error)}`);
  }

  try {
    await handleCallback(code, state);
    res.redirect(`${origin}/settings?tab=google&connected=1`);
  } catch (err) {
    const msg = err.message || 'OAuth failed';
    res.redirect(`${origin}/settings?tab=google&error=${encodeURIComponent(msg)}`);
  }
});

// ── DELETE /api/google/disconnect ─────────────────────────────────────────────
router.delete('/disconnect', requireAuth, async (req, res, next) => {
  try {
    await disconnect(req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Drive error helper ────────────────────────────────────────────────────────
// Converts Google API errors into clean HTTP responses instead of 500s.
function handleDriveErr(err, res, next) {
  if (err.message?.includes('not connected')) {
    return res.status(401).json({ error: 'Google account not connected. Connect in Settings → Google Workspace.' });
  }
  const code = err.code || err.status;
  if (code === 403 || err.message?.includes('insufficientPermissions') || err.message?.includes('forbidden')) {
    return res.status(403).json({ error: 'You do not have permission to access this Google Drive folder.' });
  }
  if (code === 404 || err.message?.includes('notFound')) {
    return res.status(404).json({ error: 'This Google Drive folder was not found. It may have been deleted or moved.' });
  }
  next(err);
}

// ── Google Drive browser ──────────────────────────────────────────────────────

// GET /api/google/drive/shared-drives — list all Shared Drives for this user
router.get('/drive/shared-drives', requireAuth, async (req, res, next) => {
  try {
    const drives = await listSharedDrives(req.user.id);
    res.json(drives);
  } catch (err) { handleDriveErr(err, res, next); }
});

// GET /api/google/drive/shared-drives/:driveId/folders — list top-level folders in a drive
router.get('/drive/shared-drives/:driveId/folders', requireAuth, async (req, res, next) => {
  try {
    const folders = await listDriveFolders(req.user.id, req.params.driveId);
    res.json(folders);
  } catch (err) { handleDriveErr(err, res, next); }
});

// ── Google Drive folder linking ───────────────────────────────────────────────
// Supported entity types and their tables
const DRIVE_TABLES = { organization: 'organizations', contact: 'contacts', deal: 'deals' };

// PUT /api/google/drive/:entityType/:entityId — link a folder to a record
router.put('/drive/:entityType/:entityId', requireAuth, async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const table = DRIVE_TABLES[entityType];
    if (!table) return res.status(400).json({ error: 'Invalid entity type' });

    const folderId = parseFolderId(req.body?.folder_url || '');
    if (!folderId) return res.status(400).json({ error: 'Could not parse a folder ID from the provided value' });

    await db.query(
      `UPDATE ${table} SET google_drive_folder_id = :fid WHERE id = :id`,
      { fid: folderId, id: entityId }
    );
    res.json({ ok: true, folder_id: folderId });
  } catch (err) { next(err); }
});

// DELETE /api/google/drive/:entityType/:entityId — unlink a folder
router.delete('/drive/:entityType/:entityId', requireAuth, async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const table = DRIVE_TABLES[entityType];
    if (!table) return res.status(400).json({ error: 'Invalid entity type' });
    await db.query(
      `UPDATE ${table} SET google_drive_folder_id = NULL WHERE id = :id`,
      { id: entityId }
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/google/drive/:entityType/:entityId/files — list files in the linked folder
router.get('/drive/:entityType/:entityId/files', requireAuth, async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const table = DRIVE_TABLES[entityType];
    if (!table) return res.status(400).json({ error: 'Invalid entity type' });

    const [[row]] = await db.query(
      `SELECT google_drive_folder_id FROM ${table} WHERE id = :id LIMIT 1`,
      { id: entityId }
    );
    if (!row) return res.status(404).json({ error: 'Record not found' });
    if (!row.google_drive_folder_id) return res.json({ folder_id: null, files: [] });

    const files = await listDriveFiles(req.user.id, row.google_drive_folder_id);
    res.json({ folder_id: row.google_drive_folder_id, files });
  } catch (err) { handleDriveErr(err, res, next); }
});

module.exports = router;
