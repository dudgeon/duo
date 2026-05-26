// ENH-171 (Sprint 20 / v0.7.7) — title-bar workspace switcher dropdown.
//
// Anchored under the workspace-name badge in App.tsx's titlebar block.
// Renders the same data as File > Open Recent Workspace, plus a top-row
// "+ New Workspace" affordance and a bottom-row "Clear Recent Workspaces".
//
// Design locked via ENH-168 owner walk 2026-05-22:
//   Q1 Position    = A — Title-bar dropdown
//   Q2 Gesture     = a — Dropdown menu (single click → list)
//   Q3 ID          = a — Name only (no color tags / emoji / thumbnails in v1)
//   Q4 Create gesture = b — "+" inline → opens full native Save As dialog
//
// Q4 superseded 2026-05-24: "+ New Workspace" routes through the same
// `newWorkspaceReset()` path as File > New Workspace (fresh empty
// workspace; prompt-on-dirty handled by the shared path). The original
// "Save As" wiring was a misread of the affordance — picker "+" means
// new, not save-current-as-new.
//
// No keyboard chord in v1 (BUG-075 lesson: ⌘\ collides with 1Password
// autofill on most users' machines). Owner-locked 2026-05-22 AUQ.

import { useEffect, useRef, useState } from 'react'
import type { ActiveWorkspace, WorkspaceHistoryEntry } from '@shared/types'

export interface WorkspaceSwitcherDropdownProps {
  open: boolean
  /** Ref to the trigger button so we can: (a) position below it, (b)
   *  ignore click-outside events that target the trigger itself
   *  (otherwise the dropdown would toggle open → close in one click). */
  anchorRef: React.RefObject<HTMLElement | null>
  activeWorkspace: ActiveWorkspace | null
  onClose: () => void
}

export function WorkspaceSwitcherDropdown({
  open,
  anchorRef,
  activeWorkspace,
  onClose
}: WorkspaceSwitcherDropdownProps) {
  const [recent, setRecent] = useState<WorkspaceHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  // Fetch the recent list every time the dropdown opens. Cheap (a
  // single IPC + 10 entries) and avoids stale display after a Save
  // Workspace As that the renderer hasn't otherwise observed.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void window.electron.workspaceFile.listRecent().then(list => {
      if (cancelled) return
      setRecent(list)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [open])

  // Click-outside + ESC dismissal.
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node | null
      // Ignore clicks on the trigger button — App.tsx already handles
      // those (and toggling open→close would race with the trigger's
      // own click handler).
      if (target && anchorRef.current?.contains(target)) return
      if (target && dropdownRef.current?.contains(target)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null

  const handleNew = () => {
    onClose()
    void window.electron.workspaceFile.newWorkspace()
  }
  const handleOpen = (path: string) => {
    onClose()
    void window.electron.workspaceFile.openRecent(path)
  }
  const handleClearRecent = async () => {
    onClose()
    await window.electron.workspaceFile.clearRecent()
  }

  // Position is anchored under the trigger. The titlebar is height 40px
  // (`h-10`) with the trigger inset 96px from the left for traffic
  // lights. We position absolute from the top-left of the app, lining
  // up under the trigger.
  //
  // Tailwind: absolute, top of dropdown ~= 40px (titlebar bottom),
  // left aligned with the trigger.
  const anchorRect = anchorRef.current?.getBoundingClientRect()
  const top = (anchorRect?.bottom ?? 40) + 4
  const left = anchorRect?.left ?? 96

  return (
    <div
      ref={dropdownRef}
      role="menu"
      aria-label="Workspace switcher"
      className="titlebar-nodrag fixed z-50 min-w-[200px] max-w-[320px] rounded-md bg-surface-1 border border-border shadow-lg py-1 text-[13px]"
      style={{ top, left }}
    >
      {/* + New Workspace */}
      <button
        type="button"
        role="menuitem"
        onClick={handleNew}
        className="w-full text-left px-3 py-1.5 hover:bg-accent/10 flex items-center gap-2"
      >
        <span className="text-accent font-semibold">＋</span>
        <span>New Workspace…</span>
      </button>

      <div className="my-1 border-t border-border" />

      {/* Recent workspaces */}
      {loading && (
        <div className="px-3 py-1.5 text-zinc-500 italic">Loading…</div>
      )}
      {!loading && recent.length === 0 && (
        <div className="px-3 py-1.5 text-zinc-500 italic">No recent workspaces</div>
      )}
      {!loading && recent.map(entry => {
        const isActive = activeWorkspace?.path === entry.path
        return (
          <button
            key={entry.path}
            type="button"
            role="menuitem"
            onClick={() => handleOpen(entry.path)}
            title={entry.path}
            className={`w-full text-left px-3 py-1.5 hover:bg-accent/10 truncate ${isActive ? 'text-accent font-semibold' : ''}`}
          >
            {entry.name}
          </button>
        )
      })}

      {/* Clear Recent Workspaces (greyed out when list empty) */}
      <div className="my-1 border-t border-border" />
      <button
        type="button"
        role="menuitem"
        onClick={handleClearRecent}
        disabled={recent.length === 0}
        className="w-full text-left px-3 py-1.5 hover:bg-accent/10 text-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        Clear Recent Workspaces
      </button>
    </div>
  )
}
