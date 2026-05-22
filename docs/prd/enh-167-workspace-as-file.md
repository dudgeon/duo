# ENH-167 — Workspace as a File

**Status:** ✅ Shipped 2026-05-21 in v0.7.4
**Author:** Geoff + Claude (paired)
**Lineage:** Builds on Stage 21c Phase 2 (autosave / session restore, v0.4.2)

---

## Problem

Duo's autosave (Stage 21c) persists every tab/terminal/browser change to
`~/.claude/duo/session-state.json` so a quit-and-relaunch picks up exactly
where the user left off. That's good for crash resilience, but the user
has no way to:

1. Bookmark a specific configuration of tabs/terminals as "the X
   workspace" they can come back to later.
2. Switch between named workspaces without manually rebuilding the tab
   set each time.
3. Share or back up a working setup as a portable artifact.

Owner kickoff (2026-05-21):

> "I want to be able to save a 'session' (file > save session, file >
> open session); the session is basically the autosave data that duo
> uses to reload all open tabs when you quit and restart — but we will
> expose this as a file type, allowing a person to put down one
> session, and pick up another; we should also have 'open recent'."

---

## Goal

Round-trip the running Duo workspace (terminals at CWDs, file tabs,
browser tabs, navigator state, split-view aux) to a user-saved
`.duo-workspace` file. Surface this as native macOS File-menu items
(`Save Workspace…`, `Open Workspace…`, `Open Recent Workspace ▸`) and
CLI verbs (`duo workspace <op>`), driven by the same persistence layer
the autosave already uses.

---

## Naming: "Workspace" not "Session"

**Original implementation used "session"; renamed to "workspace" on
owner directive 2026-05-21.**

The collision: Claude Code calls each agent loop inside a terminal a
**Claude session**. Saying "new session" in Duo was ambiguous —
*new Claude session*? *new Duo workspace*?

Verbal clarity test:
- ❌ "Did you start a new session?" — Claude or Duo?
- ✅ "Did you start a new workspace?" — unambiguous.

Industry precedent: IDEs (VS Code `.code-workspace`, JetBrains
Workspace) use **workspace** for exactly this concept — the
collection of open tabs/files/terminals in a single window. Duo is
more IDE-shaped than terminal-shaped, so the IDE convention fits.

Alternatives considered:
- **Layout** — too narrow (suggests window arrangement, not the
  whole set of open things).
- **Space** — Arc / new Chrome convention. Modern but less
  established for desktop apps; might feel browser-y.
- **Project** — IDE convention (PyCharm). Implies a directory
  association, which Duo doesn't have — Duo workspaces can span
  multiple working directories.

---

## Decisions (4 owner-locked AUQs, 2026-05-21)

| # | Question | Answer |
|---|---|---|
| 1 | What goes in the file? | Autosave shape (`SessionState`) + a `name` field. Defaults to filename sans `.duo-workspace`. |
| 2 | What happens to current tabs on Open? | Replace current workspace entirely. Prompt to save current first (Save / Don't Save / Cancel). |
| 3 | Where do `.duo-workspace` files live? | Wherever the user picks via standard macOS Save dialog. Extension: `.duo-workspace`. |
| 4 | Open Recent — how many entries / how to prune? | 10 entries, prune-missing-on-open (silently drop entries whose file no longer exists on disk). |

### v1.1 decisions — "New Workspace" semantics (owner reframe, same day)

Owner: *"new session should actually clear the current session (with
warning if current session unsaved); clear the terminal tabs (only
one terminal tab remains w current CWD from front most terminal tab
pre new session), all canvas tabs gone except pinned."*

`New Workspace` was originally just "clear the active-workspace
pointer." Reframed to **reset the workspace in-place**:

| # | Question | Answer |
|---|---|---|
| 1 | Prompt button labels | Save / Don't Save / Cancel (same as Open) |
| 2 | When does the prompt fire? | Whenever any terminal or file tab is open |
| 3 | What kind of surviving terminal? | Always a shell at the live CWD (not Claude) |
| 4 | What about pinned browser tabs? | Survive alongside pinned file tabs |

### v1.2 stretch — title-bar badge + autosave mirror (owner ask, same day)

Owner: *"for a saved session, adding the session name to the top bar
of the app (and just blank if file new session but no save). We also
did not discuss, but I think it was implied: auto save should continue
to function, updating the current session if saved of unsaved."*

1. **Title-bar badge** — workspace name shown in the renderer's
   in-app titlebar (right of the macOS traffic lights), blank when
   untitled. Pushed via a new `WORKSPACE_FILE_ACTIVE_CHANGED` IPC
   channel so the badge tracks live without polling.
2. **Autosave mirror** — every flush of `session-state.json` also
   writes the active `.duo-workspace` (if one is loaded). The
   `.duo-workspace` is the **live** workspace, not a snapshot of the
   last manual save.

---

## Architecture

### Three new core services

| Service | Storage | Role |
|---|---|---|
| `WorkspaceFileService` | User-picked path | Atomic save/load of the `.duo-workspace` envelope. Stateless. |
| `WorkspaceHistoryService` | `~/.claude/duo/workspace-history.json` | LRU-by-`lastOpenedAt`, capped at 10, prune-missing-on-list. Mirrors `BrowserHistoryService`. |
| `ActiveWorkspaceService` | `~/.claude/duo/active-workspace.json` | Pointer to the currently-loaded workspace file (`{path, name}` or `null` for untitled). |

### File envelope

```json
{
  "schemaVersion": 1,
  "name": "<human-readable name>",
  "savedAt": "<ISO timestamp>",
  "appVersion": "<duo version at save time>",
  "state": { /* the Stage 21c SessionState autosave shape */ }
}
```

The inner `state` is the existing `SessionState` (`terminals[]`,
`fileTabs[]`, `browserTabs[]`, `activeWorking`, `aux`, etc.) —
zero new schema for the workspace's contents. The envelope just adds
a name + version metadata.

### Save Session bypasses the autosave debounce

The renderer's autosave debounce is 500 ms + 250 ms (renderer + main).
On manual Save Workspace, we want the **right-now** state, not a
500-1000 ms-old snapshot. New IPC pair:

- `SESSION_STATE_SNAPSHOT_REQUEST` (main → renderer)
- `SESSION_STATE_SNAPSHOT_RESULT` (renderer → main)

Renderer extracts `buildSessionSnapshot()` from the existing autosave
effect so the same code path computes the state for both autosave and
Save Workspace.

### Open Workspace = in-place reset (not `app.relaunch()`)

**Original implementation used `app.relaunch() + app.exit(0)`. Replaced
with in-place reset on day 1 after `app.relaunch()` in dev mode killed
the Vite dev server and produced a blank window.**

In-place reset steps (in `electron/main.ts § applyNewSessionState`):

1. Write the new `SessionState` to `~/.claude/duo/session-state.json`.
2. Close every browser tab cleanly via `browserManager.closeTab(id)` in
   reverse (preserves CDP, closes WCVs).
3. Dispose every PTY via `ptyManager.dispose()`.
4. Re-arm the BUG-057 browser-pin-restore on the **next**
   `did-finish-load` (the original is `once` and already consumed).
5. `mainWindow.webContents.reload()` — fresh React mount runs the
   existing boot-time `SESSION_STATE_LOAD` restore against the new
   state. Pinned tabs auto-restore via the existing hooks.

Properties:
- **No process exit** — the same `mainWindow` survives, just the
  renderer is fresh. Works uniformly in dev and packaged.
- **Faster than relaunch** — ~200 ms vs ~2 s (no process spawn cost).
- **Memory-safe** — disposes PTYs + closes WCVs explicitly so they
  don't leak across resets.

### New Workspace reset (v1.1)

Same in-place reset path, but the new state is a **skeleton**:

```ts
{
  terminals: [{ cwd: <live CWD from lsof>, kind: 'shell', title }],
  activeTerminalIndex: 0,
  browserTabs: [],   // pinned ones auto-restore via BUG-057 block
  fileTabs: [],      // pinned ones auto-restore via App.tsx § pinAutoOpenRanRef
  aux: null,
  navigatorPath: '',
  // ...
}
```

Live CWD detection uses `lsof -a -d cwd -p <pid> -Fn` against the
previously-frontmost terminal's PID, with the persisted spawn CWD as
fallback. macOS-only; failures fall back gracefully.

### Autosave mirror (v1.2)

`SessionStateService` now accepts an optional `mirrorHook` that
fires inside `flush()` (so it's debounced by the same 250 ms as the
primary write). Main wires the hook:

```ts
sessionStateService.setMirrorHook(async (state) => {
  const active = activeWorkspaceService.get()
  if (!active) return
  await workspaceFileService.save(active.path, active.name, state, app.getVersion())
})
```

No-op when untitled. Every state change updates both:
- `~/.claude/duo/session-state.json` (autosave)
- `<active workspace path>.duo-workspace` (mirror)

### Title-bar badge (v1.2)

The renderer's in-app titlebar (`App.tsx § titlebar-drag block`)
already painted the version diagnostic on the right. The badge adds a
new flex-1 spacer with the workspace name on the LEFT (right of the
macOS traffic lights at x=16). State is driven by:

1. `window.electron.workspaceFile.active()` on mount (initial load).
2. `window.electron.workspaceFile.onActiveChanged()` subscription
   (live updates on every Save / Save As / Open / Open Recent / New).

Main pushes `WORKSPACE_FILE_ACTIVE_CHANGED` from `applyWindowTitle()`,
which runs on every active-pointer mutation.

### File menu structure

```
File
  New Workspace
  Save Workspace…
  Save Workspace As…
  Open Workspace…
  Open Recent Workspace ▸
    <recent 1>
    <recent 2>
    …
    ───
    Clear Recent Workspaces
  ───
  Clone from GitHub…   ⌘⇧K
```

No accelerators on the workspace items to avoid clashing with the
editor's ⌘S (markdown save) and browser pane's ⌘O.

### CLI parity

```
duo workspace save [<path>] [--name <name>] [--save-as]
duo workspace open <path>
duo workspace list-recent
duo workspace current
duo workspace new
```

Same in-place reset under the hood; CLI skips the GUI Save-current
prompt (agent caller is presumed deliberate, matches the convention
for other write verbs).

---

## Alternatives considered

### A. Symlink-based session bookmarks

Have the user create symlinks at `~/.claude/duo/saved-sessions/<name>`
pointing at snapshots of `session-state.json`. Lightweight, no new
file format.

**Rejected:** Symlinks aren't a "file the user can save to my Desktop
and double-click to open." The whole point of the feature is the
file-icon-and-double-click experience.

### B. Full `app.relaunch()` on open

Original v1 implementation. Works in packaged builds; breaks in dev
because `npm run dev` (electron-vite dev) dies along with Electron.

**Rejected:** ENH-167 v1.1.1 same-day after blank-window bug.
In-place reset is faster anyway.

### C. Per-pack workspaces (Stage 18b PACK.json defaults)

The existing distro packs (Stage 18b) already auto-open default tabs
on first launch via `packs/<name>/PACK.json § defaults[]`. We could
extend packs to be the "saved workspace" surface.

**Rejected:** Packs are author-time artifacts intended for distribution
(a curriculum author packages a lesson). Workspaces are user-time
artifacts (I want to save MY context). Conflating them would muddy the
mental model.

### D. Browser-tab-style workspace switcher (Arc-inspired)

Modern browsers (Arc, new Chrome) have inline "Space" switchers in
the sidebar. Could ship that instead of File menu + Open Recent.

**Deferred:** v1 lands as native File-menu commands because that
maps to user expectations from every other macOS app. A future
sidebar switcher is a UX layer on top of the same persistence model
— doesn't preclude shipping the file-based version first.

---

## Validation

### Smoke walk

`docs/dev/smoke-walks/v0.7.4.json` covers 14 items:
- Save / Save As dialog flows (3)
- Open / Open Recent flows (4)
- New Workspace reset semantics (3)
- Clear Recent + cleanup (2)
- v1.2 title-bar badge + autosave mirror (2)

All 12 items in the original manifest pre-walked via computer-use on
2026-05-21. v1.2 items walked via CLI verification.

### Key verifications passing

- Live CWD detection works: `cd /tmp` in terminal → New Workspace →
  new terminal lands at `/private/tmp` (not the spawn `/stoop`).
- Pinned tabs survive resets: file pins via `App.tsx § pinAutoOpenRanRef`,
  browser pins via `electron/main.ts § BUG-057` block.
- Autosave mirror updates `.duo-workspace` on every state change; no-op
  when untitled (verified mtime advances on titled workspace, stays
  unchanged when untitled).
- In-place reset works in dev (no blank-window regression).
- Title-bar badge tracks live across Save / Open / New.

---

## Risks + follow-ups

### Cross-machine portability

A `.duo-workspace` file persists absolute paths (file tabs, terminal
spawn CWDs). Opening it on a different machine where those paths don't
exist results in silently-dropped file tabs (existing BUG-039 logic
handles this) and terminals landing at the user's `$HOME` (PtyManager
fallback). **Not blocking v1**; if cross-machine becomes a real demand,
add a path-rewriting pass on load.

### Live CWD detection is macOS-only

`lsof` is the live-CWD source. Linux would use `/proc/<pid>/cwd`;
Windows has its own API. **Not blocking v1** — Duo is macOS-only today.
Worst case on non-macOS: fall back to spawn CWD (already the fallback
path).

### Workspace name is from filename

The save dialog takes the filename and strips `.duo-workspace` to seed
the name. There's no separate "rename workspace" gesture today — to
rename, the user does Save Workspace As. **Acceptable for v1**; can
add inline rename later.

### Mirror write amplification

Every autosave flush (~500 ms) writes BOTH `session-state.json` and
the active `.duo-workspace`. That's 2× the disk I/O of pre-v1.2.
**Acceptable** — atomic-write-rename is ~10 ms per file on SSD;
modern macOS handles this without bottoming out. Future optimization:
diff and skip the mirror write if state is identical to last write.

---

## Files touched (final)

**New (3):**
- `core/workspace-file-service.ts`
- `core/workspace-history-service.ts`
- `core/active-workspace-service.ts`
- `docs/prd/enh-167-workspace-as-file.md` (this doc)

**Modified (significant):**
- `shared/types.ts` — `WorkspaceFile`, `WorkspaceFileOp`,
  `WorkspaceHistoryEntry`, `ActiveWorkspace`, IPC channels.
- `shared/host-api.ts` — `ElectronWorkspaceFileAPI`.
- `electron/main.ts` — service singletons, IPC handlers, dispatch
  helpers (`saveWorkspaceFile`, `openWorkspaceFile`, `newWorkspaceReset`,
  `applyNewSessionState`, `promptToSaveCurrentWorkspace`,
  `applyWindowTitle`, `rebuildAppMenu`, `buildRecentWorkspacesSubmenu`,
  `getLiveCwdForPid`), File menu items, before-quit flush, NavBridge
  methods.
- `core/session-state-service.ts` — `setMirrorHook()` for the v1.2
  autosave-to-`.duo-workspace` mirror.
- `core/socket-server.ts` — new `case 'workspace':` with op union.
- `cli/duo.ts` — `case 'workspace':` verb + help text.
- `electron/preload.ts` — `workspaceFile` API surface.
- `renderer/App.tsx` — `activeWorkspace` state + subscribe + titlebar
  badge.
- `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md` — verb
  cheat-sheets.
- `tasks.md`, `docs/dev/active-sprint.md` — ENH-167 entry.
- `docs/dev/smoke-walks/v0.7.4.json` + `.html` — walk manifest +
  generated page.

---

## Related

- **Stage 21c Phase 2** (v0.4.2) — the autosave / boot-time restore
  this feature builds on.
- **BUG-057** — pinned browser tab restore on boot. Re-armed on each
  in-place reset for v1.1+.
- **`feedback_research_reports_must_file_review_task.md`** — the rule
  this PRD honors (research docs file tracked review tasks).
