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
import type { DirEntry, NavPinEntry } from '@shared/types'
import type { NavigatorState, NavigatorActions } from '../hooks/useNavigator'
import type { NavPinsApi } from '../hooks/useNavPins'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'

/** Return the parent directory of an absolute POSIX-style path. */
function parentDir(absPath: string): string {
  const i = absPath.lastIndexOf('/')
  return i > 0 ? absPath.slice(0, i) : '/'
}

/** Re-join a parent directory with a new basename. */
function joinPath(dir: string, base: string): string {
  return dir.endsWith('/') ? dir + base : dir + '/' + base
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
}

export function FileTree({ state, actions, onOpenFile, onOpenTerminalHere, onOpenClaudeIn, navPins, rootEntriesOverride }: FileTreeProps) {
  const rootEntries = rootEntriesOverride !== undefined ? rootEntriesOverride : state.listings.get(state.cwd)
  // Shared context-menu state — only one menu open at a time across the whole
  // tree. `target` carries the entry the user right-clicked.
  const [menu, setMenu] = useState<{ x: number; y: number; target: DirEntry } | null>(null)
  // Stage 26 item 6 — inline rename. Holds the path of the row currently
  // in rename mode; null means no row is being renamed. Local to the tree
  // because rename is a transient renderer-side state (no IPC mirror).
  const [renamingPath, setRenamingPath] = useState<string | null>(null)

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
    const label = entry.kind === 'directory' ? `Move folder "${entry.name}" and all of its contents to the Trash?` : `Move "${entry.name}" to the Trash?`
    if (!window.confirm(label)) return
    try {
      await window.electron.files.trash(entry.path)
      actions.refresh(parentDir(entry.path))
    } catch (err) {
      window.alert(`Move to Trash failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="flex-1 overflow-auto scrollbar-none py-1">
      <TreeNodes
        entries={rootEntries}
        depth={0}
        state={state}
        actions={actions}
        onOpenFile={onOpenFile}
        onContextMenu={(e, entry) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, target: entry })
        }}
        renamingPath={renamingPath}
        onCommitRename={onCommitRename}
        onCancelRename={() => setRenamingPath(null)}
        onOpenClaudeIn={onOpenClaudeIn}
      />
      {menu && (
        <ContextMenu
          position={{ x: menu.x, y: menu.y }}
          items={buildMenuItems(menu.target, {
            onOpenTerminalHere,
            onOpenFile,
            onRevealInFinder: (p) => window.electron.files.revealInFinder(p),
            onCopyPath: async (p) => {
              try { await navigator.clipboard.writeText(p) } catch { /* permission denied */ }
            },
            onOpenWithDefault: (p) => window.electron.files.openExternal(p),
            onStartRename: () => setRenamingPath(menu.target.path),
            onTrash: () => { void onTrashEntry(menu.target) },
            navPins,
            onTogglePin: navPins
              ? (entry) => {
                  void navPins.toggle({
                    path: entry.path,
                    kind: entry.kind === 'directory' ? 'folder' : 'file',
                    title: entry.name
                  })
                }
              : undefined
          })}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

// Menu item factory — keeps the permutations (folder vs file) in one place
// so the rules map directly onto PRD § D11. Stage 26 item 6 adds Rename
// + Move to Trash, gated behind the same handlers as the `duo file *`
// CLI verbs so the agent and human use the same code paths.
function buildMenuItems(
  entry: DirEntry,
  handlers: {
    onOpenTerminalHere: (path: string) => void
    onOpenFile: (entry: DirEntry) => void
    onRevealInFinder: (path: string) => void | Promise<void>
    onCopyPath: (path: string) => void | Promise<void>
    onOpenWithDefault: (path: string) => void | Promise<void>
    onStartRename: () => void
    onTrash: () => void
    /** Stage 26 PR 2 (ENH-010) — present only when the host pane wires
     *  navPins (project tree does; user-claude pane does not). */
    navPins?: NavPinsApi
    onTogglePin?: (entry: DirEntry) => void
  }
): ContextMenuItem[] {
  const isFolder = entry.kind === 'directory'
  const items: ContextMenuItem[] = []

  if (isFolder) {
    items.push({
      label: 'Open terminal here',
      onClick: () => handlers.onOpenTerminalHere(entry.path)
    })
  } else {
    items.push({
      label: 'Open in Duo editor',
      onClick: () => handlers.onOpenFile(entry)
    })
  }
  items.push({
    label: 'Reveal in Finder',
    onClick: () => { void handlers.onRevealInFinder(entry.path) }
  })
  items.push({
    label: 'Copy path',
    onClick: () => { void handlers.onCopyPath(entry.path) }
  })
  items.push({
    label: 'Open with default app',
    separatorBefore: true,
    onClick: () => { void handlers.onOpenWithDefault(entry.path) }
  })
  // Stage 26 PR 2 (ENH-010) — Pin / Unpin from navigator. Visible when
  // the host pane wires navPins; suppressed otherwise (user-claude pane).
  if (handlers.navPins && handlers.onTogglePin) {
    const pinned = handlers.navPins.isPinned(entry.path)
    items.push({
      label: pinned ? 'Unpin from navigator' : 'Pin to navigator',
      separatorBefore: true,
      onClick: () => handlers.onTogglePin!(entry)
    })
  }
  items.push({
    label: 'Rename…',
    separatorBefore: true,
    onClick: handlers.onStartRename
  })
  items.push({
    label: isFolder ? 'Move folder to Trash…' : 'Move to Trash…',
    onClick: handlers.onTrash
  })

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
}

export function TreeNodes({ entries, depth, state, actions, onOpenFile, onContextMenu, renamingPath, onCommitRename, onCancelRename, onOpenClaudeIn }: TreeNodesProps) {
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
}

function TreeNode({ entry, depth, state, actions, onOpenFile, onContextMenu, renamingPath, onCommitRename, onCancelRename, onOpenClaudeIn }: TreeNodeProps) {
  const isFolder = entry.kind === 'directory'
  const isExpanded = isFolder && state.expanded.has(entry.path)
  const isSelected = state.selected?.path === entry.path
  const isRenaming = renamingPath === entry.path

  // Stage 26 item 1 — single-click selects, double-click opens.
  // Stage 26 item 1b (BUG-025) — chevron is a discrete hit target;
  // toggling expansion does NOT change selection or re-root the tree.
  const onSingleClickRow = () => {
    actions.selectItem(entry.path, isFolder ? 'folder' : 'file')
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
          isSelected
            ? 'bg-accent/15 text-zinc-100'
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
          void onCommit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        } else {
          // Block global shortcuts from hijacking typing in the rename
          // input (⌃Tab, ⌘W, etc. should NOT bubble while editing).
          e.stopPropagation()
        }
      }}
      onBlur={() => onCancel()}
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
