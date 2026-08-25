---
name: qa-audit
description: Run a QA pass over this app's public website — WCAG/ADA accessibility, mobile-responsive layout across breakpoints, and page speed — then diagnose every finding down to file and line. Use when asked to check accessibility or ADA compliance, to test mobile or responsive behaviour, to measure or improve site speed, or for a general "QA the site" pass before a launch or handover. Also use after importing a new client design, since imported markup is where most of these defects come from.
---

# QA audit — accessibility, responsive, speed

Measure first, diagnose second, fix only on request. The measuring is done by
`qa/audit.js` (axe-core + Playwright + Lighthouse); the diagnosis is done by
`qa-auditor` subagents, one per page. Neither step guesses.

**This skill reports. It does not fix.** Present findings and stop, unless the
user explicitly asks for fixes afterwards.

## Step 0 — One-time setup

If `qa/node_modules` is missing, the user needs to install it. Hand over the
command rather than running it — it downloads a browser and takes a few minutes:

```bash
cd app/qa && npm install
```

`postinstall` fetches Playwright's Chromium (~150MB). Lighthouse reuses that
same binary, so nothing else needs installing.

## Step 1 — Decide what to point it at

This matters more than anything else in the run, because **the right target
differs per check**:

| Check | Valid against dev server? |
|---|---|
| Accessibility | Yes |
| Responsive layout | Yes |
| **Speed** | **No** |

Lighthouse against Vite dev measures unminified, uncompressed ES modules. The
script detects this and stamps a warning on the report, but don't let a run get
that far if speed is the point of the exercise. For real numbers use either the
deployed site, or a local production build:

```bash
cd app/client && npm run build && npm run preview
```

If the user hasn't said which target they want and speed is in scope, ask.
Otherwise default to the local site on `http://localhost:5183`, started with
`node run.js` from the project root.

## Step 2 — Run the audit

```bash
node app/qa/audit.js --url <base-url>
```

Useful flags:

- `--only /licensing` — a single page
- `--pages /,/about,/licensing` — an explicit list (default: crawls the home
  page's own nav and footer, capped at 12)
- `--breakpoints 360,430,768,1024,1440` — override the widths tested
- `--skip-speed` / `--skip-ada` / `--skip-responsive` — narrow the pass
- `--speed-desktop` — add a desktop Lighthouse run alongside mobile

It writes timestamped `audit-*.json` and `audit-*.md` into `qa/reports/` and
exits non-zero when anything critical or serious is found.

If it exits 2, the site was unreachable — check the target is actually running
before anything else.

## Step 3 — Diagnose, one agent per page

Read the JSON to get the page list, then dispatch a `qa-auditor` subagent per
page **concurrently** — they're independent and read-only. Give each one the
JSON path and its page path.

Don't do this analysis in the main conversation. The agent definition carries
the architectural context that keeps diagnoses correct: that pages are database
rows rather than files, that three stylesheets stack in a specific order, and
that the header and footer live in `PublicLayout.jsx` using the imported
design's class names.

Skip this step only for pages the report shows as entirely clean.

## Step 4 — Consolidate and report

Merge every agent's findings into one list. Then, before presenting:

**Group by root cause, not by page.** Imported designs produce the same defect
across ten pages from one stylesheet rule. Ten findings that share a cause are
one fix — say so, and name the pages it clears. This is the single most useful
thing this pass produces.

Rank by: WCAG critical > WCAG serious > horizontal overflow > tap-target
failures > performance > WCAG moderate/minor.

Present:

1. A one-paragraph verdict — is this site launchable, and what's the blocker.
2. The grouped findings, each with the measurement, the `file:line`, and the
   suggested fix.
3. Anything the tooling explicitly could not judge, stated plainly.

Then stop and let the user choose what to fix.

## Known false positives in this codebase

Check these before reporting, or the list fills with noise:

- **Contrast failures on `.btn--primary` and similar design classes.** Colours
  come from `--brand-*` admin settings, so the fix is a settings change, not a
  CSS edit. Report it as a settings issue.
- **`landmark-unique` / `region` violations inside `HtmlBlock`s.** Imported
  markup often has stray `<section>` elements. Real, but low value — group them
  into one line rather than one per instance.
- **Overflow at 360px on pages with wide data tables.** The design wraps tables
  in `.table-wrap { overflow-x: auto }`; if that wrapper is present the page is
  behaving correctly and it's not a finding.
- **Missing `alt` on decorative imagery.** `alt=""` is correct for decoration.
  Only flag images that carry meaning.

## Scope

Public website only. The admin UI is behind a login and is excluded by the
script (`/login`, `/admin`, `/portal`, `/dashboard`). If the user wants the
admin audited too, that's a different pass and needs authentication handling
that this script doesn't have — say so rather than half-doing it.
