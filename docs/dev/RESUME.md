# Resume after compaction — Sprint 24 / post-v0.8.0 (next-agent handoff)

**Read this first.** Then in order:

1. [`docs/dev/active-sprint.md`](active-sprint.md) — Sprint 24 starting carry-forward queue.
2. [`CLAUDE.md`](../../CLAUDE.md) § Active sprint — same content, shorter form.
3. [`tasks.md`](../../tasks.md) — running ledger. Sprint 23 closed at the top with the v0.8.0 commit map; Sprint 24 starts from the carry-forward queue.

## Where we are

**v0.8.0 shipped** (2026-05-25). The ENH-182 project-as-filter-layer story is feature-complete: rail (Phase 1) + focus filter (Phase 2 + 2b) + lifecycle/menu (Phase 3) + auto-switch (Phase 3c) + CLI parity (Phase 4). Plus ENH-184 workspace pill defeaturing closed out. Plus ENH-185 polish. Smoke walk 5/5 PASS via computer-use pre-walk.

**The marquee.** Four commits closed everything queued for the capstone:

- [`26cfd03`](https://github.com/dudgeon/duo/commit/26cfd03) — Phase 3 (D11 auto-switch + D12 lifecycle/tile menu) + ENH-185 polish
- [`608034e`](https://github.com/dudgeon/duo/commit/608034e) — Phase 4 (`duo project list/focus/pin/unpin/close` CLI parity)
- [`f1adf96`](https://github.com/dudgeon/duo/commit/f1adf96) — Phase 2b (`file://` browser tab filter)
- [`282b0bc`](https://github.com/dudgeon/duo/commit/282b0bc) — ENH-184 workspace pill defeaturing + `duo workspace-pill-menu` CLI verb

## Sprint 24 starts here

### Top of carry-forward queue

In rough order of "small + cleanup-shaped + close-to-done":

1. **FOLLOWUP-030** (filed v0.8.0 audit) — browser-pane active-tab redirect on focus change. When user enters focus and the active browser tab is non-member, the strip hides the entry but the WebContentsView still shows its content. Add a parallel useEffect to the Phase 2 file-tab analog at App.tsx (`useEffect` on `[focusedProject, visibleTerminals, visibleFileTabs]`) — when `activeWorking.kind === 'browser'` and the active BrowserTab isn't in `visibleBrowserTabIds`, call `window.electron.browser.switchTab(...)` to shift to a visible member. ~10 lines.

2. **FOLLOWUP-031** (filed v0.8.0 audit) — `MaxListenersExceededWarning` on `terminal:claude-presence-changed`. Each `useClaudePresence` mount registers a listener; with many terminal tabs the count exceeds Node's default 10-listener warning. Fix: hoist the subscription to App.tsx + push state down via React context (matches `useFrontTerminalClaudeLive`). Pre-existing — not new with v0.8.0.

3. **BUG-079** Ctrl-Tab cycle latency partial repro. Sprint 22 walk-1 gave us a known-good repro (focus on duo with 1 visible terminal). Sprint 17 instrumentation established total renderer-keydown → switchTab return ≈ 15ms. Open hypotheses: modifier release timing, upstream consumer race.

### Older carry-forward (most-recent first)

BUG-093 (split crash) · BUG-122 hypothesis 2/3 · ENH-084 v4 (aux glow) · ENH-127 (composer-window direction) · ENH-128 walk-4 (HEIC drag-drop) · ENH-137 (Beginner's Guide) · ENH-141 (enterprise smoke) · ENH-148 v2 · ENH-157 · ENH-162 (Clone modal collision UX) · FOLLOWUP-021 (`duo install --clean`) · BUG-024 follow-up · 17a.5 (template gallery) · Backlinks/graph view · GH-CLUSTER-PROTO gate.

### Other-claude's working tree

**Empty as of v0.8.0.** Their ENH-184 working tree (`useWorkspacePillMenuFlag.ts` + `App.tsx` flag declaration + `WorkspaceSwitcherDropdown.tsx` handler fix) landed in [`282b0bc`](https://github.com/dudgeon/duo/commit/282b0bc) together with the finishing onClick gate. If other-claude starts a new branch of work this is back to a clean slate.

## Critical guardrails for the next agent

These are failure modes hit during recent sessions. Read before touching the codebase.

### 1. macOS Optimize Storage eviction (Sprint 22 emergency, now guarded)

**Trap.** If `~/Documents` is in iCloud Drive and "Optimize Mac Storage" is ON, macOS will silently evict tracked files locally under disk pressure. The file's metadata still claims a non-zero size but the bytes are gone (`dataless` BSD file flag).

**Symptoms.** `git status` → "short read while indexing"; vitest → "Unexpected end of JSON input" on stub package.json files; `git rev-parse HEAD` → "ambiguous argument 'HEAD'"; `git cat-file -e` → exit 138 (SIGBUS) on partially-materialized packfile.

**Guard.** `predev` / `pretest` npm hooks now run `bash scripts/check-materialization.sh --quiet || true` so each `npm run dev` warns once if anything is dataless. Recovery is `npm run materialize` (force-reads files to trigger iCloud download + `git checkout HEAD --` for files iCloud can't return).

**Recovery shortcuts when the guard fails:**
- `defaults write com.apple.bird optimize-storage -bool false` + `killall bird` to stop further evictions.
- For files iCloud can't return: `rm <file> && git checkout HEAD -- <file>` (the cloud-stub must be deleted before git can write).
- `.git/refs/heads/main` empty? Reconstruct from `.git/logs/HEAD` reflog tail (the reflog usually materializes).
- node_modules largely dataless? `rm -rf node_modules && npm install` is faster than per-file iCloud download.

Full doc at [`CLAUDE.md § Build commands`](../../CLAUDE.md).

### 2. Promise-cancel-on-cleanup destroys async cache hooks

If you write a hook that does "async probe → merge into Map state" and the host re-renders often (e.g. against `tabs` array changing per keystroke), do NOT set `cancelled = true` in the useEffect cleanup. The cleanup fires on every re-render → cancels the in-flight promise → setState never happens → cache stays empty forever. The setState merge is idempotent for stable probe results, so stale-closure resolutions after re-render are safe. Pattern lives in `renderer/hooks/useProjects.ts` with a comment explaining the gotcha.

### 3. ENH-182 home-dir exclusion (owner directive)

D2 says "marker = CLAUDE.md or .claude/". `~/.claude/` IS a `.claude/` subdir of the home dir, so naively `~` qualifies — that would make every random `/tmp/...` cwd surface "geoffreydudgeon" as a project. **Excluded.** BUT — editing a file directly under `~/.claude/` (the user's global config) SHOULD make `~/.claude/` itself a project. The exclusion bars ONLY `$HOME` itself + `/`; subdirs qualify normally. See `shared/projects.ts § isExcludedFromQualification` + the three `~/.claude editing scenario` tests in `core/projects-service.test.ts`.

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

If the session has any meaningful UI work on the table (renderer/, TipTap, CSS, keyboard, modals, etc.), call `request_access` with `applications: ["Electron"]` (or the bundle id `com.github.Electron`) BEFORE writing code. The app name is **"Electron"** (the dev target), NOT "Duo" (which resolves to the packaged `.app` in /Applications).

**v0.8.0 lesson learned:** pre-walking owner-judgment smoke-walk items via computer-use (real mouse/keyboard + screenshots + worksheet "Mark all Pass" + Copy results) eliminated the owner-walk-then-fix iteration cycle entirely. ENH-184's visual state machine (caret toggle + cursor:default) verified in seconds. Standard play for v0.8.x cuts that touch UI surfaces.

### 7. Verify the artifact BEFORE filing fixes from verbal symptom reports

A verbal "looks broken" report can be misleading. Check the actual artifact (file on disk, JSONL entry, network response, DOM probe — whatever the supposed-broken code writes) and confirm the broken behavior is real before designing a fix. Memory: [feedback_verify_current_behavior_before_proposing_fix.md](.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_verify_current_behavior_before_proposing_fix.md).

### 8. ENH-182 hook-point lesson (Phase 3c iteration)

When designing an effect that fires on a user-intent ("opening a file"), hook off the state that captures intent (`activeWorking`), not the state that captures the side effect (`tabMembership` identity change). The first iteration of Phase 3c hooked off `tabMembership` and missed reactivations of existing tabs (no fileTabs change → no membership change → no effect). The second iteration hooks off `activeWorking` and catches both new-file opens AND reactivations.

### 9. DMG version drift trap (Sprint 22 v0.7.10 cut)

`scripts/dist-signed.sh` reads `package.json § version` AT PACKAGING TIME, not at script start. If you bump `package.json` while a background `dist-signed.sh` is mid-run, the DMG filename + Info.plist `CFBundleShortVersionString` come out with the BUMPED version, not the cut version. Sequence to avoid this:
1. Cut commit + tag at the cut version.
2. Build DMG (synchronous wait, OR confirmed complete via `ls dist/` before bumping).
3. THEN bump `package.json`.

## State at-a-glance

- **Branch:** `main`. v0.8.0 tag at the cut commit (pushed). 
- **Git status:** working tree should be clean immediately post-cut. The v0.7.10 cycle's preserved other-claude tree (3 files: App.tsx, WSD.tsx, useWorkspacePillMenuFlag.ts) is gone — landed in [`282b0bc`](https://github.com/dudgeon/duo/commit/282b0bc).
- **Package version:** 0.8.0 at cut; will bump to v0.8.1 for the next sprint.
- **Pack version:** `packs/duo-default/PACK.json § version` bumped during the v0.8.0 cut so existing users see the per-pack "What's new" prompt on next launch (new entries cover project rail completion + `duo project` CLI + browser-tab filter + workspace-pill defeaturing).
- **dist/:** `Duo-0.8.0-arm64.dmg` (signed + notarized + stapled + launch-validated). Prior `Duo-0.7.10-arm64.dmg` safety net.
- **Disk free:** check `df -h ~`. Sprint 22 hit the iCloud trap at ~26GB; if you're lower than 40GB, run `npm run check:materialization` proactively.
- **Smoke walks:** v0.8.0 manifest at `docs/dev/smoke-walks/v0.8.0.json` (gitignored). 5/5 PASS pre-walk.

## What NOT to do

- **Don't re-cut v0.8.0.** It's tagged + released. Next cut is v0.8.1 (PATCH) or v0.9.0 (MINOR if a new user-visible chapter ships).
- **Don't bypass the materialization check.** When `predev` warns, run `npm run materialize` before continuing.
- **Don't toggle `optimize-storage` back to `1`.** It's currently OFF — that's the protective default.
- **Don't bump package.json during a background DMG build.** See guardrail § 9.

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
```

Welcome aboard.
