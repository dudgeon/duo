# Resume after compaction — Sprint 22 / v0.8.0 (next-agent handoff)

**Read this first.** Then in order:

1. [`docs/dev/active-sprint.md`](active-sprint.md) — what shipped this session + what's next.
2. [`CLAUDE.md`](../../CLAUDE.md) § Active sprint — same content, shorter form.
3. [`tasks.md`](../../tasks.md) — running ledger. Sprint 22 section is at the top.

## Where we are

**5 commits ahead of `origin/main`, not pushed yet.** Sprint 22 had a session-start emergency (iCloud Optimize Storage evicted 13k+ files including `.git/refs/heads/main`) that's now permanently guarded against — full chain:

```
6bd1742  fix(ENH-182): home-dir exclusion + dedicated marker IPC
58dcc86  feat(ENH-182): Phase 1 — read-only project rail mounts left of files
db3829a  feat(sprint22): iCloud Optimize Storage data-loss guard
b3953e8  fix(ENH-183-pare): TabBar.tsx — drop S2 collapsed-dot leftover
3b49e43  feat(ENH-182): Phase 0 — Project model + pure derivation + persisted slice
```

**ENH-182 Phase 0 + Phase 1 verified live.** Read-only project rail mounts at the left edge with R1-B quiet bloom tiles. With workspace tabs spanning the duo repo + `/tmp/duo-walk-hydrate` + `~/.claude/CLAUDE.md`, the rail correctly surfaces **CL** (`.claude`) and **DU** (`duo`) tiles. Home dir itself does NOT qualify despite containing `.claude/` (the global Claude Code config) — exclusion fires before any marker check.

**Phase 2 (focus filter — the actual payoff)** is the obvious next step. Phase 1 tiles are display-only by design; clicks are no-ops until Phase 2 lands.

## Sprint 22 picks up here

### ENH-182 Phase 2 — Focus filter

The rail's `onFocus` prop is already wired through to Phase 1; App.tsx currently passes `focusedProject={null}`. Phase 2 builds:

1. **`focusedProject` state** in `App.tsx` — type `string | null`. Set on tile click; cleared on All tile or active-tile-again click (D8).
2. **Filter tabs while focused** — apply to both `tabs` (terminals) and `fileTabs` (working tabs). Use the `terminalMembership` + `tabMembership` from `useProjects` (the hook already returns them; Phase 1 just doesn't consume them). Filter is visibility-only — closed tabs RETURN when focus clears (D10).
3. **Re-root navigator** — `nav.actions.navigateTo(focusedProject)` on focus; restore previous cwd on clear. PRD § 9 area 2 has the entry point.
4. **Ctrl-Tab respects filter** — `renderer/keyboard/tabCycle.ts cycleNext()` already operates on the array passed in; just pass the filtered array (D8).
5. **Title-bar focus chip** — small "Focused: {projectName} ×" affordance somewhere visible. Click × to clear.

PRD spec at [`docs/prd/enh-182-project-centric-ux.md § Phase 2`](../prd/enh-182-project-centric-ux.md). The §5 demo in [`docs/research/project-centric-ux.html`](../research/project-centric-ux.html) has working CSS/JS for the collapse-&-reflow transition (port it to the real components, restyled).

### ENH-184 — Workspace pill defeaturing (still in-flight)

Other-claude's uncommitted working tree from the prior session is preserved untouched:
- `renderer/hooks/useWorkspacePillMenuFlag.ts` (new, untracked)
- `renderer/App.tsx` (flag imported + declared, NOT consumed)
- `renderer/components/WorkspaceSwitcherDropdown.tsx` (`+ New Workspace` handler fixed)

Finishing work documented at [`tasks.md § ENH-184`](../../tasks.md). Whichever Claude picks it up: wire the flag to gate the pill's `onClick`, owner walk, optional CLI parity verb.

## Critical guardrails for the next agent

These are the failure modes hit during this session + prior sessions. Read before touching the codebase.

### 1. macOS Optimize Storage eviction (NEW — Sprint 22 emergency)

**Trap.** If `~/Documents` is in iCloud Drive and "Optimize Mac Storage" is ON (System Settings → Apple ID → iCloud → iCloud Drive), macOS will silently evict tracked files locally under disk pressure. The file's metadata still claims a non-zero size but the bytes are gone (the `dataless` BSD file flag).

**Symptoms.** `git status` → "short read while indexing"; vitest → "Unexpected end of JSON input" on stub package.json files; `git rev-parse HEAD` → "ambiguous argument 'HEAD'" (when `.git/refs/heads/main` itself is evicted); `git cat-file -e` → exit 138 (SIGBUS) on partially-materialized packfile.

**Guard.** `predev` / `pretest` npm hooks now run `bash scripts/check-materialization.sh --quiet || true` so each `npm run dev` warns once if anything is dataless. Recovery is `npm run materialize` (force-reads files to trigger iCloud download + `git checkout HEAD --` for files iCloud can't return).

**Recovery shortcuts:**
- `defaults write com.apple.bird optimize-storage -bool false` + `killall bird` to stop further evictions.
- For files iCloud can't return: `rm <file> && git checkout HEAD -- <file>` (the cloud-stub must be deleted before git can write).
- `.git/refs/heads/main` empty? Reconstruct from `.git/logs/HEAD` reflog tail (the reflog usually materializes).
- node_modules largely dataless? `rm -rf node_modules && npm install` is faster than per-file iCloud download.

Full doc at [`CLAUDE.md § Build commands`](../../CLAUDE.md).

### 2. Promise-cancel-on-cleanup destroys async cache hooks

If you write a hook that does "async probe → merge into Map state" and the host re-renders often (e.g. against `tabs` array which changes per keystroke), do NOT set `cancelled = true` in the useEffect cleanup. The cleanup fires on every re-render → cancels the in-flight promise → setState never happens → cache stays empty forever. The setState merge is idempotent for stable probe results, so stale-closure resolutions after re-render are safe. Pattern lives in `renderer/hooks/useProjects.ts` with a comment explaining the gotcha.

### 3. ENH-182 home-dir exclusion (owner directive)

D2 says "marker = CLAUDE.md or .claude/". `~/.claude/` IS a `.claude/` subdir of the home dir, so naively `~` qualifies — that would make every random `/tmp/...` cwd surface "geoffreydudgeon" as a project. **Excluded.** BUT — editing a file directly under `~/.claude/` (the user's global config) SHOULD make `~/.claude/` itself a project. The exclusion bars ONLY `$HOME` itself + `/`; subdirs qualify normally. See `shared/projects.ts § isExcludedFromQualification` + the three `~/.claude editing scenario` tests in `core/projects-service.test.ts`.

### 4. Always invoke `/smoke-walk` via the Skill tool (CLAUDE.md § 7b)

Hard rule. Don't run `.claude/skills/smoke-walk/generate.mjs` directly. The skill's procedural steps (renderer reload, surface re-probe, pref reset, agent-walks-CLI-items) are not in the generator script. Bypassing them is auditable as a process failure even when output looks right.

### 5. Renderer reload after dev restarts

After any `npm run dev` kill+spawn cycle, run:
```bash
duo dom --js 'window.location.reload()'
sleep 3
until duo dom --js 'typeof window.electron?.session' 2>&1 | grep -q object; do sleep 1; done
```
HMR through multiple restarts can leave the renderer pinned to an older module graph.

### 6. Computer-use access at session start for UI work (CLAUDE.md § 7e)

If the session has any meaningful UI work on the table (renderer/, TipTap, CSS, keyboard, modals, etc.), call `request_access` with `applications: ["Electron"]` BEFORE writing code. The app name is **"Electron"** (the dev target), NOT "Duo" (which resolves to the packaged `.app` in /Applications).

### 7. Verify the artifact BEFORE filing fixes from verbal symptom reports

BUG-159 (ENH-183 walks) and the original Phase 1 hasMarker behavior both showed: a verbal "looks broken" report can be misleading. Check the actual artifact (file on disk, JSONL entry, network response, DOM probe — whatever the supposed-broken code writes) and confirm the broken behavior is real before designing a fix. Memory: [feedback_verify_current_behavior_before_proposing_fix.md](.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_verify_current_behavior_before_proposing_fix.md).

### 8. Other-claude's working tree is sacred

The session's commits should NEVER touch `renderer/App.tsx`, `renderer/components/WorkspaceSwitcherDropdown.tsx`, or `renderer/hooks/useWorkspacePillMenuFlag.ts` in a way that drops their changes. This session used a temporary-revert + commit + restore dance twice (Phase 1 commit + home-dir-fix commit) to land work that touches `App.tsx` while preserving other-claude's untracked + uncommitted changes. The pattern:
1. Save other-claude's WSD patch via `git diff > /tmp/other-claude-wsd.patch`.
2. Use Edit tool to revert their hunks in App.tsx (small, mechanical).
3. `git checkout HEAD -- renderer/components/WorkspaceSwitcherDropdown.tsx` to revert their WSD change.
4. Verify typecheck + commit.
5. Use Edit tool to restore their App.tsx hunks (matching what I just saved).
6. `git apply /tmp/other-claude-wsd.patch` to restore WSD.
7. Verify `git status -s` shows only their three lines: `M App.tsx`, `M WSD.tsx`, `?? useWorkspacePillMenuFlag.ts`.

## State at-a-glance

- **Branch:** `main` at `6bd1742`. 5 commits ahead of `origin/main`. v0.7.9 tag at `6a8525e`.
- **Git status:** working tree has the 3 ENH-184 files uncommitted (intentional; preserved from prior session).
- **Dev session:** running under v0.8.0 identity; ProjectRail visible with CL + DU tiles. `duo doctor` clean.
- **Package version:** 0.8.0 (dev).
- **dist/:** cleaned to just `Duo-0.7.9-arm64.dmg` (104 MB) + blockmap. 11 legacy DMGs deleted this session (freed 1.1 GB).
- **Disk free:** ~24 GB (94% used). Still tight; consider further cleanup if Optimize Storage gets re-enabled.
- **Smoke walks:** none for this session yet — recommend walking Phase 1 + home-dir fix + iCloud guard + TabBar fix together once Phase 2 lands.

## What NOT to do

- Don't push commits to `main` without checking for parallel work (other-claude may commit ENH-184).
- Don't bypass the materialization check — when `predev` warns, run `npm run materialize` before continuing.
- Don't drop other-claude's ENH-184 working tree state. See guardrail § 8.
- Don't smoke-walk Phase 1 in isolation — the rail's clicks are display-only by design until Phase 2 lands. Walking just Phase 1 invites the owner to test focus behavior that doesn't exist yet.
- Don't toggle `optimize-storage` back to `1` unless the disk situation has changed dramatically + you understand the recurrence risk.

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

# See the rail live
duo dom --js 'JSON.stringify(Array.from(document.querySelectorAll("[data-project-tile]")).map(t => t.getAttribute("data-project-tile")))'
```

Welcome aboard.
