// =============================================================================
// ConnectWise Manage — simple Phase 1 integration
// -----------------------------------------------------------------------------
// Auth: Basic auth using "<companyId>+<publicKey>:<privateKey>"
// Header clientId required.
// Docs: https://developer.connectwise.com/Products/ConnectWise_PSA/REST
// =============================================================================
const { db } = require('../db');

async function getCwSettings() {
  const [rows] = await db.query('SELECT * FROM cw_manage_settings ORDER BY is_active DESC, id DESC LIMIT 1');
  if (rows[0]) return rows[0];

  // fallback to env
  if (!process.env.CW_SITE_URL) return null;
  return {
    site_url:    process.env.CW_SITE_URL,
    company_id:  process.env.CW_COMPANY_ID,
    public_key:  process.env.CW_PUBLIC_KEY,
    private_key: process.env.CW_PRIVATE_KEY,
    client_id:   process.env.CW_CLIENT_ID,
    api_version: process.env.CW_API_VERSION || '2025.1',
    push_on_won: 1,
    webhook_url: null,
  };
}

function buildAuthHeader(cfg) {
  const raw = `${cfg.company_id}+${cfg.public_key}:${cfg.private_key}`;
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

async function cwFetch(cfg, path, { method = 'GET', body } = {}) {
  const url = `${cfg.site_url.replace(/\/$/, '')}/v4_6_release/apis/3.0${path}`;
  const headers = {
    'Authorization': buildAuthHeader(cfg),
    'Accept':        `application/vnd.connectwise.com+json; version=${cfg.api_version}`,
    'Content-Type':  'application/json',
  };
  if (cfg.client_id) headers['clientId'] = cfg.client_id;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_e) { json = { raw: text }; }
  if (!res.ok) {
    // Upstream bodies can be arbitrary (a full Cloudflare challenge HTML page,
    // a stack trace, etc.) — never forward that to the client. Log the
    // (truncated) body for our own debugging, throw a short generic message.
    const rawText = (json && typeof json.raw === 'string') ? json.raw : JSON.stringify(json);
    console.error(`[connectwise] ${method} ${path} failed ${res.status}: ${String(rawText).slice(0, 200)}`);
    const err = new Error(`ConnectWise request failed (${res.status}). Check integration settings.`);
    err.status = res.status;
    err.response = json; // full parsed body still available to server-side callers, just not in .message
    throw err;
  }
  return json;
}

async function logSync({ entityType, entityId, action, direction = 'outbound', request, response, status, error }) {
  try {
    await db.query(
      `INSERT INTO cw_sync_log (entity_type, entity_id, direction, action, request_json, response_json, status, error)
       VALUES (:entityType, :entityId, :direction, :action, CAST(:req AS JSON), CAST(:res AS JSON), :status, :error)`,
      {
        entityType, entityId, direction, action,
        req: request  ? JSON.stringify(request)  : null,
        res: response ? JSON.stringify(response) : null,
        status,
        error: error || null,
      }
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[cw_sync_log]', e.message);
  }
}

/**
 * Fire an outbound webhook (optional) with the deal payload.
 * Used in addition to / instead of direct API push depending on settings.
 */
async function fireWebhook(url, payload) {
  if (!url) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, ok: res.ok };
}

/**
 * Push a won deal to ConnectWise Manage:
 *   1. Upsert Company (by name)
 *   2. Create Opportunity on that company
 *   3. Update local deal + organization with CW ids
 */
async function pushDealToManage(dealId) {
  const cfg = await getCwSettings();
  if (!cfg) {
    await logSync({
      entityType: 'deal', entityId: dealId, action: 'push_deal',
      status: 'failed', error: 'ConnectWise Manage not configured',
    });
    throw new Error('ConnectWise Manage not configured');
  }

  // Load deal + org + contact
  const [deals] = await db.query(
    `SELECT d.*, o.name AS org_name, o.cw_company_id, o.phone AS org_phone,
            o.website, o.address_line1, o.city, o.state, o.postal_code, o.country,
            c.first_name, c.last_name, c.email AS contact_email, c.phone AS contact_phone, c.cw_contact_id,
            u.cw_member_id AS owner_cw_member_id
       FROM deals d
       LEFT JOIN organizations o ON o.id = d.organization_id
       LEFT JOIN contacts c      ON c.id = d.primary_contact_id
       LEFT JOIN users u         ON u.id = d.owner_id
      WHERE d.id = :id`,
    { id: dealId }
  );
  const deal = deals[0];
  if (!deal) throw new Error('Deal not found');

  // ConnectWise requires full country names — map common abbreviations.
  function normalizeCwCountry(raw) {
    if (!raw) return null;
    const map = {
      'US': 'United States', 'USA': 'United States', 'U.S.A.': 'United States', 'U.S.': 'United States',
      'CA': 'Canada', 'CAN': 'Canada',
      'GB': 'United Kingdom', 'UK': 'United Kingdom',
      'AU': 'Australia', 'AUS': 'Australia',
      'DE': 'Germany', 'FR': 'France', 'MX': 'Mexico',
      'NZ': 'New Zealand', 'IE': 'Ireland', 'IN': 'India',
    };
    return map[raw.trim().toUpperCase()] || raw.trim();
  }

  // ---------------- Step 1: upsert company ----------------
  let cwCompanyId = deal.cw_company_id;
  if (!cwCompanyId && deal.org_name) {
    // CW identifier: letters, numbers, spaces, + only (no hyphens/special chars)
    const identifier = deal.org_name
      .toLowerCase()
      .replace(/[^a-z0-9 +]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50);

    const companyPayload = {
      name:       deal.org_name,
      identifier: identifier || 'company',
      site:       { name: 'Main' },  // required by CW API
      ...(deal.org_phone    && { phoneNumber:  deal.org_phone }),
      ...(deal.website      && { website:      deal.website }),
      ...(deal.address_line1 && { addressLine1: deal.address_line1 }),
      ...(deal.city         && { city:         deal.city }),
      ...(deal.state        && { state:        deal.state }),
      ...(deal.postal_code  && { zip:          deal.postal_code }),
      ...(normalizeCwCountry(deal.country) && { country: { name: normalizeCwCountry(deal.country) } }),
    };
    try {
      const company = await cwFetch(cfg, '/company/companies', { method: 'POST', body: companyPayload });
      cwCompanyId = company.id;
      await db.query('UPDATE organizations SET cw_company_id = :cw WHERE id = :id',
        { cw: cwCompanyId, id: deal.organization_id });
      await logSync({ entityType: 'organization', entityId: deal.organization_id, action: 'push_company',
        request: companyPayload, response: company, status: 'success' });
    } catch (err) {
      await logSync({ entityType: 'organization', entityId: deal.organization_id, action: 'push_company',
        request: companyPayload, response: err.response, status: 'failed', error: err.message });
      throw err;
    }
  }

  // ---------------- Step 1b: upsert contact ----------------
  let cwContactId = deal.cw_contact_id;

  if (!cwContactId && (deal.first_name || deal.last_name)) {
    // Deal has a local contact — create them in CW
    const contactPayload = {
      firstName: deal.first_name || '',
      lastName:  deal.last_name  || 'Unknown',
      ...(cwCompanyId        && { company: { id: cwCompanyId } }),
      ...(deal.contact_email && { communicationItems: [
        { type: { name: 'Email' }, value: deal.contact_email, defaultFlag: true },
      ]}),
    };
    try {
      const contact = await cwFetch(cfg, '/company/contacts', { method: 'POST', body: contactPayload });
      cwContactId = contact.id;
      if (deal.primary_contact_id) {
        await db.query('UPDATE contacts SET cw_contact_id = :cw WHERE id = :id',
          { cw: cwContactId, id: deal.primary_contact_id });
      }
      await logSync({ entityType: 'contact', entityId: deal.primary_contact_id, action: 'push_contact',
        request: contactPayload, response: contact, status: 'success' });
    } catch (err) {
      await logSync({ entityType: 'contact', entityId: deal.primary_contact_id, action: 'push_contact',
        request: contactPayload, response: err.response, status: 'failed', error: err.message });
    }
  }

  if (!cwContactId && deal.organization_id) {
    // No local contact on deal — check if the org has any contacts locally
    const [orgContacts] = await db.query(
      `SELECT id, first_name, last_name, email, cw_contact_id
         FROM contacts WHERE organization_id = :orgId LIMIT 1`,
      { orgId: deal.organization_id }
    );
    const orgContact = orgContacts[0];
    if (orgContact) {
      if (orgContact.cw_contact_id) {
        cwContactId = orgContact.cw_contact_id;
      } else {
        // Push this org contact to CW
        const contactPayload = {
          firstName: orgContact.first_name || '',
          lastName:  orgContact.last_name  || 'Unknown',
          ...(cwCompanyId        && { company: { id: cwCompanyId } }),
          ...(orgContact.email   && { communicationItems: [
            { type: { name: 'Email' }, value: orgContact.email, defaultFlag: true },
          ]}),
        };
        try {
          const contact = await cwFetch(cfg, '/company/contacts', { method: 'POST', body: contactPayload });
          cwContactId = contact.id;
          await db.query('UPDATE contacts SET cw_contact_id = :cw WHERE id = :id',
            { cw: cwContactId, id: orgContact.id });
          await logSync({ entityType: 'contact', entityId: orgContact.id, action: 'push_contact',
            request: contactPayload, response: contact, status: 'success' });
        } catch (err) {
          await logSync({ entityType: 'contact', entityId: orgContact.id, action: 'push_contact',
            request: contactPayload, response: err.response, status: 'failed', error: err.message });
        }
      }
    }
  }

  if (!cwContactId && cwCompanyId) {
    // Last resort — look up existing contacts at this CW company
    try {
      const contacts = await cwFetch(cfg, `/company/contacts?conditions=company/id=${cwCompanyId}&pageSize=1`);
      if (Array.isArray(contacts) && contacts[0]) cwContactId = contacts[0].id;
    } catch (_) { /* best-effort */ }
  }

  if (!cwContactId) {
    const err = new Error(
      'Deal has no primary contact. Add a contact to this deal before pushing to ConnectWise.'
    );
    await logSync({ entityType: 'deal', entityId: dealId, action: 'push_deal',
      status: 'failed', error: err.message });
    throw err;
  }

  // ---------------- Step 2: create opportunity ----------------
  // Build a minimal payload — only send fields that are actually set so CW
  // can apply its own defaults for location, business unit, etc.
  const closeDate = deal.expected_close_date
    ? new Date(deal.expected_close_date).toISOString().split('T')[0] + 'T00:00:00Z'
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] + 'T00:00:00Z';

  const oppPayload = {
    name: deal.name || 'Untitled Opportunity',
    expectedCloseDate: closeDate,
    ...(cwCompanyId  && { company: { id: cwCompanyId } }),
    ...(cwContactId  && { contact: { id: cwContactId } }),
    ...(deal.description     && { notes:      deal.description }),
    ...(cfg.cw_location_id   && { locationId: Number(cfg.cw_location_id) }),
    ...(cfg.cw_business_unit_id && { businessUnitId: Number(cfg.cw_business_unit_id) }),
    ...(cfg.cw_stage_name    && { stage:      { name: cfg.cw_stage_name } }),
    ...(cfg.cw_status_name   && { status:     { name: cfg.cw_status_name } }),
    ...((deal.owner_cw_member_id || cfg.cw_member_id) && {
      primarySalesRep: { identifier: deal.owner_cw_member_id || cfg.cw_member_id },
    }),
  };

  let opp;
  try {
    opp = await cwFetch(cfg, '/sales/opportunities', { method: 'POST', body: oppPayload });
    await db.query(
      'UPDATE deals SET cw_opportunity_id = :cw, cw_pushed_at = NOW() WHERE id = :id',
      { cw: opp.id, id: deal.id }
    );
    await logSync({ entityType: 'deal', entityId: deal.id, action: 'push_opportunity',
      request: oppPayload, response: opp, status: 'success' });
  } catch (err) {
    await logSync({ entityType: 'deal', entityId: deal.id, action: 'push_opportunity',
      request: oppPayload, response: err.response, status: 'failed', error: err.message });
    throw err;
  }

  // ---------------- Step 3: optional outbound webhook ----------------
  if (cfg.webhook_url) {
    try {
      const res = await fireWebhook(cfg.webhook_url, {
        event: 'deal.won', deal, cwCompanyId, cwOpportunityId: opp.id,
      });
      await logSync({ entityType: 'deal', entityId: deal.id, action: 'webhook_out',
        request: { url: cfg.webhook_url }, response: res, status: res.ok ? 'success' : 'failed' });
    } catch (err) {
      await logSync({ entityType: 'deal', entityId: deal.id, action: 'webhook_out',
        status: 'failed', error: err.message });
    }
  }

  return { cwCompanyId, cwOpportunityId: opp.id };
}

async function testConnection() {
  const cfg = await getCwSettings();
  if (!cfg) throw new Error('ConnectWise Manage not configured');
  const res = await cwFetch(cfg, '/system/info');
  return res;
}

// =============================================================================
// Inbound sync: pull CW Companies → organizations, CW Contacts → contacts
// =============================================================================

const PAGE_SIZE = 1000;

async function cwFetchAll(cfg, path) {
  const all = [];
  let page = 1;
  while (true) {
    const rows = await cwFetch(cfg, `${path}?pageSize=${PAGE_SIZE}&page=${page}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

async function importFromConnectWise(runId) {
  const cfg = await getCwSettings();
  if (!cfg) throw new Error('ConnectWise Manage not configured');

  const stats = { orgs_created: 0, orgs_updated: 0, contacts_created: 0, contacts_updated: 0 };

  // ── Companies → Organizations ────────────────────────────────────────────
  const companies = await cwFetchAll(cfg, '/company/companies');
  for (const co of companies) {
    const [existing] = await db.query(
      'SELECT id FROM organizations WHERE cw_company_id = :cwId LIMIT 1',
      { cwId: co.id }
    );
    const row = existing[0];

    const phone   = co.phoneNumber || co.phone || null;
    const website = co.website || null;
    const addr    = co.addressLine1 || null;
    const city    = co.city || null;
    const state   = co.state || null;
    const zip     = co.zip || null;
    const country = co.country?.name || co.country || null;

    if (row) {
      await db.query(
        `UPDATE organizations SET
           name          = :name,
           phone         = COALESCE(:phone, phone),
           website       = COALESCE(:website, website),
           address_line1 = COALESCE(:addr, address_line1),
           city          = COALESCE(:city, city),
           state         = COALESCE(:state, state),
           postal_code   = COALESCE(:zip, postal_code),
           country       = COALESCE(:country, country)
         WHERE id = :id`,
        { name: co.name, phone, website, addr, city, state, zip, country, id: row.id }
      );
      stats.orgs_updated++;
    } else {
      // Check if same-name org exists without a cw_company_id (e.g. manually entered)
      const [byName] = await db.query(
        'SELECT id FROM organizations WHERE name = :name AND cw_company_id IS NULL LIMIT 1',
        { name: co.name }
      );
      if (byName[0]) {
        await db.query(
          `UPDATE organizations SET
             cw_company_id = :cwId,
             phone         = COALESCE(:phone, phone),
             website       = COALESCE(:website, website),
             address_line1 = COALESCE(:addr, address_line1),
             city          = COALESCE(:city, city),
             state         = COALESCE(:state, state),
             postal_code   = COALESCE(:zip, postal_code),
             country       = COALESCE(:country, country)
           WHERE id = :id`,
          { cwId: co.id, phone, website, addr, city, state, zip, country, id: byName[0].id }
        );
        stats.orgs_updated++;
      } else {
        await db.query(
          `INSERT INTO organizations (name, phone, website, address_line1, city, state, postal_code, country, cw_company_id)
           VALUES (:name, :phone, :website, :addr, :city, :state, :zip, :country, :cwId)`,
          { name: co.name || 'Unnamed', phone, website, addr, city, state, zip, country, cwId: co.id }
        );
        stats.orgs_created++;
      }
    }
  }

  await db.query(
    'UPDATE cw_import_run SET orgs_created=:c, orgs_updated=:u WHERE id=:id',
    { c: stats.orgs_created, u: stats.orgs_updated, id: runId }
  );

  // ── Contacts ─────────────────────────────────────────────────────────────
  const contacts = await cwFetchAll(cfg, '/company/contacts');
  for (const ct of contacts) {
    const [existing] = await db.query(
      'SELECT id FROM contacts WHERE cw_contact_id = :cwId LIMIT 1',
      { cwId: ct.id }
    );
    const row = existing[0];

    const firstName = ct.firstName || '';
    const lastName  = ct.lastName  || '';
    const email = ct.communicationItems?.find((i) => i.type?.name === 'Email')?.value || null;
    const phone = ct.communicationItems?.find((i) =>
      ['Direct', 'Office', 'Cell', 'Mobile', 'Phone'].includes(i.type?.name)
    )?.value || null;
    const title = ct.title || null;

    // Resolve local org id from the CW company id on the contact
    let orgId = null;
    if (ct.company?.id) {
      const [orgRows] = await db.query(
        'SELECT id FROM organizations WHERE cw_company_id = :cwId LIMIT 1',
        { cwId: ct.company.id }
      );
      orgId = orgRows[0]?.id || null;
    }

    if (row) {
      await db.query(
        `UPDATE contacts SET
           first_name      = :fn,
           last_name       = :ln,
           email           = COALESCE(:email, email),
           phone           = COALESCE(:phone, phone),
           title           = COALESCE(:title, title),
           organization_id = COALESCE(:orgId, organization_id)
         WHERE id = :id`,
        { fn: firstName, ln: lastName, email, phone, title, orgId, id: row.id }
      );
      stats.contacts_updated++;
    } else {
      // Try to match by email first
      const [byEmail] = email
        ? await db.query('SELECT id FROM contacts WHERE email = :email AND cw_contact_id IS NULL LIMIT 1', { email })
        : [[]];
      if (byEmail[0]) {
        await db.query(
          `UPDATE contacts SET
             cw_contact_id   = :cwId,
             first_name      = :fn,
             last_name       = :ln,
             phone           = COALESCE(:phone, phone),
             title           = COALESCE(:title, title),
             organization_id = COALESCE(:orgId, organization_id)
           WHERE id = :id`,
          { cwId: ct.id, fn: firstName, ln: lastName, phone, title, orgId, id: byEmail[0].id }
        );
        stats.contacts_updated++;
      } else {
        await db.query(
          `INSERT INTO contacts (first_name, last_name, email, phone, title, organization_id, cw_contact_id)
           VALUES (:fn, :ln, :email, :phone, :title, :orgId, :cwId)`,
          { fn: firstName, ln: lastName, email, phone, title, orgId, cwId: ct.id }
        );
        stats.contacts_created++;
      }
    }
  }

  return stats;
}

// =============================================================================
// Single-contact search + import (for the "pick from CW" UI flow)
// =============================================================================

async function searchCwContacts(query) {
  const cfg = await getCwSettings();
  if (!cfg) throw new Error('ConnectWise Manage not configured');
  const q = query.trim().replace(/"/g, '');
  const conditions = `firstName contains "${q}" OR lastName contains "${q}"`;
  const results = await cwFetch(
    cfg,
    `/company/contacts?conditions=${encodeURIComponent(conditions)}&pageSize=25&fields=id,firstName,lastName,title,company,communicationItems`
  );
  return (Array.isArray(results) ? results : []).map((ct) => ({
    id:        ct.id,
    firstName: ct.firstName || '',
    lastName:  ct.lastName  || '',
    title:     ct.title     || '',
    company:   ct.company   ? { id: ct.company.id, name: ct.company.name } : null,
    email: ct.communicationItems?.find((i) => i.type?.name === 'Email')?.value || null,
    phone: ct.communicationItems?.find((i) =>
      ['Direct', 'Office', 'Cell', 'Mobile', 'Phone'].includes(i.type?.name)
    )?.value || null,
  }));
}

async function importCwContact(cwContactId) {
  const cfg = await getCwSettings();
  if (!cfg) throw new Error('ConnectWise Manage not configured');

  const ct = await cwFetch(cfg, `/company/contacts/${cwContactId}`);

  const firstName = ct.firstName || '';
  const lastName  = ct.lastName  || '';
  const email = ct.communicationItems?.find((i) => i.type?.name === 'Email')?.value || null;
  const phone = ct.communicationItems?.find((i) =>
    ['Direct', 'Office', 'Cell', 'Mobile', 'Phone'].includes(i.type?.name)
  )?.value || null;
  const title = ct.title || null;

  // ── Upsert org from CW company ──────────────────────────────────────────────
  let orgId = null;
  if (ct.company?.id) {
    const [existingOrg] = await db.query(
      'SELECT id FROM organizations WHERE cw_company_id = :cwId LIMIT 1',
      { cwId: ct.company.id }
    );
    if (existingOrg[0]) {
      orgId = existingOrg[0].id;
    } else {
      // Fetch full company details from CW
      let co = ct.company;
      try { co = await cwFetch(cfg, `/company/companies/${ct.company.id}`); } catch (_) { /* use stub */ }

      // Check by name if no cw_company_id match
      const [byName] = await db.query(
        'SELECT id FROM organizations WHERE name = :name AND cw_company_id IS NULL LIMIT 1',
        { name: co.name }
      );
      if (byName[0]) {
        await db.query(
          'UPDATE organizations SET cw_company_id = :cwId WHERE id = :id',
          { cwId: ct.company.id, id: byName[0].id }
        );
        orgId = byName[0].id;
      } else {
        const [ins] = await db.query(
          `INSERT INTO organizations (name, phone, website, address_line1, city, state, postal_code, country, cw_company_id)
           VALUES (:name, :phone, :website, :addr, :city, :state, :zip, :country, :cwId)`,
          {
            name:    co.name || 'Unnamed',
            phone:   co.phoneNumber || co.phone || null,
            website: co.website || null,
            addr:    co.addressLine1 || null,
            city:    co.city || null,
            state:   co.state || null,
            zip:     co.zip || null,
            country: co.country?.name || co.country || null,
            cwId:    ct.company.id,
          }
        );
        orgId = ins.insertId;
      }
    }
  }

  // ── Upsert contact ──────────────────────────────────────────────────────────
  const [existingCt] = await db.query(
    'SELECT id FROM contacts WHERE cw_contact_id = :cwId LIMIT 1',
    { cwId: cwContactId }
  );

  let contactId;
  if (existingCt[0]) {
    contactId = existingCt[0].id;
    await db.query(
      `UPDATE contacts SET
         first_name      = :fn,
         last_name       = :ln,
         email           = COALESCE(:email, email),
         phone           = COALESCE(:phone, phone),
         title           = COALESCE(:title, title),
         organization_id = COALESCE(:orgId, organization_id)
       WHERE id = :id`,
      { fn: firstName, ln: lastName, email, phone, title, orgId, id: contactId }
    );
  } else {
    const [byEmail] = email
      ? await db.query('SELECT id FROM contacts WHERE email = :email AND cw_contact_id IS NULL LIMIT 1', { email })
      : [[]];
    if (byEmail[0]) {
      contactId = byEmail[0].id;
      await db.query(
        `UPDATE contacts SET cw_contact_id=:cwId, first_name=:fn, last_name=:ln,
           phone=COALESCE(:phone,phone), title=COALESCE(:title,title),
           organization_id=COALESCE(:orgId,organization_id)
         WHERE id=:id`,
        { cwId: cwContactId, fn: firstName, ln: lastName, phone, title, orgId, id: contactId }
      );
    } else {
      const [ins] = await db.query(
        `INSERT INTO contacts (first_name, last_name, email, phone, title, organization_id, cw_contact_id)
         VALUES (:fn, :ln, :email, :phone, :title, :orgId, :cwId)`,
        { fn: firstName, ln: lastName, email, phone, title, orgId, cwId: cwContactId }
      );
      contactId = ins.insertId;
    }
  }

  return { contactId, orgId, created: !existingCt[0] };
}

module.exports = { pushDealToManage, testConnection, getCwSettings, fireWebhook, cwFetch, importFromConnectWise, searchCwContacts, importCwContact };
