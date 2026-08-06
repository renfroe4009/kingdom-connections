// =============================================================================
// GET /api/integrations/status — one consolidated boolean-status endpoint so
// the client can gate integration-dependent features (email/SMS buttons,
// Google Drive/Calendar, USPS verify, ConnectWise import) without each
// component independently probing its own settings route.
// =============================================================================
const router = require('express').Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getCwSettings, cwFetch } = require('../services/connectwise');

// ConnectWise is the one integration worth actually verifying live — a saved
// credentials row doesn't mean the connection works (e.g. Cloudflare blocking
// the API host, expired keys). Everything else (SMTP/SMS/USPS/gateways) is a
// simple settings flag; there's no cheap universal "ping" for those.
const CW_PROBE_TTL_MS = 5 * 60 * 1000;
let cwProbeCache = { active: false, ts: 0 };

async function probeConnectWise() {
  const now = Date.now();
  if (now - cwProbeCache.ts < CW_PROBE_TTL_MS) return cwProbeCache.active;
  let active = false;
  try {
    const cfg = await getCwSettings();
    if (cfg) {
      await Promise.race([
        cwFetch(cfg, '/system/info'),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
      ]);
      active = true;
    }
  } catch (_e) {
    active = false;
  }
  cwProbeCache = { active, ts: now };
  return active;
}

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const [[smtp]]  = await db.query('SELECT is_active FROM smtp_settings ORDER BY id DESC LIMIT 1').catch(() => [[null]]);
    const [[sms]]   = await db.query('SELECT is_active FROM sms_settings ORDER BY id DESC LIMIT 1').catch(() => [[null]]);
    const [[usps]]  = await db.query('SELECT is_active FROM usps_settings ORDER BY id DESC LIMIT 1').catch(() => [[null]]);
    const [[googleRow]] = await db.query(
      'SELECT 1 AS ok FROM google_tokens WHERE user_id = :uid LIMIT 1', { uid: req.user.id }
    ).catch(() => [[null]]);
    const [gatewayRows] = await db.query('SELECT gateway, is_active FROM payment_gateway_settings').catch(() => [[]]);

    const connectwise = await probeConnectWise();

    res.json({
      connectwise,
      smtp:  !!smtp?.is_active,
      sms:   !!sms?.is_active,
      usps:  !!usps?.is_active,
      google: !!googleRow,
      gateways: {
        authnet: gatewayRows.some((r) => r.gateway === 'authnet' && !!r.is_active),
        valor:   gatewayRows.some((r) => r.gateway === 'valor'   && !!r.is_active),
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
