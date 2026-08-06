// =============================================================================
// /api/maps  —  geocoded pins for organizations + contacts
// -----------------------------------------------------------------------------
// Uses Nominatim (OSM) for geocoding. Results are cached in geo_cache forever,
// keyed off a SHA-1 hash of the normalized address. Cache invalidates automatically
// when the hash changes (i.e., address was edited).
// =============================================================================
const router = require('express').Router();
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { resolveOwnerScope, ownerClause } = require('../services/scope');

router.use(requireAuth);

function normalizeAddress(a) {
  return [a.address_line1, a.city, a.state, a.postal_code, a.country]
    .map((x) => (x || '').toString().trim().toLowerCase())
    .filter(Boolean)
    .join(', ');
}
function hashAddress(a) {
  return crypto.createHash('sha1').update(normalizeAddress(a)).digest('hex');
}

// Returns { lat, lng, cached } from cache if possible. Geocoding a new address
// requires { allowRemote: true } — we batch a small number per request so we
// don't blow Nominatim's 1 req/sec rate limit and cause the whole endpoint to
// hang or get banned. Remaining uncached entries still show up in the pin list
// (just without coordinates) and resolve on subsequent loads.
async function cachedGeocode(entityType, entity, { allowRemote = true } = {}) {
  if (!entity.address_line1 && !entity.postal_code) return null;
  const hash = hashAddress(entity);
  const [[existing]] = await db.query(
    `SELECT lat, lng, address_hash FROM geo_cache
      WHERE entity_type = :et AND entity_id = :eid`,
    { et: entityType, eid: entity.id });
  if (existing && existing.address_hash === hash && existing.lat != null) {
    return { lat: Number(existing.lat), lng: Number(existing.lng), cached: true };
  }
  if (!allowRemote) return null;

  // Call Nominatim (self-hostable; free for reasonable use, per their policy).
  const q = normalizeAddress(entity);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  // AbortController guards against a hanging fetch dragging the whole request.
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'localCRM/1.0 (contact: admin@localcrm.local)',
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    });
  } catch (_e) {
    clearTimeout(timeout);
    return null;
  }
  clearTimeout(timeout);
  if (!res.ok) return null;
  const arr = await res.json().catch(() => []);
  const first = arr?.[0];
  const lat = first ? Number(first.lat) : null;
  const lng = first ? Number(first.lon) : null;

  // Upsert cache (even if null, to avoid retrying the same bad address on every request).
  if (existing) {
    await db.query(
      `UPDATE geo_cache SET lat = :lat, lng = :lng, address_hash = :hash, resolved_at = NOW()
        WHERE entity_type = :et AND entity_id = :eid`,
      { et: entityType, eid: entity.id, lat, lng, hash });
  } else {
    await db.query(
      `INSERT INTO geo_cache (entity_type, entity_id, address_hash, lat, lng, provider)
       VALUES (:et, :eid, :hash, :lat, :lng, 'nominatim')`,
      { et: entityType, eid: entity.id, hash, lat, lng });
  }
  return lat != null && lng != null ? { lat, lng, cached: false } : null;
}

router.get('/pins', requirePermission('maps.view'), async (req, res, next) => {
  try {
    const { owner_id, lifecycle_stage, tag_id } = req.query;

    const scopeIds = await resolveOwnerScope(req.user);
    // If an explicit owner_id filter is passed, narrow scope to that user only
    // (already guaranteed to be within the caller's scope by the WHERE IN clause)
    const effectiveScope = owner_id
      ? (scopeIds === null ? null : scopeIds.filter((id) => id === Number(owner_id)))
      : scopeIds;

    const oCope = ownerClause(effectiveScope, 'o.owner_id');
    const cCope = ownerClause(effectiveScope, 'c.owner_id');

    // Organizations
    const oConds = ["o.address_line1 IS NOT NULL AND o.address_line1 != ''"];
    if (oCope) oConds.push(oCope);
    const [orgs] = await db.query(
      `SELECT o.id, o.name, o.address_line1, o.city, o.state, o.postal_code, o.country
         FROM organizations o
        WHERE ${oConds.join(' AND ')}`);

    // Contacts
    const cConds = ["c.address_line1 IS NOT NULL AND c.address_line1 != ''"];
    if (cCope)         cConds.push(cCope);
    if (lifecycle_stage) { cConds.push('c.lifecycle_stage = :ls'); }
    if (tag_id)          { cConds.push('c.id IN (SELECT contact_id FROM contact_tags WHERE tag_id = :tid)'); }
    const cParams = {};
    if (lifecycle_stage) cParams.ls  = lifecycle_stage;
    if (tag_id)          cParams.tid = tag_id;
    const [contacts] = await db.query(
      `SELECT c.id, c.first_name, c.last_name, c.title,
              c.address_line1, c.city, c.state, c.postal_code, c.country,
              c.lifecycle_stage,
              o.name AS organization_name
         FROM contacts c
         LEFT JOIN organizations o ON o.id = c.organization_id
        WHERE ${cConds.join(' AND ')}`, cParams);

    // Geocode with a per-request budget for remote lookups. Nominatim allows
    // ~1 req/sec — we cap at 10 new lookups per page load and space them out
    // by 1.1s. Cached entries are free. Un-geocoded entries remain in the DB
    // uncached so the next visit keeps chipping away at the backlog.
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let budget = 10;
    const pins = [];
    let pending = 0;

    for (const o of orgs) {
      let geo = await cachedGeocode('organization', o, { allowRemote: false }).catch(() => null);
      if (!geo && budget > 0) {
        if (pending > 0) await sleep(1100);
        geo = await cachedGeocode('organization', o, { allowRemote: true }).catch(() => null);
        budget--; pending++;
      } else if (!geo) { pending++; }
      if (geo) pins.push({ ...o, kind: 'organization', label: o.name, lat: geo.lat, lng: geo.lng });
    }
    for (const c of contacts) {
      let geo = await cachedGeocode('contact', c, { allowRemote: false }).catch(() => null);
      if (!geo && budget > 0) {
        if (pending > 0) await sleep(1100);
        geo = await cachedGeocode('contact', c, { allowRemote: true }).catch(() => null);
        budget--; pending++;
      } else if (!geo) { pending++; }
      if (geo) pins.push({
        ...c, kind: 'contact',
        label: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
        lat: geo.lat, lng: geo.lng,
      });
    }
    res.json({ pins, meta: { total_orgs: orgs.length, total_contacts: contacts.length, budget_remaining: budget } });
  } catch (err) { next(err); }
});

// Invalidate cache for one entity — called from contact/org edit flow later.
router.post('/invalidate', requirePermission('maps.view'), async (req, res, next) => {
  try {
    const { entity_type, entity_id } = req.body || {};
    if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type + entity_id required' });
    await db.query(
      'DELETE FROM geo_cache WHERE entity_type = :et AND entity_id = :eid',
      { et: entity_type, eid: entity_id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
