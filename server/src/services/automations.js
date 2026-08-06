// =============================================================================
// Automation execution engine
// =============================================================================
// The public surface is two functions:
//
//   triggerWorkflow(triggerType, entityType, entity, extraCtx)
//     Called from route files when an event fires (contact.created, etc.).
//     Loads all active workflows matching the trigger, checks filters, creates
//     an enrollment row, then begins executing the graph synchronously until
//     a wait node is encountered (at which point it enqueues a scheduled step
//     and returns — the cron worker picks up from there).
//
//   resumeScheduledStep(stepId)
//     Called by the automations cron worker to continue execution after a
//     wait node's delay has elapsed.
// =============================================================================
const { db } = require('../db');
const { sendMail }    = require('./mailer');
const { sendSms }     = require('./sms');
const { buildContext } = require('./templates');
const { render }       = require('./templates');
const { logActivity }  = require('./activity');

// ---------------------------------------------------------------------------
// Public: fire a trigger
// ---------------------------------------------------------------------------
async function triggerWorkflow(triggerType, entityType, entity, extraCtx = {}) {
  try {
    const [workflows] = await db.query(
      `SELECT * FROM automation_workflows
        WHERE status = 'active' AND trigger_type = :tt`,
      { tt: triggerType }
    );
    for (const wf of workflows) {
      try {
        const cfg = safeJson(wf.trigger_config) || {};
        if (!matchesTriggerFilter(cfg, entity, extraCtx)) continue;

        // Prevent re-enrollment if an active enrollment already exists
        const [[existing]] = await db.query(
          `SELECT id FROM automation_enrollments
            WHERE workflow_id = :wid AND entity_type = :et AND entity_id = :eid
              AND status = 'active'`,
          { wid: wf.id, et: entityType, eid: entity.id }
        );
        if (existing) continue;

        // Build the runtime context: snapshot of entity fields + trigger data
        const context = {
          trigger_type: triggerType,
          entity_type:  entityType,
          entity_id:    entity.id,
          ...extraCtx,
          entity,
        };

        const [ins] = await db.query(
          `INSERT INTO automation_enrollments
             (workflow_id, entity_type, entity_id, status, context)
           VALUES (:wid, :et, :eid, 'active', CAST(:ctx AS JSON))`,
          { wid: wf.id, et: entityType, eid: entity.id, ctx: JSON.stringify(context) }
        );
        const enrollmentId = ins.insertId;

        await db.query(
          `UPDATE automation_workflows SET run_count = run_count + 1, last_triggered_at = NOW()
            WHERE id = :id`,
          { id: wf.id }
        );

        // Begin executing — fire-and-forget so callers aren't blocked
        executeWorkflow(wf, enrollmentId, context).catch((err) => {
          console.error(`[automations] workflow ${wf.id} enrollment ${enrollmentId} error:`, err.message);
        });
      } catch (err) {
        console.error(`[automations] trigger ${wf.id} error:`, err.message);
      }
    }
  } catch (err) {
    console.error('[automations] triggerWorkflow error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Public: resume after a scheduled wait
// ---------------------------------------------------------------------------
async function resumeScheduledStep(stepId) {
  const [[step]] = await db.query(
    `SELECT * FROM automation_scheduled_steps WHERE id = :id`, { id: stepId }
  );
  if (!step) return;

  const [[enrollment]] = await db.query(
    `SELECT * FROM automation_enrollments WHERE id = :id`, { id: step.enrollment_id }
  );
  if (!enrollment || enrollment.status !== 'active') {
    await db.query(`UPDATE automation_scheduled_steps SET status = 'cancelled' WHERE id = :id`, { id: stepId });
    return;
  }

  const [[wf]] = await db.query(
    `SELECT * FROM automation_workflows WHERE id = :id`, { id: step.workflow_id }
  );
  if (!wf) return;

  await db.query(
    `UPDATE automation_scheduled_steps SET status = 'running', attempts = attempts + 1 WHERE id = :id`,
    { id: stepId }
  );

  const flowDef = safeJson(wf.flow_definition) || { nodes: [], edges: [] };
  const context = safeJson(enrollment.context) || {};
  const startNode = flowDef.nodes.find((n) => n.id === step.node_id);
  if (!startNode) {
    await db.query(`UPDATE automation_scheduled_steps SET status = 'failed', error = 'Node not found' WHERE id = :id`, { id: stepId });
    return;
  }

  try {
    await runFromNode(enrollment.id, wf.id, flowDef, startNode, context);
    await db.query(`UPDATE automation_scheduled_steps SET status = 'completed' WHERE id = :id`, { id: stepId });
  } catch (err) {
    await db.query(
      `UPDATE automation_scheduled_steps SET status = 'failed', error = :e WHERE id = :id`,
      { id: stepId, e: err.message.slice(0, 500) }
    );
  }
}

// ---------------------------------------------------------------------------
// Internal: walk the graph from the first action node after the trigger
// ---------------------------------------------------------------------------
async function executeWorkflow(wf, enrollmentId, context) {
  const flowDef = safeJson(wf.flow_definition) || { nodes: [], edges: [] };
  const triggerNode = flowDef.nodes.find((n) => n.type === 'triggerNode');
  if (!triggerNode) {
    await markEnrollmentDone(enrollmentId, 'failed');
    return;
  }

  const firstNodeIds = getNextNodeIds(flowDef, triggerNode.id);
  if (firstNodeIds.length === 0) {
    await markEnrollmentDone(enrollmentId, 'completed');
    return;
  }

  if (firstNodeIds.length === 1) {
    const firstNode = flowDef.nodes.find((n) => n.id === firstNodeIds[0]);
    if (!firstNode) {
      await markEnrollmentDone(enrollmentId, 'failed');
      return;
    }
    await runFromNode(enrollmentId, wf.id, flowDef, firstNode, context);
  } else {
    // Parallel fan-out directly from trigger
    await Promise.all(
      firstNodeIds.map((nid) => {
        const n = flowDef.nodes.find((x) => x.id === nid);
        return n ? runFromNode(enrollmentId, wf.id, flowDef, n, context) : Promise.resolve();
      })
    );
    await markEnrollmentDone(enrollmentId, 'completed');
  }
}

// ---------------------------------------------------------------------------
// Walk nodes starting from `node`, executing each one in sequence.
// Stops when a wait node is hit (schedules a step) or the end of the graph.
// ---------------------------------------------------------------------------
async function runFromNode(enrollmentId, workflowId, flowDef, node, context) {
  let current = node;
  while (current) {
    await db.query(
      `UPDATE automation_enrollments SET current_node_id = :nid WHERE id = :id`,
      { nid: current.id, id: enrollmentId }
    );

    if (current.type === 'waitNode') {
      const delayMs = calcDelayMs(current.data || {});
      const scheduledFor = new Date(Date.now() + delayMs);
      // The next node to run after the delay
      const nextNodeId = getNextNodeId(flowDef, current.id);
      if (!nextNodeId) {
        await markEnrollmentDone(enrollmentId, 'completed');
        return;
      }
      await db.query(
        `INSERT INTO automation_scheduled_steps
           (enrollment_id, workflow_id, node_id, scheduled_for)
         VALUES (:eid, :wid, :nid, :sf)`,
        { eid: enrollmentId, wid: workflowId, nid: nextNodeId, sf: fmtDatetime(scheduledFor) }
      );
      return; // cron will resume
    }

    if (current.type === 'actionNode') {
      const data = current.data || {};
      let logStatus = 'completed';
      let logOutput = null;
      let logError  = null;

      try {
        logOutput = await executeAction(data.actionType, data.config || {}, context, enrollmentId);
      } catch (err) {
        logStatus = 'failed';
        logError  = err.message.slice(0, 500);
        console.error(`[automations] action ${data.actionType} enrollment ${enrollmentId}:`, err.message);
      }

      await db.query(
        `INSERT INTO automation_execution_log
           (enrollment_id, workflow_id, node_id, node_type, status, output, error)
         VALUES (:eid, :wid, :nid, :nt, :s, CAST(:out AS JSON), :err)`,
        {
          eid: enrollmentId, wid: workflowId, nid: current.id,
          nt:  data.actionType || 'action',
          s:   logStatus,
          out: JSON.stringify(logOutput || {}),
          err: logError,
        }
      );
    }

    const nextIds = getNextNodeIds(flowDef, current.id);
    if (nextIds.length === 0) {
      break;
    } else if (nextIds.length === 1) {
      // Linear chain — continue the while loop
      current = flowDef.nodes.find((n) => n.id === nextIds[0]) || null;
    } else {
      // Parallel fan-out — run all branches concurrently then stop this chain
      await Promise.all(
        nextIds.map((nid) => {
          const n = flowDef.nodes.find((x) => x.id === nid);
          return n ? runFromNode(enrollmentId, workflowId, flowDef, n, context) : Promise.resolve();
        })
      );
      current = null; // branches handle their own completion
    }
  }

  await markEnrollmentDone(enrollmentId, 'completed');
}

// ---------------------------------------------------------------------------
// Execute a single action node
// ---------------------------------------------------------------------------
async function executeAction(actionType, config, context, enrollmentId) {
  const [[enrollment]] = await db.query(
    `SELECT * FROM automation_enrollments WHERE id = :id`, { id: enrollmentId }
  );

  // Build template merge context from the enrollment entity
  // Resolve contact_id: direct for contact triggers, or via the entity's FK for deal/invoice triggers
  const resolvedContactId =
    context.entity_type === 'contact' ? context.entity_id :
    context.contact_id ?? context.entity?.primary_contact_id ?? context.entity?.contact_id ?? null;

  const tplCtx = await buildContext({
    contact_id:      resolvedContactId,
    deal_id:         context.entity_type === 'deal'    ? context.entity_id : (context.deal_id ?? null),
    organization_id: context.organization_id ?? context.entity?.organization_id ?? null,
    user_id:         null,
  });

  // Merge the trigger's own ephemeral payload (tier_name, fund_name, amount,
  // due dates — passed via triggerWorkflow's extraCtx from notify* helpers in
  // services/constituents.js) into the same template namespaces buildContext()
  // populates from a real payment_id lookup. Without this, a template like
  // membership_renewal_reminder or pledge_installment_reminder — fired from a
  // cron reminder with no payment_id at all — would render every merge field
  // as an empty string, since buildContext() only knows about a `payment_id`
  // when one is explicitly passed in.
  if (context.tier_name !== undefined || (context.amount !== undefined && context.fund_name === undefined)) {
    tplCtx.membership = { ...tplCtx.membership, tier_name: context.tier_name, amount: context.amount, next_run_date: context.next_run_date };
  }
  if (context.fund_name !== undefined) {
    tplCtx.donation = { ...tplCtx.donation, fund_name: context.fund_name, amount: context.amount, is_recurring: context.is_recurring };
    tplCtx.pledge = { fund_name: context.fund_name, amount: context.amount, due_date: context.due_date };
  }
  if (context.compliance_type !== undefined) {
    tplCtx.compliance = { type: context.compliance_type, expiry_date: context.expiry_date };
  }

  switch (actionType) {

    case 'send_email': {
      const [[tpl]] = await db.query(
        `SELECT * FROM message_templates WHERE id = :id`, { id: config.template_id }
      );
      if (!tpl) throw new Error(`Template ${config.template_id} not found`);
      const toEmail = tplCtx.contact?.email;
      if (!toEmail) return { skipped: true, reason: 'No contact email' };
      const subject = render(config.subject_override || tpl.subject || '(no subject)', tplCtx);
      const html    = render(tpl.body || '', tplCtx);
      await sendMail({
        to: toEmail,
        subject,
        html,
        entityType: context.entity_type,
        entityId:   context.entity_id,
      });
      return { to: toEmail, subject };
    }

    case 'send_sms': {
      const phone = tplCtx.contact?.phone;
      if (!phone) return { skipped: true, reason: 'No contact phone' };
      const body = render(config.message || '', tplCtx);
      await sendSms({ to: phone, body, entityType: context.entity_type, entityId: context.entity_id });
      return { to: phone };
    }

    case 'create_task': {
      const title      = render(config.title || 'Follow up', tplCtx);
      const assignedTo = config.assign_to_owner
        ? (tplCtx.contact?.owner_id ?? null)
        : (config.assigned_to ?? null);
      const dueDate = config.due_days != null
        ? fmtDate(new Date(Date.now() + config.due_days * 86400000))
        : null;
      const [ins] = await db.query(
        `INSERT INTO tasks (title, entity_type, entity_id, assigned_to, due_date, status, created_by)
         VALUES (:t, :et, :eid, :uid, :dd, 'open', NULL)`,
        { t: title, et: context.entity_type, eid: context.entity_id, uid: assignedTo, dd: dueDate }
      );
      return { task_id: ins.insertId };
    }

    case 'add_tag': {
      if (!config.tag_id || context.entity_type !== 'contact') return { skipped: true };
      await db.query(
        `INSERT IGNORE INTO contact_tags (contact_id, tag_id) VALUES (:cid, :tid)`,
        { cid: context.entity_id, tid: config.tag_id }
      );
      return { tag_id: config.tag_id };
    }

    case 'remove_tag': {
      if (!config.tag_id || context.entity_type !== 'contact') return { skipped: true };
      await db.query(
        `DELETE FROM contact_tags WHERE contact_id = :cid AND tag_id = :tid`,
        { cid: context.entity_id, tid: config.tag_id }
      );
      return { tag_id: config.tag_id };
    }

    case 'add_to_list': {
      if (!config.list_id || context.entity_type !== 'contact') return { skipped: true };
      await db.query(
        `INSERT IGNORE INTO contact_list_members (list_id, contact_id) VALUES (:lid, :cid)`,
        { lid: config.list_id, cid: context.entity_id }
      );
      return { list_id: config.list_id };
    }

    case 'update_field': {
      if (!config.field || !config.value || context.entity_type !== 'contact') return { skipped: true };
      const allowed = ['lifecycle_stage', 'status', 'title', 'department', 'city', 'state'];
      if (!allowed.includes(config.field)) return { skipped: true, reason: 'Field not allowed' };
      await db.query(
        `UPDATE contacts SET ${config.field} = :v WHERE id = :id`,
        { v: config.value, id: context.entity_id }
      );
      return { field: config.field, value: config.value };
    }

    case 'notify_user': {
      const msg = render(config.message || 'Automation notification', tplCtx);
      await logActivity({
        userId:     config.user_id || null,
        entityType: context.entity_type,
        entityId:   context.entity_id,
        action:     'automation_notification',
        description: msg,
      });
      return { message: msg };
    }

    case 'webhook': {
      if (!config.url) return { skipped: true, reason: 'No URL' };
      const payload = { trigger: context.trigger_type, entity_type: context.entity_type, entity_id: context.entity_id, ...context };
      const resp = await fetch(config.url, {
        method:  config.method || 'POST',
        headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(10000),
      });
      return { status: resp.status };
    }

    default:
      return { skipped: true, reason: `Unknown action: ${actionType}` };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Returns all direct successors of a node (supports parallel fan-out).
function getNextNodeIds(flowDef, currentNodeId) {
  return flowDef.edges
    .filter((e) => e.source === currentNodeId)
    .map((e) => e.target);
}

// Single-successor helper — kept for the wait-node enqueue path.
function getNextNodeId(flowDef, currentNodeId) {
  return getNextNodeIds(flowDef, currentNodeId)[0] || null;
}

function calcDelayMs({ delay = 1, unit = 'hours' }) {
  const n = Number(delay) || 1;
  const map = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 };
  return n * (map[unit] || 3600000);
}

function matchesTriggerFilter(cfg, entity, extraCtx) {
  if (!cfg || !Object.keys(cfg).length) return true;
  if (cfg.stage_id     && entity.stage_id     !== cfg.stage_id)     return false;
  if (cfg.pipeline_id  && entity.pipeline_id  !== cfg.pipeline_id)  return false;
  if (cfg.owner_id     && entity.owner_id     !== cfg.owner_id)     return false;
  if (cfg.lifecycle_stage && entity.lifecycle_stage !== cfg.lifecycle_stage) return false;
  return true;
}

async function markEnrollmentDone(enrollmentId, status) {
  await db.query(
    `UPDATE automation_enrollments SET status = :s, completed_at = NOW(), current_node_id = NULL
      WHERE id = :id`,
    { s: status, id: enrollmentId }
  );
}

function fmtDatetime(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function safeJson(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (_) { return null; }
}

module.exports = { triggerWorkflow, resumeScheduledStep };
