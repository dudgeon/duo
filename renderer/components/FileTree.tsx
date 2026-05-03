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

import { useEffect, useRef, useState } from 'react'
import type { DirEntry, MenuTemplateItem, NavPinEntry } from '@shared/types'
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

  // ENH-050 — central handler that maps a chosen menu id back to an
  // action against the given target entry. Stable ids keep the menu
  // template a pure data structure (no closures riding through IPC).
  const handleMenuChoice = async (chosenId: string, target: DirEntry) => {
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
        try { await navigator.clipboard.writeText(target.path) } catch { /* permission denied */ }
        return
      case 'open-with-default':
        await window.electron.files.openExternal(target.path)
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
        await onTrashEntry(target)
        return
      case 'open-in-split':
        if (!isFolder && onOpenInSplit) onOpenInSplit(target.path)
        return
    }
  }

  // ENH-050 — fire native menu on right-click (rows + whitespace). The
  // popup awaits the user's choice; we then dispatch via handleMenuChoice.
  const popupMenu = async (e: React.MouseEvent, target: DirEntry, whitespaceMode: boolean) => {
    e.preventDefault()
    const items = buildTreeMenuTemplate({
      target,
      whitespaceMode,
      navPins,
      onOpenInSplit
    })
    if (items.length === 0) return
    const result = await window.electron.menu.popup({
      items,
      x: e.clientX,
      y: e.clientY
    })
    if (!result.chosenId) return
    void handleMenuChoice(result.chosenId, target)
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

  return (
    <div
      className="flex-1 overflow-auto scrollbar-none py-1"
      onContextMenu={onWhitespaceContextMenu}
      onClick={onWhitespaceClick}
    >
      <TreeNodes
        entries={rootEntries}
        depth={0}
        state={state}
        actions={actions}
        onOpenFile={onOpenFile}
        onContextMenu={(e, entry) => { void popupMenu(e, entry, false) }}
        renamingPath={renamingPath}
        onCommitRename={onCommitRename}
        onCancelRename={() => setRenamingPath(null)}
        onOpenClaudeIn={onOpenClaudeIn}
        activeTerminalCwd={activeTerminalCwd}
        openFilePaths={openFilePaths}
        activeFilePath={activeFilePath}
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
}): MenuTemplateItem[] {
  const { target, whitespaceMode, navPins, onOpenInSplit } = opts
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
    items.push({
      id: 'trash',
      label: isFolder ? 'Move folder to Trash…' : 'Move to Trash…'
    })
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
}

export function TreeNodes({ entries, depth, state, actions, onOpenFile, onContextMenu, renamingPath, onCommitRename, onCancelRename, onOpenClaudeIn, activeTerminalCwd = null, openFilePaths, activeFilePath = null }: TreeNodesProps) {
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
          renamingPath={renamingPath}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          onOpenClaudeIn={onOpenClaudeIn}
          activeTerminalCwd={activeTerminalCwd}
          openFilePaths={openFilePaths}
          activeFilePath={activeFilePath}
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
  renamingPath?: string | null
  onCommitRename?: (entry: DirEntry, newName: string) => Promise<boolean>
  onCancelRename?: () => void
  onOpenClaudeIn?: (folderPath: string) => void
  /** Stage 26 PR 3 item 2 — active terminal CWD for ambient highlight. */
  activeTerminalCwd?: string | null
  /** Stage 26 PR 3 item 3 — open / active file signals. */
  openFilePaths?: ReadonlySet<string>
  activeFilePath?: string | null
}

function TreeNode({ entry, depth, state, actions, onOpenFile, onContextMenu, renamingPath, onCommitRename, onCancelRename, onOpenClaudeIn, activeTerminalCwd = null, openFilePaths, activeFilePath = null }: TreeNodeProps) {
  const isFolder = entry.kind === 'directory'
  const isExpanded = isFolder && state.expanded.has(entry.path)
  const isSelected = state.selected?.path === entry.path
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
  const onSingleClickRow = () => {
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
  }

  // Two-sibling layout: chevron button + row button. The wrapping div
  // owns the indent + selection background so they paint as one unit.
  const indentLeft = 8 + depth * 12

  return (
    <>
      <div
        className={[
          'group/row relative w-full flex items-center gap-1.5 pr-2 py-0.5 text-[12px] leading-tight rounded transition-colors',
          // ENH-078 (v0.6.4) — selection prominence bumped from
          // bg-accent/15 + text-zinc-100 to bg-accent/30 + text-zinc-50
          // + font-medium so selection reads like Finder's at a glance.
          // Owner observation: prior selection state was "too subtle;
          // hard to see which item is selected." Same accent token
          // (still atelier), heavier fill + heavier weight.
          isSelected
            ? 'bg-accent/30 text-zinc-50 font-medium'
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
                same dot the active-CWD folder gets above. Open files
                (in any tab, not necessarily front-most) render with
                brighter text — see the row's className. */}
            {isActiveFile && (
              <span
                aria-label="Active file tab"
                title="This file is the active WorkingPane tab"
                className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent"
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
          renamingPath={renamingPath}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          onOpenClaudeIn={onOpenClaudeIn}
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

// Dotfile rule (Stage 10 § D6): hide dotfiles by default, EXCEPT `.claude`
// directories and anything beneath them, which are always visible.
function shouldShow(entry: DirEntry, showDotfiles: boolean): boolean {
  if (showDotfiles) return true
  if (!entry.name.startsWith('.')) return true
  if (entry.name === '.claude') return true
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
