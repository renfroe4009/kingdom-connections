#!/usr/bin/env node
// Provisions (or re-secrets) a mobile API client for the Praying Planet
// integration. Same underlying logic as the admin UI's Mobile API settings
// tab (routes/mobileApiAdmin.js) — both call services/apiClients.js — kept
// here too for provisioning without needing the admin UI open (e.g. from a
// deploy script, or before the UI existed).
//
// The generated secret is shown ONCE, at creation time, then only its hash
// is stored (SHA-256, verified via crypto.timingSafeEqual in
// middleware/apiClientAuth.js) — same reasoning as never storing a
// recoverable password.
//
//   node scripts/create-api-client.js --name "Praying Planet" \
//     --scopes organizations:read,members:read,members:write,members:delete
//
//   # Register a webhook endpoint for the same client in one step:
//   node scripts/create-api-client.js --name "Praying Planet" \
//     --scopes organizations:read,members:read,members:write,members:delete \
//     --webhook-url https://api.prayingplanet.example/webhooks/kc \
//     --webhook-events member.created,member.updated,member.app_data_deleted

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createApiClient, createWebhookEndpoint } = require(path.join(__dirname, '..', 'src', 'services', 'apiClients.js'));
const { db } = require(path.join(__dirname, '..', 'src', 'db.js'));

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

(async () => {
  const name = arg('name');
  if (!name) {
    console.error('Usage: node scripts/create-api-client.js --name "Partner Name" --scopes scope1,scope2 [--webhook-url URL --webhook-events ev1,ev2]');
    process.exit(1);
  }
  const scopes = (arg('scopes', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!scopes.length) {
    console.error('At least one --scopes value is required, e.g. members:read');
    process.exit(1);
  }

  try {
    const client = await createApiClient({ name, scopes });

    const webhookUrl = arg('webhook-url');
    if (webhookUrl) {
      const events = (arg('webhook-events', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
      const webhook = await createWebhookEndpoint({ apiClientId: client.id, targetUrl: webhookUrl, subscribedEvents: events });
      console.log('\nWebhook endpoint registered:');
      console.log(`  target_url:      ${webhookUrl}`);
      console.log(`  events:          ${events.join(', ') || '(none — set --webhook-events)'}`);
      console.log(`  signing_secret:  ${webhook.signingSecret}   <-- give this to the partner, shown once`);
    }

    console.log('\nAPI client created — store these credentials securely, they will not be shown again:');
    console.log(`  client_id:      ${client.clientId}`);
    console.log(`  client_secret:  ${client.clientSecret}`);
    console.log(`  scopes:         ${scopes.join(', ')}`);
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
