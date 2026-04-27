---
name: cut-version
description: Cut a new Duo version — drafts release notes (litmus test), bumps package.json if needed, rebuilds CLI, syncs skill, runs typecheck + smoke matrix, updates CHANGELOG, RELEASES.md, faq.html "What's New", what-duo-does.html new-capabilities, roadmap status flips, then commits + tags. PROACTIVELY OFFER when a stage flips to ✅, when a substantial commit lands on user-visible surfaces (renderer/, electron/, cli/duo, skill/, agents/), or when the user says "shipped"/"done"/"let's commit" on something user-facing. Geoff won't remember to ask.
---

# Cut-version skill — Duo

> **Why this skill exists.** Geoff doesn't remember to ask for
> versions to be cut. The detection has to come from Claude. This
> skill encodes both the *trigger conditions* (when to propose a
> cut) and the *procedure* (what a cut actually does). Both are
> load-bearing — a skill that knows the procedure but never fires
> is worse than no skill at all.

---

## When to propose a cut

**Strong triggers (propose):**

1. A *whole stage* on the roadmap flips from 🔄 / ⬜ to ✅ (not a partial / sub-stage).
2. A coherent multi-commit feature surface lands and the user signals closure ("shipped," "done," "let's tag it").
3. The FTUX trio (Stage 18 + 18b + 23 + 24) or another similarly-sized initiative completes.
4. The user explicitly asks to cut.

**Calibration note (added after the v0.2.0 draft was deferred 2026-04-26):**
Three coherent commits in a row is NOT automatically a cut. The bar
is closer to "a meaningful chapter has ended." If you find yourself
proposing a cut every few commits, you're proposing too often. The
draft accumulates in `RELEASES.md § Pending` between actual cuts —
that's the safety net, but the goal is to propose less, not to lean
on the safety net.

**Weak triggers (consider, don't auto-propose):**

**Weak triggers (consider, don't auto-propose):**

- A doc-only commit (`docs/`, `README.md`, etc.) where the docs describe something that already shipped.
- A refactor with no observable behavior change.
- A test-only commit.
- A bug fix without a coherent surface around it. (Fix accumulates in `[Unreleased]`; cut waits for a chapter to close.)

When in doubt, the litmus test (Step 1 below) is the answer. Draft
the notes; if the notes feel anemic, the version doesn't get cut.

**Don't propose:**

- During a verification sweep where multiple punch-list items are
  expected to land in a single follow-up commit. Wait until the
  sweep settles.
- In the middle of a multi-stage feature where the early stages
  have shipped but the user is still working on the next one.
- When the user has explicitly said "not yet" on the most recent
  proposal — wait for the next strong trigger.

---

## The procedure

### Step 1 — Draft release notes (the litmus test)

This is the load-bearing step. Draft notes BEFORE bumping anything,
running anything, or touching git. The notes are what the user sees
to decide whether the cut should happen.

Pull from these sources, in order:

1. `docs/dev/session-log.md` — most recent sessions since the last cut. The prose-y narrative; mine for "what shipped + why."
2. `git log --oneline <last-tag>..HEAD` — actual commits. The auditable inventory.
3. `docs/roadmap.html` (or `ROADMAP.md`) — stages that flipped to ✅ since the last cut.
4. `tasks.md` — bugs that flipped to ✅ Fixed since the last cut.
5. The `Pending — not yet cut` stash at the top of `docs/RELEASES.md` — accumulated draft notes from prior rejected cuts.

Compose into two artifacts:

**(a) CHANGELOG entry** — one section per category (Added /
Changed / Fixed / Deprecated / Removed / Security / Known issues).
One line per item. Reference PR / commit / stage where relevant.

**(b) RELEASES.md prose entry** — narrative companion. Cover:

- Why this version lands here (vs. earlier or later).
- 2–4 key design decisions baked in.
- "What this is and isn't" framing — what's queued next.

**Show the user both artifacts** and ask: "Cut as proposed, defer
to accumulate more, or rework?" Accept the user's decision verbatim.

### Step 2 — Decision branch

**If user says "defer":** move the draft into the `Pending — not
yet cut` section at the top of `docs/RELEASES.md`. Do NOT touch
`CHANGELOG.md` (the `[Unreleased]` section can grow next time, but
deferred drafts only stash in RELEASES.md to avoid double-entry).
Stop. The next strong trigger re-proposes with the accumulated stash.

**If user says "rework":** revise per their feedback. Re-show. Loop
until they say "cut as proposed."

**If user says "cut":** proceed to Step 3.

### Step 3 — Decide version bump

Read current version: `cat package.json | grep '"version"'`.

Apply semver:

- **MAJOR** (1.x.0 → 2.0.0) — breaking changes to user-facing APIs (CLI verb signatures, file paths, IPC contracts that external skills depend on). Pre-1.0, MAJOR doesn't apply (entire 0.x range is "may break").
- **MINOR** (0.1.x → 0.2.0) — new user-visible capability shipped. Most cuts will be MINOR while pre-1.0.
- **PATCH** (0.1.0 → 0.1.1) — bug fixes only, no new capability.

State the version + bump rationale to the user. Wait for ack.

### Step 4 — Apply changes

Run in order. Stop on first error.

```bash
# Bump version (only if Step 3 chose to bump — first cut at v0.1.0
# may not need a bump if package.json already matches).
# Edit package.json manually with the Edit tool; do NOT use `npm version`
# (it auto-creates a tag we don't yet want).

npm run typecheck                 # blocking — must be clean

npm run build:cli                 # rebuilds cli/duo binary
npm run sync:claude               # copies skill + agent into ~/.claude/

# Optional: npm run build, then a quick `npm run dev` boot smoke
# (Section 1 of docs/dev/smoke-checklist.md only — full smoke
# walk is the user's call).
```

Update files **in source — NOT the installed copies in `~/.claude/`**.
The Stage 18 installer copies these to the user's `~/.claude/duo/help/`
on first launch / upgrade. Editing the installed copies directly
would mean your next `npm run dist` doesn't include the changes.
Order:

1. `package.json` — version field (if bumping).
2. `CHANGELOG.md` — move `[Unreleased]` content into a new `[X.Y.Z] — YYYY-MM-DD` section. Add the date. Update the link refs at the bottom. Reset `[Unreleased]` to empty.
3. `docs/RELEASES.md` — prepend the new prose entry above prior entries (most-recent-first). Clear the `Pending — not yet cut` stash if any of it folded into this cut.
4. `help/faq.html` (in repo, NOT the `~/.claude/duo/help/` copy) — add a "What's new in vX.Y.Z" entry to the FAQ's "What's new" section. Plain-English, 2–4 lines per major item.
5. `help/what-duo-does.html` (in repo, NOT the `~/.claude/duo/help/` copy) — for any newly-added capability, insert a numbered entry in the relevant category (Editor / Browser / Canvas / Files / Terminal / Capture-Send / Sessions / etc.). Use plain-English voice with the CLI invocation listed alongside as the "how." Logical ordering, NOT chronological.
6. `docs/roadmap.html` (and `ROADMAP.md` for parity) — flip stage statuses for anything that landed in this cut. Update the sidebar status counts.
7. `docs/dev/session-log.md` — add a one-paragraph entry referencing the cut, the version, and what landed.

### Step 4.5 — Build the distributable DMG

```bash
# v0.2.0+ default — UNSIGNED build (Stage 21 not yet shipped)
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
                                  # produces dist/Duo-X.Y.Z-arm64.dmg
                                  # (and the universal/x64 DMG)
```

Why the env override: when `CSC_NAME` is in the environment (from
`~/Documents/duo-private/.env`), electron-builder auto-discovers the
Developer ID Application cert and tries to sign — but Stage 21
hasn't shipped, so signing isn't wired correctly. The override forces
an unsigned build, which is the right behavior pre-Stage-21.

Once Stage 21 lands, drop the override and the build will sign +
notarize per the YAML wiring. The first signed build on a new Mac
prompts a macOS keychain permission dialog ("codesign wants to use
the key in keychain") — click "Always Allow" or the build hangs and
eventually fails with misleading errors (FOLLOWUP-005 in tasks.md).

Output sanity check:

```bash
ls -lh dist/Duo-*.dmg             # confirm a DMG with the new version
                                  # in its filename exists
```

Do NOT `git add dist/` — `dist/` is gitignored. The DMG is a build
artifact tracked outside the repo (manual distribution today; Stage 21
adds notarization + Stage 21+ should add a GitHub Releases publish).
A future cut shouldn't be considered "done" until at least the local
DMG exists — that's what proves the build pipeline still works.

**Dev-mode banner oddity to flag in the user-facing notes:** because
the install service runs the same code path regardless of
`app.isPackaged`, the welcome banner appears in `npm run dev` too.
Devs see it on every fresh dev launch unless they click Install once
or copy a stub `installed.json`. Not user-visible (end users only
ever see the banner once per machine), but worth noting in any
"how do I dev on Duo" doc.

**Smoke-verification note when running computer-use:** see
`docs/dev/smoke-checklist.md § Verifying transient UI states`.
Critical takeaway: the screenshot tool has 5–15s of latency past
the trigger, so any UI state under ~5s won't be captured by a
naive click-then-screenshot. Pattern: temporarily extend
auto-dismiss timers in the source to 60s, walk the smoke, revert
before commit.

### Step 5 — Verification before commit

```bash
npm run typecheck                 # second pass — catches any breakage from the file edits
git status                        # confirm only intended files changed
git diff --stat                   # one-line review of scope
```

If anything unexpected appears in `git status` (untracked files,
unrelated diffs), STOP and surface to the user. Don't commit
through unexpected state.

`dist/` should appear as untracked but is `.gitignore`d — that's
expected. The DMG produced by Step 4.5 lives there and gets
distributed manually (or via Stage 21's eventual upload step).

### Step 6 — Commit + tag

```bash
git add CHANGELOG.md docs/RELEASES.md docs/roadmap.html ROADMAP.md \
        docs/dev/session-log.md package.json cli/duo \
        ~/.claude/duo/help/faq.html ~/.claude/duo/help/what-duo-does.html
        # Note: ~/.claude/ is outside the repo — those files are committed
        # to the help-files repo or wherever they live, NOT the duo repo.
        # Adjust per-environment.

git commit -m "$(cat <<'EOF'
release: vX.Y.Z

<one-line summary of the release headline>

<2-3 lines of body text mirroring the RELEASES.md "Why" section>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git tag -a vX.Y.Z -m "Duo vX.Y.Z — <one-line headline>"
```

**Do NOT push the tag automatically.** Always ask the user before
`git push --tags` — pushing a tag is observable to the outside
world (or will be once the repo has a public mirror), and the user
should explicitly bless that.

### Step 6.5 — Publish DMG to GitHub Releases (after `git push --tags`)

Once the user has confirmed the tag push, attach the unsigned DMG(s)
built in Step 4.5 to a GitHub Release so end users can download
the latest build directly from
`https://github.com/dudgeon/duo/releases/latest` without cloning
the repo.

```bash
# Verify the tag landed remotely first.
git ls-remote --tags origin "refs/tags/vX.Y.Z" | grep -q "refs/tags/vX.Y.Z" \
  || { echo "tag vX.Y.Z not on origin yet — push first"; exit 1; }

# Confirm the DMGs from Step 4.5 are still on disk.
ls -lh dist/Duo-X.Y.Z*.dmg || { echo "no DMG present — re-run Step 4.5"; exit 1; }

# Generate the release body. Pull the most recent v0.X.Y entry from
# RELEASES.md (everything between "## vX.Y.Z" and the next "## v" or
# horizontal rule).
RELEASE_BODY=$(awk -v v="X.Y.Z" '
  /^## v/ { if (capture) exit; if ($2 == "v" v) capture = 1 }
  capture { print }
' docs/RELEASES.md)

gh release create vX.Y.Z \
  --title "Duo vX.Y.Z — <one-line headline>" \
  --notes "$RELEASE_BODY" \
  dist/Duo-X.Y.Z*.dmg
```

The `dist/Duo-X.Y.Z*.dmg` glob picks up both arm64 and x64 builds when
electron-builder produces them. Both attach to the same release.

**Stage 21 transition:** once code-signing + notarization land, this
step still works unchanged — the DMG glob doesn't care whether the
artifacts are signed. The release notes should call out `signed +
notarized` so users know the Gatekeeper warning is gone.

**If `gh` isn't authenticated:** `gh auth status` first; `gh auth
login` to fix. Don't paper over it; an unauthenticated release call
fails silently in some shells.

### Step 7 — Stop. Report.

Show the user:
- The new version.
- One-line summary.
- The commit SHA.
- The tag (local only — not pushed).
- Suggested next: `git push --tags` (defer to user).

---

## Failure modes to watch

- **Typecheck fails after edit step.** Almost always means a stage flip in `roadmap.html` references something that doesn't exist yet — the most common culprit is editing the roadmap before the corresponding code commit lands. Roll back the roadmap edit; cut without it.
- **`cli/duo` binary diff is huge.** Expected if `cli/duo.ts` changed. Unexpected if not — usually means esbuild's bundling decided to reorder modules. The binary is deterministic; if `cli/duo.ts` is unchanged and the binary diff is non-trivial, something's wrong. Inspect.
- **Sidecar / sync drift.** `npm run sync:claude` copies the *current* `skill/SKILL.md` to `~/.claude/skills/duo/SKILL.md`. If a prior cut forgot the sync, the live skill on disk is stale. The skill itself doesn't surface that mismatch — the user finds it next time the agent does the wrong thing. Always run `sync:claude` even if you don't think `skill/` changed (cheap insurance).
- **`Pending — not yet cut` stash forgotten.** When a cut goes through, MUST clear the stash items that folded into the cut. Otherwise next proposal double-counts them.

---

## Cross-references

- `CHANGELOG.md` — the inventory.
- `docs/RELEASES.md` — the prose log + pending stash.
- `docs/dev/session-log.md` — the running session-by-session log; mine for prose during Step 1.
- `tasks.md` — bugs / FOLLOWUPs; mine for fixes during Step 1.
- `docs/roadmap.html` / `ROADMAP.md` — stage status; mine for "what flipped" during Step 1.
- `~/.claude/duo/help/faq.html` — FAQ surface; update during Step 4.5.
- `~/.claude/duo/help/what-duo-does.html` — capability reference; update during Step 4.6.
- `CLAUDE.md` — project conventions, including the trigger rule that primes Claude to use this skill.
