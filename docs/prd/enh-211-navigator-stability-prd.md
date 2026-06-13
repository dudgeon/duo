# ENH-211 PRD — Kill navigator render-flicker (stable-while-revalidate tree)

> **Status:** Filed 2026-06-11 · owner: Geoff · priority **High** (P0 user-visible
> jank on the single most-used pane). **Not yet implemented** — this PRD is the
> build spec; no branch/PR yet. **Sequenced after ENH-210** (worktree-aware Duo,
> sibling branch `claude/youthful-chebyshev-885712`): ENH-210 lands on `main`
> first, ENH-211 rebases onto post-ENH-210 `main`. See § C for the conflict
> matrix — every code surface this change touches is disjoint from ENH-210.
>
> **Doubles as the canonical navigator feature compendium.** Part A compiles the
> navigator's genesis, every shipped/open enhancement, and every bug into one
> reference; Part B specifies the new anti-flicker work; Part C is the landing
> plan.
>
> **References:**
> - [Stage 10 PRD — file navigator](stage-10-file-navigator.md) — the foundation
>   (`FileTree` / `useNavigator` / `FilesPane`); D1–D32, the data-model + watcher
>   contract this flicker rides on.
> - [ENH-190 PRD — navigator resize/peek](enh-190-navigator-resize-peek.md) — the
>   shape model for a chrome-scoped navigator PRD.
> - [ENH-207 PRD — drag path to terminal](enh-207-navigator-drag-path-to-terminal.md)
>   — sibling open navigator increment; the D-numbered house style.
> - [ENH-182 PRD — project-centric UX](enh-182-project-centric-ux.md) — the
>   project-lens re-root churn that compounds with flicker.
> - [ENH-191 PRD — multi-window](enh-191-multi-window.md) — per-window navigator
>   namespacing (`duo.nav.v2.w${windowId}.*`).
> - [DECISIONS.md](../DECISIONS.md) — launch-CWD-evaporates-on-`cd` (:313),
>   main-process `Menu.popup()` for navigator right-click (:680–713), ENH-191
>   per-window identity-not-focus (:983–1005).
> - `CLAUDE.md` locked table (Skills CWD source = PTY **launch** CWD; two scopes)
>   + glossary (`the navigator` = `FileTree` / `useNavigator`).
> - **Code (this change touches):** `renderer/hooks/useNavigator.ts`,
>   `renderer/hooks/useUserClaudeNavigator.ts`,
>   `renderer/components/FileTree.tsx`, `electron/files-service.ts`,
>   `electron/main.ts` (git-watcher region ~2282–2347),
>   `electron/preload.ts` (`files.watch` ~302). New test:
>   `renderer/hooks/useNavigator.flicker.test.ts` (or equivalent).

---

## Summary

The navigator — Duo's leftmost column (`FileTree` rows, `FilesPane` wrapper,
backed by `useNavigator` / `useUserClaudeNavigator`) — **visibly flickers and
momentarily renders the literal `Loading…` placeholder on every filesystem
event and every git-watch invalidation.** Whenever Claude (or any external tool)
writes, renames, or deletes a file in the navigator's cwd or a visible folder —
and on every expand/collapse — the affected subtree blanks to `Loading…` for a
frame, and a write *directly in cwd* blanks the **whole tree** because the root
rows derive from `state.listings.get(state.cwd)`. There is no renderer-side
debounce, so a burst of agent writes (an `npm install`, a `git checkout`, a
batch edit) produces sustained flashing. **ENH-211 makes the tree
stable-while-revalidate**: keep the previous rows on screen while a refresh is in
flight, coalesce bursty events, stop tearing the watcher down on every toggle,
and stop re-rendering every row on every git tick. This document also serves as
the **navigator feature compendium** (Part A) — its genesis, locked decisions,
full enhancement and bug history, and current architecture with file:line
anchors — so the flicker fix is grounded in the whole feature's contract rather
than a point patch.

---

# Part A — Navigator feature compendium

## A.1 Genesis & vision

The navigator is Duo's leftmost column. Internally it is `FilesPane` (the
wrapper) + `FileTree` / `FileTreeNode` (the rows) + `Breadcrumb` +
`CollapsedRail` + `RevealChip`, backed by the `useNavigator` renderer hook (and
now also `useUserClaudeNavigator` for the bottom `~/.claude` pane). It was
defined in the **Stage 10 PRD** ("File navigator / context drawer + layout
reshape", spec locked 2026-04-23) as one of three atomic deliverables:

1. A tree-based file navigator **"always showing somewhere on disk, drivable by
   both the user and the agent."**
2. The three-column layout reshape: **Files | Terminal-middle | WorkingPane-right.**
3. The file-render story: **click a file → it opens as a `WorkingPane` tab.**

**Primary persona** — *a PM who doesn't type file paths.* They want to see
folders, click a PRD to read it, and spawn a terminal "in this project" without
knowing what a CWD is. **Jobs to be done:** "show me what's in this folder",
"let me click a `.md` and read it", "open the new terminal in the folder I'm
looking at", "tell me when Claude modifies a file I'm looking at", "show me where
Claude says it moved a file."

**PTY-launch-CWD model.** Follow mode (D1) tracks the **active terminal tab's
launch CWD** — *not* the moving shell CWD, which evaporates on `cd`
(DECISIONS.md:313). A pin in the navigator header freezes the navigator
independently of follow mode. This matches the CLAUDE.md locked decision: *Skills
CWD source = PTY launch CWD (not moving shell CWD); two scopes (project + home).*

**Pending-CWD concept (D9/D10).** The navigator's current view **is** the pending
CWD for the next new terminal tab; if a *file* is selected, the pending CWD is
the file's **parent directory**. This is surfaced only as a tooltip on the
terminal-tab `+` button ("Will launch in `<folder>`") — there is no
always-visible label. Derived: `nav.selected file → dirname; folder → path; else
nav.cwd`.

**Two scopes.** The **project navigator** browses anywhere readable on disk (no
`$HOME` sandbox, D3; dotfiles hidden **except `.claude/` dirs** which are always
visible, D6). The separate **user-`~/.claude` navigator**
(`useUserClaudeNavigator.ts`) is fixed at `~/.claude`. Per ENH-191, scope is
**per-window** — each window owns its own navigator cwd/workspace. State (cwd,
expanded-set by absolute path, pinned, showDotfiles, collapsed, width) persists
across relaunches in Electron `userData`.

## A.2 Locked decisions (from Stage 10 + downstream)

| ID | Area | Decision |
|---|---|---|
| (CLAUDE.md) | CWD source | Skills CWD source = PTY **launch** CWD (not moving shell CWD); two scopes (project + home). |
| (CLAUDE.md) | Scope | Brainstem / MCP not included — Skills panel is CWD-scan only. |
| (CLAUDE.md) | Glossary | "the navigator" = `FileTree` / `useNavigator` (internal name). |
| **D1** | Follow mode | Navigator tracks the active terminal tab's launch CWD by default; header pin freezes it independently. |
| **D2** | Persistence | Navigator folder + tree-expansion state persist across relaunches (JSON in Electron `userData`). |
| **D3** | Scope | Anywhere the user can read on disk; no `$HOME` sandbox. |
| **D4** | Click | Single click expands folders **and** opens files; no double-click required. |
| **D5** | Layout | Column resizable (180–360px) + collapsible; ⌘B toggles; collapsed = narrow icon rail, not fully hidden. |
| **D6** | Dotfiles | Hidden by default **except `.claude/` dirs** (always visible); toggle shows all. |
| **D8** | Breadcrumb | Clickable breadcrumb bar at top (`~ / Documents / GitHub / duo`). |
| **D9** | Pending-CWD | Current view is the pending CWD for the next new terminal; if a **file** is selected, pending CWD = file's **parent** dir. |
| **D10** | Pending-CWD UI | Shown only as a tooltip on the terminal-tab `+` button; no always-visible label. |
| **D13** | Open dedupe | Clicking an already-open file **switches** to that tab (identity = absolute path + type); no duplicate. |
| **D16** | Reveal | `duo reveal` jumps the navigator to a path + a dismissible chip fades in. |
| **D18** | Watcher | chokidar file watcher keeps tree + previews in sync; **debounced; scoped to visible subtree + expanded descendants only.** |
| **D22** | Expansion persist | Tree expansion persisted by absolute path in `userData`; survives folder changes + relaunches. |
| **D24** | First launch | Default = `$HOME` if no persisted state; otherwise follows the active tab (D1). |
| **D27** | Keyboard | Arrows move selection, ←/→ collapse/expand, Enter opens, typeahead to sibling name. |
| **D32** | Narrow auto-collapse | Below ~1100px window width, Files auto-collapses to icon rail; manual expand at narrow widths respects the override. |
| **D19/D20/D23** | Deferred | Drag-and-drop, file ops (rename/delete/new), and git-status badges all explicitly deferred out of Stage 10 (later shipped via ENH-016/147/152). |
| (DECISIONS.md) | Right-click | Navigator right-click uses main-process `Menu.popup()` (`menu:popup-tree-row`), not a DOM menu (renders above the WebContentsView). |
| (ENH-191) | Per-window | Navigator cwd/workspace is **per-window**; each window owns its own navigator, restored per relaunch in ascending-id order; default app resolution by identity (lowest-id primary), never focus. |

## A.3 Enhancement history

Grouped by theme. Status as of filing.

### Foundation

| ID | Title | What it added | Status |
|---|---|---|---|
| **Stage-10** | File navigator foundation | The core data+render contract: `state.listings` Map keyed by cwd, chokidar watcher (D18) scoped to "visible subtree + expanded descendants", debounced, per-path cache invalidated by the watcher — the substrate every later flicker mechanism layers onto. | shipped (foundational) |

### Selection & visual prominence

| ID | Title | What it added | Status |
|---|---|---|---|
| **ENH-078** | Selection prominence + easier deselection | Stepped the selected-row class up (Finder-style fill); click-on-selected-row and click-on-whitespace clear selection. | shipped v0.6.5 |
| **BUG-074** | ENH-078 light-mode contrast | Replaced `text-zinc-50`/opacity-modifier fill with the theme-aware `text-ink` + **solid** `bg-accent text-white` (Finder-style); accent token had no `<alpha-value>` so opacity modifiers were broken. | shipped (fix of ENH-078) |
| **ENH-119** | Selection tint covers images | Image rows in the selected range also paint the selection tint. | shipped |
| **ENH-147** | Multi-select v1 (⌘-click + batch trash) | Replaced singular `selected` with `selectedItems: Map<path,'file'\|'folder'>` + `primaryPath` anchor (both hooks); ⌘-click toggles, batched trash refreshes affected parents once; chokidar `removed` prunes the map. | shipped v0.7.0 |
| **ENH-148** | Multi-select v2 (⇧-range + ⌘-A) | ⇧-click range (anchored on `primaryPath`), ⌘-A select-all-in-dir respecting the dotfile filter. | open (Sprint 17) |

### Creation & file ops

| ID | Title | What it added | Status |
|---|---|---|---|
| **ENH-016** | New file / new folder (context menu) | Create-default-name + auto-rename pattern (Electron disables `prompt()`); `pickUniquePath()` conflict-suffix; drops the new row into rename mode. | shipped v0.5.3 |
| **BUG-041** | Right-click whitespace menu | Wrapper-level `onContextMenu` gated on `e.target===e.currentTarget`, synthesizing a "root" target from `state.cwd` (whitespace menu: New file/folder, Open terminal here, Reveal in Finder). | shipped v0.5.3 |
| **ENH-050** | Native NSMenu + system-sheet dialogs | Migrated FileTree row + whitespace right-clicks and `onTrashEntry` to `menu.popup` / `dialog.confirm` (pure-data `buildTreeMenuTemplate` + `handleMenuChoice`); retired the in-renderer menu/confirm components. | shipped v0.6.3 |
| **ENH-169** | Unified new-file/new-folder UX | One modal across breadcrumb right-click, File menu, ⌘N/⌘⇧N; validates collisions, creates via FilesService IPC, scrolls into view via `NAV_REVEAL`. | open / planned (v0.7.7) |

### Cross-surface reveal & pins

| ID | Title | What it added | Status |
|---|---|---|---|
| **ENH-010** | Pinned files & folders section | Third "Pinned" section in FilesPane backed by `~/.claude/duo/nav-pins.json` (`useNavPins`); resolves live, refreshes via `NAV_PINS_CHANGED`. | shipped v0.5.0 |
| **BUG-030** | Pin-state push on CLI change | `IPC.NAV_PINS_CHANGED` push so `duo nav pin/unpin` flips the renderer Pinned section immediately. | shipped v0.5.1 |
| **ENH-026** | Working-tab context menu | Established the working-tab menu pattern (Reveal in navigator, Rename, Pin, Move to Trash); "Reveal" drives `nav.actions.navigateTo`. | shipped v0.5.3 |
| **ENH-115** | Terminal-tab "Reveal in navigator" | Single-verb terminal-tab menu re-roots the navigator on the tab's CWD via `navigateTo` (reuses `menu.popup`; no new IPC). | shipped |
| **ENH-029** | Breadcrumb pans right + bold last segment | `Breadcrumb.tsx` scrolls `scrollLeft=scrollWidth` on every cwd change (per-cwd DOM side-effect in the chrome). | shipped v0.5.4 |

### Git overlay (ENH-152 cluster — the M3 substrate)

| ID | Title | What it added | Status |
|---|---|---|---|
| **ENH-152** | Git status overlay — root chip | Slice 1: repo-root chip (`core/git/` reader + `GitRepoStatus` IPC + chip render); owner rejected clean-stays-invisible → always-visible v2. | shipped v1 (2026-05-16); v2 spec'd |
| **ENH-152a-v2** | Peer-repo root icon + hover popover | `useEffect` on cwd/rootEntries calls `scanReposIn(parentDir, childNames)` (cheap `.git/` stat + parallel `getGitStatus`) → Map re-keyed by absolute path; each repo-root child renders a git-branch icon with a portal'd (`createPortal`) hover chip. **Per-cwd-change probe yielding new Map identities.** | shipped v0.7.0 |
| **ENH-152b** | Per-file dirty dots | `dirtyFileMap` state fed by `getDirtyFilesFor` → `Map<absPath,{status,plus,minus}>`; TreeNode renders an accent dot + diff tooltip on dirty rows. | shipped v0.7.0 |
| **ENH-152c** | fsevents-driven git invalidation | `IPC.GIT_WATCH_START` installs a chokidar watcher on `state.cwd` at **depth 1** (deliberately not full `workTreeRoot`, to avoid huge-repo inotify lockups), 250ms-debounced, bumping `gitRefreshTick` → re-runs ribbon + child-repo-map + dirty-files probes. **This is the M3 flicker mechanism.** | shipped v0.7.0 |
| **ENH-155** | Right-click GitHub menu | Repo-root GitHub verbs (Open on GitHub / Copy GitHub URL) reading `git remote` + `git rev-parse`. | filed Sprint 17 |
| **ENH-154** | Link a local folder to a GitHub repo | "Link to GitHub…" modal + `duo gh-link`; chip reflects the new linked state. | filed |
| **FOLLOWUP-025** | File → Clone… modal | `CloneModal` + File-menu / navigator "Clone GitHub repo here…" defaulting to nav cwd; clone lands a repo that then shows the ENH-152 chip. | v1 shipped (walk-FAIL); v2 PRD open |

### Project lens, workspace, multi-window, vault

| ID | Title | What it added | Status |
|---|---|---|---|
| **ENH-182** | Project-centric UX (filter-lens) | `ProjectRail` tile click re-roots the navigator via `navigateTo(projectRoot)` (D10, not a hard filter) and re-seeds new-tab cwd; navigator root derives from project state; follow-mode moves `nav.cwd` to the active tab's cwd. **Heavy re-root churn driver.** | shipped v0.8.0 |
| **ENH-186** | Project tile abbreviations | Word-aware collision-free tile abbreviations (replaced `name.slice(0,2)` stacks of "AI"). | shipped v0.8.0-era |
| **ENH-167** | Workspace as a File (`.duo-workspace`) | Round-trips workspace incl. navigator state (cwd / pins) to a saved file; restore re-seeds the navigator root. | shipped v0.7.4 |
| **ENH-191** | Multi-window namespacing | Moved `duo.nav.cwd`/`expanded` off the localStorage storage-event bus into **per-window** keys (`duo.nav.v2.w${windowId}.*`); each `WindowContext` owns its navigator; `nav-state`/`--window` addressing resolves the right window. | shipped v0.10.0 |
| **ENH-172** | Show/hide hidden files | Promoted `showDotfiles` to persisted state; View-menu checkbox + ⌘⇧. + `duo hidden-files` verb; `.claude`/`.obsidian` stay always-visible. | shipped 2026-05-22 |
| **ENH-109** | Show `.obsidian/` in a vault | Added `.obsidian` to the always-visible dotfile carve-out (`shouldShow`) — predecessor of ENH-172's carve-out + ENH-208's vault work. | shipped (archive) |
| **ENH-208** | Vault — networked work-notes | Vault detection (`vaultIndex.ts` walking up for `.obsidian/`) + vault-aware affordances; navigator surfaces vault entities. | draft for sign-off (2026-06-09) |
| **ENH-045** | "Project Claude Context" improvements | Collapsible / dynamic-name / project-detection / gh-integration for the navigator's top Claude-context pane. | filed (archive) |

### Chrome interactions & drag (ENH-190 / ENH-207 cluster)

| ID | Title | What it added | Status |
|---|---|---|---|
| **ENH-190** | Temp-widen + drag-to-collapse + resize affordance | Transient peek-widen that eases back, drag-the-right-border-to-collapse-to-rail, hover-reveal resize grip (chrome-only; no tree/selection/cwd change). | shipped v0.9.1 (PR #67) |
| **ENH-201** | Rework the red "Release to collapse" cue | Recolor/replace/remove the red right-border hint that reads as destructive for a non-destructive action. | open (Low) |
| **BUG-197** | Rail-peek commit on file/folder click | ENH-190 defect: peek-commit fires on whitespace click but a row's click handler stops propagation, so a row click doesn't commit the peek. | open (Medium) |
| **ENH-207** | Drag a row → insert its path in the terminal | Draggable per-row content (`onDragStart` carrying `DirEntry.path`) + drop target on the terminal column that `pty.write`s the absolute path + trailing space. | spec locked 2026-06-08 (per FOLLOWUP-043 ref, shipped v0.9.3) |
| **FOLLOWUP-043** | Drop on collapsed terminal rail | ENH-207 follow-up: drop on the 36px collapsed rail expands+spawns instead of expand-then-insert. | open (Low) |

## A.4 Bug history

Two lineages matter most for ENH-211: the **ENOENT / self-heal** lineage (the
navigator must survive a deleted cwd) and the **watch / refresh** lineage (the
chokidar event path — `add` worked, `unlink` initially didn't; later self-heal
was bolted on). ENH-211 is the next chapter of the second lineage.

| ID | Symptom | Fix | Status |
|---|---|---|---|
| **BUG-007** | Deleted files lingered in the navigator until full reload (fs-watch `unlink` not reflected; `add` worked). | `handleEvent` now handles `removed` events — prunes the path from the multi-select map + refetches the parent listing. | ✅ Resolved (Stage 10 watcher + ENH-147/PR #59 self-heal) |
| **BUG-025** | Folder chevron click promoted/opened the row instead of just toggling. | Split the chevron into a discrete button with `e.stopPropagation()`. | ✅ v0.5.0 |
| **BUG-053** | `nav:reveal` opened the parent but didn't highlight/scroll the file; v1 selected the **wrong** navigator instance. | v2 prefix-matches `~/.claude/` and dispatches to `userClaudeNav` for those paths. | ✅ post-v0.5.6 |
| **BUG-105** | Right-click → Copy path was a no-op (clipboard). | Root: `navigator.clipboard.writeText` rejects from a native NSMenu handler (no gesture). Added main-process `clipboard:write-text`; routed all Copy-path sites (incl. FileTree) through it. | ✅ Sprint 10 |
| **BUG-125** | Canvas/editor didn't auto-reload on external Write against **symlinked** paths (`/tmp` → `/private/tmp`). | `files-service.startWatch` keeps a `Map<resolvedPath, callerPath>` (via `realpathSync`) and remaps event paths back before sending. | ✅ v1 (Sprint 17); v2 PRD filed |
| **BUG-132** | Right-click "Open on GitHub" was a no-op — wrong IPC (`openExternal`→`shell.openPath` for a URL). | New `FILES_OPEN_EXTERNAL_URL` IPC (`shell.openExternal` w/ scheme guard). | ✅ Sprint 17 (v0.7.0 rev5) |
| **BUG-135** | Git **ribbon** activates for a cwd that is **not** a repo root (climbs to any ancestor `.git`); GitHub menu items over-claim too. | Proposed: show ribbon iff cwd is at-or-inside a repo root **and** the path doesn't cross a 2+-peer-repo folder (reuse `scanReposIn`, cache per cwd). | 🆕 Filed 2026-05-18, **UNRESOLVED** |
| **BUG-153** | Settings modal occluded by the browser-pane WebContentsView (WCV-above-DOM occlusion class). | Paired `browser.setOverlayMuted(true/false)` on open/close; later superseded by ENH-170 v2 native menu. | ✅ Fixed then superseded 2026-05-22 |
| **BUG-165** | Terminal stuck `[process exited]` when its cwd was deleted; navigator ENOENTs the same dead path. | `core/cwd-utils.ts resolveExistingCwd(desired, fallback)`; `PtyManager.create` resolves cwd before spawn + amber note. **Navigator half NOT covered** → FOLLOWUP-041. | ✅ Terminal half (PR #56); nav deferred |
| **BUG-167** | Project-switch floods console with `[nav] list failed … ENOENT` from ghost expanded folders + focus instrumentation spam. | Shared `pruneDeadPaths.ts` (`findDeadExpandedPaths` + `nearestExistingAncestor`); mount-time prune wired into both hooks; focus logs gated behind `duo.debug.focus`. | 🟡 Folded into PR #59 (2026-05-28) |
| **FOLLOWUP-041** | Navigator still ENOENTs + renders empty on a deleted cwd (terminal recovers, navigator doesn't). | Proposed: navigator path-bind reuses `resolveExistingCwd` — walk up to nearest ancestor, rebind, surface a chip note. | 🆕 Filed 2026-05-26, **UNRESOLVED** |

**Watch/refresh lineage in one line:** Stage 10 shipped the chokidar watcher
(D18) → BUG-007 fixed the missing `unlink` branch → ENH-147 added multi-select
pruning on `removed` → BUG-125 fixed symlink-resolved event paths → ENH-152c
added a **second** (git) watcher with its own invalidation tick. **ENH-211 is the
next chapter: the watcher *correctly* invalidates, but the renderer's reaction to
each invalidation (delete-then-refetch, watcher teardown, whole-tree git
re-render) is what flickers.**

## A.5 Current architecture

### State model

The project navigator's state is owned by `useNavigator(initialCwd)`
(`renderer/hooks/useNavigator.ts`). Its `NavigatorState` (lines 40–58) holds:

- **`cwd`** — the folder shown as the tree root.
- **`selectedItems`** — `Map<path,'file'|'folder'>` (the ENH-147 canonical
  multi-select), with a separate `primaryPath` `useState` (line 105) and a
  derived singular `selected` computed at lines 455–464.
- **`expanded`** — `Set<string>` of unfolded folders.
- **`pinned`** + **`showDotfiles`** — global prefs.
- **`listings`** — `Map<path, DirEntry[] | null>`, where **`null` is the
  "loading" sentinel** (line 57). Root entries render from
  `state.listings.get(state.cwd)` (`FileTree.tsx:100`).

**Persistence** is localStorage, v2 window-namespaced (lines 27–38):
`duo.nav.v2.w${windowId}.cwd` and `.expanded` are per-window, seeded once
read-only from legacy shared keys `duo.nav.cwd` / `duo.nav.expanded`; `pinned`
and `showDotfiles` stay on shared un-namespaced keys as global prefs. Writes
happen in four effects (lines 129–141). A mount-time prune (lines 166–196) drops
persisted dead `expanded`/`cwd` paths via a `dirExists` probe (BUG-167) before
the watcher first subscribes.

The user-claude variant `useUserClaudeNavigator(home)`
(`renderer/hooks/useUserClaudeNavigator.ts`) mirrors the same shape to share
`<TreeNodes>`, but: root is fixed at `~/.claude` (`navigateTo` is a no-op, line
258), `pinned:true` / `showDotfiles:true` are hardcoded (lines 288–289), and the
rendered root comes from a synthesized `curatedRootEntries` array
(CLAUDE.md/skills/agents/duo, lines 145–158) passed via `rootEntriesOverride`,
**not** from `listings.get(cwd)`. Its localStorage keys are separately namespaced
(`duo.userClaude.showAll`/`.expanded`, lines 27–28). It has its own
`selectedItems`/`primaryPath`/`listings` and an `ensureListing` (lines 77–101)
identical to the project pane's **but without the ENOENT self-heal block**.

### Data flow: filesystem event → render

```
 fs write/rename/delete in cwd or a visible folder
        │
        ▼
 chokidar (main)  FilesService.startWatch         electron/files-service.ts:435–483
   depth:0 · ignoreInitial · awaitWriteFinish{150,50}
   ignores .git/.obsidian/node_modules
        │  add | change | unlink | addDir | unlinkDir
        ▼
   send(...) → wc.send(FILES_CHANGED, { id, event })           :462–471
        │
        ▼
 preload  files.watch(paths, cb, opts)            electron/preload.ts:302–318
   mints a FRESH id (w_<ts>_<rand>) per subscribe (line 306),
   filters push.id===id, invokes cb(push.event)
        │
        ▼
 useNavigator  handleEvent(event)                 useNavigator.ts:286–306
   parent = dirname(event.path) || cwd
   setListings: next.delete(parent)   ← DELETE the cached listing   (M1)
   ensureListing(parent)              ← async re-fetch; seeds null   (M4)
   (removed: also prune selectedItems/primaryPath)
        │
        ▼  while the re-fetch promise is pending, listings.get(parent)===null
 FileTree TreeNodes renders literal "Loading…"   FileTree.tsx:1015–1017
   (root rows: rootEntries = state.listings.get(state.cwd), line 100
    → a write IN cwd blanks the WHOLE tree)
```

**Watch subscription lifecycle.** The watch subscription is a `useEffect` with
deps `[cwd, expanded, ensureListing]` (`useNavigator.ts:333`). Cleanup calls
`stop()` (`FILES_WATCH_STOP` → `FilesService.stopWatch` → `fsw.close()`) and the
next run calls `files.watch` again with a **new id** — full teardown + recreate,
**not** the incremental `updateWatchPaths` that `FilesService` already exposes
(`files-service.ts:486–512`, currently unused by the nav). On every resubscribe a
belt-and-suspenders block (316–324) **deletes every visible path's listing** and
re-`ensureListing`s it.

**Git watcher (parallel path).** `FileTree`'s effect (line 302) calls
`git.watchStart({workTreeRoot, cwd})`; `electron/main.ts` (2282–2347) opens a
**separate** chokidar on `cwd` at depth 1, debounced 250ms (`scheduleInvalidate`,
2333–2335), firing `GIT_WATCH_INVALIDATE` to the arming window. The renderer's
`onWatchInvalidate` (FileTree.tsx:313–316) bumps `gitRefreshTick`, which re-runs
three git probes (root status, `childRepoMap` scan via `scanReposIn`, `dirtyFilesFor`).

---

# Part B — ENH-211: Navigator render-stability

## B.1 Problem statement

The navigator flickers and momentarily renders the literal **`Loading…`**
placeholder on **every** filesystem event and **every** git-watch invalidation.
In practice the trigger is **an agent writing files** — the exact scenario Duo
exists for. When Claude edits, creates, renames, or deletes a file in the
navigator's cwd or any visible folder, the affected subtree blanks to `Loading…`
for a frame; a write **directly in cwd** blanks the **whole tree**, because the
root rows derive from `state.listings.get(state.cwd)` (`FileTree.tsx:100`) and
that listing is `delete`d before the refetch. There is **no renderer-side
debounce or coalesce**, so a *burst* of writes — `npm install`, `git checkout`, a
batch agent edit — produces a rapid `delete → null → "Loading…" → refetch` storm:
sustained flashing on the single most-watched pane in the app. Expand/collapse
flickers too (the watcher tears down + every visible folder re-lists), and every
git tick re-renders every row (unmemoized rows + fresh Map identities). This reads
as instability and undermines the navigator's core promise: *"tell me when Claude
modifies a file I'm looking at"* should be a calm, in-place update, not a flash.

## B.2 Root cause — verified mechanisms

Six mechanisms, all confirmed against current source (file:line evidence below).
M1–M3 are **primary** (the visible flash); M4 is the **load-bearing root** that
makes M1/M2 manifest *as flicker* rather than silent swaps; M5/M6 are amplifiers.

| ID | Severity | Mechanism | Evidence |
|---|---|---|---|
| **M1** | primary | `handleEvent` **deletes** the parent dir's cached listing on **every** chokidar event then re-fetches async; during the in-flight window `listings.get(parent)===null` and `TreeNodes` renders `Loading…`. When the mutation is in cwd, `parent===cwd` → the **whole** root listing goes null → whole-tree blank. No renderer debounce, so bursts storm. **Same in the user-claude pane** → bottom pane flickers identically. | `useNavigator.ts:286–294` (`next.delete(parent); ensureListing(parent)`); `FileTree.tsx:1015–1017` (null→`Loading…`); `FileTree.tsx:100` (root = `listings.get(cwd)`); `useUserClaudeNavigator.ts:169–178` (identical delete-then-ensure). |
| **M2** | primary | The watch effect deps are `[cwd, expanded, ensureListing]`, so **any expand/collapse** tears down the chokidar watcher (`stop()` → `fsw.close()`) and re-subscribes with a fresh id (full recreate, not the cheaper `updateWatchPaths`). On each resubscribe a belt-and-suspenders block **deletes every visible folder's listing** and re-lists — expanding ONE folder blanks ALL visible folders. | `useNavigator.ts:333` (deps); 329–332 (cleanup `unwatch()`); 316–324 (resubscribe delete+re-ensure loop); `preload.ts:306` (fresh id per call); `files-service.ts:486–512` (unused incremental `updateWatchPaths`). |
| **M3** | primary | The ENH-152c git watcher (depth 1, 250ms debounce) fires `GIT_WATCH_INVALIDATE` → `gitRefreshTick++` → three probe effects re-run, each producing a **brand-new** `Map`/object identity (`setChildRepoMap(new Map())`, `setDirtyFileMap(new Map(...))`, `setGitSnap`). `TreeNodes`/`TreeNode` are **plain functions (no `React.memo`)**, so a new Map identity re-renders **every** row each tick, even when no row's data changed. `key={entry.path}` only aids reconciliation, not bail-out. | `FileTree.tsx:313–316` (`gitRefreshTick++`); deps at 235, 273, 295; `setChildRepoMap` 258–262, `setDirtyFileMap(new Map(...))` 288; `main.ts:2333–2335` (250ms debounce); `FileTree.tsx:1014` (`export function TreeNodes`), `1077` (`function TreeNode`) — no `React.memo`. |
| **M4** | **root cause of M1/M2 visibility** | Both `ensureListing` impls **seed `null`** (the loading sentinel) before the async list resolves — and `refresh()`/M1's delete force the `has()`-miss so the re-seed always happens. The cache **never holds the prior entries while fetching**; there is no stale-while-revalidate. This is *why* deletes are visible as flicker rather than silent swaps. **Highest-leverage single fix.** | `useNavigator.ts:199–205` (seed null if `!prev.has`), 442–449 (`refresh` deletes then ensures); `useUserClaudeNavigator.ts:77–83`, 246–253 (same). |
| **M5** | secondary (amplifier) | The ribbon-suppression effect (BUG-135) and the `childRepoMap` effect both depend on `gitRefreshTick` and issue their **own** `files.list` / `scanReposIn` / `dirtyFilesFor` probes on each tick. One tracked-file save fans out to: 1 `git.status` + 1 ribbon directory walk (potentially multiple `files.list` climbing to repoRoot) + 1 `scanReposIn` + 1 `dirtyFilesFor` — each resolving at a slightly different time, so the tree repaints **several times** for one event. | `FileTree.tsx:191–235` (ribbon effect, deps incl. `gitRefreshTick`; loops `await files.list` 216 + `scanReposIn` 221); 242–273 (`childRepoMap`); 275–295 (`dirtyFileMap`). |
| **M6** | minor (amplifier) | On cwd change, `git.status` sets `gitSnap`/`gitChip`; a window `'focus'` listener **also** calls `refresh()`, so every app refocus re-probes git and can repaint ("flickers when I click back into the app"). | `FileTree.tsx:123–145` (cwd git refresh); 139–140 (`window.addEventListener('focus', onFocus)`). |

## B.3 Goals / non-goals

**Goals**

- **G1** — A single FILES_CHANGED event for a file in cwd **never** transitions
  `listings.get(cwd)` through `null`; rows stay mounted and visually unchanged
  except for the one row that actually changed.
- **G2** — A burst of N file events in a directory produces **one** re-list per
  directory, not N.
- **G3** — Expand/collapse does **not** blank any already-loaded folder and does
  not tear down + recreate the watcher.
- **G4** — A `gitRefreshTick` whose git state is unchanged yields a
  **referentially-equal** `childRepoMap`/`dirtyFileMap` and re-renders **no** rows.
- **G5** — Both panes (project + user-claude) are covered; the fix is symmetric.

**Non-goals**

- **N1** — No change to navigator behavior, layout, selection, cwd-follow, pins,
  dotfile filtering, keyboard nav, or git-status **semantics** (what the chips
  say). This is render-stability only — the chip *content* is BUG-135's job, not
  ENH-211's.
- **N2** — Not fixing the ENOENT self-heal gap (FOLLOWUP-041) or the ribbon
  over-claim (BUG-135); those are separate tickets, merely adjacent.
- **N3** — No new CLI verb / IPC contract change is *required* (an optional
  combined git-probe IPC under D5 is called out but gated as P1-optional, behind
  the 4-surface sync rule if exposed).
- **N4** — No move to a virtualized tree / React Query / external store. The fix
  stays within the existing hook + component shape.

## B.4 Proposed solution — D-numbered decisions

Priority key: **P0** = kills the visible flash (ship first, standalone);
**P1** = polish / churn reduction (ship second).

### D1 (P0) — Stale-while-revalidate the listings cache *(addresses M1, M4)*

**Change.** In `handleEvent` and `ensureListing`/`refresh`, **stop deleting** the
cached `DirEntry[]` before re-fetching. Keep the previous array in the `listings`
Map and **overwrite only when the new list resolves**. The `null` sentinel is
reserved for the *first-ever* load of a path (when there is genuinely nothing to
show). If a spinner is ever wanted, track a separate `refreshing: Set<string>`
rather than nulling the data.

**Files.** `renderer/hooks/useNavigator.ts` (`handleEvent` 286–294, `ensureListing`
199–205, `refresh` 442–449) **and** `renderer/hooks/useUserClaudeNavigator.ts`
(169–178, 77–83, 246–253) — symmetric edit, per **G5**.

**Trade-off.** A brief window (≤ one `fs.readdir`, ~ms) where a just-deleted
file's row is still shown before the refetch resolves and removes it. This is
standard stale-while-revalidate behavior and imperceptible; the `removed`-event
path *already* prunes `selectedItems` synchronously, so selection state stays
correct even during that window.

**Recommendation.** **Do this first.** Per the verification verdict, M4 is the
load-bearing cause — a stale-while-revalidate hold at `ensureListing` masks M1
**and** M2's visible flash even before touching the delete-then-refetch pattern
or the watcher lifecycle. Highest payoff, lowest risk.

### D2 (P0) — Coalesce/debounce file events renderer-side *(addresses M1)*

**Change.** Collect event parent-dirs into a `Set<string>` and flush via a single
trailing-edge debounce (80–120ms) before re-listing, so a burst (`npm install`,
`git checkout`, agent batch-write) produces **one** re-list per dir instead of N.
Pairs naturally with D1.

**Files.** `renderer/hooks/useNavigator.ts` (`handleEvent`); mirror in
`useUserClaudeNavigator.ts`.

**Trade-off.** Up to ~100ms latency before the tree reflects a *single* manual
change — imperceptible, and the main-process watcher already imposes
`awaitWriteFinish{stabilityThreshold:150}` so the perceived floor is unchanged.

**Recommendation.** Ship with D1 as the P0 pair. D1 removes the *visible* flash;
D2 removes the *redundant work* and the residual micro-jank under bursts.

### D3 (P1) — Drop the resubscribe-nuke; use incremental watch updates *(addresses M2)*

**Change.** Split the watcher **lifecycle** from the watched **path set**. Create
the chokidar subscription once (effect deps `[]`, or keyed only on `windowId`)
and, on `[cwd, expanded]` changes, call the already-built
`FilesService.updateWatchPaths` (`files-service.ts:486–512`) instead of
`stop()` + `watch()`-with-new-id. **Delete** the belt-and-suspenders re-list loop
(`useNavigator.ts:316–324`) entirely, or scope it to **only the newly-added
paths**.

**Files.** `renderer/hooks/useNavigator.ts` (watch effect 264–333),
`electron/preload.ts` (expose `updateWatchPaths` if not already surfaced to the
renderer; `files-service.ts` already implements it). Mirror in
`useUserClaudeNavigator.ts` if it runs its own watcher.

**Trade-off.** Must verify the sub/resub gap the belt-and-suspenders block was
guarding against is covered by incremental `add()` — in practice `add()` attaches
before events can be missed, but this needs a regression test (B.6). Slightly
more state to track (the current path set vs. the desired path set).

**Recommendation.** P1. After D1+D2 the expand/collapse flash is *already
invisible* (stale-while-revalidate holds the old rows), so D3 is primarily a
**chokidar-churn / efficiency** win (no `close()+reopen` of N inotify watches per
toggle) rather than a visible-flicker fix. Worth doing, not urgent.

### D4 (P1) — Memoize `TreeNode` and pass per-row git data as primitives *(addresses M3)*

**Change.** Wrap `TreeNode` (and/or `TreeNodes`) in `React.memo` with a custom
comparator. **Stop threading whole Maps** (`childRepoMap`/`dirtyFileMap`, whose
identity changes every tick) to every row; instead compute the scalar each row
needs (`repoChip?`, `dirty?`) at the `FileTree` level and pass **only that
scalar**, so a tick that changes one file's dirty state re-renders only that row.

**Files.** `renderer/components/FileTree.tsx` (`TreeNodes` 1014, `TreeNode` 1077;
prop plumbing from the Map states 258–295 down to rows).

**Trade-off.** The `memo` comparator **must** include every per-row reactive flag
— `selected`, `expanded`, `active`, `dirty`, `repoChip`, rename-mode — or rows go
stale. Moderate care; a missed flag is a visible "row didn't update" bug, so this
needs explicit test coverage (B.6).

**Recommendation.** P1. Real win for large trees under an active git watcher, but
gated on D5 (without stable Map identity upstream, memoization at the row level is
fighting churn it could instead eliminate).

### D5 (P1) — Stabilize git Map identity + (optional) coalesce the three probes *(addresses M3, M5, M6)*

**Change.** In `setChildRepoMap` / `setDirtyFileMap` / `setGitSnap`, **bail out
when the newly-computed value is deep-equal to the previous** (`return prev`), so
a `gitRefreshTick` that changes nothing yields a referentially-equal Map and
re-renders no rows (satisfies **G4** directly). Optionally **coalesce** the three
git probes behind one combined main-process call returning
`{status, childRepos, dirtyFiles}`, so one save = one renderer state update
instead of three independently-resolving `setState`s (kills M5's repaint-several-
times-per-event fan-out). Also make the cwd/focus `git.status` refresh idempotent
(return-prev guard) so refocus doesn't repaint unchanged git state (**M6**).

**Files.** `renderer/components/FileTree.tsx` (the three probe effects 191–295,
the focus listener 139–140). If the combined-probe IPC is added:
`electron/main.ts` (git-watcher region) + `electron/preload.ts` + the 4-surface
CLI sync (`cli/duo.ts`, `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md`)
**only if** the verb is exposed externally — internal-only if not (preferred,
keeps N3).

**Trade-off.** A deep-equal check per tick (cheap relative to the
`scanReposIn`/`dirtyFilesFor` it gates). The combined IPC is plumbing cost; keep
it **internal-only** to avoid the 4-surface sync tax unless an agent needs it.

**Recommendation.** P1. The deep-equal/return-prev guard is the cheap half and
pairs with D4 (memoization is only effective once upstream identities are stable).
Treat the combined-probe IPC as optional — do it only if profiling shows the
3-probe fan-out is still visible after the guard.

### Decision summary

| ID | Priority | Targets | One-line | Recommend |
|---|---|---|---|---|
| **D1** | **P0** | M1, M4 | Stale-while-revalidate (don't delete before refetch) | **Ship first — the flash-killer** |
| **D2** | **P0** | M1 | Coalesce/debounce fs events (80–120ms trailing) | Ship with D1 |
| **D3** | P1 | M2 | Incremental `updateWatchPaths`; drop resubscribe-nuke | Churn win, after P0 |
| **D4** | P1 | M3 | `React.memo` rows + per-row primitive git props | After D5 |
| **D5** | P1 | M3, M5, M6 | Deep-equal git Map guard (+ optional combined probe) | Cheap half first; pairs with D4 |

## B.5 Acceptance criteria & verification

**Repro (the canonical trigger):** with the navigator rooted at a project cwd
that is a git repo, run a Claude session (or a shell) in the active terminal and
have it write/rename/delete files **in cwd and in an expanded subfolder**, both
singly and in a burst (`npm install` or a `git checkout` of a busy branch).

| # | Criterion | How to verify |
|---|---|---|
| **AC1** | A single write in cwd does **not** flash `Loading…`; the tree stays fully painted, only the changed row updates. | Live smoke-walk; DOM probe (`duo eval`) asserting no `.nav-loading`/`Loading…` text node appears for the cwd listing across a write. |
| **AC2** | A **burst** of writes produces a calm, in-place tree — no sustained flashing; one re-list per dir. | Live: `npm install` in cwd; watch the navigator. Instrument: count `files.list` calls per dir per burst (should be ~1). |
| **AC3** | Expanding/collapsing a folder does **not** blank any already-loaded sibling folder, and does **not** close+reopen the chokidar watcher. | Live: expand several folders rapidly. Instrument: assert `FILES_WATCH_STOP` is not fired on toggle (D3). |
| **AC4** | A git tick with **unchanged** git state re-renders **no** rows. | Unit/RTL: fire `GIT_WATCH_INVALIDATE` with identical git data; assert `childRepoMap`/`dirtyFileMap` are referentially equal and `TreeNode` render count is unchanged. |
| **AC5** | The **user-claude** bottom pane is equally stable under the same events. | Live: write a file under `~/.claude`; the bottom pane does not flash. |
| **AC6** | No regression: single-click select/open, multi-select, expand persistence, dirty dots, repo chips, dotfile toggle, reveal-and-select still work. | Smoke-walk regression block. |

**Verification note (per the verify-UI rule):** drag/flash behavior is not
exercisable headlessly. A macOS dev-session smoke-walk is owed before any cut;
the agent-writes-files-in-cwd repro must be walked live, and the `Loading…`-frame
absence confirmed via a `duo eval` DOM probe (mutation-observer or
listings-snapshot) rather than a screenshot, since the flash is sub-frame.

## B.6 Test / regression coverage owed

Per the recurring-regression rule (MEMORY: *"recurring regressions need durable
test coverage"*), the watch/refresh lineage (BUG-007 → ENH-147 → BUG-125 →
ENH-152c → ENH-211) has churned the same code repeatedly with no invariant test.
ENH-211 **must** land regression tests, not just a smoke-checklist line:

- **T1 (stale-while-revalidate invariant, D1):** assert that a single
  FILES_CHANGED event for a file in cwd does **not** transition
  `listings.get(cwd)` through `null` — the prior `DirEntry[]` identity is held
  until the refetch resolves, then replaced. Cover both hooks.
- **T2 (coalesce, D2):** fire N FILES_CHANGED events for the same dir within the
  debounce window; assert exactly **one** `files.list` call results.
- **T3 (watcher stability, D3):** toggle `expanded`; assert the watcher is **not**
  stopped/recreated and that `updateWatchPaths` is called with the delta only.
- **T4 (git identity stability, D4/D5):** fire `GIT_WATCH_INVALIDATE` with
  unchanged git data; assert `childRepoMap`/`dirtyFileMap` are referentially
  equal (return-prev) and the row render count does not increase.

Suggested home: `renderer/hooks/useNavigator.flicker.test.ts` (+ a `FileTree`
RTL render-count test for T4). These mirror the existing
`pruneDeadPaths.test.ts` (BUG-167) and `cwd-utils.test.ts` (BUG-165) precedents.

---

# Part C — Execution plan (sequenced after ENH-210)

## C.1 Sequencing assumption

ENH-210 (worktree-aware Duo — sibling branch
`claude/youthful-chebyshev-885712`, HEAD `2426a5a`) **lands on `main` first**;
ENH-211 then **rebases onto post-ENH-210 `main`**. ENH-210's only genuine unique
delta vs current `main` (`da2da9d`, v0.10.1) is a **new research playground**
(`docs/research/worktree-ux.html`, +981, cannot conflict) plus **top-of-ledger
entries** in `tasks.md` and `docs/dev/active-sprint.md`. ENH-210 touches **no
navigator code** — so every code surface ENH-211 edits is disjoint; the only
merge work is the two append regions.

> Note on the scouted "sibling App.tsx (+22/-8), `core/pty-manager.ts`,
> `core/constants.ts`" hunks: per the conflict verification verdict these are the
> **BUG-200** terminal-column floor fix, computed against the *stale* merge-base
> `820bf58`. They are sibling-unique vs `main` but **terminal-column only** (the
> `aria-label="Terminal column"` region), disjoint from the navigator. They are
> **not** part of ENH-211's surface and cannot double-apply onto a base that
> already contains BUG-200.

## C.2 Conflict matrix (verified)

| File | Risk | Why | Mitigation |
|---|---|---|---|
| `renderer/hooks/useNavigator.ts` | **none** | ENH-210 does not touch any navigator hook. D1/D2/D3 edits are entirely ours. | Land freely. |
| `renderer/hooks/useUserClaudeNavigator.ts` | **none** | Untouched by ENH-210. | Land freely. |
| `renderer/components/FileTree.tsx` | **none** | Untouched by ENH-210. D1/D4/D5 edits are ours. | Land freely. |
| `electron/files-service.ts` | **none** | Untouched by ENH-210 (chokidar debounce/coalesce + `updateWatchPaths` exposure is ours). | Land freely. |
| `electron/main.ts` (git-watcher 2282–2347) | **none** | ENH-210 does not modify `main.ts`. (BUG-200's PTY_KILL path is already in our shared base.) | Land freely. |
| `electron/preload.ts` (`files.watch` ~302) | **none** | Untouched by ENH-210. | Land freely. |
| `renderer/App.tsx` | **none** | ENH-210 makes **zero** App.tsx changes vs current `main`. The `+22/-8` terminal-column hunk is BUG-200 (already in base). Our work, if any, is near the navigator mount (the `useNavigator`/`useUserClaudeNavigator` call sites ~L321–325) — there is no literal `<FileTree>` JSX in App.tsx — far from the terminal column. | None; no double-apply. |
| `tasks.md` | **low** | Both ENH-210 and our ENH-211 insert a new `###` entry at the **top** of the ledger (right after the legend header). Git flags a textual conflict at that shared anchor if the sibling lands first. Additive, not semantic. | **Accept-both** on rebase, or append the ENH-211 block **below** the ENH-210 block to avoid touching the same first line. |
| `docs/dev/active-sprint.md` | **low** | ENH-210 inserts a new `## BUG-200` section at line 3 (right after the H1). **(Corrects the scouted "zero delta" claim — verified +16.)** If ENH-211 adds a top section it meets the same anchor. | Append the ENH-211 note **below** the ENH-210/BUG-200 block, or accept-both. |
| `docs/research/worktree-ux.html` | **none** | New ENH-210 file; we don't touch it. | n/a. |

**Net:** code surfaces are fully disjoint. The only genuine merge labor is two
**append-region** text conflicts (`tasks.md`, `active-sprint.md`), both mechanical
accept-both.

## C.3 Step-by-step landing plan

1. **Wait for / rebase onto ENH-210.** Do not branch ENH-211 work onto the stale
   base. Once ENH-210 merges to `main`, rebase the ENH-211 branch onto
   post-ENH-210 `main`. Resolve the two append-region conflicts mechanically
   (accept-both; place the ENH-211 entry just **below** the ENH-210 block in both
   `tasks.md` and `active-sprint.md`).
2. **File ENH-211 in `tasks.md`** (append, don't edit) with the M1–M6 file:line
   map and the D1–D5 plan, cross-linking BUG-135 / FOLLOWUP-041 / ENH-152c /
   ENH-207. Add a one-line `active-sprint.md` pointer.
3. **Implement P0 (D1 + D2) as the standalone flash-killer.** Stale-while-
   revalidate `listings` (both hooks) + renderer-side coalesce/debounce. This
   alone removes the visible `Loading…` flash and the burst storm — it is
   shippable on its own and is the recommended first cut. Add tests **T1, T2**.
4. **Implement P1 (D3 watcher lifecycle, then D5 git-identity guard, then D4 row
   memoization).** Order matters: D5's stable Map identity is the precondition for
   D4's memoization to bail out cleanly. Add tests **T3, T4**.
5. **Smoke-walk + cut.** Run `/smoke-walk` (the change touches `renderer/`) using
   the B.5 repro — agent writes files in cwd + a burst — and confirm the
   `Loading…`-frame absence via a `duo eval` DOM/mutation probe (the flash is
   sub-frame; a screenshot won't catch it). Then propose a cut via `cut-version`.
   P0 (D1+D2) may cut independently of P1 if owner prefers an early flash-fix.

**Git/rebase mechanics for the two text conflicts.** Both are additive top-of-file
inserts. On `git rebase main`, when `tasks.md` / `active-sprint.md` conflict,
**keep both blocks** (the incumbent ENH-210 block stays where it merged; the
ENH-211 block goes directly beneath it) — never delete the sibling's lines. Then
`git add` + `git rebase --continue`. **Ticket-number check (per the multi-agent
collision rule):** ENH-211 is currently **collision-free** — verified across all
sibling worktrees, only `youthful-chebyshev` holds ENH-210 and no worktree holds
ENH-211. Re-grep sibling worktrees' `tasks.md` for `ENH-211` immediately before
committing; if a third agent grabbed it in the interim, renumber the **unmerged**
(ours) entry, not the incumbent.

## C.4 Risks & rollback

| Risk | Mitigation |
|---|---|
| Stale-while-revalidate briefly shows a just-deleted file's row (≤ one `readdir`). | Standard SWR behavior; `removed` events already prune `selectedItems` synchronously so selection is correct. Acceptable; documented in D1. |
| D3 incremental-watch misses an event during the sub/resub gap the belt-and-suspenders block guarded. | T3 regression test asserts no missed events on rapid toggles; `add()` attaches before events fire in practice. If a gap is found, retain a *scoped* re-list of **only newly-added** paths (not all visible). |
| D4 `memo` comparator omits a per-row flag → a row goes stale (doesn't repaint). | T4 + an explicit comparator checklist (selected/expanded/active/dirty/repoChip/rename). Ship D5 (stable identity) before D4 so the comparator surface is minimal. |
| Coalesce debounce (D2) delays a manual single change perceptibly. | 80–120ms trailing window is below the perception floor and below the main-process `awaitWriteFinish{150}` the user already lives with. |
| Rebase mis-resolves an append region (drops the sibling's ENH-210 entry). | Accept-both rule is mechanical; verify post-rebase that both ENH-210 and ENH-211 entries are present in `tasks.md` and `active-sprint.md` before committing. |
| **Rollback:** each D is independently revertible. | D1+D2 are a self-contained P0 commit; D3/D4/D5 are separate P1 commits. Reverting any P1 commit leaves the P0 flash-fix intact. |

---

## Cross-refs

**Related tickets.** ENH-152c (the git watcher = M3 substrate), BUG-007 / ENH-147
(the `removed`-event + multi-select-prune lineage), BUG-125 (symlink-resolved
event paths), BUG-167 / FOLLOWUP-041 / BUG-165 (ENOENT self-heal lineage — adjacent,
not in scope), BUG-135 (ribbon over-claim — adjacent git-semantics bug),
ENH-182 (project-lens re-root churn that compounds flicker), ENH-191 (per-window
nav namespacing), ENH-207 (sibling open navigator increment), ENH-210 (sequencing
predecessor — worktree-aware Duo).

**Touched files.** `renderer/hooks/useNavigator.ts`,
`renderer/hooks/useUserClaudeNavigator.ts`, `renderer/components/FileTree.tsx`,
`electron/files-service.ts`, `electron/main.ts` (git-watcher ~2282–2347),
`electron/preload.ts` (`files.watch` ~302); new test
`renderer/hooks/useNavigator.flicker.test.ts` (+ a `FileTree` render-count RTL
test). Ledger: `tasks.md`, `docs/dev/active-sprint.md` (append regions).
