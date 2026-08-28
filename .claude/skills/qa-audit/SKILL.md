---
name: qa-audit
description: Run a QA pass over this app's public website — WCAG/ADA accessibility, mobile-responsive layout across breakpoints, page speed, and brand safety of outbound email — then diagnose every finding down to file and line. Use when asked to check accessibility or ADA compliance, to test mobile or responsive behaviour, to measure or improve site speed, to verify email templates and sender identity are branded as the current client (no leftover boilerplate, previous-client, or agency naming), or for a general "QA the site" pass before a launch or handover. Also use after importing a new client design, since imported markup is where most of these defects come from.
---

# QA audit — accessibility, responsive, speed, brand safety

Measure first, diagnose second, fix only on request. The measuring is done by
`qa/audit.js` (axe-core + Playwright + Lighthouse); the diagnosis is done by
`qa-auditor` subagents, one per page. Neither step guesses.

Alongside the browser pass, a **brand-safety sweep** checks that outbound
messaging is branded as the current client. That one is a source-and-database
scan rather than a browser measurement, so it runs differently — see Step 4.

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

**Never diagnose against `website-files/`.** It's the one-time source
`import-design.js` copied into `website_global_settings.site_custom_css` at
import time — nothing reads it at runtime, and it can already have drifted
from the live CSS since an admin can edit `site_custom_css` directly through
the Theme editor afterward. Every finding's "Where" and "fix" must point at
the live value (dump `site_custom_css` from the DB, per the `qa-auditor`
agent definition), never at a path under `website-files/`. This applies even
if the `qa-auditor` subagent type isn't registered and you fall back to
briefing a general-purpose agent by hand — carry this rule over explicitly.

Skip this step only for pages the report shows as entirely clean.

## Step 4 — Brand-safety sweep (emails, templates, sender identity)

This codebase is a clone of a clone: a generic boilerplate (`localCRM`), built
out for a previous client (`VCSF`), re-cloned for the current one, by an agency
(`NetSimple`). All three layers leave strings behind, and some reach real
inboxes — a password-reset subject, an order-confirmation number, the from-name
on every message.

Dispatch **one** `brand-auditor` subagent. Not one per page — the surface is
the server's outbound messaging plus the database, which has nothing to do with
page routes, so a per-page fan-out would just repeat identical work and produce
duplicate findings.

It runs independently of `qa/audit.js`, so:

- It needs **no** `qa/node_modules`, no browser, and no running site — only a
  reachable database. It is the one part of this skill that still works when
  the site won't boot.
- Launch it **concurrently with the Step 3 page agents**, not after them.
- Run it even when `--skip-speed`/`--skip-ada` narrowed the browser pass, and
  even when every page came back clean — a perfectly accessible page says
  nothing about what the mailer sends.

The agent definition carries the specifics: the surfaces to cover (inline
`sendMail()`/`sendSms()` content, stored templates and campaigns, the template
seeder, sender identity, ID prefixes that land in subject lines, PDF receipts,
and — the one that is not mail-shaped — **public page copy, meta descriptions
and the SEO/`llms.txt` routes**), plus the customer-facing vs internal triage
that keeps the report credible.

Don't let the "email" framing narrow it. A previous client's mission statement
or tax ID sitting in a public route damages this client more than any subject
line, and `llms.txt` is specifically what AI search engines read to learn who
the organisation is.

Two things to insist on when you relay its results:

- **Keep its triage.** Customer-facing findings and internal ones (code
  comments, cache keys, the default DB name) are different problems. Flattening
  them into one count makes a handful of real defects look like dozens.
- **Never echo secrets.** SMTP credentials sit next to the identity fields it
  reads; it reports field names and set/unset, never values.

## Step 5 — Consolidate and report

Merge every agent's findings into one list. Then, before presenting:

**Group by root cause, not by page.** Imported designs produce the same defect
across ten pages from one stylesheet rule. Ten findings that share a cause are
one fix — say so, and name the pages it clears. This is the single most useful
thing this pass produces.

Rank by: customer-facing brand leakage > WCAG critical > WCAG serious >
horizontal overflow > tap-target failures > performance > WCAG moderate/minor >
internal-only brand leakage.

Brand leakage sits at both ends deliberately. A previous client's name in a
live subject line outranks every accessibility finding — it is the one defect
here that damages the client in front of *their* customers, and it is usually a
one-line fix. Internal-only hits (comments, cache keys) sit at the bottom,
grouped into a single line, because itemising them buries everything above.

Keep the two brand buckets visually separate and count them separately. "3
customer-facing, 12 internal" is actionable; "15 branding issues" is not.

Present:

1. A one-paragraph verdict — is this site launchable, and what's the blocker.
   Answer two questions explicitly: is the site usable, and **is outbound mail
   safe to send to real recipients**. A site can pass every browser check and
   still be unshippable because it emails people under someone else's brand.
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
- **Vendor and payment-processor names in email content.** "Valor PayTech",
  card brands and library names are not brand leakage — some are contractually
  required. Only an *organisation* identity that isn't the current client's
  counts.

## Scope

**Browser pass (Steps 1–3): public website only.** The admin UI is behind a
login and is excluded by the script (`/login`, `/admin`, `/portal`,
`/dashboard`). If the user wants the admin audited too, that's a different pass
and needs authentication handling that this script doesn't have — say so rather
than half-doing it.

**Brand sweep (Step 4): all outbound messaging, public or not.** Scope is by
*audience*, not by route. A password-reset email is triggered from a login page
the browser pass never visits, and a year-end statement is sent by an
unattended cron job with no page at all — both land in a real person's inbox,
so both are in scope. Admin-only screens stay out of scope; the mail the admin
UI *sends* does not.

What the brand sweep still does not cover, and should be named as such rather
than implied: messages already delivered (`email_logs` is history, not a
template — a fix changes future sends only), SMS/push copy if this install
uses it, and anything composed by hand in the admin UI at send time.
