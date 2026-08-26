---
name: newproject-setup
description: Set up a freshly cloned project as a Craft.js website builder around a client's static design. Detects what's already in place, removes Puck if present, applies the builder database schema, analyses the design in website-files/, wires theme and header/footer to it, imports each page, converts sections into editable components, and verifies with a build and a QA pass. Use on a new clone, or to resume a half-finished setup. Idempotent — safe to re-run.
---

# New project setup

Turns a freshly cloned project into a working Craft.js site builder around a
client's design.

**Everything here is idempotent.** It detects state and acts on the gap, so a
re-run after a failure picks up where it stopped. Never assume a step is needed
because it's in the list.

---

## Phase 0 — Preflight (always)

```bash
node server/scripts/detect-stack.js
```

This decides the entire run. It reports the stack (`craft` / `puck` / `mixed`),
what the database has, what's in `website-files/`, and a `NEXT:` line naming the
phases that actually apply.

**Read the DATABASE target line out loud to yourself.** `server/.env` on a
working machine often points at a *production* database — this project's did.
Every later phase writes. If the target isn't the local database you intend,
stop and say so before doing anything else.

If it reports `not checked`, fix that first — a missing `.env`, or `npm install`
never run in `server/`.

Then confirm the plan with the user before writing anything. Show them the
`NEXT:` line and what you intend to do. This is a destructive, multi-step
process on a real client project; a thirty-second check beats an hour of undo.

---

## Phase 1 — Remove Puck (only if detected)

Skip entirely unless preflight reports `puck` or `mixed`. On a clone of an
already-converted project this phase is a no-op — running it anyway deletes
nothing but wastes the user's time and erodes trust in the report.

When it does apply:

```bash
cd client && npm uninstall @measured/puck
```

Then delete the files preflight listed under "Puck files left", plus any
`server/scripts/*seed*` or `*rebuild*` scripts belonging to the previous
client's content. Grep for `puck` across `client/src` afterwards and fix the
imports that break — the page editor route is usually the last one.

Leave the `puck_data` **column** alone. It's where Craft.js stores its node
tree; only the name is historical.

---

## Phase 2 — Craft.js (only if missing)

The builder is ~50 files: node components, a fields library, an iframe canvas
and the theme chain. It **cannot be synthesised** from a description, so this
skill carries a copy of it in `payload/` and installs from itself. No sibling
project, no network, no shared drive required.

```bash
node .claude/skills/newproject-setup/bundle.js
node .claude/skills/newproject-setup/bundle.js --install
```

The first command reports what's bundled and what the target already has. The
second copies it in, **skipping any file that already exists** — so a resumed
run never clobbers local edits. Pass `--force` only when deliberately replacing
the builder with a newer bundle.

It then prints the exact `npm install` lines, with versions pinned to what the
bundle was tested against. Hand those over rather than running them.

If `payload/` is empty, this copy of the skill was taken from a project that
never packed one. Run `--pack` in a project that has a working builder, commit
the result, and copy the skill again.

**Keeping the bundle fresh:** whenever the builder changes in a project, re-pack
so the next clone inherits the improvement rather than a stale copy:

```bash
node .claude/skills/newproject-setup/bundle.js --pack
```

⚠️ **`--pack` does not know which files are client-specific.** The manifest
includes `PublicLayout.jsx` and `frontend/theme/site.css`, and by the end of a
project both are full of one client's markup, class names and compat rules.
Packing those forward hands the next client somebody else's header. Before
packing, diff what changed and keep only what's generic — a new component prop,
a conversion rule, a bug fix — reverting client-specific edits in the payload
copy. Genuinely per-project work belongs behind a `⚠️ PER-PROJECT` marker, not
in the bundle.

Then re-run preflight. Never attempt to write the builder from scratch — a
half-built builder is worse than an honest "run --install".

---

## Phase 3 — Database schema

```bash
node server/scripts/ensure-builder-schema.js
```

Adds `page_mode` and `code_html` to `website_pages`, and widens
`website_global_settings.setting_value`, `website_pages.custom_css` and
`website_pages.custom_js` to `MEDIUMTEXT`. Without the widening, saving a real
stylesheet fails at 64KB with `Data too long for column`.

It also creates any table the app queries that provisioning never made:
`media_folders`, `media_files`, `social_accounts`, `social_posts`,
`social_queue`, `custom_reports`, `videos`.

None of these fail at startup. Each surfaces only when someone reaches the
feature — `Table '<db>.media_files' doesn't exist` at the first image upload,
long after setup looked finished — so run this before handing the builder over,
not just before importing.

**Re-run the audit on a new clone rather than trusting this list.** Different
provisioning vintages are missing different things. Extract every table named
in `server/src` SQL and diff it against `information_schema`:

- Strip comments and template-literal prose first, or you get "table" names
  like `your`, `today` and `this` from doc text and seeder content.
- Discard false positives by checking each candidate appears in real SQL: CTEs
  (`WITH RECURSIVE reports AS …`) and AI tool names read exactly like tables.
- Derive columns from `INSERT INTO x (…)` lists, then sweep `WHERE`/`ORDER BY`
  for the ones no insert mentions — `alt_text` and `created_at` on
  `media_files` appear only in a search filter and a sort.
- Validate the DDL by creating every table under a `__probe_` prefix against
  the real database and dropping it again. That catches what review won't:
  `uploaded_by INT` fails its foreign key with errno 3780 because `users.id` is
  `INT UNSIGNED`.

**Not every missing table should be created.** This codebase's search route
also queries `panther_completions` and `kb_articles`, which belong to a
different vertical (an aircraft builders' manual). Creating them would add
empty tables to a nonprofit's database. They are wrapped in an `optional()`
helper in `routes/website.js` instead, which swallows `ER_NO_SUCH_TABLE` and
returns no rows — because `Promise.all` means one missing table made the whole
site search return 500.

Idempotent — it checks `SHOW COLUMNS` first.

Per the user's standing preference, **hand this command over rather than running
it**, along with any other command that writes to their database.

---

## Phase 4 — Understand the design

Dispatch one `design-system-mapper` agent at `website-files/`. Don't do this
analysis in the main conversation — the agent definition carries the full
methodology.

What comes back drives every remaining phase. Three findings matter most:

1. **How the palette is defined.** If it's theme-scoped
   (`[data-theme="light"]`), the canvas and the public page must both carry that
   attribute or every colour resolves to nothing. If colours are hardcoded hex,
   tell the user up front that brand settings won't drive this design without
   override rules.
2. **The header/footer class contract.** `PublicLayout.jsx` renders these using
   the *design's own* class names. A different design means different names, and
   the header renders unstyled until they're updated. This is the single largest
   piece of hand-work in a new project — budget for it, don't discover it.

   **Diff the header markup across at least two pages before you build it.**
   `index.html` is the tempting source and is often the *wrong* one: a mockup
   assembled from more than one template ships more than one header. Seen in
   the wild — home used `.site-header__inner` / `.logo` / `.nav-desktop`, every
   other page used `.ns-grid` / `.site-header__brand` / `.site-nav`, and the
   stylesheet defined the first set **only** under `body.home`. Built from the
   home page, the nav rendered unstyled on all twelve inner pages; nothing
   errored, and the home page looked perfect.

   Pick whichever structure the stylesheet defines *unscoped* — that is the
   canonical one, and it matches everywhere including the page whose variant
   you dropped. Confirm with
   `grep -c 'body\.[a-z-]* \.the-selector' styles.css` per candidate.

   Verify by computed style, not by eye: on an inner page check the container
   really is `display: grid`/`flex` and the nav links have their padding and
   colour. Unstyled inline links look like a spacing bug, not a missing rule.

   **Check the mobile toggle button's actual position, not just that it's
   visible.** On the `.ns-grid`/`.ns-block` contract, a header's `.ns-block`s
   only get their `--col-start`/`--col-span` placement above 768px — below
   that they fall back to the design's own `.ns-block { grid-column: 1/-1 }`,
   so two blocks (brand, nav/actions) stack into two grid rows instead of
   sitting side by side. A header with a *fixed* height and no
   `overflow: hidden` doesn't clip that second row — it visually spills out
   beneath the navy bar and lands on whatever content follows, looking like a
   stray hamburger icon floating over the hero image rather than a header
   control. `margin-left: auto` on the toggle button (routine in these
   designs) makes this worse, not better, by doing *nothing*: it only pushes
   within a flex parent, and both `.ns-grid` (grid, not flex) and whatever
   wrapper holds the toggle are usually neither.

   Site-wide fix, not a one-off: make the header row `display: flex` at every
   width instead of depending on the grid fallback (`grid-column` is a no-op
   on a flex item, so this doesn't fight the design's own box-model
   properties on `.ns-grid` — max-width/padding/centering survive). Verify
   with `getBoundingClientRect()` on the toggle button at mobile width:
   `top`/`bottom` must fall inside the header's own box, and `right` should
   sit near the viewport edge — "the icon is visible somewhere on the page"
   is not evidence it's in the header.

   **Do this for the footer too — it is not automatically covered by fixing
   the header.** The same design shipped a *second* two-implementation split
   here: home's footer was `.site-footer__grid` (CSS grid) / `.site-footer__links`
   / `.contact-list`, home-only; every inner page used the same `.ns-grid` /
   `.ns-block` contract as the header, unscoped. Fixing the header does not
   catch this — it is a different set of classes on a different element, and
   the two were fixed in separate passes here. Check both, in the same pass.

   **A `body.home` reset can break a class you didn't touch, even after you
   picked the right one.** After moving the header to `.site-nav` (unscoped,
   correct on every page), non-current nav links were still invisible on
   *home specifically*. Cause: the design's file is two stylesheets
   concatenated — its own comment says so — and the home-only half carries a
   blanket `body.home a { color: inherit }` reset. That has the *same*
   specificity as `.site-nav a`'s colour rule and sits *later* in the file, so
   it wins the tie on home only. `.site-nav a[aria-current="page"]` survived
   because an attribute selector already outranks a bare `a`.

   Fix this as a compat rule in the app's `site.css`, never by editing the
   imported stylesheet: add one more class to the selector
   (`.site-header .site-nav a`) so specificity beats the reset outright,
   regardless of load order. Confirm it doesn't clobber `:hover`/
   `[aria-current="page"]` — those need to stay equal-specificity so the
   later-loading design CSS still wins that tie. Verify with computed style on
   *every* non-current link, not just the active one — the active link's gold
   colour surviving is not evidence the others are white.
3. **The section inventory.** The bucket totals are the honest forecast of how
   much of the design becomes editable automatically. Report that number before
   importing, so expectations are set by evidence rather than hope.

---

## Phase 5 — Theme and chrome

### The grid itself does not change per design

Section → Row → Column is generic: 12 columns, per-breakpoint spans, gaps and
padding all driven by props. There is nothing to rebuild for a new mockup, and
rewriting it would break every page already saved against it.

What *is* per-project is a short list of **contract values** the generic grid
reads. These are the only things a new design should change, and every one of
them comes from the mapper's report:

| Contract value | Lives in | Symptom when wrong |
|---|---|---|
| Breakpoint widths | `frontend/theme/site.css` | Columns stack at the wrong width |
| Container max-width | `layout_width` setting | Content wider or narrower than the mockup |
| Palette mechanism (`[data-theme]` or `:root`) | `CanvasFrame.jsx` | Every colour undefined — unstyled canvas |
| Brand colours, fonts | Web Settings / Theme drawer | Design doesn't respond to branding |
| Header/footer class names | `PublicLayout.jsx` | Header renders unstyled |
| Mobile-menu mechanism | `PublicLayout.jsx` | Button animates, menu never opens |
| Fixed-header height + hero classes | `site.css` clearance rule | First section hidden under the header |
| Design CSS scoped with `>` | `site.css` compat rule | Layout silently ignored — cells stack |

That last row is the one most easily missed. A design that scopes its layout to
a direct child — `.page-section > .grid { display: grid }` — works in the
mockup and stops matching in the builder, because a Section renders
`<section class="bx-section"><div class="bx-section__inner">` and the importer
adds its own Row/Column. Three elements now sit between them. Nothing errors:
the content renders, it just loses `display: grid` and stacks full-width.

Grep the design's stylesheet for `>` in layout selectors during Phase 4. Fix it
by re-asserting the rule without the combinator in `site.css`, at lower
specificity so the design's own rule still wins wherever it does match. Don't
try to fix it by removing the builder's wrappers — `.bx-section__inner` is
structural and changing `Section` affects every page ever built.

Also check whether the design keys off `data-*` attributes: the importer copies
a section's `class` but not its attributes, so `[data-section-type="hero"]`
rules won't match no matter how the nesting is fixed.

Work down that table against the mapper's report. Each row is a small, specific
edit — not a redesign. The last row is marked `⚠️ PER-PROJECT` in `site.css`;
grep for that marker to find anything else needing the same treatment.

### Where each value goes in the admin

Everything the mapper found is entered through **Website → Header & Footer**,
which has a tab per concern. Nothing here needs code:

That page ships in the bundle (`client/src/vb/admin/WebsiteHeaderFooterPage.jsx`)
because it and `PublicLayout.jsx` are one contract: a settings key renamed in
the layout becomes a dead control here — it saves happily and never renders —
and `site_custom_css` has no other editor in the app. If you add a setting to
the layout, add its field here in the same change.

**Audit that contract both ways before handover.** Diff the keys `PublicLayout`
and `frontend/theme/siteTheme.js` read against the keys the settings page can
write. Both directions are real bugs, and neither throws:

- *Read but not editable* — the client can never set it. Found this way:
  `topbar_text`, `header_show_cart`, `header_show_theme_toggle`, the four
  logo URLs, `footer_blurb`, `footer_col4_*`, `header_phone_tollfree`.
- *Editable but not read* — a control that saves and does nothing. Found this
  way: the page wrote `header_topbar_text` while the layout read `topbar_text`,
  and wrote `header_cta_member_*` / `header_cta_donate_*` while the layout read
  the `header_cta_buttons` array.

A settings key is a text value, so booleans are the strings `'true'`/`'false'`.
Give a toggle the *same* default the layout applies, or the checkbox shows the
opposite of what the site is doing until someone saves.

| Tab | What goes in it |
|---|---|
| **Theme** | Brand colours (primary, secondary, buttons, icons), text-on-dark/light, heading and body font stacks, content width |
| **CSS** | The design's whole stylesheet. Loaded after the site stylesheet on every public page **and inside the builder canvas**, so it wins |
| **JS** | The design's `main.js` — runs on the live site only, never in the canvas |
| **Nav** | Header links in order, plus the header CTA button |
| **Footer** | Up to three link columns, blurb, copyright, social links |
| **Contact** | Address, phone, email — feeds the Contact Details block |

The builder's **Theme drawer** (palette icon in the topbar) edits the same
Theme and CSS values with a live canvas preview, so prefer it when tuning
colours against a real page. Both write to the same settings.

Two things this replaces: do NOT paste the design's stylesheet into a page's
Custom CSS (it would load once per page), and do NOT import header/footer markup
as page content — the importer skips it deliberately so it stays consistent.

### Then, from the mapper's output:

- Enter the theme values and paste the stylesheet, per the table above.
- **Import the nav and footer rather than typing them.** The design already
  contains them; retyping twenty links is slow and goes wrong quietly — a
  mistyped href fails only when someone clicks it.

  ```bash
  node server/scripts/import-nav-from-design.js            # report only
  node server/scripts/import-nav-from-design.js --apply    # write the settings
  ```

  It reads `website-files/index.html` and writes `header_nav_links`,
  `header_cta_buttons`, the footer link columns and their headings, the brand
  blurb, the social strip, the contact column (heading, phone, location, email),
  the domain call-out, the bottom-bar legal links and the copyright name.
  Design hrefs are mapped to CMS routes — `about.html` → `/about`,
  `index.html` → `/`, `app.html#features` → `/app#features` — so the slugs line
  up with the pages `import-design.js` creates.

  Two extraction details worth keeping: the social strip is keyed off each
  anchor's `aria-label`, because inline-SVG icons carry no class to match on;
  and the copyright is stored as the *name only* (`Example Org. All Rights
  Reserved.`) since the layout renders the `©` and the year itself — store the
  whole string and the year appears twice.

  **Run it without `--apply` first and read the report.** It names any section
  it could not find, and an empty section means its selector is wrong for this
  design, not that the design lacks the content. The `SELECTORS` block at the
  top of the script is the per-project part: change the selectors, never the
  logic.

  Two things it gets right that are easy to get wrong by hand: submenu children
  are written under `dropdown` (the key the Nav tab saves and `PublicLayout`
  reads — `children` renders as flat links with no caret), and a parent item
  with children is given `/` rather than a destination of its own.

  Then open the Nav and Footer tabs and check it, rather than assuming. Social
  links are not extracted — most designs put them in markup too varied to match
  reliably, so transcribe those by hand if the design has any.
- Update `PublicLayout.jsx` to the design's header/footer class names and its
  mobile-menu mechanism. Check whether the menu needs a class (`.open`), an
  attribute (`hidden`), or both — a mismatch produces a button that animates
  while nothing opens.
- If the palette is theme-scoped, confirm `CanvasFrame.jsx` writes that
  attribute onto the canvas document.

### Prevent the reload flash

A hard reload of any public page briefly shows raw, unstyled markup before
snapping into its real appearance. This is structural, not a bug in one
project: `site.css` and the design's own `site_custom_css` are both attached
from a `useEffect` — after first paint — and `site_custom_css` doesn't exist as
text until `/api/website/public-settings` resolves. Every project built this
way needs the same fix; it doesn't fix itself just because the CSS pipeline
here is architecturally correct elsewhere.

`useSiteStylesheet` (in the bundle, `frontend/theme/useSiteTheme.js`) already
returns whether its `<link>` has loaded — that part travels automatically.
What doesn't travel, because `PublicLayout.jsx` is per-project, is wiring it
up:

- Track a second `settingsReady` flag alongside it (`fetchSiteSettings().then(...)`
  — this reuses the existing cache/in-flight dedupe, not a second request).
- Compute `chromeReady = preview || (styleLoaded && settingsReady)`.
- Mount the real content unconditionally, wrapped in a sibling pair: the
  content in a `<div style={{ visibility: chromeReady ? 'visible' : 'hidden' }}>`,
  and a `position:fixed` spinner overlay shown while `!chromeReady`.

**Mount unconditionally — don't gate the mount itself.** An early return
before the content renders looks simpler, but it delays the page's own data
fetch (`WebsitePublicPage`'s `/website/pages/by-slug/...` call) until after
the site-wide CSS request finishes, turning two requests that were running in
parallel into a waterfall — trading the flash for a slower total load.
`visibility: hidden` keeps the subtree mounted (so its fetch starts
immediately) while stopping it from painting.

**The overlay must not itself depend on the CSS being waited for.** Bootstrap
is a static import in `main.jsx`, so `spinner-border` is safe; nothing scoped
to `site.css` or the design's stylesheet is.

Verify the actual transient state, not just the settled one — the settled
state looks identical whether this works or not. Temporarily lengthen
`fetchSiteSettings`'s delay (wrap the `api.get(...)` in
`new Promise(r => setTimeout(r, 15000)).then(() => ...)`), reload, and confirm
in DevTools that content is `visibility: hidden` with the overlay showing
partway through, then flips once the delay elapses. Revert the delay
afterward — it must never reach a commit.

---

## Phase 6 — Import the pages

```bash
node server/scripts/import-design.js --dry-run
node server/scripts/import-design.js
```

Hand both over rather than running them. Each page becomes draggable Sections
holding the original markup — pixel-exact immediately, upgradable later.

Check the output for skipped assets and the placeholder-media warning preflight
already flagged.

**Then confirm the stylesheet actually reaches the public site.** The importer
writes the design's CSS to `website_global_settings.site_custom_css`, but three
separate things have to line up for it to render, and each fails silently:

1. `GET /api/website/public-settings` must include `site_custom_css` and
   `site_custom_js` in its response. Older copies of `server/src/routes/website.js`
   don't — the route is app-specific and isn't in the bundle, so a clone can
   carry a version that predates the field. Grep it.
2. `PublicLayout.jsx` must call `useSiteStylesheet()` and `useSiteCustomCss()`.
   Site CSS is attached per-surface, never imported globally, so nothing loads
   it unless the layout opts in — that isolation is what keeps the design's
   unscoped selectors out of the admin dashboard.
3. The Express server must be restarted after any route change.

The symptom when any one is missing is the same: a public site of correctly
structured but completely unstyled markup. Easy to misread as a bad import when
nothing is wrong with the data at all.

Also exclude stray stylesheets. Designs often ship a legacy stub
(`css/main.css` containing `@import url("styles.css")`); the importer
absolutises that URL, turning a working relative import into a 404 — and if it
ever resolved, it would load the whole stylesheet a second time. Drop it with
`--exclude main.css`.

---

## Phase 7 — Make it editable

Invoke the `import-design` skill. It audits each page against the reference and
converts HTML blocks into real components.

**Conversion is on by default** (`--no-convert` opts out). It used to require
`--convert`, and forgetting it produced a page of HTML blobs — which is the
opposite of the point of importing into a builder, and looks identical to the
rules having failed. If you see a page of HtmlBlocks, check the *rules* now,
not the flag.

**HTML blocks are a client-visible failure, not a cosmetic one.** The editor
they are handed cannot open an HtmlBlock's contents in the settings panel —
there is nothing to edit but markup. "Users don't know HTML" is the recurring
client complaint, and every section left as raw HTML is a section they cannot
maintain. Treat a section that converts to a single HtmlBlock as unfinished
work, and reserve it for the genuinely irreducible: JS-driven carousels,
multi-step wizards, and raw `<form>`s.

**The goal is real blocks, not structure alone.** A section that converts to
Section → Row → Column but whose leaves are all HtmlBlock is barely more
editable than one big blob. Aim each recognised pattern at the component that
matches the mockup:

| Design pattern | Target block |
|---|---|
| Repeating cards / stats / logos | `CardGrid` (repeater — add, remove, reorder) |
| Eyebrow + heading, with or without a link | `Heading` (+ `ButtonBlock` for the link) |
| Paragraph, or a classed text leaf | `TextBlock` |
| `.btn`-ish anchor, or a lone anchor in a wrapper | `ButtonBlock` |
| Photo | `ImageBlock` |

### Before trusting the existing rules, prove they fit

The generic rules match loose structural patterns (`-header`, `[-_]grid`,
split, banner). That looseness is a hazard: on a design that ships its own
layout contract, a rule can match a **layout wrapper by coincidence** and
convert it, silently dropping content. Seen in the wild: a `.ns-grid` wrapper
satisfied the `[-_]grid` test, so a whole section collapsed into a two-card
grid that dropped every paragraph after the first, every inline SVG icon, and —
because the rule searched *descendants* of a card that was itself an `<a>` —
every card's `href`. Cards that look right and link nowhere are worse than no
conversion at all.

So: read `website-files` for a structural contract (`data-section-*`
attributes, a repeated wrapper class) before assuming the shipped rules apply.
A design that has one is a gift — it's machine-readable and beats inference —
but you must write rules *for* it and order them ahead of the generic ones.

### Rules that pay for themselves

- **Partition, don't demand uniformity.** Real sections are rarely pure: a
  heading, then the cards, then a "view all" link. Find the longest
  *consecutive run* of siblings sharing a class, convert that to a `CardGrid`,
  and keep what precedes and follows it in document order. Requiring every
  child to match gives up on exactly the sections most worth converting.
- **Take every paragraph, not the first one.** `querySelector('p')` inside a
  card rule looks harmless and quietly halves the content. A stat card is two
  paragraphs — the value and its label — so the imported page rendered
  `50,000+` with nothing saying what it counted, while the section still
  reported as fully converted. `CardGrid` carries a `details` field (plus
  `detailsClass`) for exactly this; check *both* card rules when you fix it,
  since they pick their text independently.
- **A card's leading badge is content, not decoration.** A letter badge, a
  numbered step, a category tag, a set of initials — all sit as one small
  element immediately before the title, and every card rule was picking a
  title and a paragraph and nothing else. It disappeared on import with the
  section still reporting fully converted. `findEyebrow()` grabs the sibling
  immediately before the title, guarded to the media wrapper and to
  inline-only content so a real second paragraph is never mistaken for it.
  Across one real design this was 39 of 66 cards — check for it, don't assume
  a design's cards are just a title and a sentence.
- **Import card text as markup, not as text.** `textOf()` flattens the accents
  a design leans on — `This <span class="gold">Movement</span>`,
  `50,000<span>+</span>`, `Christians<br>Connected` — and the loss reads as a
  styling bug rather than missing content. Use `htmlOf()` for any field the
  component renders as HTML. `CardGrid`'s title/text/details do, passing
  through `sanitizeInline()` (`nodeUtils.js`), which keeps an inline allowlist,
  *unwraps* anything else so the text survives, and drops script/style/frame
  content outright. Verify a new allowlist against hostile input —
  `<img onerror>`, `javascript:` hrefs, `onclick` — not just against the design.
- **Convert classed text leaves.** Many designs express content as
  `<div class="stat-number">` rather than `<h3>`/`<p>`. Treat an element whose
  only children are inline tags (`br`, `span`, `strong`, `a`…) as a text leaf
  and emit a `TextBlock` carrying its class. Without this nearly every leaf
  falls through to HTML.
- **Never bail to a lossy fallback.** Returning `null` because a case is hard
  doesn't leave the section as HTML — it hands it to the *next*, looser rule,
  which may well mangle it. Handle the case, or block the fallthrough
  deliberately.
- **A section with no element children still needs converting.** `convertSection`
  walks a section's *children*, so a self-contained empty section — the usual
  shape of a decorative rule, `<div class="section-break" role="separator">` —
  produced nothing at all and fell through to HTML no matter which rules were
  registered. It falls back to treating the section itself as the block. Symptom
  is a rule that plainly matches yet never fires.
- **Convert the irreducible-looking things too.** An empty separator becomes a
  `Divider`, an `<iframe>` embed becomes a `VideoBlock`. Both look like "nothing
  to edit" and both are things a client asks to change — swapping the video is a
  routine request, and as markup it means editing an embed URL by hand. Leave
  the dimensions blank when the design styles the element (`Divider` writes
  `marginY` inline, and inline beats the design's own `margin: 0`).
- **Recurse into wrappers before giving up.** `convertContentBlock` is the
  last rule in `RULES` and the reason most sections convert at all: it walks a
  block's children with the same vocabulary (`Heading`/`TextBlock`/
  `ButtonBlock`/`ImageBlock`/classed text leaves), re-running `CORE_RULES` on
  each nested wrapper so an inner card grid still becomes a `CardGrid`. Each
  wrapper it descends through is reproduced as a `Column` carrying that
  wrapper's own class and inline style, so the DOM the stylesheet expects
  survives. It returns `null` when it produced nothing but HTML blocks, so a
  block it can't improve is still reported honestly as unconverted.
  Most designs put their content one or two wrappers below the section, so
  without this every section converts to a single blob.
- **Keep the container class.** `convertSection` reports the wrapper it
  descended through as `containerClass`, and `import-design.js` puts it on the
  Row as `importedClass` (Row drops its own `bx-row` layout when that is set).
  That wrapper almost always carries `max-width` / `margin-inline` /
  `padding-inline` as well as layout — drop it and every converted section goes
  edge-to-edge while looking structurally perfect.
- **Watch tag precedence in the leaf rules.** Anchors count as inline tags, so
  a `<div>` of nothing but links satisfies the classed-text-leaf test and gets
  swallowed as rich text — the client loses the button fields. The actions-row
  branch has to be checked first. The same trap applies to any new leaf branch
  added below an existing looser one.

### Fidelity first: never drop a wrapper that carries layout

**The most common way this phase goes wrong is converting a design element into
a builder block that renders a different DOM shape.** The content is all there,
the page still "converted", and the layout is quietly broken.

Every wrapper in the design is doing a job. Before replacing one with a block,
look up what its class actually does in the stylesheet:

- A grid wrapper usually carries `max-width`, `margin-inline: auto` and
  `padding-inline` as well as `display: grid`. Drop it and the section goes
  edge-to-edge — the page loses its container and nothing else looks right.
- A `section-head` wrapper is usually `display: flex; justify-content:
  space-between`, which is what puts the heading left and the "view all" link
  right. Flatten it into a Heading plus a Button and they stack, or fly to
  opposite ends of a full-width row.
- A card's CTA class carries its own colour and weight. Map it to a generic
  `linkLabel` and it renders in the component's colour instead of the design's.

All three were observed on one section of one real project, from one careless
choice each.

So the rule is: **a converted block must reproduce the wrapper's class, or
reproduce its CSS.** In practice that means passing the wrapper class through
(`gridClass`, `cardClass`, `linkClass`…) rather than blanking it. Blank it only
when you have checked the class carries no layout, and say so in a comment.

If passing the class through fights the block's own layout — a repeater can't
store per-cell grid coordinates, for instance — that is a signal the block is
the wrong target, not that the class should be dropped. Prefer Row/Column,
which preserves placement exactly, over a repeater that silently reflows.

### When a block can't represent the design, extend the block

This is expected work, not a hack. If a component would lose fidelity, add the
prop rather than accepting the loss or giving up the conversion:

- **Class passthrough.** `CardGrid` takes `gridClass`/`cardClass`/`titleClass`/
  `textClass`/`detailsClass` so imported cards keep the design's own styling.
  Any component you convert *into* needs the same, or the conversion is a
  visual regression. **Expose those props in the settings panel too** — a
  passthrough the importer writes but nobody can see or set means a hand-added
  card can never match an imported one, and the obvious workaround (typing
  `<p class="…">` into a text field) cannot work: text fields render *inside*
  the classed element, so a block tag nested there is invalid HTML and the
  sanitiser unwraps it, taking the class with it.
  `Stats` had none, which is why stats are better served by `CardGrid` with
  passthrough than by the block that shares their name.
- **Inline style passthrough.** A design may put the rule in a class and the
  per-cell values in inline custom properties
  (`<div class="ns-block" style="--col-start:1; --col-span:7">`). `Column`
  discarded inline styles whenever `importedClass` was set, so placement was
  lost with them — fixed by adding an `importedStyle` prop and
  `parseInlineStyle()` in `nodeUtils.js`.
- **New fields.** If the mockup exposes something the settings panel can't edit,
  add the field to the node's `craft.props` and its settings component. A
  converted block the client can't actually edit hasn't achieved anything.

Re-run `--pack` afterwards so the next clone inherits the improvement — but see
the warning in Phase 2 about client-specific files.

### Verify against the markup, not by reasoning

The dry run counts *sections*, so it reports success while every leaf is still
HTML. To see what was actually produced, walk the tree and tally node types:

```js
// server/_probe.js — delete when done. node-html-parser must be installed.
const { parse } = require('node-html-parser');
const { convertSection } = require('./scripts/lib/convert-sections');
const make = (type, props, children) => ({ type, props, children });
const flat = (ns, out = []) => (ns || []).reduce((a, n) => (a.push(n), flat(n.children, a)), out);
const root = parse(require('fs').readFileSync('../website-files/index.html', 'utf8'));
for (const s of root.querySelector('main').childNodes.filter((n) => n.nodeType === 1)) {
  const t = {};
  flat(convertSection(s, make).children).forEach((n) => { t[n.type] = (t[n.type] || 0) + 1; });
  console.log(s.getAttribute('data-section-id'), t);
}
```

Check the `href`, image and text of a few converted cards explicitly. Silent
content loss is the failure mode of this phase, and totals won't show it.

**Report real numbers.** Sections converted vs left as HTML, and how many
editable blocks came out. "33/33 sections, 0 raw" is a claim you can defend;
"most of it converted" is not.

### Then compare rendered output against the mockup, section by section

Node counts prove content survived. They say nothing about whether it *looks*
right, and that is the failure this phase actually produces. Do not close Phase
7 on counts alone.

Open the two side by side — the built page and the design file it came from —
and walk them **one section at a time**, top to bottom:

```bash
# the mockup, straight from disk
start website-files/index.html
```

For each section ask four questions, in this order:

1. **Container** — does the content start and end at the same x-position as the
   mockup, or has it gone edge-to-edge? A lost container is the single most
   visible regression and the easiest to miss in a narrow screenshot.
2. **Internal arrangement** — is anything that was side by side now stacked, or
   pushed to opposite ends? That means a flex/grid wrapper was dropped.
3. **Type and colour** — headings, eyebrows, CTA links. A colour change means a
   class didn't come through.
4. **Spacing** — gutters and vertical rhythm.

Anything that differs is a wrapper whose class was dropped or whose CSS the
block doesn't reproduce. Fix it in the rule and re-import that one page with
`--only <slug>`; don't hand-edit the page, or the next import loses the fix.

Iterate per section rather than per page. A single careless `gridClass: ''` can
account for several apparent problems at once, and fixing it clears them
together — while a page-level "looks a bit off" tells you nothing about which
rule to change.

---

## Phase 8 — Verify

```bash
cd client && npm run build
```

A clean build is necessary, not sufficient. Then:

```bash
cd qa && npm install          # first run only, downloads Chromium
node audit.js --url http://localhost:5183 --skip-speed
```

Or invoke the `qa-audit` skill, which adds per-page diagnosis. Speed needs a
production build or the deployed URL — dev-server numbers are meaningless.

Finally, check by hand what tooling can't:

- The builder canvas shows the design's real colours, not defaults.
- Header and footer render inside the canvas, inert, correctly styled.
- A section can be selected, edited, and the change survives a save and reload.
- The public page matches the mockup side by side.
- **The admin dashboard is visually unchanged** — site CSS leaking into it is
  the failure mode this architecture exists to prevent.

---

## Report at the end

State plainly:

- Which phases ran and which were skipped because they were already done.
- How many sections converted vs stayed as markup, per page.
- What still needs hand-work — header/footer classes, missing assets,
  unconverted patterns.
- Anything you could not verify.

A setup that's 80% done and honestly described is more useful than one claimed
complete. Do not report success on phases you skipped.
