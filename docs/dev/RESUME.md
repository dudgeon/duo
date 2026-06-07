# Resume after compaction — a+b bug/LHF sprint (branch `amazing-goodall-39846b`): 6/8 built, BUG-093 blocked

**🛑 READ FIRST (2026-06-07).** This branch (`claude/amazing-goodall-39846b`, 15 commits) shipped **ENH-113** (the "file removed on disk" strip + a **Close tab** button on markdown/canvas/JSON + the split-view aux pane — done + live-tested) and ran the **a+b bug/LHF sprint**. The live tally is in [`active-sprint.md`](active-sprint.md); per-item detail in [`tasks.md`](../../tasks.md).

- **a+b sprint — 6 of 8 built.** ✅ verified live: BUG-197, FOLLOWUP-031, FOLLOWUP-033, FOLLOWUP-036, BUG-157. 🟡 built + **owner smoke-walk owed**: BUG-100 (aux Send→Duo pill — typecheck-clean; needs a live-Claude terminal + a text selection in the split-view aux pane to confirm the pill). ↗ **handed off**: ENH-198 → posted as a comment on **PR #74**; that agent applies the CriticMarkup steer. ⛔ **NOT done**: BUG-093 (Move-to-Split-View crash) — its PRD requires a computer-use crash repro that can't be driven on the dev Electron.
- **⚠️ PR #74 ("feat(ENH-203): overhaul the bundled duo skill", branch `claude/mystifying-meitner-0c854f`) is OPEN and rewrites the entire skill.** Do NOT edit `skill/SKILL.md`, `agents/duo.md`, `cli/duo.ts`, `CLAUDE.md`, or `docs/CLI-COVERAGE.md` on this branch — instant conflict (that's why ENH-198 was handed off via PR comment). **`tasks.md` WILL conflict with #74** (both edit it heavily); my ENH-203 was renumbered → **ENH-206** to yield 203 to #74.
- **⚠️ Computer-use CANNOT reach the dev Electron** this session (`request_access` won't resolve `com.github.Electron` / "Electron"). Verify UI via `duo dom --js` (renderer shell) + `duo eval` (browser pane) DOM probes, NOT screenshots. This is why BUG-093's repro + BUG-100's live pill check need the owner's hands.
- **Backlog hygiene done:** 7 feature PRDs authored (`docs/prd/`), stale-sweep closed 35 already-shipped entries (open 80→45), ENH-191 nag muted + about-duo screenshots split to ENH-204, **ENH-205 filed** (the *real* per-tab MaxListeners leak — 10 IPC channels; FOLLOWUP-031 only fixed claude-presence, which wasn't even the culprit). **ENH-157: the owner DECLINED it at sprint planning — do NOT raise it again.**
- **Dev build:** running the worktree 0.9.2 build (the `duo doctor` 0.9.1-CLI "mismatch" is cosmetic). `node_modules` is a **symlink to the main checkout's** (created this session for typecheck/vitest — untracked; never `git add -A`). Launch dev via `node /Users/geoffreydudgeon/Documents/GitHub/duo/node_modules/electron-vite/bin/electron-vite.js dev`. **`window.location.reload()` crashed this worktree dev build (socket dies) — avoid it; restart fresh instead.**
- **Lesson this session:** I overclaimed FOLLOWUP-031's "warning gone" and caught it by verifying on a fresh log. Verify before claiming; for UI, a DOM probe / regression test beats "typecheck passed."

---

⬇ _Below is the prior ENH-195 / v0.9.1 cycle (a DIFFERENT branch, `sharp-hamilton-70eb87`) — superseded context, kept for reference._

# Resume after compaction — ENH-195 + ENH-197 + BUG-195 COMPLETE, submitted as a PR (owner integrates on main)

**🛑 READ FIRST — current state:**
ENH-195 (CLI edits / disk-sync / false-positive conflicts) is **complete, validated, and submitted as a PR** from branch `claude/sharp-hamilton-70eb87` for the owner to integrate (version label + merge with other branches) on `main`. Per-item detail is in [`tasks.md`](../../tasks.md) (ENH-195 / ENH-197 / BUG-195 / ENH-198). One-paragraph version:

- **Shipped + verified this cycle:** the shared `useDiskReconciliation` hook (markdown + canvas + JSON), D3 markdown change-highlight, 3 verbs (`duo status` / `doc edit` / `json set|merge`), B2–B7 responsiveness, warn-hook + guidance — PLUS the four follow-on fixes that landed AFTER the local v0.9.0 cut: **(1) canvas false-positive fix** (the old blocker — `shouldBannerOnClean` now compares the byte-exact disk baseline, not the ID-injected serialized view; root-caused by a 4-lens workflow, regression-tested, verified live); **(2) ENH-197 "View diff"** (a destructive (>50%) external reload now offers **Keep mine / Load new / View diff**, where View diff rebuilds the doc as accept/rejectable tracked changes via the existing CriticMarkup rail — block-LCS so it reads clean, not char-soup; round-trip tested, verified live all 3 buttons); **(3) BUG-195** (`split-view close` orphaned the aux browser WebContentsView → ghost; the renderer close/promote handlers now call `releaseAuxTab()` unconditionally so a reload-stale ref can't skip the reconcile; verified live); **(4)** the strip-JSX strips + frontmatter-preserve (verified). **923 tests, both typecheckers clean.** v0.9.1-rev2 smoke walk: **VIEW-DIFF + WARN-HOOK both PASS.**
- **Git:** branch `claude/sharp-hamilton-70eb87` carries `f6e1b36` (release: v0.9.0) → `915af34` (bump v0.9.1) → this session's fix commits. **Owner decides the version label + does the push/release on main** (the local `v0.9.0` tag predates the four fixes).
- **Tracked for later:** ENH-196 (canvas change-highlight parity), ENH-198 (agent-native CriticMarkup track-changes — agents wrote `<ins>` tags instead of CriticMarkup), the FOLLOWUP-031..040 polish queue below.
- **Dev-build note:** the worktree has no local `node_modules`; launch dev via `node /Users/geoffreydudgeon/Documents/GitHub/duo/node_modules/electron-vite/bin/electron-vite.js dev` (≡ `npm run dev`). `duo eval` targets the BROWSER pane; `duo dom --js` the renderer shell. Smoke walks run in the **split-view aux** (owner's workflow — see the updated `.claude/skills/smoke-walk/SKILL.md`).

**v0.8.4 released; v0.8.5 in-flight** (as of 2026-05-31). Sprint 23/24 — ENH-182 (project rail) plus the v0.8.0-era FOLLOWUP-031..040 polish wave — shipped across v0.8.0–v0.8.4.

**Current initiative:** the docs deep-clean (ENH-191) on branch `fix/cli-version-and-docs-cleanup` — a CLI/app version-source fix (`duo --version` + doctor now derive from `package.json`) plus a full project-docs audit executed decision-by-decision. **Current-sprint scope lives in [`active-sprint.md`](active-sprint.md)**; the next *feature*-sprint goal + cut target is **TBD — owner to confirm.**

## Current sprint scope

Lives in **[`active-sprint.md`](active-sprint.md)** — the running scratchpad owns the prioritized scope so it does not drift across two files. Open engineering work is in [`tasks.md`](../../tasks.md) (97 open entries; harvest with the `sprint-plan` skill). The next feature-sprint goal + cut target is TBD pending owner direction.

## Critical guardrails for the next agent

These are failure modes hit during recent sessions. Read before touching the codebase.

### 1. macOS Optimize Storage eviction (Sprint 22 emergency, now guarded)

**Trap.** If `~/Documents` is in iCloud Drive and "Optimize Mac Storage" is ON, macOS will silently evict tracked files locally under disk pressure. The file's metadata still claims a non-zero size but the bytes are gone (`dataless` BSD file flag).

**Symptoms.** `git status` → "short read while indexing"; vitest → "Unexpected end of JSON input" on stub package.json files; `git rev-parse HEAD` → "ambiguous argument 'HEAD'"; `git cat-file -e` → exit 138 (SIGBUS) on partially-materialized packfile.

**Guard.** `predev` / `pretest` npm hooks run `bash scripts/check-materialization.sh --quiet || true` so each `npm run dev` warns once if anything is dataless. Recovery is `npm run materialize` (force-reads files to trigger iCloud download + `git checkout HEAD --` for files iCloud can't return).

**Recovery shortcuts when the guard fails:**
- `defaults write com.apple.bird optimize-storage -bool false` + `killall bird` to stop further evictions.
- For files iCloud can't return: `rm <file> && git checkout HEAD -- <file>` (the cloud-stub must be deleted before git can write).
- `.git/refs/heads/main` empty? Reconstruct from `.git/logs/HEAD` reflog tail.
- node_modules largely dataless? `rm -rf node_modules && npm install` is faster than per-file iCloud download.

Full doc at [`CLAUDE.md § Build commands`](../../CLAUDE.md).

### 2. Promise-cancel-on-cleanup destroys async cache hooks

If you write a hook that does "async probe → merge into Map state" and the host re-renders often, do NOT set `cancelled = true` in the useEffect cleanup. The cleanup fires on every re-render → cancels the in-flight promise → setState never happens → cache stays empty forever. The setState merge is idempotent for stable probe results, so stale-closure resolutions after re-render are safe. Pattern lives in `renderer/hooks/useProjects.ts` with a comment.

### 3. ENH-182 home-dir exclusion (owner directive)

D2 says "marker = CLAUDE.md or .claude/". The exclusion bars ONLY `$HOME` itself + `/`; subdirs qualify normally. See `shared/projects.ts § isExcludedFromQualification` + the three `~/.claude editing scenario` tests in `core/projects-service.test.ts`.

### 4. Always invoke `/smoke-walk` via the Skill tool (CLAUDE.md § 7b)

Hard rule. Don't run `.claude/skills/smoke-walk/generate.mjs` directly. The skill's procedural steps (renderer reload, surface re-probe, pref reset, agent-walks-CLI-items) are not in the generator script.

### 5. Renderer reload after dev restarts

After any `npm run dev` kill+spawn cycle, run:
```bash
duo dom --js 'window.location.reload()'
sleep 3
until duo dom --js 'typeof window.electron?.session' 2>&1 | grep -q object; do
  sleep 1
done
```

### 6. Computer-use access at session start for UI work (CLAUDE.md § 7e)

If the session has any meaningful UI work on the table (renderer/, TipTap, CSS, keyboard, modals, etc.), call `request_access` with `applications: ["com.github.Electron"]` (bundle id; the display name "Electron" sometimes fuzzy-matches wrong) BEFORE writing code. The app name is **the dev target Electron**, NOT "Duo" (which resolves to the packaged `.app` in /Applications).

**v0.8.0 lesson learned:** pre-walking owner-judgment smoke-walk items via computer-use (real mouse/keyboard + screenshots + worksheet "Mark all Pass" + Copy results) eliminated the owner-walk-then-fix iteration cycle entirely. Standard play for v0.8.x cuts that touch UI surfaces.

### 7. Verify the artifact BEFORE filing fixes from verbal symptom reports

A verbal "looks broken" report can be misleading. Check the actual artifact (file on disk, JSONL entry, network response, DOM probe) and confirm the broken behavior is real before designing a fix. Memory: [feedback_verify_current_behavior_before_proposing_fix.md](.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_verify_current_behavior_before_proposing_fix.md).

### 8. ENH-182 hook-point lesson (Phase 3c iteration)

When designing an effect that fires on user-intent ("opening a file"), hook off the state that captures intent (`activeWorking`), not the state that captures the side effect (`tabMembership` identity change). The first iteration of Phase 3c hooked off `tabMembership` and missed reactivations of existing tabs (no fileTabs change → no membership change → no effect). Second iteration hooks off `activeWorking` and catches both new-file opens AND reactivations.

**Sprint 24 corollary:** FOLLOWUP-031 (claudePresence listener hoist) needs the same care. The natural shape is "context provider at App.tsx → consume via useContext in TerminalPane." Don't introduce a new state-change-cascade pattern.

### 9. DMG version drift trap (Sprint 22 v0.7.10 cut)

`scripts/dist-signed.sh` reads `package.json § version` AT PACKAGING TIME, not at script start. If you bump `package.json` while a background `dist-signed.sh` is mid-run, the DMG filename + Info.plist `CFBundleShortVersionString` come out with the BUMPED version, not the cut version. Sequence:
1. Cut commit + tag at the cut version.
2. Build DMG (synchronous wait OR confirmed complete via `ls dist/` before bumping).
3. THEN bump `package.json`.

### 10. Spec FOLLOWUPs at filing time, not implementation time (Sprint 24 starting rule)

When the audit agent surfaces a follow-up worth filing, capture the proposed fix sketch + an effort estimate IN THE TASK ENTRY (not just "there's a bug"). The Sprint 24 starting state has every FOLLOWUP-031 through 040 documented with file:line refs + fix sketches + effort estimates because that's what makes them tractable a week later. Tasks that say "the X feels slow" without instrumentation guidance become the carry-forward queue's BUG-079s — they sit unaddressed for sprints because picking them up requires re-doing the investigation. Filing-time discipline → implementation-time ease.

### 11. Sprint 23 v0.8.0 pattern — background audit as cheap insurance

The v0.8.0 capstone shipped 4 BUGs fixed that the smoke walk missed entirely. A background `general-purpose` agent reviewed the code in parallel with my implementation work for ~10 minutes and surfaced 13 issues (4 critical enough to fold in pre-cut; 9 deferred). Cost: one agent invocation. Benefit: caught a chained-bug in FOLLOWUP-030's design that would have shipped as user-visible disorientation. **Repeat the pattern for any sprint with non-trivial code changes** — fire the audit at smoke-walk time, while the user does owner-judgment walk; reconcile findings before cut. The Sprint 24 polish wave should still do this (even though changes are small) because the cross-effect interactions are exactly what the audit catches.

## State at-a-glance

- **Latest release:** **v0.8.4** (tagged). **Package version: v0.8.5** (in-flight).
- **Active branch:** `fix/cli-version-and-docs-cleanup` (docs deep-clean ENH-191; several commits ahead of `main`, not yet pushed). `main` is at the v0.8.5 bump.
- **Git status:** run `git status` — verify before assuming clean.
- **Verify versions:** `duo doctor` should read `0.8.5 (matches)` against a current build (CLI + app both derive the version from `package.json` after the ENH-191 fix).
- **Disk free:** `df -h ~`; if under ~40 GB run `npm run check:materialization` proactively (iCloud trap — see guardrail § 1).

## What NOT to do

- **Don't re-cut v0.8.4.** It's the latest release; the next cut target (PATCH v0.8.x vs MINOR v0.9.0) is owner-TBD.
- **Don't bypass the materialization check.** When `predev` warns, run `npm run materialize` before continuing.
- **Don't toggle `optimize-storage` back to `1`.** It's currently OFF — that's the protective default.
- **Don't bump package.json during a background DMG build.** See guardrail § 9.
- **Don't implement owner-decision-gated items without input** — see the standing-decisions table in [`active-sprint.md`](active-sprint.md).
- **Don't skip the background audit at smoke-walk time** (per guardrail § 11). Even small sprints benefit.

## Quick orientation commands

```bash
# Confirm everything is current
git log --oneline -5
duo doctor
cat package.json | grep version
ls -lh dist/Duo-*.dmg
bash scripts/check-materialization.sh

# Read sprint state
cat docs/dev/active-sprint.md

# See the latest released cut
gh release view v0.8.4

# List released DMGs (if present)
ls dist/Duo-*.dmg
```

## Starting move

Read [`active-sprint.md`](active-sprint.md) for the current initiative + scope, then [`tasks.md`](../../tasks.md) for open work. If picking up the docs deep-clean (ENH-191), the decision playground at `docs/research/docs-deep-clean-decisions.html` drives the remaining items.

Welcome aboard.
