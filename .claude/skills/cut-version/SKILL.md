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

### Step 0 — Scan for open 🟡 owner-decision gates (HARD BLOCK)

**Before drafting notes, anything else — scan `tasks.md` for `🟡 Awaiting`
status entries.** These are owner-decision gates (PRDs converted to
playgrounds per CLAUDE.md § 11) that block the cut.

```bash
grep -B1 "Status:\*\* 🟡 Awaiting" tasks.md
```

**If any 🟡 gates exist:**
- **STOP.** Do not draft notes; do not propose the cut.
- Report each gate's playground path to the user.
- Tell the user: "Cut blocked — N owner-decision gates open. Walk each playground in Duo (`duo open <path>`), copy decisions back, then I'll implement + we cut."
- If user explicitly overrides ("cut anyway, defer these gates to next version"), accept — but warn that the v2 work is now deferred.

**Why this gate exists.** Owner-decision PRDs without playground gates
historically got lost across sprints (ENH-110 was deferred 3 sprints
as a markdown PRD; the moment it became a playground, decisions
landed in one session). The 🟡 status is the forgetting-protection
structure — the cut-version skill is the enforcement point.

### Step 1 — Draft release notes (the litmus test)

This is the load-bearing step. Draft notes BEFORE bumping anything,
running anything, or touching git. The notes are what the user sees
to decide whether the cut should happen.

Pull from these sources, in order:

1. `docs/dev/session-log.md` — most recent sessions since the last cut. The prose-y narrative; mine for "what shipped + why."
2. `git log --oneline <last-tag>..HEAD` — actual commits. The auditable inventory.
3. `docs/roadmap.html` — canonical roadmap; stages that flipped to ✅ since the last cut.
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

# BUG-118 sanity-check — guard against committing a stale binary.
# v0.6.12 cut shipped a stale cli/duo missing ENH-130 --reveal handling
# because the prior commit's `git add cli/duo` captured a pre-rebuild
# copy. Fail the cut early if the freshly-rebuilt binary differs from
# what's in HEAD — owner re-stages and re-attempts.
git diff --quiet cli/duo || {
  echo "ERROR: cli/duo binary has uncommitted changes post-rebuild."
  echo "Run: git add cli/duo  (then re-attempt the cut)."
  exit 1
}

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
4. ~~`help/faq.html`~~ retired in v0.6.13 (ENH-135) — moved to `docs/legacy/faq.html`. The "What's new" log lives in `docs/RELEASES.md` (Step 3) and `CHANGELOG.md` (Step 2). Skip this step.
5. `packs/duo-default/canvases/what-duo-does.html` (in repo, NOT the `~/.claude/duo/packs/duo-default/canvases/` mirror copy) — for any newly-added capability, insert a numbered entry in the relevant category (Editor / Browser / Canvas / Files / Terminal / Capture-Send / Sessions / etc.). Use plain-English voice with the CLI invocation listed alongside as the "how." Logical ordering, NOT chronological. **Bump `packs/duo-default/PACK.json § version`** so the per-pack-version flag in `installed-packs.json` re-fires for existing users on next launch (ENH-138 — pack-version-bump is the v0.6.13+ replacement for the per-cut faq.html "What's new" surface).
6. `docs/roadmap.html` — flip stage statuses for anything that landed in this cut. Update the sidebar status counts. (Canonical roadmap; the prior synced-markdown view at `ROADMAP.md` was retired 2026-05-04.)
7. `docs/dev/session-log.md` — add a one-paragraph entry referencing the cut, the version, and what landed.

### Step 4.5 — Build the distributable DMG

Two paths. Pick by what's set up on the cutting machine.

#### Signed + notarized (Stage 21 ✅, default once cert is present)

```bash
bash scripts/dist-signed.sh
                                  # produces dist/Duo-X.Y.Z-arm64.dmg
                                  # signed + notarized + stapled,
                                  # validated end-to-end before exit
```

Sprint 7 (2026-05-05) — Duo ships **arm64-only** now. The Intel/x64
target was dropped from `electron-builder.yml`'s `mac.target.arch`
list. Apple Silicon is the only published architecture; Intel users
on Sequoia have moved on. If the universal/x64 case is ever needed
again, add `- x64` back to the yml's arch list and every downstream
piece (this skill, README, validators, release upload glob) honors
it without further changes.

End-to-end ~3–4 min on M1 (one notarization round-trip; previously
~5–8 min covered both archs). The script:

1. Sources cert + notarization env vars from
   `~/Documents/duo-private/.env` (`CSC_NAME`, `APPLE_API_KEY`,
   `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`).
2. Strips the `Developer ID Application: ` prefix off `CSC_NAME` if
   present (electron-builder rejects the keychain-canonical form).
3. Builds to `$DUO_BUILD_OUTPUT` (default `$HOME/.cache/duo-build`)
   instead of `dist/` — see "iCloud File Provider gotcha" below.
4. Runs `electron-builder -c.directories.output=$DUO_BUILD_OUTPUT`,
   which signs each binary with hardened-runtime + entitlements,
   notarizes via `xcrun notarytool`, and staples the ticket.
5. Copies signed DMGs back to `dist/` for the user.
6. Runs `scripts/validate-signed-dmg.sh`: `codesign --verify --deep
   --strict`, `spctl -a -t open --context primary-signature`,
   `xcrun stapler validate`. **Exits non-zero if any check fails.**

##### iCloud File Provider gotcha — why the script builds outside `dist/`

If the repo lives under `~/Documents/` (the macOS default for users
with iCloud Desktop & Documents sync), iCloud's file provider tags
directories inside Electron's helper bundles
(`Duo Helper (GPU).app`, `Duo Helper (Renderer).app`, etc.) with
`com.apple.FinderInfo`, `com.apple.fileprovider.fpfs#P`, and
`com.apple.fileprovider.dir#N` extended attributes within
milliseconds of creation. `codesign` then rejects helpers with:

```
resource fork, Finder information, or similar detritus not allowed
```

`xattr -cr` and `ditto --noextattr` strip the attrs but iCloud
re-applies them faster than the next `codesign` call can read the
file. Empirical proof: the same fresh helper binary fails to
codesign in `~/Documents/GitHub/duo/dist/` but succeeds when
copied to `/tmp/`.

**The script avoids this entirely** by directing electron-builder
at a non-iCloud path (`$HOME/.cache/duo-build`) and copying DMGs
back to `dist/` only after signing completes. Users who run the
build from a non-iCloud-touched repo location won't hit this, but
the redirect is harmless and makes the toolchain location-portable.

`com.apple.provenance` (which Sequoia adds to nearly every file)
is **NOT** the cause. It's harmless on its own; even files in
`/tmp/` carry it. Don't waste a session chasing it.

##### Failure modes

- **Hangs at "signing"** — keychain prompt fired and was missed.
  macOS pops "codesign wants to access key in keychain" the first
  time after a system reboot. Click **Always Allow** (Terminal
  may need to be foreground). FOLLOWUP-005 in tasks.md.
- **`resource fork, Finder information, or similar detritus not allowed`**
  — iCloud File Provider on the build path. The script's redirect
  prevents this; if you bypassed it (e.g. set `DUO_BUILD_OUTPUT`
  to a path inside `~/Documents/`), unset it and re-run.
- **`notarytool` returns "Invalid"** — read the JSON response in
  `/tmp/duo-stage21-signed.log`. Common causes: hardened runtime
  missing (yml's `mac.hardenedRuntime: true` should be set —
  confirm), entitlements file missing, helper unsigned (rare; an
  electron-builder bug if it happens). Apple's response includes a
  per-issue URL for the developer log.
- **`security find-identity -v -p codesigning` returns 0 valid
  identities** — cert expired or wrong keychain. Regenerate per
  `docs/dev/cert-procurement.md`. Developer ID Application certs
  are valid for ~5 years; check expiry.

#### Unsigned (fallback for users without certs)

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
                                  # produces dist/Duo-X.Y.Z-arm64.dmg
                                  # (arm64-only as of Sprint 7)
```

Skips signing entirely. End users see the macOS "Apple cannot check
this for malicious software" warning on first launch and need to
right-click → Open. Useful for: cutting a build without internet
access (no notarytool round-trip), contributors who don't have a
Developer ID Application cert, or quick local-test cuts.

The `CSC_IDENTITY_AUTO_DISCOVERY=false` override is required even
when no cert is present — without it, electron-builder errors if
the env var `CSC_NAME` happens to be set from a prior shell.

Output sanity check (either path):

```bash
ls -lh dist/Duo-*.dmg             # confirm a DMG with the new version
                                  # in its filename exists
```

##### Mandatory: launch-smoke validation

```bash
bash scripts/validate-dmg-launch.sh dist/Duo-X.Y.Z-arm64.dmg
                                  # static + dynamic checks. Mounts
                                  # the DMG, confirms the bundle has
                                  # app.asar.unpacked/node_modules/
                                  # with the required runtime
                                  # modules (node-pty, chokidar,
                                  # electron-updater), then opens
                                  # the .app and verifies the
                                  # process is alive past 8s.
                                  # Exits non-zero on failure.
```

**This step is non-negotiable.** It exists because v0.4.0–v0.4.3
shipped DMGs that crashed on launch with "Cannot find module
'node-pty'" — a bad `electron-builder.yml § files` config silently
excluded all node_modules from the bundle. The asar built fine, the
DMG packaged fine, codesign succeeded, notarization succeeded —
nothing in the build pipeline noticed. The only signal was the
end-user double-clicking the app and seeing an Uncaught Exception.

`scripts/validate-dmg-launch.sh` catches this class of bug at cut
time. Two layers:

1. **Static** — confirm `app.asar.unpacked/node_modules/` exists
   and contains every module in `REQUIRED_RUNTIME_MODULES` (top of
   the script). Cheap, deterministic, names the specific failure
   mode in the error message.
2. **Dynamic** — mount the DMG, `open` the .app, sleep 8s, confirm
   the main process is still alive. Catches anything else that
   crashes on startup (config typos, broken imports, missing
   entitlements, Sequoia bundle-validation regressions).

**When you add a new main-process production dep**, update
`REQUIRED_RUNTIME_MODULES` at the top of the script. That's the
only maintenance the validator needs.

If the validator fails, **abort the cut**. Don't push, don't
release, don't tag. Fix the root cause (almost always
`electron-builder.yml § files` or `electron.vite.config.ts`'s
`externalizeDepsPlugin` config), rebuild, re-validate.

Do NOT `git add dist/` — `dist/` is gitignored. The DMG is a build
artifact tracked outside the repo. Step 6.5 below uploads it to
GitHub Releases. A future cut shouldn't be considered "done" until
at least the local DMG exists AND the launch-smoke validator
passes — that's what proves the build pipeline still works
end-to-end.

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
git add CHANGELOG.md docs/RELEASES.md docs/roadmap.html \
        docs/dev/session-log.md package.json cli/duo \
        packs/duo-default/canvases/what-duo-does.html \
        packs/duo-default/PACK.json
        # Note: ENH-135 retired help/faq.html → docs/legacy/faq.html
        # (no longer cut-relevant). The What Duo Does + PACK.json
        # version bump replace the per-cut faq.html "What's new"
        # surface (ENH-138 — pack-version-bump fires the per-user
        # update via installed-packs.json on next launch).

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

The `dist/Duo-X.Y.Z*.dmg` glob is arm64-only as of Sprint 7 (single
file: `Duo-X.Y.Z-arm64.dmg`). The glob shape is preserved so a
hypothetical re-introduction of x64 (add `- x64` back to
`electron-builder.yml`) works without touching this command.

**Stage 21 ✅ — signed + notarized DMGs.** This step works unchanged
for both signed and unsigned cuts; the DMG glob doesn't care which
path Step 4.5 took. For signed cuts, mention `signed + notarized` in
the release notes so users know the "Apple cannot check this for
malicious software" warning is gone — first-launch is now a single
double-click.

**If `gh` isn't authenticated:** `gh auth status` first; `gh auth
login` to fix. Don't paper over it; an unauthenticated release call
fails silently in some shells.

### Step 7 — Bump `package.json` to the next in-progress version.

After the cut commit + tag are in, the next dev work shouldn't run
under the just-cut version's identity. Bump `package.json` to the
next likely MINOR (or PATCH if the next sprint is bug-only) and
commit it as a separate "chore: bump to vX.Y.Z-dev" commit.

```bash
# After cutting v0.5.3, bump for next sprint:
# Edit package.json: "version": "0.5.4"  (no -dev suffix needed —
# the dev build's titlebar already paints "·dev" via app.isPackaged).

git add package.json
git commit -m "$(cat <<'EOF'
chore: bump to v0.5.4 for next sprint

Post-v0.5.3 cut. Lets the dev build's titlebar version badge
correctly identify the in-progress work as v0.5.4 rather than
"still v0.5.3 in dev." Skipping this step makes smoke-walk
filenames (v0.5.4-rev*.json) and dev-build version mismatch,
which is confusing during a re-walk.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Why this matters.** Without the bump, dev builds run under the
just-cut version's identity. When mid-sprint smoke walks happen, the
walk page is named `vNEXT-rev*.html` but the dev titlebar still says
`v0.5.3 ·dev` — the user reasonably asks "am I walking the right
build?" and the answer is genuinely confusing. Bumping at cut time
makes "the badge matches the walk" the default, so the question
never surfaces.

If you're not sure whether next sprint is MINOR or PATCH, lean
MINOR. Re-bumping later is free; under-bumping leaves dev under the
wrong identity for a whole sprint.

### Step 8 — Stop. Report.

Show the user:
- The new (cut) version.
- One-line summary.
- The cut commit SHA + tag (local only — not pushed unless step 6.5
  ran).
- The bump commit SHA (Step 7).
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
- `docs/roadmap.html` — stage status; mine for "what flipped" during Step 1. (Canonical roadmap; the prior synced-markdown view at `ROADMAP.md` was retired 2026-05-04 — preserved historical fragments live at `docs/dev/roadmap-history.md`.)
- `packs/duo-default/canvases/what-duo-does.html` — capability reference; update during Step 4 item 5. Bump `packs/duo-default/PACK.json § version` afterwards so the per-pack-version flag re-fires for existing users.
- `docs/legacy/faq.html` — retired in v0.6.13 (ENH-135); kept for code reference only. No longer cut-relevant.
- `CLAUDE.md` — project conventions, including the trigger rule that primes Claude to use this skill.
