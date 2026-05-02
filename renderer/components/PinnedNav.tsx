// Stage 26 PR 2 (ENH-010) — Pinned files & folders section.
//
// Renders at the bottom of FilesPane below the project tree, hidden
// when empty. Entries are grouped by parent directory so a pinned
// `~/Documents/notes/inbox.md` and `~/Documents/notes/today.md`
// appear under one "notes" header. Same single-/double-click model
// as the rest of the navigator (Stage 26 PR 1):
//
//   - Single-click: select the row (sets navigator selection so
//     "open terminal here" / pending-CWD logic still works).
//   - Double-click on file: opens it via onOpenFile (same as the
//     project tree).
//   - Double-click on folder: re-roots the navigator (navigateTo) —
//     pinned folders are a "jump to" affordance.
//   - Right-click: Unpin from navigator (folder also gets Open
//     terminal here / Reveal in Finder; file gets Open in Duo
//     editor / Reveal in Finder).
//
// Path-shortening: `~/` for HOME prefix, then up to one segment of
// dirname before the basename. So `~/Documents/notes/inbox.md`
// renders as basename "inbox.md" + dim secondary "~/Documents/notes".
// Same project rooted at `~/Documents/GitHub/duo/cli` shows "cli"
// under header "duo" inside group `~/Documents/GitHub`. Long paths
// truncate the middle with `…`.

import { useState } from 'react'
import type { MenuTemplateItem, NavPinEntry } from '@shared/types'

interface PinnedNavProps {
  pins: NavPinEntry[]
  home: string
  selectedPath: string | null
  onSelect: (entry: NavPinEntry) => void
  onOpenFile: (entry: NavPinEntry) => void
  onOpenFolder: (entry: NavPinEntry) => void
  onOpenTerminalHere: (folderPath: string) => void
  onRevealInFinder: (path: string) => void | Promise<void>
  onUnpin: (entry: NavPinEntry) => Promise<void>
}

export function PinnedNav({
  pins,
  home,
  selectedPath,
  onSelect,
  onOpenFile,
  onOpenFolder,
  onOpenTerminalHere,
  onRevealInFinder,
  onUnpin
}: PinnedNavProps) {
  const [collapsed, setCollapsed] = useState(false)
  // ENH-050 — context menu via window.electron.menu.popup. No state.

  if (pins.length === 0) return null

  const handleMenuChoice = async (chosenId: string, target: NavPinEntry) => {
    switch (chosenId) {
      case 'open-here':
        if (target.kind === 'folder') onOpenFolder(target)
        return
      case 'open-terminal-here':
        if (target.kind === 'folder') onOpenTerminalHere(target.path)
        return
      case 'open-in-editor':
        if (target.kind === 'file') onOpenFile(target)
        return
      case 'reveal-in-finder':
        await onRevealInFinder(target.path)
        return
      case 'unpin':
        await onUnpin(target)
        return
    }
  }

  const popupMenu = async (e: React.MouseEvent, target: NavPinEntry) => {
    e.preventDefault()
    const items: MenuTemplateItem[] = []
    if (target.kind === 'folder') {
      items.push({ id: 'open-here', label: 'Open here' })
      items.push({ id: 'open-terminal-here', label: 'Open terminal here' })
    } else {
      items.push({ id: 'open-in-editor', label: 'Open in Duo editor' })
    }
    items.push({ id: 'reveal-in-finder', label: 'Reveal in Finder' })
    items.push({ type: 'separator' })
    items.push({ id: 'unpin', label: 'Unpin from navigator' })
    const result = await window.electron.menu.popup({
      items,
      x: e.clientX,
      y: e.clientY
    })
    if (result.chosenId) void handleMenuChoice(result.chosenId, target)
  }

  // Group by parent directory. Stable sort preserves insertion order
  // within each group (matches user's pin-order intuition: recently
  // pinned shows up at the end of its group).
  const groups = groupByParent(pins, home)

  return (
    <div className="border-t border-border shrink-0 max-h-[40%] overflow-auto">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 hover:bg-surface-2 transition-colors"
        title={collapsed ? 'Expand pinned' : 'Collapse pinned'}
      >
        <Caret open={!collapsed} />
        <span>Pinned</span>
        <span className="ml-auto text-zinc-600">{pins.length}</span>
      </button>

      {!collapsed && (
        <div className="pb-1">
          {groups.map(group => (
            <div key={group.parent}>
              <div className="px-2 pt-1.5 pb-0.5 text-[10px] text-zinc-600 truncate" title={group.parentLong}>
                {group.parentShort}
              </div>
              {group.entries.map(entry => (
                <PinnedRow
                  key={entry.path}
                  entry={entry}
                  isSelected={selectedPath === entry.path}
                  onSingleClick={() => onSelect(entry)}
                  onDoubleClick={() => {
                    if (entry.kind === 'folder') onOpenFolder(entry)
                    else onOpenFile(entry)
                  }}
                  onContextMenu={(e) => { void popupMenu(e, entry) }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface PinnedRowProps {
  entry: NavPinEntry
  isSelected: boolean
  onSingleClick: () => void
  onDoubleClick: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

function PinnedRow({ entry, isSelected, onSingleClick, onDoubleClick, onContextMenu }: PinnedRowProps) {
  return (
    <button
      type="button"
      onClick={onSingleClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title={entry.path}
      className={[
        'w-full flex items-center gap-1.5 px-2 py-0.5 text-[12px] text-left leading-tight rounded transition-colors',
        isSelected
          ? 'bg-accent/15 text-zinc-100'
          : 'text-zinc-400 hover:bg-surface-2 hover:text-zinc-200'
      ].join(' ')}
      style={{ paddingLeft: '20px' }}
    >
      <PinIcon kind={entry.kind} />
      <span className="truncate">{entry.title ?? basename(entry.path)}</span>
    </button>
  )
}

interface Group {
  parent: string         // raw absolute path of parent dir
  parentShort: string    // header-display version (~/foo/bar/baz w/ truncation)
  parentLong: string     // full path for the title attr
  entries: NavPinEntry[]
}

function groupByParent(pins: NavPinEntry[], home: string): Group[] {
  const map = new Map<string, NavPinEntry[]>()
  for (const p of pins) {
    const parent = parentDir(p.path)
    const existing = map.get(parent)
    if (existing) existing.push(p)
    else map.set(parent, [p])
  }
  return Array.from(map.entries()).map(([parent, entries]) => ({
    parent,
    parentShort: shortenPath(parent, home),
    parentLong: parent,
    entries
  }))
}

function parentDir(absPath: string): string {
  const i = absPath.lastIndexOf('/')
  return i > 0 ? absPath.slice(0, i) : '/'
}

function basename(absPath: string): string {
  const i = absPath.lastIndexOf('/')
  return i >= 0 ? absPath.slice(i + 1) : absPath
}

const SHORT_PATH_LIMIT = 32

function shortenPath(absPath: string, home: string): string {
  let p = absPath
  if (home && p.startsWith(home)) p = '~' + p.slice(home.length)
  if (p.length <= SHORT_PATH_LIMIT) return p
  // Keep the leading 1-2 segments + final 2 segments, ellipsize the middle.
  const parts = p.split('/')
  if (parts.length <= 4) return p
  return [parts[0], parts[1], '…', ...parts.slice(-2)].filter(Boolean).join('/')
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 transition-transform text-zinc-600 ${open ? 'rotate-90' : ''}`}
    >
      <path d="M3.5 2.5L6.5 5l-3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PinIcon({ kind }: { kind: 'file' | 'folder' }) {
  if (kind === 'folder') {
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
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0 text-zinc-500">
      <path d="M2 1.5h5l2 2v7h-7v-9Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M7 1.5v2h2" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}
