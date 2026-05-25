# Resume after compaction — Sprint 23 / v0.7.11 (next-agent handoff)

**Read this first.** Then in order:

1. [`docs/dev/active-sprint.md`](active-sprint.md) — Sprint 23 starting scope + carry-forward queue.
2. [`CLAUDE.md`](../../CLAUDE.md) § Active sprint — same content, shorter form.
3. [`tasks.md`](../../tasks.md) — running ledger. Sprint 23 section at the top; Sprint 22 closed.

## Where we are

**v0.7.10 just shipped** (2026-05-25 same-day-as-Sprint-22-build). Tag + signed-notarized DMG + GitHub Release all live at [github.com/dudgeon/duo/releases/tag/v0.7.10](https://github.com/dudgeon/duo/releases/tag/v0.7.10). Dev package.json bumped to **v0.7.11**. Sprint 22 closed with **5/5 PASS** on the smoke walk (manifest at `docs/dev/smoke-walks/v0.8.0.json` — named under the working version before the cut got renumbered to PATCH; results stand).

**Marquee that shipped: ENH-182 Phases 0–2.** The project rail (left ~54px edge, R1-B "quiet bloom" tiles in six hash-stable hues) + focus filter (click tile → hide non-member terminal + working tabs, re-root navigator, titlebar chip, Ctrl-Tab respects filter) + auto-spawn on empty-terminal focus. Plus the home-dir exclusion + dedicated marker IPC, the iCloud Optimize Storage data-loss guard, and the TabBar.tsx ENH-183 pare leftover cleanup. Full details: `CHANGELOG.md § [0.7.10]` + `docs/RELEASES.md § v0.7.10`.

**Why v0.7.10 and not v0.8.0.** Owner reframed mid-push: the project-as-filter-layer feature is real and visible but Phase 2b (browser-mode canvas filter) + Phase 3 (lifecycle + D11 auto-switch + tile right-click menu) + Phase 4 (CLI parity) are still pending. PATCH (0.7.9 → 0.7.10) is the honest framing. v0.8.0 reserved for the feature-complete ENH-182 capstone — Sprint 23's anchor.

## Sprint 23 starts here

### Top priority — close ENH-182 toward the v0.8.0 capstone

In order of dependency:

1. **Phase 3 — D11 auto-switch + D12 lifecycle + tile right-click menu.** Opening a file from another project while focused auto-switches focus (D11). Pinned projects survive across sessions (D12). Tile right-click: Pin/Unpin + "Close N terminals and M tabs" (bulk-close, live counts, confirm on live process). Uses the existing `FileTree.popupMenu()` pattern (PRD § 9 area 10). All decisions locked in [`docs/prd/enh-182-project-centric-ux.md § Phase 3`](../prd/enh-182-project-centric-ux.md).
2. **Phase 4 — CLI parity.** `duo project list / focus / focus --all / pin / unpin / close`. Full plumbing checklist per CLAUDE.md § 4. Mirrors the rail's behavior.
3. **Phase 2b — Browser-mode canvas tab filter.** Currently `file://` browser tabs stay visible across every focus. The filter should gate them by path membership too. URL→project resolution is the new bit (current code uses path-based membership).

### Lower-priority follow-ups (file before sprint planning)

- **ENH-185** — Project rail refinements. Owner walk-1 PASS-with-notes: rail 10% narrower (`w-14 → w-[50px]`) + tooltip wording (`Project: {name}` instead of `{name}\n{root}`). Cosmetic; fold into Phase 3 or land as a side commit. Two-file change in `renderer/components/ProjectRail/ProjectRail.tsx`.
- **BUG-079** — Ctrl-Tab cycle latency partial repro. Sprint 22 walk-1 confirmed the latency is present even with a 1-tab focused set (narrow case), so it's NOT in cycle traversal. Sprint 17 instrumentation at [`feedback_verify_current_behavior_before_proposing_fix.md`] established total renderer-keydown → switchTab return ≈ 15ms. Open hypotheses: modifier release timing, upstream consumer race. Use the Sprint 22 known-good repro condition (focus on duo with 1 visible terminal) to instrument.

### ENH-184 — still in-flight on `main`

Other-claude's working tree from a prior session was preserved untouched across the entire Sprint 22 cycle. Status at v0.7.10 cut:

```
M renderer/App.tsx                                  (flag declared, NOT consumed)
M renderer/components/WorkspaceSwitcherDropdown.tsx (+ New Workspace handler fix complete)
?? renderer/hooks/useWorkspacePillMenuFlag.ts       (new flag hook, default OFF)
```

Owner intent: render the title-bar workspace pill as a **passive label** — no dropdown, no caret, no click. All workspace operations route through File menu. Finishing work:
1. Wire `workspacePillMenuEnabled` to gate the pill's `onClick` + caret render in App.tsx (~5 lines, near the `<WorkspaceSwitcherDropdown />` mount).
2. CLI parity verb `duo workspace-pill-menu [on|off]` (optional but matches CLAUDE.md § 4).
3. Update `packs/duo-default/canvases/what-duo-does.html` § 37c (still describes the click-to-open behavior).
4. Smoke-walk via the `/smoke-walk` skill.

### Carry-forward queue (not yet picked, most-recent first)

BUG-079 update (ctrl-tab latency — see above) · ENH-185 rail refinements (see above) · BUG-093 split crash · BUG-122 hypothesis 2/3 · ENH-084 v4 (aux glow) · ENH-127 (composer-window direction) · ENH-128 walk-4 (HEIC drag-drop) · ENH-137 (Beginner's Guide) · ENH-141 (enterprise smoke) · ENH-148 v2 · ENH-157 · ENH-162 (Clone modal collision UX) · FOLLOWUP-021 (`duo install --clean`) · BUG-024 follow-up · 17a.5 (template gallery) · Backlinks/graph view.

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

If the session has any meaningful UI work on the table (renderer/, TipTap, CSS, keyboard, modals, etc.), call `request_access` with `applications: ["Electron"]` BEFORE writing code. The app name is **"Electron"** (the dev target), NOT "Duo" (which resolves to the packaged `.app` in /Applications).

### 7. Verify the artifact BEFORE filing fixes from verbal symptom reports

A verbal "looks broken" report can be misleading. Check the actual artifact (file on disk, JSONL entry, network response, DOM probe — whatever the supposed-broken code writes) and confirm the broken behavior is real before designing a fix. Memory: [feedback_verify_current_behavior_before_proposing_fix.md](.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_verify_current_behavior_before_proposing_fix.md).

### 8. Other-claude's working tree is sacred

The session's commits should NEVER touch `renderer/App.tsx`, `renderer/components/WorkspaceSwitcherDropdown.tsx`, or `renderer/hooks/useWorkspacePillMenuFlag.ts` in a way that drops their changes. Sprint 22 used a temporary-revert + commit + restore dance four times (Phase 1, Phase 2, home-dir fix, auto-spawn) to land App.tsx-touching work while preserving other-claude's untracked + uncommitted changes. The pattern:
1. Save other-claude's WSD patch via `git diff > /tmp/other-claude-wsd.patch`.
2. Use Edit tool to revert their hunks in App.tsx (small, mechanical).
3. `git checkout HEAD -- renderer/components/WorkspaceSwitcherDropdown.tsx` to revert their WSD change.
4. Verify typecheck + commit.
5. Use Edit tool to restore their App.tsx hunks (matching what was saved).
6. `git apply /tmp/other-claude-wsd.patch` to restore WSD.
7. Verify `git status -s` shows only their three lines: `M App.tsx`, `M WSD.tsx`, `?? useWorkspacePillMenuFlag.ts`.

### 9. DMG version drift trap (Sprint 22 v0.7.10 cut)

`scripts/dist-signed.sh` reads `package.json § version` AT PACKAGING TIME, not at script start. If you bump `package.json` while a background `dist-signed.sh` is mid-run, the DMG filename + Info.plist `CFBundleShortVersionString` come out with the BUMPED version, not the cut version. Sequence to avoid this:
1. Cut commit + tag at the cut version.
2. Build DMG (synchronous wait, OR confirmed complete via `ls dist/` before bumping).
3. THEN bump `package.json`.

Sprint 22 hit this — built `Duo-0.7.11-arm64.dmg` after bumping while v0.7.10 build was async; had to rebuild with `package.json` temporarily reverted to 0.7.10. Cost an extra 3 min.

## State at-a-glance

- **Branch:** `main` at `d41df25` (bump to v0.7.11). v0.7.10 tag at `fcbbbf8`. **Pushed to origin.** 0 commits ahead of `origin/main`.
- **Git status:** working tree has the 3 ENH-184 files uncommitted (intentional; preserved from prior session).
- **Dev session:** if running, it was launched under v0.7.10 (mid-cut). Next session should respawn for the v0.7.11 identity to apply cleanly.
- **Package version:** 0.7.11 (dev).
- **Pack version:** `packs/duo-default/PACK.json § version` is 1.0.14 (bumped during the v0.7.10 cut; existing users see the per-pack "What's new" prompt on next launch — new entries 17j/17k/17l in `what-duo-does.html` cover the project rail + focus filter + auto-spawn).
- **dist/:** `Duo-0.7.10-arm64.dmg` (104 MB, signed + notarized + stapled + launch-validated) + the prior `Duo-0.7.9-arm64.dmg` safety net.
- **Disk free:** ~26 GB (94% used).
- **Smoke walks:** v0.8.0 manifest at `docs/dev/smoke-walks/v0.8.0.json` (gitignored, named under the working version before the cut renumber).

## What NOT to do

- **Don't re-cut v0.8.0 yet.** Reserved for the feature-complete ENH-182 capstone. Earn it by closing Phase 2b + Phase 3 + Phase 4.
- **Don't drop other-claude's ENH-184 working tree state.** See guardrail § 8.
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
gh release view v0.7.10
```

Welcome aboard.
