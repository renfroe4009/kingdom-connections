'use strict';
// =============================================================================
// urlSafety.js — shared SSRF defense-in-depth for every place this app
// makes an outbound HTTP request to a URL that's wholly or partly
// influenced by data that originated from an HTTP request (a caller-
// supplied URL, or a stored setting an authenticated user configured).
// -----------------------------------------------------------------------------
// Originally written for GET /api/ada/check (Phase 5 adversarial retest —
// that route had NO restriction at all and was reachable unauthenticated;
// fixed with requireAuth + this helper). Reused by services/automations.js's
// webhook action (config.url is unvalidated JSON from a stored workflow,
// triggerable indirectly from unauthenticated public form submissions) and
// services/receipts.js's logo fetch (business_settings.logo_web_url, an
// admin-set value with no URL validation on write).
//
// Resolves the hostname via DNS and checks the RESOLVED IP against
// private/loopback/link-local ranges — not the URL string alone, which DNS
// rebinding (a public hostname that resolves to a private IP) would
// otherwise bypass.
// =============================================================================
const dns = require('dns').promises;

function isPrivateIp(ip, family) {
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10) return true;                          // 10.0.0.0/8
    if (a === 127) return true;                          // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true;              // 169.254.0.0/16 link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12
    if (a === 192 && b === 168) return true;               // 192.168.0.0/16
    if (a === 0) return true;                              // 0.0.0.0/8
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;                        // loopback
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10 link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique local
  return false;
}

// http/https only, resolved IP must not be private/loopback/link-local.
async function isSafeTargetUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (!/^https?:$/.test(parsed.protocol)) return false;
  try {
    const { address, family } = await dns.lookup(parsed.hostname);
    return !isPrivateIp(address, family);
  } catch {
    return false; // DNS resolution failure — refuse rather than guess.
  }
}

module.exports = { isSafeTargetUrl, isPrivateIp };
