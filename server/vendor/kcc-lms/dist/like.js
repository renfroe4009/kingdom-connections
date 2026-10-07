/**
 * Wraps search text as a LIKE/ILIKE pattern.
 *
 * `%` and `_` are wildcards and a backslash escapes them. Unescaped, a search
 * for "100%" matches every row and "a_b" matches "axb", which reads to the
 * person searching as a broken search rather than a generous one. The
 * backslash is escaped first, or escaping the wildcards would escape its own
 * escape.
 */
export function likePattern(query) {
    return `%${query.replace(/([\\%_])/g, '\\$1')}%`;
}
