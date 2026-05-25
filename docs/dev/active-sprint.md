# Active sprint state — Sprint 22 / v0.8.0 (walk-1 PASS, ready to cut)

**Status (2026-05-25 late session):** **8 commits ahead of `origin/main`, walked + green, awaiting cut.** ENH-182 Phase 0 + Phase 1 + Phase 2 + home-dir fix + auto-spawn ALL shipped + owner-walked 5/5 PASS via the smoke-walk skill ([`docs/dev/smoke-walks/v0.8.0.json`](smoke-walks/v0.8.0.json) + `.html`). iCloud Optimize Storage data-loss emergency hit at session start (13k+ files dataless) — recovered + permanent guard committed. TabBar.tsx ENH-183 pare leftover closed (typecheck unblocked). Suite: 786/786 green. Other-claude's ENH-184 working tree state preserved untouched. Three follow-ups filed from walk-1 notes: ENH-185 (rail refinements), BUG-079 update (ctrl-tab latency partial repro). Phase 2b / Phase 3 / Phase 4 deliberately deferred to Sprint 23.

## What shipped this session

| Commit | Item | Notes |
|---|---|---|
| [3b49e43](https://github.com/dudgeon/duo/commit/3b49e43) | **ENH-182 Phase 0** | Project model + pure `deriveProjects` + `ProjectsService` persisted slice + `hasMarker` fs probe. 40 unit tests. |
| [b3953e8](https://github.com/dudgeon/duo/commit/b3953e8) | **TabBar.tsx pare leftover** | Dropped 3 references to `ui.collapsed` + render block. Unblocks `npm run typecheck`. |
| [db3829a](https://github.com/dudgeon/duo/commit/db3829a) | **iCloud Optimize Storage guard** | Recovery scripts + `predev`/`pretest` hooks + CLAUDE.md trap doc. |
| [58dcc86](https://github.com/dudgeon/duo/commit/58dcc86) | **ENH-182 Phase 1** | Read-only ProjectRail mounts left of files. R1-B quiet bloom. Six `--duo-project-*` tokens. `useProjects` hook. |
| [6bd1742](https://github.com/dudgeon/duo/commit/6bd1742) | **ENH-182 home-dir fix + IPC** | Pure `isExcludedFromQualification` helper (only `$HOME` itself is blocked; subdirs like `~/.claude` qualify normally). Dedicated `projects:has-marker` IPC replaces nav-listings lookup. 9 new tests. |
| [9831cce](https://github.com/dudgeon/duo/commit/9831cce) | **Sprint 22 docs refresh** | active-sprint.md / RESUME.md / session-log.md / CLAUDE.md / tasks.md all updated with what shipped + lessons learned. |
| [2a8a885](https://github.com/dudgeon/duo/commit/2a8a885) | **ENH-182 Phase 2 — focus filter** | Click tile → hide non-member tabs + chip + Ctrl-Tab respects filter + navigator re-roots + active-in-hidden recovery. The marquee. |
| [dfb0b52](https://github.com/dudgeon/duo/commit/dfb0b52) | **ENH-182 Phase 2 — auto-spawn** | Owner walk-1 edge case: focusing on a project with no member terminals auto-spawns one at the project root using `lastTabKind`. Per-focus-session guard prevents double-spawn. |

## What's next in Sprint 22

### ENH-182 Phase 2 — Focus filter (the actual payoff)

Phase 1 ships the rail read-only. Phase 2 is where it becomes interactive:
- Click tile → `focusedProject` state set; click again (or "All") to clear (D8).
- Hide non-member terminal + canvas tabs while focused (D10, visibility-only).
- Re-root navigator to project root (D10, not a hard tree filter).
- Title-bar focus chip with collapse-&-reflow transition.
- Ctrl-Tab cycles only visible tabs (D8).

PRD at [`docs/prd/enh-182-project-centric-ux.md § Phase 2`](../prd/enh-182-project-centric-ux.md). Smoke-walkable once it lands.

### ENH-182 Phase 3 — Corner case + lifecycle + tile context menu

D11 auto-switch focus when opening a file from another project. D12 auto add/remove + pin; tile right-click menu (Pin/Unpin + "Close N terminals and M tabs"). Uses the existing `FileTree.popupMenu()` pattern (PRD § 9 area 10).

### ENH-182 Phase 4 — CLI parity

`duo project list / focus [--all] / pin / unpin / close`. Full plumbing checklist per CLAUDE.md § 4.

### ENH-184 — Workspace pill defeaturing (other-claude's in-flight work)

Still uncommitted on `main` from the prior session — this session left it untouched:
- `renderer/hooks/useWorkspacePillMenuFlag.ts` (untracked)
- `renderer/App.tsx` (flag imported + declared, NOT consumed)
- `renderer/components/WorkspaceSwitcherDropdown.tsx` (handler fix complete)

Finishing work documented at [`tasks.md § ENH-184`](../../tasks.md). Whichever Claude picks it up: wire `workspacePillMenuEnabled` to gate the pill's `onClick`, owner walk, optional CLI parity verb.

### Carry-forward queue (not yet picked, most-recent first)

BUG-079 (tab-cycle latency) · BUG-093 (split crash) · BUG-122 hypothesis 2/3 · ENH-084 v4 (aux glow) · ENH-127 (composer-window direction) · ENH-128 walk-4 (HEIC drag-drop) · ENH-137 (Beginner's Guide) · ENH-141 (enterprise smoke) · ENH-148 v2 · ENH-157 · ENH-162 (Clone modal collision UX) · FOLLOWUP-021 (`duo install --clean`) · BUG-024 follow-up · 17a.5 (template gallery) · Backlinks/graph view.

## Lessons captured this session

1. **iCloud Optimize Storage is a class-1 dev hazard.** When `~/Documents` is in iCloud Drive and "Optimize Mac Storage" is ON, macOS will silently evict tracked files under disk pressure. Symptoms span the entire dev stack: `git status` → "short read while indexing"; vitest → "Unexpected end of JSON input"; `git rev-parse HEAD` → "ambiguous argument 'HEAD'"; `git cat-file -e` → SIGBUS. Recovery is 6 stages of force-read + git-checkout; some files have no cloud copy and are unrecoverable. **The guard is permanent now (`predev` hook + `npm run materialize`)** but the trap can re-fire if `optimize-storage` gets toggled back on. Full trap doc lives in [`CLAUDE.md § Build commands`](../../CLAUDE.md).

2. **Promise-cancel-on-cleanup destroys async cache hooks.** Phase 1's first attempt at `useProjects` set `cancelled = true` in the useEffect cleanup; every re-render of the host component cancelled the in-flight probe BEFORE it could `setGitResults`, leaving the cache permanently empty. Fix: no cancel-on-cleanup; the setState merge is idempotent (each key writes the same stable result on retry) so stale-closure resolutions after re-render produce a correct state. Pattern applies broadly to renderer hooks doing "async probe → merge into Map state" against a parent that re-renders often (e.g. `tabs` array changing on every keystroke).

3. **Owner directive on `~/.claude` qualification.** D2 of the project-as-filter-layer model says "marker = `CLAUDE.md` or `.claude/`". A naive read qualifies the user's home dir as a project because the global `~/.claude/` IS a `.claude/` directory in the home dir's listing. Owner correctly flagged this would surface "geoffreydudgeon" as a project tile on every random `/tmp/...` cwd. BUT — editing a file directly under `~/.claude/` (e.g. updating the global CLAUDE.md or a skill) SHOULD make `~/.claude/` itself a project. Locked by exclusion helper that bars ONLY the home dir + filesystem root, never subdirs. Three explicit integration tests assert the desired behavior.

4. **Pre-existing typecheck regressions block new work.** When sprint cleanup leaves typecheck broken (the ENH-183 pare missed TabBar.tsx), the next agent gets blocked OR ignores typecheck (which then masks new regressions). Fix structural-rename leftovers in the same commit as the rename. See [feedback_grep_all_implementations_before_rename](.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_grep_all_implementations_before_rename.md).

5. **`rm + git checkout HEAD --` is the recovery for cloud-stubbed tracked files.** `git checkout HEAD --` silently no-ops on a `dataless`-flagged file (returns 0, file mtime unchanged, content stays empty). The cloud-stub must be physically removed first so git can write a fresh file. Documented in `scripts/materialize.sh § Step 5`.

## Smoke walks

**v0.8.0 walk-1 (2026-05-25) — 5/5 PASS.** Manifest at [`docs/dev/smoke-walks/v0.8.0.json`](smoke-walks/v0.8.0.json). Owner-walked items: ENH-182-RAIL-VISUAL · ENH-182-FOCUS-CLICK · ENH-182-FOCUS-NAV · ENH-182-CTRL-TAB · TABBAR-PARE-CLEANUP. Agent-walked PASS (auto-skipped per intro): iCloud guard scripts + predev hook + vitest 786/786 + typecheck + hash-stable colors across reload + ~/.claude qualification (3 tests). Two PASS items came with refinement notes filed as follow-ups (ENH-185, BUG-079 update). Walk complete; ready for cut.

## Open questions for the next agent

None blocking. Two open product threads in case Sprint 22 has cycles:
- ENH-184 finish (other-claude's working tree)
- ENH-182 Phase 2 (start) — the actual filter behavior
