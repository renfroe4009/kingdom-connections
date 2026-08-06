// =============================================================================
// Parse an axios error's response body into a single user-facing string,
// regardless of which shape the server used (a plain { error }, a Zod
// { issues: [...] } / { errors: [...] } array, a bare string body, or nothing
// at all because the request never reached the server). Used so every form's
// catch block can show something real instead of failing silently.
// =============================================================================
export function parseApiError(err, fallback = 'Something went wrong — your changes were not saved.') {
  const data = err?.response?.data;
  if (!data) return err?.message ? fallback : fallback;

  if (typeof data === 'string' && data.trim()) return data;

  if (typeof data.error === 'string' && data.error.trim()) return data.error;

  if (Array.isArray(data.issues) && data.issues.length) {
    const msg = data.issues.map((i) => i.message).filter(Boolean).join(' ');
    if (msg) return msg;
  }

  if (Array.isArray(data.errors) && data.errors.length) {
    const msg = data.errors.map((i) => (typeof i === 'string' ? i : i.message)).filter(Boolean).join(' ');
    if (msg) return msg;
  }

  return fallback;
}
