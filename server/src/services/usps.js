// =============================================================================
// USPS — Addresses 3.0 API (developers.usps.com)
// -----------------------------------------------------------------------------
// OAuth2 client-credentials flow.
//   Token:     POST {base}/oauth2/v3/token        (application/x-www-form-urlencoded)
//   Address:   GET  {base}/addresses/v3/address   (query params, Bearer token)
//   City/State GET  {base}/addresses/v3/city-state (query params, Bearer token)
//
// We cache the access token in-process. It's refreshed ~60s before expiry and
// forcefully re-fetched on any 401.
// =============================================================================
const { db } = require('../db');

let _tokenCache = { token: null, expiresAt: 0, key: null };

async function getUspsSettings() {
  const [rows] = await db.query(
    'SELECT * FROM usps_settings WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
  );
  if (rows[0]) return rows[0];

  if (!process.env.USPS_CLIENT_ID) return null;
  return {
    base_url:        process.env.USPS_BASE_URL || 'https://apis.usps.com',
    consumer_key:    process.env.USPS_CLIENT_ID,
    consumer_secret: process.env.USPS_CLIENT_SECRET,
    is_active: 1,
  };
}

async function getToken(cfg, { force = false } = {}) {
  const now = Date.now();
  const cacheKey = `${cfg.base_url}|${cfg.consumer_key}`;
  if (!force
      && _tokenCache.token
      && _tokenCache.key === cacheKey
      && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.token;
  }

  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     cfg.consumer_key,
    client_secret: cfg.consumer_secret,
    scope:         'addresses',
  });
  const url = `${cfg.base_url.replace(/\/$/, '')}/oauth2/v3/token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_e) { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error_description || json?.error || `${res.status} ${res.statusText}`;
    throw new Error(`USPS token fetch failed: ${msg}`);
  }
  _tokenCache = {
    token: json.access_token,
    expiresAt: now + (Number(json.expires_in || 3600) * 1000),
    key: cacheKey,
  };
  return _tokenCache.token;
}

async function uspsGet(cfg, path, query) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  ).toString();
  const url = `${cfg.base_url.replace(/\/$/, '')}${path}${qs ? '?' + qs : ''}`;

  async function call(token) {
    return fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
  }

  let token = await getToken(cfg);
  let res = await call(token);
  if (res.status === 401) {
    // Stale cache — force a refresh and retry once.
    token = await getToken(cfg, { force: true });
    res = await call(token);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_e) { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `${res.status} ${res.statusText}`;
    const err = new Error(`USPS GET ${path} failed: ${msg}`);
    err.status = res.status;
    err.response = json;
    throw err;
  }
  return json;
}

/**
 * Validate / standardize a US address.
 * Input is lenient — either (street + zip) or (street + city + state) is enough.
 * Returns the USPS-standardized payload plus a condensed `formatted` object
 * the client can map straight onto form fields.
 */
async function verifyAddress(input) {
  const cfg = await getUspsSettings();
  if (!cfg) throw new Error('USPS API is not configured. Add credentials in Settings.');

  // If city/state missing but ZIP given, USPS will fill them in anyway.
  const json = await uspsGet(cfg, '/addresses/v3/address', {
    streetAddress:    (input.street_address || input.address_line1 || '').trim(),
    secondaryAddress: (input.secondary_address || input.address_line2 || '').trim(),
    city:             (input.city || '').trim(),
    state:            (input.state || '').trim().toUpperCase(),
    ZIPCode:          String(input.zip_code || input.postal_code || '').trim().split('-')[0],
    ZIPPlus4:         input.zip_plus4 || undefined,
  });

  const a = json?.address || {};
  const addl = json?.additionalInfo || {};
  return {
    raw: json,
    formatted: {
      address_line1: a.streetAddress   || '',
      address_line2: a.secondaryAddress || '',
      city:          a.city            || '',
      state:         a.state           || '',
      postal_code:   a.ZIPCode
                     ? (a.ZIPPlus4 ? `${a.ZIPCode}-${a.ZIPPlus4}` : a.ZIPCode)
                     : '',
      country:       'USA',
    },
    warnings: json?.corrections || [],
    matchCode: json?.matchCode   || null,
    dpvConfirmation: addl?.DPVConfirmation || null,
    business: addl?.business === 'Y',
    vacant:   addl?.vacant   === 'Y',
  };
}

/**
 * ZIP -> City/State lookup (bonus; not currently wired into UI but handy).
 */
async function cityStateLookup(zip) {
  const cfg = await getUspsSettings();
  if (!cfg) throw new Error('USPS API is not configured.');
  return uspsGet(cfg, '/addresses/v3/city-state', { ZIPCode: String(zip).trim().split('-')[0] });
}

async function testConnection() {
  const cfg = await getUspsSettings();
  if (!cfg) throw new Error('USPS API is not configured.');
  await getToken(cfg, { force: true });
  // Probe the service with a known-good address.
  const probe = await verifyAddress({
    street_address: '1600 Pennsylvania Ave NW',
    city: 'Washington', state: 'DC', zip_code: '20500',
  });
  return { ok: true, probe: probe.formatted };
}

module.exports = { getUspsSettings, verifyAddress, cityStateLookup, testConnection };
