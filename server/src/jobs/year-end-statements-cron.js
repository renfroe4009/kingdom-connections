// =============================================================================
// Year-end giving statements cron
// -----------------------------------------------------------------------------
// Once a year, every donor who gave a captured/authorized gift in the prior
// calendar year should receive a consolidated giving statement PDF by email
// (loadYearEndStatementData / renderYearEndStatementPdf in services/receipts.js
// already generate the single-donor statement on demand — this job is what
// was missing: running that for every donor, unattended, at year-end).
//
// Runs daily at 5:00 AM, but only does anything during Jan 1–15 (statements
// cover the year that just ended). Outside that window tick() no-ops. Within
// the window it's safe to re-run every day: each contact's send is recorded
// as an `activities` row and skipped on subsequent days, so a mid-batch
// failure (SMTP outage, crash) is picked up and retried the next morning
// instead of silently losing that donor's statement.
// =============================================================================
const { db } = require('../db');
const { logActivity } = require('../services/activity');
const { sendMail } = require('../services/mailer');
const { loadYearEndStatementData, renderYearEndStatementPdf } = require('../services/receipts');

const STATEMENT_ACTION = 'year_end_statement_sent';
const WINDOW_END_DAY = 15; // only run automatically through Jan 15

function msUntilNext(hour, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

async function alreadySent(contactId, year) {
  const [[row]] = await db.query(
    `SELECT id FROM activities
      WHERE entity_type = 'contact' AND entity_id = :id
        AND action = :action AND description = :desc
      LIMIT 1`,
    { id: contactId, action: STATEMENT_ACTION, desc: `Year-end giving statement sent for ${year}` }
  );
  return Boolean(row);
}

async function sendStatement(contactId, year) {
  const data = await loadYearEndStatementData(contactId, year);
  if (!data || !data.gifts.length) return { ok: false, skipped: true, reason: 'no_gifts' };
  if (!data.contact.email) return { ok: false, skipped: true, reason: 'no_email' };

  const pdf = await renderYearEndStatementPdf(data);
  await sendMail({
    to: data.contact.email,
    subject: `Your ${year} year-end giving statement from ${data.company.name}`,
    text: `Hi ${data.contact.name},\n\nAttached is your consolidated giving statement for ${year} — thank you for your generosity. `
      + `Please retain this for your tax records.\n\n${data.company.name}`,
    attachments: [{ filename: `giving-statement-${year}-${contactId}.pdf`, content: pdf }],
    entityType: 'contact',
    entityId: contactId,
  });

  await logActivity({
    entityType: 'contact', entityId: contactId, action: STATEMENT_ACTION,
    description: `Year-end giving statement sent for ${year}`,
  });
  return { ok: true };
}

async function runYearEndStatements(year) {
  const [contacts] = await db.query(
    `SELECT DISTINCT d.contact_id
       FROM donations d
       JOIN payments p ON p.id = d.payment_id
       JOIN contacts c ON c.id = d.contact_id
      WHERE d.contact_id IS NOT NULL
        AND p.status IN ('captured','authorized')
        AND YEAR(d.created_at) = :year
        AND c.email IS NOT NULL AND c.email <> ''`,
    { year }
  );

  const results = { sent: 0, skipped: 0, failed: 0 };
  for (const { contact_id } of contacts) {
    try {
      if (await alreadySent(contact_id, year)) { results.skipped++; continue; }
      const r = await sendStatement(contact_id, year);
      if (r.ok) results.sent++; else results.skipped++;
    } catch (err) {
      results.failed++;
      // eslint-disable-next-line no-console
      console.error(`[year-end-statements] failed for contact #${contact_id}:`, err.message);
    }
  }
  return results;
}

async function tick() {
  const now = new Date();
  if (now.getMonth() !== 0 || now.getDate() > WINDOW_END_DAY) return; // only Jan 1–15
  const year = now.getFullYear() - 1;

  try {
    const results = await runYearEndStatements(year);
    if (results.sent || results.failed) {
      // eslint-disable-next-line no-console
      console.log('[year-end-statements] tick', { year, ...results });
    }
    if (!global._jobStatus) global._jobStatus = {};
    global._jobStatus.yearEndStatements = { lastRan: now.toISOString(), year, ...results };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[year-end-statements] tick failed:', err);
    if (!global._jobStatus) global._jobStatus = {};
    global._jobStatus.yearEndStatements = { lastRan: now.toISOString(), year, error: err.message };
  }
}

function startYearEndStatementsCron() {
  const wait = msUntilNext(5, 0);
  setTimeout(() => {
    tick();
    setInterval(tick, 24 * 60 * 60 * 1000);
  }, wait);
  // eslint-disable-next-line no-console
  console.log('[year-end-statements] scheduled (daily, active Jan 1-15)');
}

module.exports = startYearEndStatementsCron;
module.exports.runYearEndStatements = runYearEndStatements;
