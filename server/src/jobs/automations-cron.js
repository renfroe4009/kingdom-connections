// =============================================================================
// Automations cron — runs every 2 minutes
//   1. Drain automation_scheduled_steps where scheduled_for <= NOW()
//   2. Fire 'invoice.overdue' trigger for overdue invoices not yet enrolled
// =============================================================================
const { Cron } = require('croner');
const { db } = require('../db');
const { resumeScheduledStep, triggerWorkflow } = require('../services/automations');

let _started = false;

async function drainScheduledSteps() {
  const [steps] = await db.query(
    `SELECT id FROM automation_scheduled_steps
      WHERE status = 'pending' AND scheduled_for <= NOW()
      ORDER BY scheduled_for
      LIMIT 50`
  );
  for (const { id } of steps) {
    try {
      await resumeScheduledStep(id);
    } catch (err) {
      console.error(`[automations-cron] step ${id} error:`, err.message);
    }
  }
}

async function fireOverdueTriggers() {
  // Only fire if there are active workflows listening for invoice.overdue
  const [[{ cnt }]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM automation_workflows
      WHERE status = 'active' AND trigger_type = 'invoice.overdue'`
  );
  if (!cnt) return;

  // Get overdue invoices that don't yet have an active enrollment in any
  // invoice.overdue automation (prevents firing every 2 minutes forever)
  const [invoices] = await db.query(
    `SELECT i.id, i.contact_id, i.organization_id, i.total, i.balance_due,
            i.due_date, i.invoice_number,
            DATEDIFF(CURDATE(), i.due_date) AS days_overdue
       FROM invoices i
      WHERE i.status = 'overdue'
        AND NOT EXISTS (
          SELECT 1 FROM automation_enrollments ae
            JOIN automation_workflows aw ON aw.id = ae.workflow_id
           WHERE aw.trigger_type = 'invoice.overdue'
             AND ae.entity_type = 'invoice'
             AND ae.entity_id = i.id
             AND ae.status = 'active'
        )`
  );

  for (const inv of invoices) {
    await triggerWorkflow('invoice.overdue', 'invoice', inv, {
      days_overdue: inv.days_overdue,
    });
  }
}

function start() {
  if (_started) return;
  _started = true;

  Cron('*/2 * * * *', { name: 'automations-drain' }, async () => {
    try {
      await drainScheduledSteps();
      if (!global._jobStatus) global._jobStatus = {};
      global._jobStatus.automations = { ...global._jobStatus.automations, lastDrain: new Date().toISOString() };
    } catch (err) {
      console.error('[automations-cron] drain error:', err.message);
      if (!global._jobStatus) global._jobStatus = {};
      global._jobStatus.automations = { ...global._jobStatus.automations, lastDrainError: err.message };
    }
  });

  Cron('*/15 * * * *', { name: 'automations-overdue' }, async () => {
    try {
      await fireOverdueTriggers();
      if (!global._jobStatus) global._jobStatus = {};
      global._jobStatus.automations = { ...global._jobStatus.automations, lastOverdue: new Date().toISOString() };
    } catch (err) {
      console.error('[automations-cron] overdue error:', err.message);
      if (!global._jobStatus) global._jobStatus = {};
      global._jobStatus.automations = { ...global._jobStatus.automations, lastOverdueError: err.message };
    }
  });

  console.log('Automations cron started');
}

module.exports = start;
