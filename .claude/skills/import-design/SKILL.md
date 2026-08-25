---
name: import-design
description: Run after importing a new reference website design (a folder of static HTML/CSS mockups) for this app's Craft.js page builder — audits every page for gaps against the live builder output (missing component fields, hardcoded values, missing component types, structural mismatches), then implements and verifies the fixes. Also use this after any redesign pass on existing pages, or whenever asked to make builder pages "match" a reference design.
---

# Import Design — audit + fix gaps against a reference mockup

This app (this CRM) is a clone-and-rebrand template: a new client gets a
reference static design (Tailwind-utility-class HTML mockups, one file per
page), which gets converted into Craft.js components once. This skill is the
repeatable version of that conversion/audit pass — run it whenever a new
design is imported, or whenever asked to make the builder match a reference.

## Do the bulk import first

Before auditing anything by hand, run the importer — it does the mechanical
90% in one pass (assets copied, stylesheets and scripts loaded site-wide, each
page's sections turned into draggable Sections holding HTML blocks):

```bash
node app/server/scripts/import-design.js --dir <folder> --dry-run   # preview
node app/server/scripts/import-design.js --dir <folder>             # apply
```

This skill is then the *upgrade* pass: replacing those HTML blocks with real
builder components, one section at a time, so the client can edit them.

## Input

Expect a path to a folder of reference HTML files (e.g.
`~/Downloads/some-redesign/` or the repo's own `website-files/`), one file
per page (`about.html`, `support.html`, `index.html`, etc.). If not given,
ask for it — don't guess a path.

## Step 1 — Map reference files to live pages

For each reference `.html` file, find the corresponding live page slug (query
`SELECT slug, title FROM website_pages` and match by filename — `index.html`
is almost always the home page, slug `home` or `/`). Confirm the mapping
before proceeding if any filename doesn't obviously correspond to a slug.

Check whether this repo already has an earlier copy of the same reference
design checked in (e.g. `website-files/`) — if the new import is nearly
identical to an existing one (`diff` them), that's useful context: it means
most pages were already built against this design once, and gaps are drift,
not a from-scratch conversion.

## Step 2 — Audit every page in parallel

For each mapped page, dispatch a `design-gap-auditor` subagent (one per
page — they're independent and read-only, so run them concurrently rather
than one at a time) with the reference file path and the page's slug. Don't
do this comparison yourself in the main conversation — the agent definition
has the full methodology (how to pull `puck_data (Craft.js JSON)` safely, which categories
of gaps to look for, what NOT to flag as a false positive).

## Step 3 — Consolidate and report before fixing

Collect every agent's findings into one list, grouped by page, ordered by
severity (missing component type > missing field/control > hardcoded value
> structural mismatch > data-only bug). Present this to the user as a
report — do not start implementing fixes silently. Large "missing component
type" gaps in particular (a whole new block needed, like a donation card or
pricing widget) are a real design/scope decision, not just a tweak, and
deserve a quick confirmation before you build them.

## Step 4 — Implement fixes

Once confirmed:

- **New fields on existing components**: edit the node in
  `client/src/builder/nodes/` — add the control to its `Settings` component
  (reuse `client/src/builder/fields/`), add a default to `craft.props`, and
  consume it in the render as a CSS variable. Don't hardcode the fix only for
  the page that surfaced it — these components are shared across every page
  and every future client clone.
- **Never add a hardcoded brand colour.** Colour defaults must be `''` so the
  theme tokens supply the value; emit dynamic values as inline CSS variables
  (`--bx-…`) consumed by a class in `client/src/frontend/theme/site.css`,
  never as inline declarations.
- **New component types**: design the settings schema before writing the
  render function (what should be configurable vs. fixed?), then register the
  node in `client/src/builder/nodes/index.jsx` — both in the `NODES` resolver
  and in the right `TOOLBOX` category. A component nobody can find in the
  palette doesn't help anyone. Resolver keys are written into every saved
  page, so add keys rather than renaming them.
- **Data-only fixes** (wrong prop value on an otherwise-capable component):
  write a small one-off Node script under `server/scripts/` that reads
  `puck_data` (which now holds Craft.js's serialized node map), finds the node
  by its id, patches `props`, and writes it back. Run it against the local DB
  with explicit host/database flags. Don't hand-edit JSON in the database.
- **Pixel-exact sections** that don't decompose cleanly into
  Section/Row/Column can go into an HTML block, or the whole page into code
  mode — both render the markup verbatim.
- Keep fixes scoped to what the audit actually found — this is a gap-closing
  pass, not an invitation to redesign unrelated things.

## Step 5 — Verify (desktop AND mobile)

For every changed page:

1. `npx vite build` from `client/` to catch syntax errors before anything else.
2. Screenshot the live page via Playwright at a normal desktop width AND at
   a phone width (375px) — this codebase has a history of desktop-only
   testing missing real bugs (an image-height bug and a builder-canvas-width
   bug were both invisible at desktop width and only showed up on mobile).
   Check for horizontal overflow (`document.documentElement.scrollWidth` vs
   `clientWidth`) and zero console errors at both sizes.
3. If a new/changed component is meant to be used across multiple pages,
   spot-check it on at least one other page too, not just the one that
   surfaced the gap.
4. If the change touches the page builder's own chrome (not just rendered
   page content), open the actual builder editor and verify there too — the
   editor canvas and the public page share components but not always CSS
   context.

## Step 6 — Commit

Follow the repo's existing git workflow: commit on `dev`, then fast-forward
`main` to match (`git branch -f main dev`) before pushing both, since the
live site deploys from `main`. Write a commit message that names the actual
gap fixed and why (new field/component vs. data fix), not just "design
updates."
