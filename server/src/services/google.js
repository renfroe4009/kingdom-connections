'use strict';
// Google OAuth2 + API helpers.
// Each CRM user connects their own Google account; tokens are stored per user_id.
// access_token and refresh_token are encrypted at rest with AES-256-GCM using
// GOOGLE_TOKEN_SECRET. Format stored in DB: "iv:authTag:ciphertext" (all hex).

const { google } = require('googleapis');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const { db }     = require('../db');

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly',
];

// ── Encryption helpers ────────────────────────────────────────────────────────
// Derive a fixed 32-byte key from GOOGLE_TOKEN_SECRET (any length input → SHA-256).
function encryptionKey() {
  const secret = process.env.GOOGLE_TOKEN_SECRET;
  if (!secret) throw new Error('GOOGLE_TOKEN_SECRET is not set in .env');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = encryptionKey();
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(stored) {
  if (!stored) return null;
  const key = encryptionKey();
  const [ivHex, tagHex, dataHex] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(dataHex, 'hex', 'utf8') + decipher.final('utf8');
}

// ── OAuth client ──────────────────────────────────────────────────────────────
function makeClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

// Build the authorization URL. State is a short-lived JWT encoding the user ID
// so the callback can associate tokens without a session cookie.
function getAuthUrl(userId) {
  const client = makeClient();
  const state  = jwt.sign({ uid: userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope:       SCOPES,
    state,
  });
}

// Exchange authorization code for tokens and upsert into google_tokens.
async function handleCallback(code, state) {
  const { uid } = jwt.verify(state, process.env.JWT_SECRET);

  const client     = makeClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2   = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();

  const expiry = tokens.expiry_date
    ? new Date(tokens.expiry_date).toISOString().slice(0, 19).replace('T', ' ')
    : null;

  await db.query(
    `INSERT INTO google_tokens (user_id, google_email, access_token, refresh_token, expiry, scopes)
     VALUES (:uid, :email, :at, :rt, :exp, :scopes)
     ON DUPLICATE KEY UPDATE
       google_email  = VALUES(google_email),
       access_token  = VALUES(access_token),
       refresh_token = COALESCE(VALUES(refresh_token), refresh_token),
       expiry        = VALUES(expiry),
       scopes        = VALUES(scopes),
       updated_at    = CURRENT_TIMESTAMP`,
    {
      uid,
      email:  data.email,
      at:     encrypt(tokens.access_token),
      rt:     tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      exp:    expiry,
      scopes: tokens.scope || SCOPES.join(' '),
    },
  );

  return uid;
}

// Return a ready-to-use OAuth2 client for a user, auto-refreshing if needed.
async function getClientForUser(userId) {
  const [[row]] = await db.query(
    'SELECT * FROM google_tokens WHERE user_id = :uid LIMIT 1',
    { uid: userId },
  );
  if (!row) throw new Error('Google account not connected for this user.');

  const client = makeClient();
  client.setCredentials({
    access_token:  decrypt(row.access_token),
    refresh_token: decrypt(row.refresh_token),
    expiry_date:   row.expiry ? new Date(row.expiry).getTime() : undefined,
  });

  // Persist refreshed tokens back to DB (also encrypted).
  client.on('tokens', async (newTokens) => {
    const newExpiry = newTokens.expiry_date
      ? new Date(newTokens.expiry_date).toISOString().slice(0, 19).replace('T', ' ')
      : null;
    await db.query(
      `UPDATE google_tokens
          SET access_token  = :at,
              refresh_token = COALESCE(:rt, refresh_token),
              expiry        = :exp,
              updated_at    = CURRENT_TIMESTAMP
        WHERE user_id = :uid`,
      {
        at:  encrypt(newTokens.access_token),
        rt:  newTokens.refresh_token ? encrypt(newTokens.refresh_token) : null,
        exp: newExpiry,
        uid: userId,
      },
    ).catch(() => {});
  });

  return client;
}

// Remove tokens for a user (disconnect).
async function disconnect(userId) {
  const [[row]] = await db.query(
    'SELECT access_token FROM google_tokens WHERE user_id = :uid LIMIT 1',
    { uid: userId },
  );
  if (row) {
    const client = makeClient();
    // Revoke the decrypted token on Google's side (best-effort).
    await client.revokeToken(decrypt(row.access_token)).catch(() => {});
    await db.query('DELETE FROM google_tokens WHERE user_id = :uid', { uid: userId });
  }
}

// ── Google Calendar helpers ───────────────────────────────────────────────────

// Build a calendar event resource from a CRM task.
function taskToEvent(task) {
  const start = task.due_date ? new Date(task.due_date) : new Date();
  const end   = new Date(start.getTime() + 60 * 60 * 1000); // 1-hour block
  return {
    summary:     task.title,
    description: task.description || '',
    start: { dateTime: start.toISOString(), timeZone: 'UTC' },
    end:   { dateTime: end.toISOString(),   timeZone: 'UTC' },
    status: task.status === 'completed' ? 'cancelled' : 'confirmed',
  };
}

async function createTaskEvent(userId, task) {
  const client   = await getClientForUser(userId);
  const cal      = google.calendar({ version: 'v3', auth: client });
  const { data } = await cal.events.insert({ calendarId: 'primary', requestBody: taskToEvent(task) });
  return data.id;
}

async function updateTaskEvent(userId, eventId, task) {
  const client = await getClientForUser(userId);
  const cal    = google.calendar({ version: 'v3', auth: client });
  await cal.events.patch({ calendarId: 'primary', eventId, requestBody: taskToEvent(task) });
}

async function deleteTaskEvent(userId, eventId) {
  const client = await getClientForUser(userId);
  const cal    = google.calendar({ version: 'v3', auth: client });
  await cal.events.delete({ calendarId: 'primary', eventId }).catch(() => {});
}

// ── Google Drive helpers ──────────────────────────────────────────────────────

// List all Shared Drives accessible to the user.
async function listSharedDrives(userId) {
  const client = await getClientForUser(userId);
  const drive  = google.drive({ version: 'v3', auth: client });

  const { data } = await drive.drives.list({
    pageSize: 100,
    fields:   'drives(id,name)',
  });

  return (data.drives || []).map((d) => ({ id: d.id, name: d.name }));
}

// List top-level folders inside a Shared Drive.
async function listDriveFolders(userId, driveId) {
  const client = await getClientForUser(userId);
  const drive  = google.drive({ version: 'v3', auth: client });

  const { data } = await drive.files.list({
    driveId,
    corpora:                   'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives:         true,
    q:                         `'${driveId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    orderBy:                   'name',
    pageSize:                  200,
    fields:                    'files(id,name)',
  });

  return (data.files || []).map((f) => ({ id: f.id, name: f.name }));
}

// Parse a Google Drive folder URL or bare ID into just the folder ID.
function parseFolderId(input) {
  if (!input) return null;
  // URL forms: /folders/<id>, /drive/folders/<id>, id= param, or bare ID
  const urlMatch = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  const paramMatch = input.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (paramMatch) return paramMatch[1];
  // Bare folder ID (alphanumeric + _ -)
  if (/^[a-zA-Z0-9_-]{10,}$/.test(input.trim())) return input.trim();
  return null;
}

// List files in a Drive folder for a given user's connected Google account.
// Returns array of { id, name, mimeType, modifiedTime, webViewLink, iconLink }
async function listDriveFiles(userId, folderId) {
  const client = await getClientForUser(userId);
  const drive  = google.drive({ version: 'v3', auth: client });

  const { data } = await drive.files.list({
    q:               `'${folderId}' in parents and trashed = false`,
    pageSize:        100,
    orderBy:         'name',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    fields:          'files(id,name,mimeType,modifiedTime,webViewLink,iconLink,size)',
  });

  return (data.files || []).map((f) => ({
    id:           f.id,
    name:         f.name,
    mimeType:     f.mimeType,
    modifiedTime: f.modifiedTime,
    webViewLink:  f.webViewLink,
    iconLink:     f.iconLink,
    size:         f.size || null,
  }));
}

module.exports = {
  getAuthUrl, handleCallback, getClientForUser, disconnect, SCOPES,
  createTaskEvent, updateTaskEvent, deleteTaskEvent,
  listDriveFiles, parseFolderId, listSharedDrives, listDriveFolders,
};
