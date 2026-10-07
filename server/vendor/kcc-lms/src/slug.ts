/**
 * Turns a title into a slug.
 *
 * Decomposes accents rather than dropping them, so "Começar Aqui" becomes
 * "comecar-aqui" and not "comear-aqui". A title in a script with no ASCII
 * form — Arabic, Chinese, Cyrillic — reduces to nothing, so a fallback is
 * appended rather than returning an empty string and failing a unique index
 * for the second such course.
 */
export function slugify(value: string, fallback = 'item'): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || `${fallback}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Finds a free slug by suffixing.
 *
 * `taken` answers whether a candidate is already used; it is async because
 * the answer is a query. Bounded rather than looping forever: after a few
 * hundred collisions something else is wrong and a random suffix ends it.
 */
export async function uniqueSlug(base: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base);
  if (!(await taken(root))) return root;
  for (let n = 2; n < 200; n += 1) {
    const candidate = `${root}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${root}-${Math.random().toString(36).slice(2, 8)}`;
}
