// =============================================================================
// server/src/db.js configures the mysql2 pool with dateStrings: true, so
// DATETIME columns come back as raw strings like "2026-07-08 14:23:01" —
// no "T", no trailing "Z"/offset. That's a real UTC instant (the pool also
// sets timezone: 'Z'), but new Date("2026-07-08 14:23:01") doesn't know
// that — non-ISO strings without a zone get parsed as LOCAL time by the
// browser, silently shifting every timestamp by the viewer's UTC offset.
// Always go through parseServerDate() instead of new Date(str) directly for
// any timestamp that came from the API.
// =============================================================================
export function parseServerDate(dateStr) {
  if (!dateStr) return null;
  // Already has a zone (Z or +hh:mm) or is a proper ISO string with "T" — trust it.
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(dateStr) || dateStr.includes('T')) {
    return new Date(dateStr);
  }
  // "YYYY-MM-DD HH:MM:SS" (MySQL's dateStrings format) — mark it as UTC.
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}

export function relativeTime(dateStr) {
  const d = parseServerDate(dateStr);
  if (!d) return '';
  const diff  = Date.now() - d.getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)  return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  < 7)  return `${days}d ago`;
  return d.toLocaleDateString();
}
