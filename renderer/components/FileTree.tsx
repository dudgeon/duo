// Stage 10 Phase 4 — file tree with lazy-loaded children.
//
// The tree renders the navigator's current folder. Each folder row
// toggles its expansion on click; expanded folders fetch their own
// listings via `useNavigator.ensureListing` (called through the hook).
// Files open via the passed-in `onOpenFile` callback (routed to
// WorkingPane in App.tsx).

import type { DirEntry } from '@shared/types'
import type { NavigatorState, NavigatorActions } from '../hooks/useNavigator'

interface FileTreeProps {
  state: NavigatorState
  actions: NavigatorActions
  onOpenFile: (entry: DirEntry) => void
}

export function FileTree({ state, actions, onOpenFile }: FileTreeProps) {
  const rootEntries = state.listings.get(state.cwd)
  return (
    <div className="flex-1 overflow-auto scrollbar-none py-1">
      <TreeNodes
        entries={rootEntries}
        depth={0}
        state={state}
        actions={actions}
        onOpenFile={onOpenFile}
      />
    </div>
  )
}

interface TreeNodesProps {
  entries: DirEntry[] | null | undefined
  depth: number
  state: NavigatorState
  actions: NavigatorActions
  onOpenFile: (entry: DirEntry) => void
}

function TreeNodes({ entries, depth, state, actions, onOpenFile }: TreeNodesProps) {
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
}

function TreeNode({ entry, depth, state, actions, onOpenFile }: TreeNodeProps) {
  const isFolder = entry.kind === 'directory'
  const isExpanded = isFolder && state.expanded.has(entry.path)
  const isSelected = state.selected?.path === entry.path

  const click = () => {
    if (isFolder) {
      actions.toggleExpand(entry.path)
      actions.selectItem(entry.path, 'folder')
    } else {
      actions.selectItem(entry.path, 'file')
      onOpenFile(entry)
    }
  }

  return (
    <>
      <button
        onClick={click}
        className={[
          'w-full flex items-center gap-1.5 px-2 py-0.5 text-[12px] text-left leading-tight rounded transition-colors',
          isSelected
            ? 'bg-accent/15 text-zinc-100'
            : 'text-zinc-400 hover:bg-surface-2 hover:text-zinc-200'
        ].join(' ')}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        title={entry.path}
      >
        {isFolder ? <Chevron open={isExpanded} /> : <span className="w-2.5" />}
        <FileIcon entry={entry} />
        <span className="truncate">{entry.name}</span>
      </button>

      {isFolder && isExpanded && (
        <TreeNodes
          entries={state.listings.get(entry.path)}
          depth={depth + 1}
          state={state}
          actions={actions}
          onOpenFile={onOpenFile}
        />
      )}
    </>
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
