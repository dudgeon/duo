# Resume after compaction — Sprint 24 / v0.8.6 (ENH-195 CLI-edits / disk-sync)

**Read this first.** Then in order:

1. [`docs/dev/active-sprint.md`](active-sprint.md) — Sprint 24 starting scope + tiered FOLLOWUP queue + Tier 3 design-decision pendings.
2. [`CLAUDE.md`](../../CLAUDE.md) § Active sprint — same content, shorter form.
3. [`tasks.md`](../../tasks.md) — running ledger. Sprint 24 section at the top; Sprint 23 closed with v0.8.0 commit map.

## Where we are

**In flight — ENH-195 (CLI-edits / disk-sync).** The dev line is on **v0.8.6** and ENH-195 is the active in-flight chapter on branch `claude/sharp-hamilton-70eb87`. Scope: three new CLI edit verbs (`duo status`, `duo doc edit`, `duo json set`/`merge`), a shared `useDiskReconciliation` hook (extracted across markdown editor + canvas + JSON/YAML viewer — see DECISIONS.md § "Editor / canvas convergence" ENH-195 D5 amendment), read-only viewer watchers, and a `DUO_SESSION`-gated PreToolUse warn hook that fires when an agent `Edit`/`Write`s a file open in Duo. Locked decisions live in [`tasks.md` § ENH-195](../../tasks.md) + the decision playground [`docs/research/enh-195-cli-edits-disk-sync.html`](../research/enh-195-cli-edits-disk-sync.html). The FOLLOWUP-031..040 polish queue below is the prior Sprint 24 chapter — still open, lower priority than ENH-195.

**v0.8.0 shipped + released** (2026-05-25). [GitHub Release](https://github.com/dudgeon/duo/releases/tag/v0.8.0) live with signed-notarized DMG attached. The ENH-182 capstone (project-as-filter-layer) is feature-complete: rail + focus filter + lifecycle/menu + auto-switch + CLI parity + browser-tab filter + ENH-184 workspace pill defeaturing + 4 audit-found BUGs folded in. Dev bumped to **v0.8.1**.

**Sprint 24 is a focused polish wave.** Goal: close the v0.8.0 audit's deferred follow-ups (FOLLOWUP-031 through 040) before any new feature work. The ENH-182 capstone was the marquee chapter; Sprint 24 is its polish epilogue.

## Sprint 24 starts here

### Definition of done

All 10 v0.8.0-era FOLLOWUPs (031–040) closed OR explicitly deferred-with-reason. Tier 1 + 2 are the must-close items; Tier 3 are owner-decision-gated and may stay open.

### Tier 1 — Bundle into one polish commit (~1 hour)

These are 1-line / 5-line fixes; the smoke walk can cover them all as a single rev. Bundle as `chore(v0.8.x-polish): tier-1 followup cleanup`.

- **FOLLOWUP-035** — `handleProjectFocus` dead-code probe. Verify the use site at `renderer/App.tsx` ~901; remove if confirmed dead. **5 min.**
- **FOLLOWUP-036** — Focus-release chip aria-label polish. `renderer/App.tsx` ~3545 reads "Focused: duo, button, Release focus (duo)" via screen reader — repetitive. Drop visible-text from aria-label OR simplify to "Release focus." **5 min.**
- **FOLLOWUP-038** — `useWorkspacePillMenuFlag` TS narrowing of `'key' in event` ambiguous between StorageEvent + CustomEvent with `key` field. Practically benign (we dispatch bare CustomEvent); add a code comment explaining intent + acknowledging the narrowing edge case. **5 min.**
- **FOLLOWUP-040** — Smoke-walk item: with `duo workspace-pill-menu off`, exercise `File → New Workspace` to verify the menu handler still works post-ENH-184 defeaturing. Add to next smoke walk manifest. **5 min.**

### Tier 2 — Single-feature commits (~30–60 min each)

In priority order (highest user-impact first):

- **FOLLOWUP-031** — `MaxListenersExceededWarning` on `terminal:claude-presence-changed` (11/10 listeners). Pre-existing; not new with v0.8.0. Each `useClaudePresence` hook mount registers a listener; with many terminal tabs the count exceeds Node's default 10-listener warning threshold. Fix: hoist subscription to App.tsx + push state via React context (matches `useFrontTerminalClaudeLive` pattern). Eliminates per-TerminalPane listener. **~30 min.** **Biggest user-facing impact** — eliminates a warning that fires routinely in normal use.
- **FOLLOWUP-032** — Double `duo project close` race. Two parallel CLI calls send two `PROJECTS_CLOSE_REQUEST` events; `handleCloseProject` runs twice; second invocation reads stale `projectCounts.get(root)`; stacks two confirm dialogs if claude-kind. Fix: gate on `inFlightCloseRef.current.has(root)` in `handleCloseProject`. **~20 min.** Low user-impact (rare CLI race) but easy fix.
- **FOLLOWUP-033** — `duo project list` returns empty silently during 1–2s renderer-boot window. Renderer hasn't pushed first snapshot; main returns empty default — indistinguishable from "no projects open." Fix: add `ready: boolean` to `ProjectsStateSnapshot`; renderer flips to true on first push. CLI emits "renderer not yet ready" warning when false (or blocks until ready, owner decision). **~30 min.**

### Tier 3 — Design-gated (ASK owner before doing)

These need quick owner decisions. **Don't implement without input.**

- **FOLLOWUP-034** — Rail-color rotation past 6 projects. PRD R2 says "rotate shade variants past 6" but didn't specify the shape. 50% collision probability at 4 projects (birthday paradox; P(no collision, N=4, K=6) ≈ 0.278). **Owner decision:** what's the shade variant rule? Lighter / darker / saturation shift / overlay marker?
- **FOLLOWUP-037** — `useProjects` probe-after-delete cache invalidation. If a pinned project's marker is deleted out-of-Duo mid-session, `markerResults` cache shows `true` → ghost tile persists. Documented limitation today. **Owner decision:** invalidate via fs.watch? Invalidate on focus change? Drop cache periodically? Or leave as-is?
- **FOLLOWUP-039** — Cross-window race on `duo workspace-pill-menu`. No multi-window today; future-proofing. **Owner decision:** defer until multi-window ships, or pre-emptively use `BroadcastChannel`?

**Default direction if owner unavailable:** defer all three (none user-blocking).

### Sprint-close carry-forward (pick 1-2 if Tiers 1+2 land fast)

In descending priority:

1. **BUG-079** — Ctrl-Tab cycle latency. Sprint 22 walk-1 gave a known-good repro (focus on duo with 1 visible terminal). Sprint 17 instrumentation established total renderer-keydown → switchTab return ≈ 15ms. Hypotheses: modifier release timing, upstream consumer race. Instrumentation step needed.
2. **ENH-128 walk-4** — HEIC drag-drop verification. Owner-walked only (no code). Closes image-handling cluster.
3. **ENH-162** — Clone modal destination-collision UX. ~30 min design + impl.
4. **ENH-148 v2** — Multi-select v2 (⇧-click range + ⌘-A + CLI parity). Bigger; could anchor a MINOR.

### Out of scope (don't pull in)

BUG-093 (no repro) · BUG-122 (needs next-repro log) · ENH-084 v4 (owner walk needed) · ENH-127 (owner declined) · ENH-137 (owner-draft pending) · ENH-141 (cross-machine test) · ENH-157 (medium-architectural; design pending) · FOLLOWUP-021 (edge case) · BUG-024 (stale; re-triage first) · 17a.5 template gallery (big chunk) · Backlinks/graph view (anchor of its own sprint) · GH-CLUSTER-PROTO gate (owner-decision required).

### Expected cut shape

- **v0.8.1 (PATCH)** — Tier 1 + Tier 2 only land. Polish-only release.
- **v0.9.0 (MINOR)** — Tier 1+2 + a coherent capability (ENH-148 v2 multi-select OR ENH-162 Clone modal) lands alongside.

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

- **Branch:** `main` at [`e80c508`](https://github.com/dudgeon/duo/commit/e80c508) (chore: bump to v0.8.1). Pushed to origin.
- **Tags:** `v0.8.0` on `e30adf1` (pushed to origin).
- **Git status:** working tree clean.
- **Package version:** 0.8.1 (dev). Cut targets: v0.8.1 PATCH (polish-only) or v0.9.0 MINOR (capability bundle).
- **Pack version:** `packs/duo-default/PACK.json § version` is 1.0.15 (bumped during v0.8.0 cut; existing users see "What's new" prompt covering project menu / `duo project` CLI / browser-tab filter / passive workspace pill).
- **dist/:** `Duo-0.8.0-arm64.dmg` (104 MB, signed + notarized + stapled + launch-validated) + prior v0.7.10 + v0.7.9 safety nets.
- **GitHub Release:** https://github.com/dudgeon/duo/releases/tag/v0.8.0 — live, DMG attached.
- **Disk free:** check `df -h ~`. If lower than 40GB, run `npm run check:materialization` proactively (iCloud trap.)

## What NOT to do

- **Don't re-cut v0.8.0.** It's tagged + released. Next cut is v0.8.1 (PATCH) or v0.9.0 (MINOR).
- **Don't bypass the materialization check.** When `predev` warns, run `npm run materialize` before continuing.
- **Don't toggle `optimize-storage` back to `1`.** It's currently OFF — that's the protective default.
- **Don't bump package.json during a background DMG build.** See guardrail § 9.
- **Don't implement Tier 3 FOLLOWUPs (034, 037, 039) without owner input.** They're design-gated.
- **Don't pull in carry-forward items beyond 1-2.** Sprint 24 is a focused polish wave; resist scope creep.
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

# See the released cut
gh release view v0.8.0

# Verify the released DMG opens cleanly
open dist/Duo-0.8.0-arm64.dmg
```

## Sprint 24 starting move

**Recommended first commit:** Tier 1 cleanup bundle. FOLLOWUP-035 + 036 + 038 + 040 in one `chore(v0.8.x-polish): tier-1 followup cleanup` commit. ~1 hour. Gets the trivial-but-tracked items off the board so the FOLLOWUP-031 hoist (the meaty Tier 2 piece) gets undivided attention.

Welcome aboard.
