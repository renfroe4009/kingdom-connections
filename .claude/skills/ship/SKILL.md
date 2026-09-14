---
name: ship
description: Commit and push the current work to GitHub safely — confirms the git commit identity matches the GitHub account that will push, scans the staged diff for credentials first, branches off main rather than committing straight to it, stages deliberately instead of `git add -A`, writes a real commit message, and merges in the latest main (resolving conflicts, re-checking the build) before pushing. Use when asked to push, commit, ship, or "send this to git". Also use before handing a change to anyone else, or before a deploy that pulls from the repo.
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

### Confirm who you're committing and pushing as

Commits carry the identity in git config (`user.name`, `user.email`). The push
is made by whichever GitHub account the credential store hands over. These are
set independently, and this machine is used with more than one GitHub account.
When they disagree, commits land under someone else's name, show as unlinked
("unverified author") on GitHub, or get attributed to the wrong person in the
client's history. Check this before creating any commit, because fixing it
afterwards means rewriting commits.

**1. The identity commits will use,** and where each value comes from (repo
config beats global):

```bash
git config --show-origin --get user.name
git config --show-origin --get user.email
```

**2. The GitHub account that will push.** Use the first method that works:

* **GitHub CLI installed and logged in** — this is authoritative, and it can
  also list the account's verified emails:

  ```bash
  gh api user --jq '.login'
  gh api user/emails --jq '.[] | select(.verified) | .email'
  ```

  The second command needs the `user:email` scope. If it's refused, fall back
  to the public profile check in step 3.

* **Git Credential Manager** (no `gh`) — see whether an account is pinned for
  this remote:

  ```bash
  git config --get-urlmatch credential.username "$(git remote get-url --push origin)"
  ```

  If nothing is pinned, list the signed-in GitHub accounts. This prints
  usernames only:

  ```bash
  git credential-manager github list
  ```

  One account means that's the pusher. **Several accounts with none pinned
  means the pusher is ambiguous.** Stop and ask the user which account should
  push. Then offer to pin it for this repository only, and run this only after
  they agree:

  ```bash
  git config credential.username <login>
  ```

⚠️ Never discover the account with `git credential fill`, or anything else that
reads the stored token. It prints the live credential in plain text. Usernames
from the commands above are all this check needs.

**3. Compare.** Look up the account's public profile (no login needed):

```bash
curl -s https://api.github.com/users/<login>
```

* **Name** — should be the account's `login` or its profile `name`. Anything
  else, flag it.
* **Email** — must be an address GitHub has verified for that account, or
  commits won't link to it. It counts as confirmed when it is:
  - in the verified list from `gh api user/emails`, or
  - the profile's public `email`, or
  - the account's no-reply address, `<id>+<login>@users.noreply.github.com`,
    using the `id` from the profile

  If none of those applies, the email can't be verified from here. That
  happens with a private email and no `gh`. Don't treat it as a pass: show the
  user the identity and the account, and ask them to confirm the email is
  verified on that account. Once they confirm, don't ask again in the same
  session.

**4. On a mismatch, ask — never fix it silently.**

* **Never** change `--global` git config. It affects every other repository
  on the machine, including other clients' work.
* With the user's agreement, set the correct identity for **this repository
  only**:

  ```bash
  git config user.name "<name>"
  git config user.email "<verified email>"
  ```

  If they don't want their real email exposed, suggest the no-reply address.

* If the user says the mismatch is intentional (for example, committing as a
  client's account), accept it and say so in the report.

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

## 6 — Bring in the latest main before pushing

Other people push to `main` while you work. Pushing a branch that was cut from
an old `main` hands the collision to whoever reviews or deploys it — or, worse,
it merges cleanly in git and breaks at runtime. Resolve that here, on your
machine, where you can still test it.

Always run this, even if the branch is minutes old. Your own commit is safe
first — that is why this comes after step 5, not before.

```bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD && echo "already up to date"
```

If it prints `already up to date`, skip to step 7. Otherwise record where the
branch was, then merge:

```bash
PRE_MERGE=$(git rev-parse HEAD)
git merge --no-edit origin/main
```

**Merge, never rebase.** A rebase rewrites commits that may already be on the
remote and then needs a force-push. A merge never does.

### If the merge stops on conflicts

List them:

```bash
git diff --name-only --diff-filter=U
```

Read both sides of every conflict before touching it. Then:

* **Resolve it yourself** when the intent of both sides survives intact:
  - both sides added different imports, routes, list entries or CSS rules
  - one side reformatted or renamed, and the other made an unrelated change
    nearby
  - version-number-only lines, such as the `version` field in a
    `package-lock.json`
* **Stop and ask the user** when both sides changed the *same logic* — the same
  condition, query, calculation, copy or config value — in different ways.
  Choosing whose version wins is a product decision, not a merge mechanic.
  Show both versions and what each does.
* **Lockfile conflicts:** resolve `package.json` by hand. Then regenerate the
  lockfile rather than hand-editing it:

  ```bash
  git checkout --theirs <dir>/package-lock.json
  cd <dir> && npm install --package-lock-only
  ```

* **Never** resolve a conflict in `.env*`, secrets, or credential-bearing
  config. Ask.

After each file is resolved, confirm no markers are left, then stage that
file by name:

```bash
grep -nE "^(<<<<<<<|=======|>>>>>>>)" <file>
git add <file>
```

Finish the merge once every file is resolved:

```bash
git commit --no-edit
```

If it turns out to be more than you should decide, back out completely. This
restores the branch exactly as it was:

```bash
git merge --abort
```

### Re-check what the merge touched

A clean merge in git is not proof the code still works. Find what came in:

```bash
git diff --name-only "$PRE_MERGE" HEAD
```

Run the checks that match, and fix anything the merge broke before pushing:

* **`client/package.json` or `server/package.json` changed** — run
  `npm install` in that folder first. A teammate adding a dependency is exactly
  how the build fails and the server crashes on start (`dompurify` and `otplib`
  both did this).
* **Anything under `client/` changed** — `cd client && npm run build`.
* **Anything under `server/` changed** — `node --check` each changed file, then
  load each changed module to catch a renamed export or broken `require`:

  ```bash
  cd server && node -e "require('./src/routes/<changed>')"
  ```

  ⚠️ Never `require('./src/index.js')` for this. It starts the server, and
  startup runs the template seeder, which writes to the database.

If a check fails because of the merge, fix it in a separate commit whose
message says it repairs the merge. If the cause isn't obvious and small, stop
and report instead. Never push a branch you know is broken.

### Re-scan exactly what will leave the machine

Step 4 scanned your own commit. Conflict resolutions and merge fixes are new
edits it never saw. Scan everything this branch adds on top of `main`:

```bash
git diff origin/main HEAD | grep -inE "password|secret|api[_-]?key|token|BEGIN [A-Z ]*PRIVATE KEY|rlwy\.net|amazonaws\.com|r2\.cloudflarestorage" | head -20
```

Read every hit, the same as step 4.

## 7 — Push and hand back a link

First, confirm every commit about to leave carries the identity approved in
step 1. That includes commits made earlier on this branch under a different
config, and the merge commit from step 6:

```bash
git log origin/main..HEAD --format='%h %an <%ae>' | sort -k2 -u
```

If any author differs, stop and show the user the commits. Changing an author
means rewriting commits, so ask before doing it. Only commits that have never
been pushed may be rewritten, and never with a force-push to a shared branch
unless the user says so.

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
environment.

Also state the commit identity and the account that pushed. Say whether the
email was verified against that account, confirmed by the user, or accepted
as an intentional mismatch.

Also say how the branch relates to `main`:

* already up to date, or merged in N new commits from `main`
* each conflict, and how it was resolved
* any fix commit the merge needed
* which checks ran afterwards, and their result

If you stopped to ask about a conflict, say so. Don't report a push as done. A push that lands but leaves the site broken because a migration
never ran is not a success, and describing it as one wastes the next hour.
