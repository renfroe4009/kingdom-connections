---
name: ship
description: Commit and push the current work to GitHub safely — scans the staged diff for credentials first, branches off main rather than committing straight to it, stages deliberately instead of `git add -A`, and writes a real commit message. Use when asked to push, commit, ship, or "send this to git". Also use before handing a change to anyone else, or before a deploy that pulls from the repo.
---

# Ship — commit and push, without leaking anything

Pushing is easy; pushing *safely* from this repo is the part worth automating.
This project has already produced two near-misses:

* `.history/` (VS Code Local History) held snapshots of `server/.env`, complete
  with the live Railway database password, the JWT secret and the R2 keys. It
  was untracked but **not** ignored, so a single `git add -A` would have put
  them on GitHub.
* `server/backups/` holds database snapshots of the client's site content.

Both are gitignored now. Neither was when the work started, and the next thing
someone adds may not be either. So: never stage blindly, and always read the
diff before it leaves the machine.

---

## 1 — Look before touching anything

```bash
git status --short
git branch --show-current
git log --oneline -3
```

Read the untracked list properly. Anything you do not recognise is a question
for the user, not something to sweep in. Specifically refuse to stage, and
raise, any of:

* `.env`, `.env.*` (except `.env.example`), or any file whose name contains
  `secret`, `credential`, `token`, or `key`
* `.history/`, `server/backups/`, `node_modules/`, `dist/`
* database dumps (`*.sql`) that were not already tracked

If one of those is untracked but *not* ignored, fix `.gitignore` in the same
commit and say so. That is the actual defect — the file being dangerous is
just the symptom.

## 2 — Branch when on the default branch

If `git branch --show-current` reports `main`, create a branch. Do not commit
straight to `main` unless the user explicitly says to.

```bash
git checkout -b <type>/<short-kebab-summary>
```

`feat/`, `fix/`, `chore/` — pick from what the change actually does.

## 3 — Stage deliberately

Never `git add -A` or `git add .` in this repo. Name paths:

```bash
git add <path> <path> …
```

Group by intent. If the working tree contains two unrelated changes, ask
whether to split them into separate commits rather than burying one inside the
other.

## 4 — Scan the staged diff for secrets

This is the step that matters, and it runs on what is **staged**, not on the
working tree:

```bash
git diff --cached | grep -inE "password|secret|api[_-]?key|token|BEGIN [A-Z ]*PRIVATE KEY|rlwy\.net|amazonaws\.com|r2\.cloudflarestorage" | head -20
```

Read every hit. Test fixtures and variable *names* are fine; live values are
not. If anything real appears, unstage it, fix it, and start the scan again.
Do not proceed on the assumption that it is probably fine.

## 5 — Commit with a message that explains itself

Subject line in the imperative, under ~72 characters. Then a body that says
**why**, not what — the diff already says what. Cover, where they apply:

* the problem the change solves, in the user's terms
* anything non-obvious a reader would otherwise have to reverse-engineer
* consequences the next person needs to know: a migration to run, a service to
  restart, a setting to configure

Use a heredoc so the body survives shell quoting:

```bash
git commit -F - <<'EOF'
Subject line here

Body explaining why.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

⚠️ In PowerShell use `@'…'@` instead; the closing delimiter must sit at column 0.

## 6 — Push and hand back a link

```bash
git push -u origin <branch>
```

Report the branch, the commit subject, and the PR URL the remote prints. If
the user wants it on `main` instead, give them the merge commands rather than
running them unasked:

```bash
git checkout main && git merge <branch> && git push
```

---

## What does not go in the commit

Say these out loud rather than silently omitting them — they are the reason a
push can look complete while the deploy still breaks:

* **`server/.env`** is ignored, correctly. Anything configured there —
  `CLIENT_ORIGIN`, database credentials, storage keys — must be set again on
  the host. A change to `.env` never ships.
* **Database state does not travel with code.** Schema scripts under
  `server/scripts/ensure-*.js` and any seed scripts have to be run against each
  environment. If the commit adds or depends on one, name it in the report.
* **New dependencies** need an install on the host. If `package.json` changed,
  say so.

## Reporting

State plainly: the branch, what was committed, what was deliberately left out,
and every follow-up step the change needs to actually work in another
environment. A push that lands but leaves the site broken because a migration
never ran is not a success, and describing it as one wastes the next hour.
