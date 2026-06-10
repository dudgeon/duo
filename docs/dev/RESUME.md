# Resume after compaction — ENH-208 Vault: Phase 1 SHIPPED + Phase 2 in flight (v0.10.0 released)

**🛑 MOST RECENT — current initiative (2026-06-09): ENH-208 "vault".** Phase 1
(skill-first slice) is **COMPLETE + on `main`** — the `duo vault` / `graph` /
`base` CLI cluster, the `skill/references/vault.md` agent how-to, and the
10-chapter Vault Guide (`docs/guide/vault-guide.html`) — PRs #83 #84 #85 #86.
Phase 2 (capture UX) is **started**: #87 (`duo vault default` + default-vault
pref) and #88 (the `@today` smart-token model + `duo vault stub` / D19 filing
model) merged. **Remaining = renderer/keyboard UI** (Settings picker · ⇧⌘N chord ·
⌘⇧F palette · `@today` AtMention wiring · silent-stub type-picker) — each needs a
dev build + an **owner smoke-walk** per PR (NOT auto-mergeable); tasks #6–#10; the
`enh-208-vault` worktree is parked for them. No version cut yet (owner holding for
some UI, then likely v0.11.0). Full detail: top of `active-sprint.md` + the
2026-06-09 `session-log.md` entry. PRD: `docs/prd/enh-208-vault.md`. The
ENH-191 detail below remains valid history.

---

**🛑 PRIOR — ENH-191 multi-window SHIPPED (v0.10.0), current state (2026-06-08):**
ENH-191 **multi-window is SHIPPED in v0.10.0** (tagged 2026-06-08, signed + notarized, 1119 tests green). Window 2 is **real and functional** — File → New Window (⌥⌘N) or `duo window new` opens a BLANK second window (does NOT clone window 1's pins — NFR-6.2). Each window owns its workspace/browser/navigator/terminals/geometry, all restored across relaunches (N-window restore, ascending-id). Gated by an **"Allow Multiple Windows"** setting (Settings menu), **default ON**; when OFF the New Window item is disabled, `duo window new` exits non-zero, and only window 1 restores. Cross-window CLI is live: every Duo terminal carries `DUO_WINDOW`; `duo --window N <verb>` addresses window N (stale id → primary fallback); `duo windows` lists `[{id, primary, focused, activeWorkspace}]`; `duo doctor` reports the live window count. Session file is now `{version:2, windows:[...]}` (lossless forward-migration + one-time `.v1.bak`; downgrade boots empty gracefully; byte-identical at N=1). Default app-level resolution is by IDENTITY (lowest-id primary), never focus.
- **Also shipped v0.10.0:** **ENH-204** (#79) — a new terminal opened outside the focused project reverts the rail filter to "All". **ENH-207** (#81) — drag a navigator file/folder onto the terminal column inserts absolute POSIX-quoted path(s) at the cursor.
- **Live follow-ups (next agent's queue):** **PR #80** (P1 per-request-window-target concurrency-interleaving test + 4 P3 edges), **FOLLOWUP-043** (drag onto a COLLAPSED rail spawns a tab instead of inserting), **BUG-198** (screenshot). Per-item detail in [`tasks.md`](../../tasks.md).

**🛑 PRIOR-CYCLE CONTEXT (ENH-195 / ENH-197 / BUG-195 — all landed pre-v0.10.0):**
ENH-195 (CLI edits / disk-sync / false-positive conflicts) is **complete, validated, and submitted as a PR** from branch `claude/sharp-hamilton-70eb87` for the owner to integrate (version label + merge with other branches) on `main`. Per-item detail is in [`tasks.md`](../../tasks.md) (ENH-195 / ENH-197 / BUG-195 / ENH-198). One-paragraph version:

- **Shipped + verified this cycle:** the shared `useDiskReconciliation` hook (markdown + canvas + JSON), D3 markdown change-highlight, 3 verbs (`duo status` / `doc edit` / `json set|merge`), B2–B7 responsiveness, warn-hook + guidance — PLUS the four follow-on fixes that landed AFTER the local v0.9.0 cut: **(1) canvas false-positive fix** (the old blocker — `shouldBannerOnClean` now compares the byte-exact disk baseline, not the ID-injected serialized view; root-caused by a 4-lens workflow, regression-tested, verified live); **(2) ENH-197 "View diff"** (a destructive (>50%) external reload now offers **Keep mine / Load new / View diff**, where View diff rebuilds the doc as accept/rejectable tracked changes via the existing CriticMarkup rail — block-LCS so it reads clean, not char-soup; round-trip tested, verified live all 3 buttons); **(3) BUG-195** (`split-view close` orphaned the aux browser WebContentsView → ghost; the renderer close/promote handlers now call `releaseAuxTab()` unconditionally so a reload-stale ref can't skip the reconcile; verified live); **(4)** the strip-JSX strips + frontmatter-preserve (verified). **923 tests, both typecheckers clean.** v0.9.1-rev2 smoke walk: **VIEW-DIFF + WARN-HOOK both PASS.**
- **Git:** branch `claude/sharp-hamilton-70eb87` carries `f6e1b36` (release: v0.9.0) → `915af34` (bump v0.9.1) → this session's fix commits. **Owner decides the version label + does the push/release on main** (the local `v0.9.0` tag predates the four fixes).
- **Tracked for later:** ENH-196 (canvas change-highlight parity), ENH-198 (agent-native CriticMarkup track-changes — agents wrote `<ins>` tags instead of CriticMarkup), the FOLLOWUP-031..040 polish queue below.
- **Dev-build note:** the worktree has no local `node_modules`; launch dev via `node /Users/geoffreydudgeon/Documents/GitHub/duo/node_modules/electron-vite/bin/electron-vite.js dev` (≡ `npm run dev`). `duo eval` targets the BROWSER pane; `duo dom --js` the renderer shell. Smoke walks run in the **split-view aux** (owner's workflow — see the updated `.claude/skills/smoke-walk/SKILL.md`).

**v0.10.0 released (2026-06-08); v0.10.1-dev in-flight.** ENH-191 multi-window (P5a/P5b, PRs #73 + #78) plus ENH-204 (#79) + ENH-207 (#81) shipped in v0.10.0.

**Current initiative:** v0.10.1-dev — drain the ENH-191 follow-up queue (**PR #80** P1/P3 edges, **FOLLOWUP-043**, **BUG-198**) and whatever the owner prioritizes next. **Current-sprint scope lives in [`active-sprint.md`](active-sprint.md)**; the next *feature*-sprint goal + cut target is **TBD — owner to confirm.**

## Current sprint scope

Lives in **[`active-sprint.md`](active-sprint.md)** — the running scratchpad owns the prioritized scope so it does not drift across two files. Open engineering work is in [`tasks.md`](../../tasks.md) (harvest with the `sprint-plan` skill). The next feature-sprint goal + cut target is TBD pending owner direction.

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

- **Latest release:** **v0.10.0** (tagged 2026-06-08, signed + notarized). **Package version: v0.10.1-dev** (in-flight).
- **Active branch:** `main` — ENH-191 multi-window merged via PRs #73 + #78; ENH-204 (#79) + ENH-207 (#81) merged.
- **Git status:** run `git status` — verify before assuming clean.
- **Verify versions:** `duo doctor` should read the current version `(matches)` against a current build (CLI + app both derive the version from `package.json`) and report the live **window count** ("Windows: N").
- **Disk free:** `df -h ~`; if under ~40 GB run `npm run check:materialization` proactively (iCloud trap — see guardrail § 1).

## What NOT to do

- **Don't re-cut v0.10.0.** It's the latest release; the next cut target (PATCH v0.10.x vs MINOR v0.11.0) is owner-TBD.
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
gh release view v0.10.0

# List released DMGs (if present)
ls dist/Duo-*.dmg
```

## Starting move

Read [`active-sprint.md`](active-sprint.md) for the current initiative + scope, then [`tasks.md`](../../tasks.md) for open work. If draining the ENH-191 multi-window follow-up queue, start with **PR #80** (P1 per-request-window-target concurrency test + P3 edges), **FOLLOWUP-043** (drag onto collapsed rail), and **BUG-198** (screenshot).

Welcome aboard.
