// =============================================================================
// LMS module runtime — lazy-loads the vendored ESM module and wires it to a
// dedicated MySQL connection.
//
// A separate pool rather than the app's shared `db` pool (see ../db.js) on
// purpose: that pool sets `dateStrings: true`, which hands every timestamp
// back as a plain string instead of a JS Date. The vendored module's Drizzle
// schema (server/vendor/kcc-lms/src/schema/mysql.ts) defines its timestamp
// columns in the default (Date) mode, so sharing the app pool would silently
// hand it the wrong shape for every date comparison it does (course release
// windows, cohort start/end dates, quiz attempt timestamps). A second small
// pool is one extra, cheap connection slot; reusing the app pool and
// discovering this the hard way is not worth the savings.
//
// The module itself ships TypeScript built for a bundler/ts-native host; this
// server has no build step, so it's compiled ahead of time to dist/ (see
// vendor/kcc-lms/VENDORED.md) and loaded here with a dynamic import() — dist/
// is ESM and this file is CommonJS, so `require()` cannot load it directly.
// =============================================================================
const mysql = require('mysql2/promise');
const storage = require('../services/storage');

// Ports — see server/vendor/kcc-lms/src/ports.ts. Both are thin adapters
// over the app's existing storage abstraction (same R2-in-production,
// local-disk-in-dev service the Media Library already uses), not a new
// video platform: a lesson's "video" is just a stored file played back with
// a plain <video> tag from a signed URL, not adaptive-bitrate streaming.
const storagePort = {
  async signedUrl(objectKey, expiresInSeconds) {
    const result = await storage.getReadable({ driver: storage.driver, key: objectKey, expiresIn: expiresInSeconds });
    if (result.type === 'redirect') return result.url;
    // Local driver has no URL of its own — see routes/lms.js's GET /files/*,
    // a dev-only fallback that never runs in production (S3/R2 is always
    // configured there).
    return `/api/lms/files/${objectKey}`;
  },
  async remove(objectKey) {
    await storage.remove({ driver: storage.driver, key: objectKey });
  },
};

const videoPort = {
  async playback(videoRef) {
    return { url: await storagePort.signedUrl(videoRef, 3600) };
  },
};

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'localcrm',
  waitForConnections: true,
  connectionLimit: 5,
  namedPlaceholders: true,
  // Deliberately NOT dateStrings:true — see the note above.
  timezone: 'Z',
  charset: 'utf8mb4',
});

let runtimePromise = null;

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const [lmsModule, drizzleModule, storesModule, mysqlSchema] = await Promise.all([
        import('../../vendor/kcc-lms/dist/index.js'),
        import('drizzle-orm/mysql2'),
        import('../../vendor/kcc-lms/dist/stores/index.js'),
        import('../../vendor/kcc-lms/dist/schema/mysql.js'),
      ]);
      const db = drizzleModule.drizzle(pool, { schema: mysqlSchema, mode: 'default' });
      const store = storesModule.mysqlStore({ db });
      return { lms: lmsModule, store, db, schema: mysqlSchema };
    })();
  }
  return runtimePromise;
}

/**
 * Builds an LmsContext for one request.
 *
 * `viewerId` is a string id — a `contacts.id` for an actual learner, or
 * `staff:<users.id>` for a staff member acting purely as author/admin with
 * no linked contact row (see VENDORED.md). `role` is one of the module's own
 * three tiers; map the host's permission system onto it at the call site.
 */
async function contextFor(viewerId, role) {
  const { lms, store } = await loadRuntime();
  return lms.lmsContext({ store, viewer: lms.asViewer(viewerId, role), ports: { storage: storagePort, video: videoPort } });
}

/** Maps the module's typed errors onto HTTP status codes. */
function statusForLmsError(err) {
  if (err?.name === 'LmsForbidden') return 403;
  if (err?.name === 'LmsNotFound') return 404;
  if (err?.name === 'LmsInvalid') return 400;
  if (err?.name === 'LmsConflict') return 409;
  return null;
}

module.exports = { loadRuntime, contextFor, statusForLmsError, pool };
