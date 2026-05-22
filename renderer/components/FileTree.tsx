// Stage 10 Phase 4 — file tree with lazy-loaded children.
//
// The tree renders the navigator's current folder. Folder rows have a
// dedicated chevron button that toggles expansion (Stage 26 item 1b /
// BUG-025); the rest of the row is select-on-single, open-on-double
// (Stage 26 item 1). Expanded folders fetch their own listings via
// `useNavigator.ensureListing` (called through the hook). Files open
// via the passed-in `onOpenFile` callback (routed to WorkingPane in
// App.tsx).
//
// Stage 10 Phase 7: right-click context menu (§ D11) — Open terminal
// here / Reveal in Finder / Copy path / Open with default app / Open in
// Duo editor.
//
// Stage 26 item 6: right-click context menu also exposes Rename + Move
// to Trash. Rename flips the row's label into an inline <input>; trash
// uses shell.trashItem after a window.confirm. Both have CLI parity at
// `duo file rename / trash`.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DirEntry, MenuTemplateItem, NavPinEntry, GitStatusSnapshot } from '@shared/types'
import { formatGitStatusChip, formatGitStatusTooltip, repoBasenameFor } from '@shared/host-api'
import type { NavigatorState, NavigatorActions } from '../hooks/useNavigator'
import type { NavPinsApi } from '../hooks/useNavPins'

/** Return the parent directory of an absolute POSIX-style path. */
function parentDir(absPath: string): string {
  const i = absPath.lastIndexOf('/')
  return i > 0 ? absPath.slice(0, i) : '/'
}

/** Re-join a parent directory with a new basename. */
function joinPath(dir: string, base: string): string {
  return dir.endsWith('/') ? dir + base : dir + '/' + base
}

/** ENH-016 — pick a non-conflicting path under `parentDir` of the form
 *  `${stem}${ext}`, `${stem}-1${ext}`, `${stem}-2${ext}`, etc. Used by
 *  the "New file" / "New folder" context menu so the create + rename
 *  flow doesn't crash on existing-file conflicts. ext = '' for folders. */
async function pickUniquePath(parentDir: string, stem: string, ext: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const name = i === 0 ? `${stem}${ext}` : `${stem}-${i}${ext}`
    const candidate = joinPath(parentDir, name)
    const exists = await window.electron.files.exists(candidate)
    if (!exists) return candidate
  }
  // Highly unlikely; if 100 untitleds exist, fall back to a timestamp.
  return joinPath(parentDir, `${stem}-${Date.now()}${ext}`)
}

interface FileTreeProps {
  state: NavigatorState
  actions: NavigatorActions
  onOpenFile: (entry: DirEntry) => void
  /** "Open terminal here" — spawns a new terminal tab with this folder
   *  as its launch CWD. */
  onOpenTerminalHere: (folderPath: string) => void
  /** Stage 26 item 7 — hover "new Claude here" button on folder rows.
   *  Optional: panes that don't pass it (UserClaudePane today) suppress
   *  the hover affordance. */
  onOpenClaudeIn?: (folderPath: string) => void
  /** Stage 26 PR 2 (ENH-010) — navigator pin state. Optional so panes
   *  that don't expose pin actions (UserClaudePane) suppress them. */
  navPins?: NavPinsApi
  /** Stage 22 — override the default root entry source (which is
   *  `state.listings.get(state.cwd)`). The user-claude pane uses
   *  this to inject a curated root list (CLAUDE.md, skills/, agents/)
   *  instead of the full `~/.claude/` listing. Children of expanded
   *  folders still come from `state.listings`. */
  rootEntriesOverride?: DirEntry[] | null
  /** Stage 26 PR 3 item 2 — front terminal's launch CWD. Folder rows
   *  whose `path` matches render a subtle accent dot to the right of
   *  the name, distinct from selection's full-row tint (selection is
   *  interaction state, this is ambient signal). `null` suppresses
   *  the indicator (e.g., on user-claude pane where no terminal
   *  semantics apply). */
  activeTerminalCwd?: string | null
  /** Stage 26 PR 3 item 3 — set of file paths currently open in any
   *  WorkingPane tab. File rows in this set render with brighter
   *  text (subtle "open" signal) on top of the default. Distinct
   *  from active-file (a stronger signal — see `activeFilePath`).
   *  Empty set / undefined suppresses both signals. */
  openFilePaths?: ReadonlySet<string>
  /** Stage 26 PR 3 item 3 — path of the currently-active WorkingPane
   *  file tab. The matching file row renders an accent dot inline
   *  (mirrors `activeTerminalCwd` on folders — symmetric "what's
   *  front-most" signal across files + folders). */
  activeFilePath?: string | null
  /** Sprint 3 Phase 3b — surface "Open in Split View" entry in the
   *  right-click menu for FILE rows. Folders excluded (split view
   *  hosts a single tab in v1, not a directory). Wired by App.tsx
   *  to splitViewMoveTabByPath. */
  onOpenInSplit?: (path: string) => void
}

export function FileTree({ state, actions, onOpenFile, onOpenTerminalHere, onOpenClaudeIn, navPins, rootEntriesOverride, activeTerminalCwd = null, openFilePaths, activeFilePath = null, onOpenInSplit }: FileTreeProps) {
  const rootEntries = rootEntriesOverride !== undefined ? rootEntriesOverride : state.listings.get(state.cwd)
  // ENH-050 (v0.6.3) — context menu now opens via window.electron.menu.popup
  // (native NSMenu) instead of the in-renderer <ContextMenu>. No menu state
  // here; we await the popup result inline from the right-click handlers.
  // Stage 26 item 6 — inline rename. Holds the path of the row currently
  // in rename mode; null means no row is being renamed. Local to the tree
  // because rename is a transient renderer-side state (no IPC mirror).
  const [renamingPath, setRenamingPath] = useState<string | null>(null)

  // ENH-152a v2 — git status for the navigator's current cwd.
  // Refreshed on cwd change + on window focus. fsevents-driven
  // invalidation (Q7 proto, ENH-152c) is a follow-up.
  //
  // v2 changes from v1:
  // - chip is ALWAYS visible when in a git repo (v1 hid clean state;
  //   owner rejected at v0.7.0 walk: "no visual indication that duo/
  //   is root of a github repo in the navigator view — very bad").
  // - The chip is rendered inline on the repo-root row IF the root
  //   is visible in the current tree, else as a slim-top ribbon
  //   banner above the tree (per locked prototype-Q1 SLIM-TOP +
  //   prototype-Q2 BREADCRUMB-DEEP trigger).
  const [gitChip, setGitChip] = useState<string>('')
  const [gitSnap, setGitSnap] = useState<GitStatusSnapshot | null>(null)
  useEffect(() => {
    if (rootEntriesOverride !== undefined) return // pinned/user-claude pane — no chip
    let cancelled = false
    const refresh = async () => {
      try {
        const snap = await window.electron.git.status(state.cwd)
        if (cancelled) return
        setGitSnap(snap)
        setGitChip(formatGitStatusChip(snap))
      } catch {
        if (cancelled) return
        setGitChip('')
        setGitSnap(null)
      }
    }
    void refresh()
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [state.cwd, rootEntriesOverride])

  // ENH-152a v2 — show the ribbon WHENEVER cwd is inside a git repo.
  // (proto-Q1 SLIM-TOP + proto-Q2 BREADCRUMB-DEEP, collapsed to
  // "always show ribbon when in repo".)
  //
  // v2 walk-rev4 follow-up: ALSO probe each child folder of cwd for
  // being a separate git repo root (peer-repos case from playground
  // § 1A "root visible — inline chip"). When user is at `~/repos`
  // and that contains `duo/` + `other-repo/` (both repo roots), each
  // gets an inline chip on its row. Independent of the ribbon: the
  // ribbon fires when CWD-itself is in a repo; the per-folder chips
  // fire on CHILD-FOLDERS that are repos.
  const repoName = repoBasenameFor(gitSnap?.workTreeRoot ?? null)
  const chipTooltip = gitSnap ? formatGitStatusTooltip(gitSnap, repoName) : ''

  // BUG-135 — ribbon strictness. Computed AFTER gitRefreshTick is
  // declared below so the effect's dep list can reference it. The
  // raw `gitSnap.isRepo` returns true whenever git status climbs
  // upward and finds ANY `.git` — even if the matched repo is many
  // levels up and the path crosses one or more "container folders"
  // full of peer-repos (e.g. `~/Documents` tracked as a repo +
  // `~/Documents/GitHub/<many-repos>` makes every descendant of
  // GitHub falsely "inside Documents"). The per-folder chip already
  // applies a strict repo-root check; the ribbon must match.
  const [ribbonSuppressed, setRibbonSuppressed] = useState(false)

  // Per-folder repo-status map for inline chips on child folder rows.
  // Keyed by absolute path. Populated on cwd change + window focus.
  const [childRepoMap, setChildRepoMap] = useState<Map<string, GitStatusSnapshot>>(new Map())

  // Per-file dirty-status map for the dots + STATUS-DIFF tooltips
  // (ENH-152b). Keyed by absolute path. Populated when cwd is in a
  // repo (uses gitSnap.workTreeRoot).
  const [dirtyFileMap, setDirtyFileMap] = useState<Map<string, { status: string; plus: number; minus: number }>>(new Map())

  // Combined refresh tick — bump it to force re-fetch of all three
  // git probes (root status, child repos, dirty files). ENH-152c
  // fsevents watcher pushes this; window-focus also bumps as a
  // belt-and-suspenders fallback.
  const [gitRefreshTick, setGitRefreshTick] = useState(0)

  // BUG-135 — suppress the ribbon when the climb from cwd up to
  // gitSnap.workTreeRoot crosses an intermediate folder containing
  // ≥2 peer-repo children. See the comment block above
  // `ribbonSuppressed` for the full rationale.
  useEffect(() => {
    if (rootEntriesOverride !== undefined) return
    if (!gitSnap?.isRepo || !gitSnap.workTreeRoot) {
      setRibbonSuppressed(false)
      return
    }
    const cwd = state.cwd
    const repoRoot = gitSnap.workTreeRoot
    if (cwd === repoRoot) {
      setRibbonSuppressed(false)
      return
    }
    let cancelled = false
    const check = async () => {
      const intermediates: string[] = []
      let current = parentDir(cwd)
      while (current && current !== repoRoot && current !== '/') {
        intermediates.push(current)
        const next = parentDir(current)
        if (next === current) break
        current = next
      }
      for (const folder of intermediates) {
        if (cancelled) return
        try {
          const entries = await window.electron.files.list(folder)
          const childDirs = entries
            .filter((e: { kind?: string }) => e.kind === 'directory')
            .map((e: { name: string }) => e.name)
          if (childDirs.length < 2) continue
          const reposIn = await window.electron.git.scanReposIn({ parentDir: folder, childNames: childDirs })
          const repoCount = Object.values(reposIn).filter((s) => (s as GitStatusSnapshot)?.isRepo).length
          if (repoCount >= 2) {
            if (!cancelled) setRibbonSuppressed(true)
            return
          }
        } catch {
          // Soft-fail; keep checking subsequent levels.
        }
      }
      if (!cancelled) setRibbonSuppressed(false)
    }
    void check()
    return () => { cancelled = true }
  }, [state.cwd, gitSnap?.isRepo, gitSnap?.workTreeRoot, rootEntriesOverride, gitRefreshTick])

  // BUG-135 — effective "in repo" gate. The ribbon and the dependent
  // right-click GitHub menu items + per-file dirty dots all consult
  // this rather than the raw `gitSnap.isRepo`.
  const isInRepo = !!gitSnap?.isRepo && !ribbonSuppressed

  useEffect(() => {
    if (rootEntriesOverride !== undefined) return
    if (!rootEntries || rootEntries.length === 0) {
      setChildRepoMap(new Map())
      return
    }
    let cancelled = false
    const childNames = rootEntries
      .filter((e) => e.kind === 'directory')
      .map((e) => e.name)
    void window.electron.git.scanReposIn({ parentDir: state.cwd, childNames })
      .then((record) => {
        if (cancelled) return
        // Re-key by absolute path so TreeNode's `entry.path` lookup
        // matches. Main process returned `{ childName: snapshot }`;
        // we build `${cwd}/${childName} → snapshot`.
        const byPath = new Map<string, GitStatusSnapshot>()
        for (const [name, snap] of Object.entries(record)) {
          byPath.set(`${state.cwd}/${name}`, snap)
        }
        setChildRepoMap(byPath)
      })
      .catch(() => {
        if (cancelled) return
        setChildRepoMap(new Map())
      })
    return () => { cancelled = true }
    // rootEntries reference identity is stable per cwd; we depend on
    // its length so a remote update (new folder appears) triggers
    // re-scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cwd, rootEntriesOverride, rootEntries?.length, gitRefreshTick])

  useEffect(() => {
    if (rootEntriesOverride !== undefined) return
    // BUG-135 — skip dirty-file probing when the ribbon is suppressed.
    // The probe would return a map of files inside a falsely-claimed
    // ancestor repo, leading to stray dirty dots on every file row.
    if (!gitSnap?.isRepo || !gitSnap.workTreeRoot || ribbonSuppressed) {
      setDirtyFileMap(new Map())
      return
    }
    let cancelled = false
    void window.electron.git.dirtyFilesFor({ workTreeRoot: gitSnap.workTreeRoot })
      .then((record) => {
        if (cancelled) return
        setDirtyFileMap(new Map(Object.entries(record)))
      })
      .catch(() => {
        if (cancelled) return
        setDirtyFileMap(new Map())
      })
    return () => { cancelled = true }
  }, [gitSnap?.workTreeRoot, gitSnap?.isRepo, ribbonSuppressed, rootEntriesOverride, gitRefreshTick])

  // ENH-152c — fsevents-driven invalidation. Start a watcher on the
  // work-tree when we enter a repo; stop on leaving or unmount. The
  // main-process watcher fires GIT_WATCH_INVALIDATE (debounced
  // 250ms) on file changes; we bump gitRefreshTick to re-fetch all
  // three git probes (root status, child repos, dirty files).
  useEffect(() => {
    if (rootEntriesOverride !== undefined) return
    if (!gitSnap?.isRepo || !gitSnap.workTreeRoot) {
      void window.electron.git.watchStop()
      return
    }
    let cancelled = false
    void window.electron.git.watchStart({
      workTreeRoot: gitSnap.workTreeRoot,
      cwd: state.cwd
    }).catch(() => null)
    const unsubscribe = window.electron.git.onWatchInvalidate(() => {
      if (cancelled) return
      setGitRefreshTick((t) => t + 1)
    })
    return () => {
      cancelled = true
      unsubscribe()
      void window.electron.git.watchStop().catch(() => null)
    }
  }, [gitSnap?.workTreeRoot, gitSnap?.isRepo, state.cwd, rootEntriesOverride])

  // ENH-026 — accept rename requests from outside the tree (e.g. the
  // WorkingPane tab strip's right-click menu). App.tsx dispatches a
  // CustomEvent with the file's absolute path; we put that row into
  // rename mode if it's renderable in this tree.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ path: string }>
      if (typeof ce.detail?.path === 'string') {
        setRenamingPath(ce.detail.path)
      }
    }
    window.addEventListener('duo-tree-start-rename', handler)
    return () => window.removeEventListener('duo-tree-start-rename', handler)
  }, [])


  const onCommitRename = async (entry: DirEntry, newName: string): Promise<boolean> => {
    const trimmed = newName.trim()
    if (trimmed === '' || trimmed === entry.name) {
      setRenamingPath(null)
      return false
    }
    if (trimmed.includes('/')) {
      // Reject path separators — rename is in-place, not a move.
      window.alert("Name can't contain '/'.")
      return false
    }
    const dir = parentDir(entry.path)
    const newPath = joinPath(dir, trimmed)
    try {
      await window.electron.files.rename(entry.path, newPath)
      // BUG-007 workaround: actively refresh the parent dir so the
      // tree updates immediately even if the chokidar watcher path
      // doesn't surface unlink+add reliably.
      actions.refresh(dir)
      setRenamingPath(null)
      return true
    } catch (err) {
      window.alert(`Rename failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  const onTrashEntry = async (entry: DirEntry): Promise<void> => {
    // ENH-050 — native sheet via dialog.showMessageBox (was window.confirm,
    // a basic blocking JS prompt). Composes natively above the WCV with
    // backdrop dimming + sheet-drop animation.
    const isFolder = entry.kind === 'directory'
    const result = await window.electron.dialog.confirm({
      title: isFolder
        ? `Move folder "${entry.name}" to the Trash?`
        : `Move "${entry.name}" to the Trash?`,
      message: isFolder
        ? 'The folder and all of its contents will be moved to the macOS Trash. You can restore them from there.'
        : 'The file will be moved to the macOS Trash. You can restore it from there.',
      buttons: ['Cancel', 'Move to Trash'],
      defaultId: 1,
      cancelId: 0,
      type: 'warning'
    })
    if (result.response !== 1) return
    try {
      await window.electron.files.trash(entry.path)
      actions.refresh(parentDir(entry.path))
    } catch (err) {
      window.alert(`Move to Trash failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ENH-147 — batch trash for the multi-select path. Confirms once
  // ("Move N items to Trash?"), then loops, trashing each in turn.
  // Failures surface individually but don't abort the batch — owner
  // can see what landed and what didn't from the surviving rows.
  // Parent dirs are refreshed AFTER the batch completes; doing it
  // per-item churns the listings cache for nothing.
  const onTrashBatch = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return
    const result = await window.electron.dialog.confirm({
      title: `Move ${paths.length} items to the Trash?`,
      message: `The ${paths.length} selected items will be moved to the macOS Trash. You can restore them from there.`,
      buttons: ['Cancel', `Move ${paths.length} items to Trash`],
      defaultId: 1,
      cancelId: 0,
      type: 'warning'
    })
    if (result.response !== 1) return
    const failures: Array<{ path: string; err: string }> = []
    const dirsToRefresh = new Set<string>()
    for (const path of paths) {
      try {
        await window.electron.files.trash(path)
        dirsToRefresh.add(parentDir(path))
      } catch (err) {
        failures.push({ path, err: err instanceof Error ? err.message : String(err) })
      }
    }
    for (const dir of dirsToRefresh) actions.refresh(dir)
    actions.clearSelection()
    if (failures.length > 0) {
      const summary = failures.length === 1
        ? `Failed to trash 1 item: ${failures[0].path}\n${failures[0].err}`
        : `Failed to trash ${failures.length} items:\n${failures.slice(0, 3).map(f => `  ${f.path}: ${f.err}`).join('\n')}${failures.length > 3 ? '\n  …' : ''}`
      window.alert(summary)
    }
  }

  // BUG-041 — synthesize a "root" target for whitespace right-clicks.
  // The project cwd is always a directory; the menu's whitespaceMode
  // restricts the items to the New file / New folder / Open terminal
  // here / Reveal in Finder set so we never accidentally surface
  // Rename or Trash on the project root.
  const rootEntry: DirEntry = {
    name: state.cwd.split('/').filter(Boolean).pop() ?? '/',
    path: state.cwd,
    kind: 'directory'
  }
  // ENH-050 — file actions, factored so both the row right-click and
  // the whitespace right-click can share them. Each action takes the
  // target entry; the menu chooses which actions to surface based on
  // the entry kind + whitespace mode (see buildTreeMenuTemplate below).
  const handleNewFile = async (parentPath: string) => {
    // ENH-016 v2 (2026-04-30 hotfix) — create `untitled.md` (or
    // `untitled-N.md` if it exists), then put the new row into rename
    // mode so the user names it.
    const target = await pickUniquePath(parentPath, 'untitled', '.md')
    try {
      await window.electron.files.write(target, new Uint8Array(0))
      if (!state.expanded.has(parentPath) && parentPath !== state.cwd) {
        actions.toggleExpand(parentPath)
      }
      actions.refresh(parentPath)
      requestAnimationFrame(() => setRenamingPath(target))
    } catch (err) {
      console.error('[ENH-016] new file failed:', err)
      window.alert(`Couldn't create file: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const handleNewFolder = async (parentPath: string) => {
    const target = await pickUniquePath(parentPath, 'untitled-folder', '')
    try {
      await window.electron.files.mkdir(target)
      if (!state.expanded.has(parentPath) && parentPath !== state.cwd) {
        actions.toggleExpand(parentPath)
      }
      actions.refresh(parentPath)
      requestAnimationFrame(() => setRenamingPath(target))
    } catch (err) {
      console.error('[ENH-016] new folder failed:', err)
      window.alert(`Couldn't create folder: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ENH-169 (Sprint 20) — external trigger points (File menu →
  // New File… / New Folder…, ⌘N / ⌘⇧N chords, breadcrumb right-
  // click context menu) all dispatch `duo-tree-new-file-here` /
  // `duo-tree-new-folder-here` CustomEvents with a `{ parentPath }`
  // detail. Listening here keeps the file-creation logic (pick
  // unique name + mkdir/seed + auto-expand + refresh + setRenamingPath)
  // in one place — the same flow the right-click "New folder here…"
  // menu item drives. Ref pattern so we always call through to the
  // LATEST closures (which capture current state/actions).
  const newHandlersRef = useRef({ newFile: handleNewFile, newFolder: handleNewFolder })
  newHandlersRef.current = { newFile: handleNewFile, newFolder: handleNewFolder }
  useEffect(() => {
    const onNewFile = (e: Event) => {
      const ce = e as CustomEvent<{ parentPath: string }>
      if (typeof ce.detail?.parentPath === 'string') {
        void newHandlersRef.current.newFile(ce.detail.parentPath)
      }
    }
    const onNewFolder = (e: Event) => {
      const ce = e as CustomEvent<{ parentPath: string }>
      if (typeof ce.detail?.parentPath === 'string') {
        void newHandlersRef.current.newFolder(ce.detail.parentPath)
      }
    }
    window.addEventListener('duo-tree-new-file-here', onNewFile)
    window.addEventListener('duo-tree-new-folder-here', onNewFolder)
    return () => {
      window.removeEventListener('duo-tree-new-file-here', onNewFile)
      window.removeEventListener('duo-tree-new-folder-here', onNewFolder)
    }
  }, [])

  // ENH-050 — central handler that maps a chosen menu id back to an
  // action against the given target entry. Stable ids keep the menu
  // template a pure data structure (no closures riding through IPC).
  // ENH-147 — `isBatch` says the right-click landed on a row that's
  // part of a multi-select set. Currently only `trash` branches on
  // this; everything else runs single-target.
  const handleMenuChoice = async (chosenId: string, target: DirEntry, isBatch: boolean = false) => {
    const isFolder = target.kind === 'directory'
    const newTargetDir = isFolder ? target.path : parentDir(target.path)
    switch (chosenId) {
      case 'new-file':
        await handleNewFile(newTargetDir)
        return
      case 'new-folder':
        await handleNewFolder(newTargetDir)
        return
      case 'open-terminal-here':
        if (isFolder) onOpenTerminalHere(target.path)
        return
      case 'open-in-editor':
        if (!isFolder) onOpenFile(target)
        return
      case 'reveal-in-finder':
        await window.electron.files.revealInFinder(target.path)
        return
      case 'copy-path':
        // BUG-105 (Sprint 10) — route through main's clipboard
        // module; the renderer-side API silently rejects when fired
        // from a native NSMenu callback (no user-gesture context).
        try { await window.electron.clipboard.writeText(target.path) } catch { /* permission denied */ }
        return
      case 'open-with-default':
        await window.electron.files.openPath(target.path)
        return
      case 'pin':
        if (navPins) {
          void navPins.toggle({
            path: target.path,
            kind: isFolder ? 'folder' : 'file',
            title: target.name
          })
        }
        return
      case 'rename':
        setRenamingPath(target.path)
        return
      case 'trash':
        // ENH-147 — when the right-click landed on a row that's part
        // of a multi-select set, trash the whole set; else trash just
        // the clicked target.
        if (isBatch) {
          await onTrashBatch(Array.from(state.selectedItems.keys()))
        } else {
          await onTrashEntry(target)
        }
        return
      case 'open-in-split':
        if (!isFolder && onOpenInSplit) onOpenInSplit(target.path)
        return
      case 'clone-github-here':
        // FOLLOWUP-025 v2 — Navigator right-click → "Clone GitHub repo
        // here…". Open the modal with the target path as the default
        // parent (owner Q1: right-click context wins). Folders pass
        // their own path; whitespace passes the current Navigator cwd
        // via newTargetDir (which equals target.path on whitespace
        // since whitespace's synthesized DirEntry uses the cwd as
        // path). For files: NOT reachable — Q2 picked folders-only.
        if (isFolder) {
          void window.electron.nav.openCloneModal?.({ path: target.path })
        }
        return
      case 'open-on-github':
      case 'copy-github-url': {
        // ENH-155 / BUG-132 — compose the GitHub URL for the right-
        // clicked path. Both items go through the same probe; one
        // opens, the other copies. If the remote isn't a GitHub host,
        // url is null and we silently no-op.
        //
        // BUG-132 (rev2): pick the right repo snapshot. When the
        // navigator is at a parent directory (e.g. ~/Documents/GitHub)
        // and the user right-clicks a peer-repo folder, gitSnap
        // reflects the OUTER directory's repo (if any) — wrong remote.
        // childRepoMap holds per-peer-repo snapshots; prefer those
        // when the target is a peer-repo root.
        const peerSnap = isFolder ? childRepoMap?.get(target.path) : undefined
        const effectiveSnap = peerSnap?.isRepo ? peerSnap : gitSnap
        if (!effectiveSnap?.workTreeRoot) return
        const branch = effectiveSnap.branch || effectiveSnap.head
        try {
          const result = await window.electron.git.githubUrlFor({
            // Run `git remote get-url origin` from the actual repo's
            // root, not state.cwd — state.cwd may be the parent of a
            // peer-repo (or even unrelated entirely).
            cwd: effectiveSnap.workTreeRoot,
            workTreeRoot: effectiveSnap.workTreeRoot,
            branch,
            absPath: target.path,
            isFolder
          })
          if (!result.url) return
          if (chosenId === 'open-on-github') {
            // BUG-132 — must use openExternalUrl (shell.openExternal)
            // for URLs, NOT openExternal (which is shell.openPath for
            // local file paths). The latter silently fails on URLs.
            await window.electron.files.openExternalUrl(result.url)
          } else {
            try { await window.electron.clipboard.writeText(result.url) } catch { /* permission */ }
          }
        } catch {
          // Probe failed — silent. User can retry; nothing destructive.
        }
        return
      }
    }
  }

  // ENH-050 — fire native menu on right-click (rows + whitespace). The
  // popup awaits the user's choice; we then dispatch via handleMenuChoice.
  // ENH-147 — if the right-clicked target is part of the multi-select
  // set AND the set has more than one entry, the menu surfaces a batch
  // trash label ("Move N items to Trash..."). The other ops stay
  // single-target (rename, copy-path, open) since they're inherently
  // 1:1 and can't meaningfully batch in v1.
  const popupMenu = async (e: React.MouseEvent, target: DirEntry, whitespaceMode: boolean) => {
    e.preventDefault()
    const inSelection = state.selectedItems.has(target.path)
    const batchSize = (!whitespaceMode && inSelection && state.selectedItems.size > 1)
      ? state.selectedItems.size
      : 0
    // ENH-155 / BUG-132 (rev2) — target is "in a GH repo" when EITHER:
    //   (a) cwd's gitSnap covers it (file/folder inside cwd's repo), OR
    //   (b) the target IS a peer-repo root (childRepoMap has its snap).
    // (b) is the case where the navigator is at a parent dir (e.g.
    // ~/Documents/GitHub) and the user right-clicks a peer-repo folder
    // — gitSnap might be null or reflect an unrelated outer repo, but
    // the peer-repo itself has a valid remote we want to expose.
    // The host check (github.com vs gitlab.com) happens lazily in the
    // handler when the user actually clicks.
    const isFolderTarget = target.kind === 'directory'
    const peerSnap = isFolderTarget ? childRepoMap?.get(target.path) : undefined
    // BUG-135 — suppress the "(a)" branch when the ribbon is
    // suppressed (cwd's gitSnap claims a repo via a falsely-climbed
    // workTreeRoot through a peer-repo container). The peerSnap
    // branch stays unconditionally — when the user right-clicks an
    // ACTUAL peer-repo root, the menu items still apply.
    const inGhRepo = (!!gitSnap?.isRepo && !ribbonSuppressed && !!gitSnap.workTreeRoot &&
      target.path.startsWith(gitSnap.workTreeRoot)) || !!peerSnap?.isRepo
    const items = buildTreeMenuTemplate({
      target,
      whitespaceMode,
      navPins,
      onOpenInSplit,
      batchSize,
      inGhRepo
    })
    if (items.length === 0) return
    const result = await window.electron.menu.popup({
      items,
      x: e.clientX,
      y: e.clientY
    })
    if (!result.chosenId) return
    void handleMenuChoice(result.chosenId, target, batchSize > 0)
  }

  const onWhitespaceContextMenu = (e: React.MouseEvent) => {
    // Only handle clicks that landed directly on this wrapper (i.e.
    // whitespace below the rows). Row clicks already preventDefault
    // in TreeNode's onContextMenu, so they never reach here.
    if (e.target !== e.currentTarget) return
    void popupMenu(e, rootEntry, true)
  }

  // ENH-078 (v0.6.4) — left-click on whitespace clears selection.
  // Same e.target !== e.currentTarget guard as the right-click menu
  // above so row clicks stay routed to TreeNode's own onClick. Pairs
  // with the same-row-second-click toggle and ⎋ in onRowKey so users
  // have three deselect paths (whitespace click / re-click selected /
  // Escape).
  const onWhitespaceClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return
    actions.clearSelection()
  }

  // ENH-148 — flatten the visible tree (rootEntries + expanded
  // children, dotfile-filtered) into a single ordered list in render
  // order. The walker is depth-first matching what TreeNodes itself
  // renders. Returns `null` when the rootEntries aren't loaded.
  const flattenVisibleRows = (): Array<{ path: string; kind: 'file' | 'folder' }> | null => {
    if (!rootEntries) return null
    const out: Array<{ path: string; kind: 'file' | 'folder' }> = []
    const walk = (entries: DirEntry[]) => {
      for (const e of entries) {
        if (!shouldShow(e, state.showDotfiles)) continue
        const kind: 'file' | 'folder' = e.kind === 'directory' ? 'folder' : 'file'
        out.push({ path: e.path, kind })
        if (e.kind === 'directory' && state.expanded.has(e.path)) {
          const children = state.listings.get(e.path)
          if (children) walk(children)
        }
      }
    }
    walk(rootEntries)
    return out
  }

  // ENH-148 — ⇧-click range select handler. Computes the slice of the
  // flattened visible-row list between the current primary selection
  // (state.selected.path, derived from primaryPath in useNavigator)
  // and the shift-clicked entry. If no anchor exists yet, falls back
  // to a single-select.
  const extendSelectionTo = (entry: DirEntry) => {
    const kind: 'file' | 'folder' = entry.kind === 'directory' ? 'folder' : 'file'
    const anchor = state.selected?.path ?? null
    if (!anchor) {
      actions.selectItem(entry.path, kind)
      return
    }
    const rows = flattenVisibleRows()
    if (!rows) {
      actions.selectItem(entry.path, kind)
      return
    }
    const anchorIdx = rows.findIndex(r => r.path === anchor)
    const targetIdx = rows.findIndex(r => r.path === entry.path)
    if (anchorIdx === -1 || targetIdx === -1) {
      actions.selectItem(entry.path, kind)
      return
    }
    const lo = Math.min(anchorIdx, targetIdx)
    const hi = Math.max(anchorIdx, targetIdx)
    const slice = rows.slice(lo, hi + 1)
    const paths = slice.map(r => r.path)
    const kinds = slice.map(r => r.kind)
    actions.selectRange(paths, kinds, entry.path)
  }

  // ENH-148 — container-level ⌘-A handler. Fires when any row inside
  // the FileTree has keyboard focus (bubbling from onRowKey). Selects
  // every top-level row in the current cwd (NOT expanded descendants
  // — the spec's safety cap: "current directory + immediate children"
  // means don't sweep huge expanded trees on ⌘-A).
  const onContainerKey = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
    if (e.key !== 'a' && e.code !== 'KeyA') return
    if (!rootEntries || rootEntries.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    const visible = rootEntries.filter(en => shouldShow(en, state.showDotfiles))
    const paths = visible.map(en => en.path)
    const kinds = visible.map((en): 'file' | 'folder' => en.kind === 'directory' ? 'folder' : 'file')
    actions.selectAllVisible(paths, kinds)
  }

  return (
    <div
      className="flex-1 overflow-auto scrollbar-none py-1"
      onContextMenu={onWhitespaceContextMenu}
      onClick={onWhitespaceClick}
      onKeyDown={onContainerKey}
    >
      {/* ENH-152a v2 — git status ribbon. SLIM-TOP per proto-Q1.
          v2 walk-rev4 FAIL fix: ribbon now right-clickable. Synthesizes
          a DirEntry for gitSnap.workTreeRoot + reuses popupMenu so the
          ribbon's context menu is identical to right-clicking the
          repo-root folder itself, including "Open on GitHub" / "Copy
          GitHub URL" (the items owner expected at walk-rev4 and didn't
          see — they only worked on file/folder rows, not the ribbon).
          Tooltip also now includes the full workTreeRoot path so the
          user can see where the .git lives (helps when the ribbon
          surprises them by showing in a directory they didn't realize
          was a git repo). */}
      {gitChip && isInRepo && gitSnap?.workTreeRoot && (
        <div
          className="px-3 py-1.5 mb-1 text-[11px] font-mono text-ink-mute border-b border-paper-rule bg-paper-deep flex items-center gap-2 cursor-context-menu hover:bg-paper-edge transition-colors"
          title={`${chipTooltip}\n${gitSnap.workTreeRoot}`}
          data-duo-git-ribbon="1"
          onContextMenu={(e) => {
            if (!gitSnap?.workTreeRoot) return
            const ribbonEntry: DirEntry = {
              name: repoName || 'repo',
              path: gitSnap.workTreeRoot,
              kind: 'directory'
            }
            void popupMenu(e, ribbonEntry, false)
          }}
        >
          {/* Owner directive 2026-05-18 — match the per-folder
              repo-chip icon. Same Lucide git-branch SVG as
              FolderRepoChip, sized to fit the ribbon's text. */}
          <span className="text-accent inline-flex items-center" aria-hidden="true">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="6" x2="6" y1="3" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          </span>
          <span className="font-medium text-ink">{repoName || 'repo'}</span>
          <span className="text-ink-mute">·</span>
          <span className="truncate flex-1">{gitChip}</span>
        </div>
      )}
      <TreeNodes
        entries={rootEntries}
        depth={0}
        state={state}
        actions={actions}
        onOpenFile={onOpenFile}
        onContextMenu={(e, entry) => { void popupMenu(e, entry, false) }}
        onRangeSelect={extendSelectionTo}
        renamingPath={renamingPath}
        onCommitRename={onCommitRename}
        onCancelRename={() => setRenamingPath(null)}
        onOpenClaudeIn={onOpenClaudeIn}
        activeTerminalCwd={activeTerminalCwd}
        openFilePaths={openFilePaths}
        activeFilePath={activeFilePath}
        childRepoMap={childRepoMap}
        dirtyFileMap={dirtyFileMap}
      />
    </div>
  )
}

// ENH-050 — pure-data menu template. Returns MenuTemplateItem[] for
// window.electron.menu.popup; click handlers live in handleMenuChoice
// in the parent component, mapped by stable `id`. Keeps the IPC
// boundary clean (no closures riding through serialization) and the
// menu logic testable.
//
// Item permutations follow PRD § D11 with Stage 26 item 6's Rename +
// Move to Trash and ENH-010's navigator pin. BUG-041 — when called
// in `whitespaceMode`, the synthesized root target gets a trimmed
// item set (no Rename / Trash / Open-with-default / Copy path / Pin —
// those would act on the project cwd, which is almost always
// destructive or irrelevant).
function buildTreeMenuTemplate(opts: {
  target: DirEntry
  whitespaceMode: boolean
  navPins?: NavPinsApi
  onOpenInSplit?: (path: string) => void
  /** ENH-147 — when > 0, the right-clicked row is part of an N-item
   *  multi-select. The trash label is pluralized; other items stay as
   *  single-target wording (only trash batches in v1). */
  batchSize?: number
  /** ENH-155 — true when the right-clicked path is inside a git repo
   *  with a GitHub remote. Caller computes this from the cached
   *  GitStatusSnapshot + a (lazy) hostname check; we don't probe per
   *  right-click. When true, the menu adds "Open on GitHub" + "Copy
   *  GitHub URL" items. */
  inGhRepo?: boolean
}): MenuTemplateItem[] {
  const { target, whitespaceMode, navPins, onOpenInSplit, batchSize = 0 } = opts
  const isFolder = target.kind === 'directory'
  const items: MenuTemplateItem[] = []

  // ENH-016 — "New file…" / "New folder…" at the top of the menu.
  // Target folder = entry itself for folder rows, parent dir for
  // file rows. Mirrors VS Code / Finder convention.
  const newSuffix = isFolder ? '' : ' here'
  items.push({ id: 'new-file', label: `New file${newSuffix}…` })
  items.push({ id: 'new-folder', label: `New folder${newSuffix}…` })

  items.push({ type: 'separator' })
  if (isFolder) {
    items.push({ id: 'open-terminal-here', label: 'Open terminal here' })
  } else {
    items.push({ id: 'open-in-editor', label: 'Open in Duo editor' })
    // Sprint 3 Phase 3b — Open in Split View. Files only (split view
    // hosts a single tab in v1; opening a folder isn't meaningful).
    // Same destination as `duo split-view open <path>` and the
    // ⌘\ chord on the active main tab.
    if (onOpenInSplit) {
      items.push({ id: 'open-in-split', label: 'Open in Split View' })
    }
  }
  items.push({ id: 'reveal-in-finder', label: 'Reveal in Finder' })

  // ENH-155 — "Open on GitHub" + "Copy GitHub URL". Only shown when
  // the row's path is inside a git repo with a GitHub remote. The
  // handler queries window.electron.git.githubUrlFor; if the
  // composed URL is null (non-GitHub host) we suppress both items.
  // Owner v1-Q5 SHOW-ALWAYS rule: render regardless of auth state
  // (URLs work for public repos without auth). The opts.gitSnap +
  // opts.inGhRepo flags are computed by the caller (FileTree) so
  // builders don't redo the probe.
  if (opts.inGhRepo) {
    items.push({ type: 'separator' })
    items.push({ id: 'open-on-github', label: 'Open on GitHub' })
    items.push({ id: 'copy-github-url', label: 'Copy GitHub URL' })
  }

  // FOLLOWUP-025 v2 — "Clone GitHub repo here…" on folders and
  // whitespace only (owner Q2 picked folders-only — cleaner mental
  // model than per-file). The handler sends NAV_OPEN_CLONE_MODAL with
  // the target path; the modal pre-populates the parent-dir input
  // with that path (owner Q1: right-click context wins over Navigator
  // cwd).
  if (isFolder || whitespaceMode) {
    items.push({ type: 'separator' })
    items.push({ id: 'clone-github-here', label: 'Clone GitHub repo here…' })
  }

  if (!whitespaceMode) {
    items.push({ id: 'copy-path', label: 'Copy path' })

    items.push({ type: 'separator' })
    items.push({ id: 'open-with-default', label: 'Open with default app' })

    // Stage 26 PR 2 (ENH-010) — Pin / Unpin from navigator. Visible
    // when the host pane wires navPins; suppressed otherwise.
    if (navPins) {
      const pinned = navPins.isPinned(target.path)
      items.push({ type: 'separator' })
      items.push({
        id: 'pin',
        label: pinned ? 'Unpin from navigator' : 'Pin to navigator'
      })
    }

    items.push({ type: 'separator' })
    items.push({ id: 'rename', label: 'Rename…' })
    // ENH-147 — pluralize the trash label when right-clicked target is
    // part of a multi-select set. The handler reads the same batchSize
    // hint via popupMenu's third arg to handleMenuChoice.
    const trashLabel = batchSize > 1
      ? `Move ${batchSize} items to Trash…`
      : (isFolder ? 'Move folder to Trash…' : 'Move to Trash…')
    items.push({ id: 'trash', label: trashLabel })
  }

  return items
}

interface TreeNodesProps {
  entries: DirEntry[] | null | undefined
  depth: number
  state: NavigatorState
  actions: NavigatorActions
  onOpenFile: (entry: DirEntry) => void
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void
  /** ENH-148 — ⇧-click range-select handler. Defined at the FileTree
   *  scope (where rootEntries + listings are available) and passed
   *  down so per-row click handlers can call it. */
  onRangeSelect?: (entry: DirEntry) => void
  /** Stage 26 item 6 — inline rename state passed down. `undefined` means
   *  this tree (e.g. user-claude pane) doesn't support rename. */
  renamingPath?: string | null
  onCommitRename?: (entry: DirEntry, newName: string) => Promise<boolean>
  onCancelRename?: () => void
  /** Stage 26 item 7 — hover "new Claude here" button on folder rows. */
  onOpenClaudeIn?: (folderPath: string) => void
  /** Stage 26 PR 3 item 2 — active terminal CWD for ambient highlight. */
  activeTerminalCwd?: string | null
  /** Stage 26 PR 3 item 3 — open / active file signals. */
  openFilePaths?: ReadonlySet<string>
  activeFilePath?: string | null
  /** ENH-152a v2 (peer-repos) — for each child folder that IS itself
   *  a git repo root, the snapshot to render as an inline chip on
   *  that row. Keyed by absolute path. Folders not in the map render
   *  without a chip. */
  childRepoMap?: ReadonlyMap<string, GitStatusSnapshot>
  /** ENH-152b — per-file dirty status. Keyed by absolute path. Files
   *  not in the map are clean (no dot). */
  dirtyFileMap?: ReadonlyMap<string, { status: string; plus: number; minus: number }>
}

export function TreeNodes({ entries, depth, state, actions, onOpenFile, onContextMenu, onRangeSelect, renamingPath, onCommitRename, onCancelRename, onOpenClaudeIn, activeTerminalCwd = null, openFilePaths, activeFilePath = null, childRepoMap, dirtyFileMap }: TreeNodesProps) {
  if (entries === null || entries === undefined) {
    return <div className="px-3 py-1 text-[11px] text-zinc-600">Loading…</div>
  }
  const filtered = entries.filter(e => shouldShow(e, state.showDotfiles))
  if (filtered.length === 0 && depth === 0) {
    return <div className="px-3 py-1 text-[11px] text-zinc-600">Empty folder</div>
  }
  return (
    <>
      {filtered.map(entry => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={depth}
          state={state}
          actions={actions}
          onOpenFile={onOpenFile}
          onContextMenu={onContextMenu}
          onRangeSelect={onRangeSelect}
          renamingPath={renamingPath}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          onOpenClaudeIn={onOpenClaudeIn}
          activeTerminalCwd={activeTerminalCwd}
          openFilePaths={openFilePaths}
          activeFilePath={activeFilePath}
          childRepoMap={childRepoMap}
          dirtyFileMap={dirtyFileMap}
        />
      ))}
    </>
  )
}

interface TreeNodeProps {
  entry: DirEntry
  depth: number
  state: NavigatorState
  actions: NavigatorActions
  onOpenFile: (entry: DirEntry) => void
  onContextMenu: (e: React.MouseEvent, entry: DirEntry) => void
  /** ENH-148 — ⇧-click range-select handler. Provided by the host
   *  FileTree (where the flattened-rows walker lives). */
  onRangeSelect?: (entry: DirEntry) => void
  renamingPath?: string | null
  onCommitRename?: (entry: DirEntry, newName: string) => Promise<boolean>
  onCancelRename?: () => void
  onOpenClaudeIn?: (folderPath: string) => void
  /** Stage 26 PR 3 item 2 — active terminal CWD for ambient highlight. */
  activeTerminalCwd?: string | null
  /** Stage 26 PR 3 item 3 — open / active file signals. */
  openFilePaths?: ReadonlySet<string>
  activeFilePath?: string | null
  /** ENH-152a v2 peer-repos — per-folder repo-status map. */
  childRepoMap?: ReadonlyMap<string, GitStatusSnapshot>
  /** ENH-152b — per-file dirty-status map. */
  dirtyFileMap?: ReadonlyMap<string, { status: string; plus: number; minus: number }>
}

function TreeNode({ entry, depth, state, actions, onOpenFile, onContextMenu, onRangeSelect, renamingPath, onCommitRename, onCancelRename, onOpenClaudeIn, activeTerminalCwd = null, openFilePaths, activeFilePath = null, childRepoMap, dirtyFileMap }: TreeNodeProps) {
  const isFolder = entry.kind === 'directory'
  const isExpanded = isFolder && state.expanded.has(entry.path)
  // ENH-147 — read from the multi-select map. Singular `state.selected`
  // would also work for size 0/1 (since it's derived from the map) but
  // when size > 1 every selected row needs to paint with the fill, not
  // just the primary.
  const isSelected = state.selectedItems.has(entry.path)
  const isRenaming = renamingPath === entry.path
  // Stage 26 PR 3 item 2 — folder rows whose path matches the front
  // terminal's launch CWD render an ambient accent dot. Files don't
  // get the dot (terminals can't have a file as cwd). Distinct from
  // selection: selection is a full-row tint, this is a small dot to
  // the right of the name.
  const isActiveCwd = isFolder && activeTerminalCwd !== null && entry.path === activeTerminalCwd
  // Stage 26 PR 3 item 3 — file rows that are open in some
  // WorkingPane tab render with brighter text (subtle "open"
  // signal). The active file (front-most WorkingPane tab) ALSO
  // renders an accent dot to the right — same gesture as the
  // active-CWD dot, symmetric across files + folders for "what's
  // front-most."
  const isOpenFile = !isFolder && openFilePaths !== undefined && openFilePaths.has(entry.path)
  const isActiveFile = !isFolder && activeFilePath !== null && entry.path === activeFilePath

  // Stage 26 item 1 — single-click selects, double-click opens.
  // Stage 26 item 1b (BUG-025) — chevron is a discrete hit target;
  // toggling expansion does NOT change selection or re-root the tree.
  // ENH-078 (v0.6.4) — clicking the row that's ALREADY selected
  // toggles selection off, mirroring Finder. Pairs with the
  // whitespace-click deselect handler at the FileTree wrapper level
  // (see onWhitespaceClick) so users have multiple ways to clear
  // selection without keyboard (⎋ already worked, see onRowKey).
  // ENH-147 — ⌘-click (metaKey) toggles this row's membership in the
  // multi-select set without affecting other selected rows. Plain
  // single-click is single-select (replaces the entire set).
  // ENH-148 — ⇧-click extends selection from the primary anchor to
  // this row across the visible row order (Finder behavior). The
  // walker lives at FileTree scope and is passed in via onRangeSelect.
  const onSingleClickRow = (e: React.MouseEvent) => {
    if (e.shiftKey && onRangeSelect) {
      onRangeSelect(entry)
      return
    }
    if (e.metaKey) {
      actions.toggleSelection(entry.path, isFolder ? 'folder' : 'file')
      return
    }
    if (isSelected) {
      actions.clearSelection()
    } else {
      actions.selectItem(entry.path, isFolder ? 'folder' : 'file')
    }
  }

  const onDoubleClickRow = () => {
    if (isFolder) {
      // "Open" a folder = navigate into it (breadcrumb re-roots).
      // navigateTo() also clears selection — intentional, since the
      // folder is now the tree's root and selection of the row that
      // disappears would be incoherent.
      actions.navigateTo(entry.path)
    } else {
      actions.selectItem(entry.path, 'file')
      onOpenFile(entry)
    }
  }

  const onChevronClick = (e: React.MouseEvent) => {
    // Stop the row's onClick from also firing (which would also select).
    e.stopPropagation()
    actions.toggleExpand(entry.path)
  }

  const onRowKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onDoubleClickRow()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      actions.clearSelection()
    }
    // ENH-148 — ⌘-A is handled at the FileTree container's onKeyDown
    // (which has access to rootEntries for the safety cap). The
    // keystroke bubbles up naturally.
  }

  // Two-sibling layout: chevron button + row button. The wrapping div
  // owns the indent + selection background so they paint as one unit.
  const indentLeft = 8 + depth * 12

  return (
    <>
      <div
        className={[
          'group/row relative w-full flex items-center gap-1.5 pr-2 py-0.5 text-[12px] leading-tight transition-colors',
          // ENH-078 (v0.6.4) + BUG-074 (v0.6.5) — Finder-style
          // selection: SOLID accent fill + white text + medium weight.
          // Square corners (no `rounded`) — macOS Finder selection is
          // edge-to-edge. The earlier `bg-accent/85` polish ATTEMPT
          // turned out to break the fill entirely: this codebase's
          // tailwind config defines accent as a raw `var(--duo-accent)`
          // (no `<alpha-value>` placeholder), so opacity modifiers like
          // `/85` synthesize invalid CSS and produce zero fill. Solid
          // bg-accent is what works. The "slightly less obtrusive"
          // refinement is queued behind the wider alpha-value migration
          // (separate follow-up — see tasks.md FOLLOWUP-008).
          isSelected
            ? 'bg-accent text-white font-medium'
            // Stage 26 PR 3 item 3 — open file rows render with
            // brighter text than unopened rows. Distinct from
            // selection (full-row tint), this is just text color.
            // Layered on top: hover still tints, active gets a dot.
            : isOpenFile
              ? 'text-zinc-200 hover:bg-surface-2 hover:text-zinc-100'
              : 'text-zinc-400 hover:bg-surface-2 hover:text-zinc-200'
        ].join(' ')}
        style={{ paddingLeft: `${indentLeft}px` }}
      >
        {isFolder ? (
          <button
            type="button"
            onClick={onChevronClick}
            aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
            tabIndex={-1}
            className="shrink-0 -my-0.5 -ml-0.5 p-0.5 rounded hover:bg-surface-3"
          >
            <Chevron open={isExpanded} />
          </button>
        ) : (
          <span className="w-2.5 shrink-0" />
        )}
        {isRenaming && onCommitRename && onCancelRename ? (
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <FileIcon entry={entry} />
            <RenameInput
              initial={entry.name}
              isFolder={isFolder}
              onCommit={(name) => onCommitRename(entry, name)}
              onCancel={onCancelRename}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={onSingleClickRow}
            onDoubleClick={onDoubleClickRow}
            onKeyDown={onRowKey}
            onContextMenu={(e) => onContextMenu(e, entry)}
            className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
            title={entry.path}
          >
            <FileIcon entry={entry} />
            <span className="truncate">{entry.name}</span>
            {/* ENH-152a v2 peer-repos — modified-Option-B per owner's
                rev5 pick: instead of inline chip (which occluded long
                folder names), show a small right-aligned git icon
                that's always visible + a floating chip popover that
                appears on icon hover (NOT row hover — so reading the
                folder name doesn't trigger the chip).
                State-colored icon for at-a-glance:
                  clean → ink-mute (subtle)
                  dirty → accent (orange, attention)
                  diverged → warn (amber)
                Chip stays full-text (no truncation). Tooltip on the
                wrapper for keyboard/screenreader access. */}
            {isFolder && childRepoMap?.has(entry.path) && (() => {
              const snap = childRepoMap.get(entry.path)!
              const chip = formatGitStatusChip(snap)
              if (!chip) return null
              return (
                <FolderRepoChip
                  snap={snap}
                  chip={chip}
                  folderName={entry.name}
                />
              )
            })()}
            {/* ENH-152b — per-file dirty dot. ANY-CHANGE semantics
                per Q6 (single orange dot for staged/unstaged/
                untracked). STATUS-DIFF tooltip per proto-Q4. Files
                only; the active-file dot below is a separate signal
                (this dot fires on dirty state, that one on "is this
                the front tab"). */}
            {!isFolder && dirtyFileMap?.has(entry.path) && (() => {
              const dirty = dirtyFileMap.get(entry.path)!
              const statusLabel = dirty.status === '?' ? 'Untracked' :
                dirty.status === 'M' ? 'Modified' :
                dirty.status === 'A' ? 'Added (staged)' :
                dirty.status === 'D' ? 'Deleted' :
                dirty.status === 'R' ? 'Renamed' :
                dirty.status === 'U' ? 'Unmerged' :
                'Changed'
              const diffPart = dirty.status === '?'
                ? `${dirty.plus} line${dirty.plus === 1 ? '' : 's'}`
                : `+${dirty.plus} / -${dirty.minus} lines`
              const tooltip = `${statusLabel} · ${diffPart}`
              return (
                <span
                  aria-label="Dirty file"
                  title={tooltip}
                  className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent"
                  data-duo-file-dirty-dot="1"
                />
              )
            })()}
            {/* Stage 26 PR 3 item 2 — ambient signal: this folder is
                the front terminal's launch CWD. A small accent dot
                inline with the name; doesn't overlap selection's
                full-row tint or item 7's hover button (which lives in
                its own sibling). */}
            {isActiveCwd && (
              <span
                aria-label="Active terminal CWD"
                title="Front terminal is in this folder"
                className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent"
              />
            )}
            {/* Stage 26 PR 3 item 3 — symmetric "front-most" signal
                for files: the active WorkingPane file tab gets the
                same accent dot the active-CWD folder gets above.
                ENH-087 (v0.6.5, OPT-B) — open-but-not-active files
                get a softer ink-mute dot so the user can tell at
                glance which files have a tab somewhere. The bolder
                row text (Stage 26 PR 3 item 3) is now reinforced by
                an explicit glyph; owner walk surfaced "I don't know
                what this means" before the dot landed. Active file
                wins the dot priority — accent only, no double dot. */}
            {isActiveFile ? (
              <span
                aria-label="Active file tab"
                title="This file is the active WorkingPane tab"
                className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent"
              />
            ) : isOpenFile && (
              <span
                aria-label="Open in working pane"
                title="Open in a working pane tab"
                className="shrink-0 w-1.5 h-1.5 rounded-full bg-ink-mute"
              />
            )}
          </button>
        )}
        {/* Stage 26 item 7 — hover "new Claude here" button. Folders only,
         *  and only when the parent pane wires the callback. Hidden by
         *  default; revealed on row hover via the parent's `group/row`. */}
        {isFolder && onOpenClaudeIn && !isRenaming && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenClaudeIn(entry.path)
            }}
            tabIndex={-1}
            title={`New Claude tab in ${entry.name}`}
            aria-label={`Open new Claude terminal in ${entry.name}`}
            className="shrink-0 opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-accent hover:bg-surface-3"
          >
            <ClaudeGlyph />
          </button>
        )}
      </div>

      {isFolder && isExpanded && (
        <TreeNodes
          entries={state.listings.get(entry.path)}
          depth={depth + 1}
          state={state}
          actions={actions}
          onOpenFile={onOpenFile}
          onContextMenu={onContextMenu}
          onRangeSelect={onRangeSelect}
          renamingPath={renamingPath}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          onOpenClaudeIn={onOpenClaudeIn}
          childRepoMap={childRepoMap}
          dirtyFileMap={dirtyFileMap}
        />
      )}
    </>
  )
}

interface RenameInputProps {
  initial: string
  isFolder: boolean
  onCommit: (newName: string) => Promise<boolean>
  onCancel: () => void
}

function RenameInput({ initial, isFolder, onCommit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  // BUG-028 — track whether Escape just fired, so the resulting blur
  // (which we trigger explicitly to force unmount) doesn't fire a second
  // cancel from a stale-looking onBlur path. Belt-and-suspenders for
  // React 18 batching: keyDown's setRenamingPath(null) might not commit
  // before the next event tick, so we also call inputRef.current.blur()
  // synchronously and let onBlur path do the cancel.
  const cancelledRef = useRef(false)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    // Finder parity: select the basename (everything before the
    // extension) for files; whole name for folders.
    if (!isFolder) {
      const dot = initial.lastIndexOf('.')
      el.setSelectionRange(0, dot > 0 ? dot : initial.length)
    } else {
      el.select()
    }
  }, [initial, isFolder])

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          void onCommit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          cancelledRef.current = true
          inputRef.current?.blur()
          onCancel()
        } else {
          // Block global shortcuts from hijacking typing in the rename
          // input (⌃Tab, ⌘W, etc. should NOT bubble while editing).
          e.stopPropagation()
        }
      }}
      onBlur={() => {
        // Skip if Escape already cancelled — avoids the second-cancel
        // race during the unmount cycle.
        if (cancelledRef.current) return
        onCancel()
      }}
      className="flex-1 min-w-0 bg-surface-3 border border-accent rounded px-1 py-0 text-[12px] text-zinc-100 outline-none"
    />
  )
}

// ENH-152a v2 round-2 — small ⎇ icon + portal-positioned chip popover.
// The chip can extend leftward beyond the navigator's scroll container
// (which clips with overflow-auto), so the popover renders into
// document.body via portal at a viewport-fixed coordinate. The chip's
// right edge sits just left of the icon; the chip extends leftward as
// far as its content needs. On hover, opacity fades in.
type FolderRepoChipProps = {
  snap: GitStatusSnapshot
  chip: string
  folderName: string
}
function FolderRepoChip({ snap, chip, folderName }: FolderRepoChipProps) {
  const iconRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLSpanElement>(null)
  const [iconRect, setIconRect] = useState<DOMRect | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const isDiverged = snap.ahead > 0 || snap.behind > 0
  const isDirty = snap.dirty
  const iconColorClass = isDiverged
    ? 'text-warn'
    : isDirty
      ? 'text-accent'
      : 'text-ink-mute'
  const tooltip = formatGitStatusTooltip(snap, folderName)
  const updateRect = () => {
    const r = iconRef.current?.getBoundingClientRect()
    if (r) setIconRect(r)
  }
  // Position the popover directly below the row (below the folder
  // name), left-aligned with the row's content. The chip then extends
  // rightward; long branch names like "claude/implement-session-
  // share-J02X3 · 1 modified" can extend past the navigator into the
  // working pane area — fine because the popover is pointer-events:
  // none and disappears on mouseleave. Avoids the horizontal-overflow
  // problem that round-3's right-anchored variant had on narrow
  // navigators.
  useLayoutEffect(() => {
    if (!iconRect || !iconRef.current) {
      setPos(null)
      return
    }
    const rowButton = iconRef.current.closest('button')
    const rowRect = rowButton?.getBoundingClientRect()
    const chipLeft = rowRect ? rowRect.left : iconRect.left
    setPos({
      left: Math.max(chipLeft, 8),
      top: iconRect.bottom + 2,
    })
  }, [iconRect])
  return (
    <span
      className="shrink-0 inline-flex items-center"
      data-duo-folder-repo-icon="1"
      data-duo-folder-repo-chip="1"
      title={tooltip}
      onMouseEnter={updateRect}
      onMouseMove={iconRect ? undefined : updateRect}
      onMouseLeave={() => { setIconRect(null); setPos(null) }}
    >
      <span
        ref={iconRef}
        className={`inline-flex items-center justify-center cursor-default ${iconColorClass} hover:text-accent transition-colors`}
        aria-label={tooltip}
        style={{ width: 11, height: 11 }}
      >
        {/* Lucide git-branch (owner pick, ENH-152a v2 round-5).
            stroke-width 2.25 reads cleanly at 11px. */}
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="6" x2="6" y1="3" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      </span>
      {iconRect && createPortal(
        <span
          ref={popoverRef}
          className="fixed px-1.5 py-0.5 text-[10px] font-mono rounded bg-accent-soft text-accent-ink font-semibold whitespace-nowrap pointer-events-none shadow-md z-[9999] transition-opacity duration-150"
          data-duo-folder-repo-chip-popover="1"
          style={{
            top: pos?.top ?? 0,
            left: pos?.left ?? -9999,
            opacity: pos ? 1 : 0,
          }}
        >
          {chip}
        </span>,
        document.body
      )}
    </span>
  )
}

// Dotfile rule (Stage 10 § D6): hide dotfiles by default, EXCEPT
// `.claude` directories — which carry user/project skills + agents
// and are first-class for the Duo workflow — and `.obsidian`
// directories, which carry vault config (workspace/theme/plugins)
// that vault authors edit by hand. Sprint 11 ENH-109 — added
// `.obsidian` to the always-visible list so working with an
// Obsidian vault doesn't require flipping the global "show hidden
// files" toggle just to reach the vault config.
function shouldShow(entry: DirEntry, showDotfiles: boolean): boolean {
  if (showDotfiles) return true
  if (!entry.name.startsWith('.')) return true
  if (entry.name === '.claude') return true
  if (entry.name === '.obsidian') return true
  return false
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 transition-transform text-zinc-600 ${open ? 'rotate-90' : ''}`}
    >
      <path d="M3.5 2.5L6.5 5l-3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Small per-type SVG set. Grows as Phase 5 / 11 add more per-type components.
function FileIcon({ entry }: { entry: DirEntry }) {
  if (entry.kind === 'directory') {
    return (
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0 text-accent/70">
        <path
          d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.1l1.3 1.3h4.6a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5Z"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  const ext = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase() : ''
  switch (ext) {
    case 'md':
    case 'markdown':
      return <DocGlyph tint="text-zinc-400" />
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg':
      return <ImageGlyph />
    case 'pdf':
      return <PdfGlyph />
    default:
      return <DocGlyph tint="text-zinc-500" />
  }
}

function DocGlyph({ tint }: { tint: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className={`shrink-0 ${tint}`}>
      <path d="M2 1.5h5l2 2v7h-7v-9Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M7 1.5v2h2" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function ImageGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0 text-zinc-500">
      <rect x="1.5" y="1.8" width="9" height="8.4" rx="1" stroke="currentColor" strokeWidth="1" />
      <circle cx="4" cy="4.5" r="1" stroke="currentColor" strokeWidth="0.9" />
      <path d="M10 8L7.5 5.5l-2 2.5L4 7l-2 1.8" stroke="currentColor" strokeWidth="0.9" />
    </svg>
  )
}

function PdfGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0 text-red-400/70">
      <path d="M2 1.5h5l2 2v7h-7v-9Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M7 1.5v2h2" stroke="currentColor" strokeWidth="1" />
      <text x="3.4" y="9" fontSize="3" fill="currentColor" fontFamily="system-ui">pdf</text>
    </svg>
  )
}

// Stage 26 item 7 — sparkle glyph for the hover "new Claude here"
// button. Mirrors the TabBar's per-kind ClaudeIcon at a slightly
// larger size for hit-target legibility on the row's right edge.
function ClaudeGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M5 1l1.1 2.9L9 5 6.1 6.1 5 9 3.9 6.1 1 5 3.9 3.9 5 1Z"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.18"
      />
    </svg>
  )
}
