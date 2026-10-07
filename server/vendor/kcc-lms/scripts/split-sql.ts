/**
 * Splits a SQL file into statements.
 *
 * MySQL's protocol will not take several statements in one call unless the
 * connection asks for it, so a migration has to be fed one statement at a
 * time. The obvious way to do that — split on `;` followed by a newline —
 * is what this replaces, and it was wrong in a way worth recording: the
 * migration opens with a comment block, the comment block is not followed by
 * a semicolon, so the first `create table` ended up in the same chunk as the
 * comments. The chunk began with `--`, was skipped as a comment, and the
 * first table was silently never created. The failure surfaced four tables
 * later as a foreign key pointing at something that did not exist.
 *
 * So: line comments are stripped first, and the split tracks whether it is
 * inside a quoted string, which is the only place a semicolon can appear
 * without ending a statement in these files.
 */
export function splitSqlStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .map((line) => {
      // A `--` inside a string literal is not a comment. Tracked per line,
      // which is enough: no statement here opens a quote it does not close.
      let quote: string | null = null;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i]!;
        if (quote) {
          if (char === quote && line[i - 1] !== '\\') quote = null;
          continue;
        }
        if (char === "'" || char === '"' || char === '`') {
          quote = char;
          continue;
        }
        if (char === '-' && line[i + 1] === '-') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');

  const statements: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (let i = 0; i < withoutComments.length; i += 1) {
    const char = withoutComments[i]!;
    if (quote) {
      current += char;
      if (char === quote && withoutComments[i - 1] !== '\\') quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ';') {
      if (current.trim().length > 0) statements.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim().length > 0) statements.push(current.trim());
  return statements;
}
