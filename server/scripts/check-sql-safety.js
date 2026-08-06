#!/usr/bin/env node
/* =============================================================================
 * check-sql-safety.js — guards against the one SQL-injection pattern a full
 * audit (see git history) confirmed does NOT exist anywhere in this codebase:
 * request-derived input spliced directly into a template-literal query string
 * instead of going through a named `:param`/`?` placeholder.
 *
 * This is a targeted heuristic, not a general static analyzer — it flags
 * `db.query`/`db.execute` template-literal calls whose interpolated
 * expressions reference `req.params`/`req.query`/`req.body`/`req.user`
 * directly. It will NOT catch every indirect flow (e.g. a variable assigned
 * from req.body two lines earlier), so it complements code review, it
 * doesn't replace it. Every OTHER interpolation in these calls (table/column
 * names from hardcoded registries, pre-built WHERE/SORT fragments, etc.) is
 * the established safe pattern and is intentionally not flagged.
 *
 * Run: node server/scripts/check-sql-safety.js
 * Exit code 1 if anything is flagged (suitable for CI).
 * ========================================================================== */
const fs   = require('fs');
const path = require('path');

const ROOTS = ['src/routes', 'src/services', 'src/jobs', 'src/middleware'];
const DANGEROUS_REF = /\breq\.(params|query|body|user)\b/;

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function findViolations(file) {
  const src = fs.readFileSync(file, 'utf8');
  const violations = [];
  // Match db.query(`...`) / db.execute(`...`) template-literal calls, allowing
  // nested ${...} (non-greedy up to the closing backtick before a comma/paren).
  const callRe = /\bdb\.(?:query|execute)\s*\(\s*`([^`]*)`/g;
  let m;
  while ((m = callRe.exec(src))) {
    const queryText = m[1];
    if (!DANGEROUS_REF.test(queryText)) continue;
    const before = src.slice(0, m.index);
    const line = before.split('\n').length;
    violations.push({ line, snippet: queryText.trim().slice(0, 160) });
  }
  return violations;
}

function main() {
  const serverRoot = path.join(__dirname, '..');
  let files = [];
  for (const rel of ROOTS) {
    const dir = path.join(serverRoot, rel);
    if (fs.existsSync(dir)) files = files.concat(walk(dir));
  }

  let total = 0;
  for (const file of files) {
    const violations = findViolations(file);
    for (const v of violations) {
      total++;
      console.error(`${path.relative(serverRoot, file)}:${v.line}  ${v.snippet}`);
    }
  }

  if (total) {
    console.error(`\n${total} potential SQL injection risk(s) found — request-derived input appears directly inside a template-literal query. Bind it as a named placeholder instead.`);
    process.exit(1);
  }
  console.log(`OK — scanned ${files.length} files, no request input spliced directly into SQL queries.`);
}

main();
