#!/usr/bin/env node
/* =============================================================================
 * seed-example-automations.js
 * Phase H/I — seeds example automation workflows so staff can see how the
 * builder is meant to be used, wired to triggers that already fire live but
 * (before this) had nothing consuming them:
 *
 *   1. "Membership renewal reminder" — membership.renewal_upcoming -> email
 *   2. "Post-gift thank-you follow-up" — donation.captured -> wait 1 day -> email
 *   3. "Pledge installment reminder" — pledge.installment_upcoming -> email
 *   4. "Volunteer compliance expiring" — volunteer.compliance_expiring -> email
 *
 * Requires the matching message_templates rows (membership_renewal_reminder,
 * donation_followup_thankyou, pledge_installment_reminder,
 * volunteer_compliance_expiring) to already be seeded by templateSeeder.js —
 * run this after the server has booted at least once.
 *
 * Idempotent: skips a workflow if one with the same name already exists.
 * ========================================================================== */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../src/db');

async function templateIdForSlug(slug) {
  const [[tpl]] = await db.query('SELECT id FROM message_templates WHERE slug = :slug', { slug });
  if (!tpl) throw new Error(`Template "${slug}" not found — has the server booted at least once since Phase H shipped?`);
  return tpl.id;
}

async function createIfMissing(name, build) {
  const [[existing]] = await db.query('SELECT id FROM automation_workflows WHERE name = :name', { name });
  if (existing) {
    console.log(`· skip (already exists): "${name}" (id=${existing.id})`);
    return;
  }
  const { description, trigger_type, flow_definition } = await build();
  const [ins] = await db.query(
    `INSERT INTO automation_workflows (name, description, status, trigger_type, trigger_config, flow_definition)
     VALUES (:name, :description, 'active', :trigger_type, NULL, CAST(:flow AS JSON))`,
    { name, description, trigger_type, flow: JSON.stringify(flow_definition) }
  );
  console.log(`→ created: "${name}" (id=${ins.insertId})`);
}

async function main() {
  await createIfMissing('Membership renewal reminder', async () => {
    const templateId = await templateIdForSlug('membership_renewal_reminder');
    return {
      description: 'Emails a member 7 days before their dues renew automatically.',
      trigger_type: 'membership.renewal_upcoming',
      flow_definition: {
        nodes: [
          { id: 'trigger-1', type: 'triggerNode', position: { x: 0, y: 0 },
            data: { triggerType: 'membership.renewal_upcoming' } },
          { id: 'action-1', type: 'actionNode', position: { x: 0, y: 150 },
            data: { actionType: 'send_email', config: { template_id: templateId } } },
        ],
        edges: [
          { id: 'e-trigger-1-action-1', source: 'trigger-1', target: 'action-1' },
        ],
      },
    };
  });

  await createIfMissing('Post-gift thank-you follow-up', async () => {
    const templateId = await templateIdForSlug('donation_followup_thankyou');
    return {
      description: 'One day after any gift, sends a warm impact/thank-you note — distinct from the instant tax receipt.',
      trigger_type: 'donation.captured',
      flow_definition: {
        nodes: [
          { id: 'trigger-1', type: 'triggerNode', position: { x: 0, y: 0 },
            data: { triggerType: 'donation.captured' } },
          { id: 'wait-1', type: 'waitNode', position: { x: 0, y: 150 },
            data: { delay: 1, unit: 'days' } },
          { id: 'action-1', type: 'actionNode', position: { x: 0, y: 300 },
            data: { actionType: 'send_email', config: { template_id: templateId } } },
        ],
        edges: [
          { id: 'e-trigger-1-wait-1', source: 'trigger-1', target: 'wait-1' },
          { id: 'e-wait-1-action-1', source: 'wait-1', target: 'action-1' },
        ],
      },
    };
  });

  await createIfMissing('Pledge installment reminder', async () => {
    const templateId = await templateIdForSlug('pledge_installment_reminder');
    return {
      description: 'Emails a donor 7 days before their next pledge installment is due.',
      trigger_type: 'pledge.installment_upcoming',
      flow_definition: {
        nodes: [
          { id: 'trigger-1', type: 'triggerNode', position: { x: 0, y: 0 },
            data: { triggerType: 'pledge.installment_upcoming' } },
          { id: 'action-1', type: 'actionNode', position: { x: 0, y: 150 },
            data: { actionType: 'send_email', config: { template_id: templateId } } },
        ],
        edges: [
          { id: 'e-trigger-1-action-1', source: 'trigger-1', target: 'action-1' },
        ],
      },
    };
  });

  await createIfMissing('Volunteer compliance expiring', async () => {
    const templateId = await templateIdForSlug('volunteer_compliance_expiring');
    return {
      description: 'Emails a volunteer 30 days before a background check or waiver on file expires.',
      trigger_type: 'volunteer.compliance_expiring',
      flow_definition: {
        nodes: [
          { id: 'trigger-1', type: 'triggerNode', position: { x: 0, y: 0 },
            data: { triggerType: 'volunteer.compliance_expiring' } },
          { id: 'action-1', type: 'actionNode', position: { x: 0, y: 150 },
            data: { actionType: 'send_email', config: { template_id: templateId } } },
        ],
        edges: [
          { id: 'e-trigger-1-action-1', source: 'trigger-1', target: 'action-1' },
        ],
      },
    };
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
