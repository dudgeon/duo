import { useEffect, useRef, useState } from 'react'
import type { MenuTemplateItem, TabSession } from '@shared/types'

interface TabBarProps {
  tabs: TabSession[]
  activeTabId: string
  onSelect: (id: string) => void
  // Stage 19c D17 — split-button affordance. `+` (left, primary) opens a
  // new claude session; `>` (right, secondary) opens a vanilla shell.
  // The opinionated default lives on the bigger click target so the
  // existing "click the +" muscle memory inherits the new behavior.
  onNewClaude: () => void
  onNewShell: () => void
  onClose: (id: string) => void
  /** Shown in the `+` button tooltip so the user can check where the next
   *  terminal will launch (Stage 10 § D10). */
  pendingCwd?: string
  /** BUG-003 fix — tint the strip when this column has keyboard focus.
   *  Works because the strip is renderer DOM (unlike the xterm canvas /
   *  WebContentsView which occlude inset shadows on the column wrapper). */
  focused?: boolean
  /** ENH-083 (v0.6.5) — collapse-pane button moved from titlebar to
   *  the new-tab cluster. Shows the terminal-collapse glyph; click
   *  toggles. Active (collapsed) state inverts to the accent fill. */
  isTerminalCollapsed?: boolean
  onToggleTerminalCollapsed?: () => void
  /** ENH-115 (Sprint 12) — right-click → "Reveal in navigator" on a
   *  tab fires this with the tab's `cwd`. Parent points the navigator
   *  at the path (same code path as the CLI's `duo reveal`). */
  onRevealCwd?: (cwd: string) => void
  /** ENH-187 — reorder terminal tabs (move-left/right menu + HTML5
   *  drag-and-drop). Both ids are members of the visible strip; the
   *  parent reorders the underlying `tabs` array. Mirrors
   *  WorkingTabStrip's `onReorderTab`. */
  onReorderTab?: (sourceId: string, targetId: string) => void
  /** ENH-187 — right-click → "Close other tabs": close every visible
   *  terminal tab except the right-clicked one. */
  onCloseOthers?: (id: string) => void
}

// Stage 12 Phase 3 — tab-strip rhyme.
//
// The terminal and working tab strips share the same chip language so
// the user reads them as a single family. Differentiator: strip background
// (terminal sits on paper-edge, working on paper-deep — see
// WorkingTabStrip.tsx). Both share rounded-top chips, accent top-stripe
// for active, and serif-italic for the active label (Atelier voice).
//
// Stage 19c D17 — the `+` button is now a split control: a wider claude
// half on the left, a narrow `>` shell half on the right. Visually
// separated by a 1px paper-rule so it reads as two affordances; the
// default click target stays where users expect (`+`), but the new
// behavior is "open claude" — the bet being that the agent-native
// premise becomes immediate from the first keystroke.
//
// Mock reference: docs/design/atelier/project/duo-components.jsx ~L286.
export function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onNewClaude,
  onNewShell,
  onClose,
  pendingCwd,
  focused = false,
  isTerminalCollapsed = false,
  onToggleTerminalCollapsed,
  onRevealCwd,
  onReorderTab,
  onCloseOthers
}: TabBarProps) {
  // ENH-187 — drag-reorder visual state. The hovered tab paints an
  // accent insertion cue while a drag is in flight; cleared on drop /
  // dragend. Mirrors WorkingTabStrip's dropTargetId.
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  // ENH-187 — move a tab one slot left/right within the visible strip.
  // `tabs` here is already the visible (project-filtered) set, so its
  // index order IS the strip order. Mirrors WorkingTabStrip.moveTabBy
  // minus the pinned-zone logic (terminals don't pin).
  const moveTabBy = (id: string, delta: -1 | 1) => {
    if (!onReorderTab) return
    const idx = tabs.findIndex(t => t.id === id)
    if (idx < 0) return
    const targetIdx = idx + delta
    if (targetIdx < 0 || targetIdx >= tabs.length) return
    onReorderTab(id, tabs[targetIdx].id)
  }

  const cwdSuffix = pendingCwd ? ` in ${pendingCwd}` : ''
  const claudeTip = `New Claude session (⌘T from terminal focus)${cwdSuffix}`
  const shellTip = `New shell tab (⌘⇧T)${cwdSuffix}`

  // ENH-024 — when the active tab changes (click, ⌃Tab, ⌘1–9, CLI),
  // scroll it into view inside the overflow-x-auto strip so users
  // and agents never lose track of where the active tab lives.
  // `inline: 'nearest'` only scrolls when the tab is actually clipped
  // by the viewport — clicking an already-visible tab is a no-op.
  const activeTabRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [activeTabId])

  return (
    <div
      className={[
        'flex items-end h-9 border-b shrink-0 px-2 gap-0.5 transition-colors',
        // Focused: warm ochre wash + accent border-bottom. Unfocused:
        // paper-edge with the standard paper-rule border.
        focused ? 'bg-accent-soft border-accent' : 'bg-surface-2 border-border'
      ].join(' ')}
    >
      {/* ENH-132 (Sprint 14, 2026-05-10) — ARIA tablist for screen readers. */}
      <div role="tablist" aria-label="Terminal tabs" className="flex items-end flex-1 overflow-x-auto scrollbar-none gap-0.5">
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSelect={() => onSelect(tab.id)}
            onCloseSelf={() => onClose(tab.id)}
            canClose={tabs.length > 1}
            onRevealCwd={onRevealCwd}
            // ENH-024 — only the active tab gets the ref; previous
            // active tab loses the assignment naturally on re-render.
            buttonRef={tab.id === activeTabId ? activeTabRef : undefined}
            // ENH-187 — reorder context: position within the visible
            // strip gates the move-left/right items; the bound mover +
            // close-others wire the menu actions.
            index={index}
            total={tabs.length}
            canReorder={!!onReorderTab}
            onMoveTab={(delta) => moveTabBy(tab.id, delta)}
            onCloseOthers={onCloseOthers ? () => onCloseOthers(tab.id) : undefined}
            // ENH-187 — HTML5 drag-and-drop reorder. Distinct mime from
            // the canvas strip so terminal/canvas drags never cross.
            isDropTarget={dropTargetId === tab.id}
            onDragStart={onReorderTab ? (e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('application/x-duo-terminal-tab-id', tab.id)
            } : undefined}
            onDragOver={onReorderTab ? (e) => {
              if (e.dataTransfer.types.includes('application/x-duo-terminal-tab-id')) {
                e.preventDefault()
                setDropTargetId(tab.id)
              }
            } : undefined}
            onDragLeave={() => setDropTargetId(prev => (prev === tab.id ? null : prev))}
            onDrop={onReorderTab ? (e) => {
              e.preventDefault()
              const sourceId = e.dataTransfer.getData('application/x-duo-terminal-tab-id')
              setDropTargetId(null)
              if (sourceId && sourceId !== tab.id) onReorderTab(sourceId, tab.id)
            } : undefined}
            onDragEnd={() => setDropTargetId(null)}
          />
        ))}
      </div>

      {/* ENH-073 (v0.6.3) — visible paper-rule separator between the
          tab list and the new-tab cluster. Owner walk-2: "there
          should be a more visible line that separates the buttons
          from the tab section." */}
      <span aria-hidden="true" className="shrink-0 w-px h-5 bg-paper-rule mb-1 mx-1.5" />

      {/* Split button: + claude (primary) | > shell (secondary) | collapse.
          Three buttons in one rounded cluster, separated by the same
          h-3 paper-rule hairline. ENH-083 (v0.6.5) — collapse-terminal
          button moved here from the titlebar; lives WITH the new-tab
          cluster (owner: "they should be with the new terminal button
          cluster") with the in-cluster divider style for visual
          consistency. Active state (terminal collapsed) inverts to
          accent fill so it's obvious which pane is hidden. */}
      <div className="shrink-0 flex items-center mb-1 rounded overflow-hidden">
        <button
          onClick={onNewClaude}
          className="w-7 h-6 flex items-center justify-center text-ink-mute hover:text-ink hover:bg-surface-3 transition-colors"
          title={claudeTip}
          aria-label={claudeTip}
        >
          <ClawdGlyph />
        </button>
        <span aria-hidden="true" className="w-px h-3 bg-paper-rule" />
        <button
          onClick={onNewShell}
          className="w-5 h-6 flex items-center justify-center text-ink-ghost hover:text-ink hover:bg-surface-3 transition-colors"
          title={shellTip}
          aria-label={shellTip}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <path d="M2.5 2.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {onToggleTerminalCollapsed && (
          <>
            <span aria-hidden="true" className="w-px h-3 bg-paper-rule" />
            <button
              type="button"
              onClick={onToggleTerminalCollapsed}
              title={isTerminalCollapsed ? 'Show terminal column' : 'Hide terminal column (canvas takes full width)'}
              aria-label={isTerminalCollapsed ? 'Show terminal column' : 'Hide terminal column'}
              className={[
                'w-6 h-6 flex items-center justify-center transition-colors',
                isTerminalCollapsed
                  ? 'bg-accent text-white'
                  : 'text-ink-mute hover:bg-surface-3 hover:text-ink'
              ].join(' ')}
            >
              <svg width="13" height="11" viewBox="0 0 13 11" fill="none" aria-hidden="true">
                <rect x="1" y="1" width="4" height="9" rx="0.5" stroke="currentColor" strokeWidth="1" fill={isTerminalCollapsed ? 'currentColor' : 'none'} />
                <rect x="6" y="1" width="6" height="9" rx="0.5" stroke="currentColor" strokeWidth="1" fill="none" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

interface TabProps {
  tab: TabSession
  isActive: boolean
  onSelect: () => void
  /** ENH-187 — close this tab (menu "Close tab" + the × button). */
  onCloseSelf: () => void
  canClose: boolean
  /** ENH-024 — passed by the parent on the active tab so it can
   *  `scrollIntoView` whenever the active tab changes. */
  buttonRef?: React.Ref<HTMLButtonElement>
  /** ENH-115 — right-click → Reveal in navigator. */
  onRevealCwd?: (cwd: string) => void
  /** ENH-187 — position within the visible strip; gates move-left/right. */
  index: number
  total: number
  /** ENH-187 — whether reorder is wired (drag + move items). */
  canReorder: boolean
  /** ENH-187 — move this tab one slot left (-1) / right (1). */
  onMoveTab: (delta: -1 | 1) => void
  /** ENH-187 — "Close other tabs" (undefined hides the item). */
  onCloseOthers?: () => void
  /** ENH-187 — drag-reorder wiring. Undefined handlers ⇒ non-draggable. */
  isDropTarget?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  onDragEnd?: (e: React.DragEvent) => void
}

function Tab({
  tab, isActive, onSelect, onCloseSelf, canClose, buttonRef, onRevealCwd,
  index, total, canReorder, onMoveTab, onCloseOthers,
  isDropTarget, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd
}: TabProps) {
  // ENH-187 — right-click → native context menu, approaching parity
  // with the canvas-tab menu (WorkingTabStrip). Items are grouped:
  // reveal / copy-cwd, then move-left/right, then close verbs — each
  // group separated by a rule (same builder shape as the canvas side).
  const onContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    const items: MenuTemplateItem[] = []
    if (onRevealCwd && tab.cwd) items.push({ id: 'reveal-cwd', label: 'Reveal in navigator' })
    if (tab.cwd) items.push({ id: 'copy-cwd', label: 'Copy cwd' })

    const moveItems: MenuTemplateItem[] = []
    if (canReorder && index > 0) moveItems.push({ id: 'move-left', label: 'Move tab left' })
    if (canReorder && index < total - 1) moveItems.push({ id: 'move-right', label: 'Move tab right' })
    if (moveItems.length) {
      if (items.length) items.push({ type: 'separator' })
      items.push(...moveItems)
    }

    const closeItems: MenuTemplateItem[] = []
    if (canClose) closeItems.push({ id: 'close', label: 'Close tab' })
    if (onCloseOthers && total > 1) closeItems.push({ id: 'close-others', label: 'Close other tabs' })
    if (closeItems.length) {
      if (items.length) items.push({ type: 'separator' })
      items.push(...closeItems)
    }

    if (items.length === 0) return
    const res = await window.electron.menu.popup({ items, x: e.clientX, y: e.clientY })
    switch (res.chosenId) {
      case 'reveal-cwd':
        if (tab.cwd) onRevealCwd?.(tab.cwd)
        return
      case 'copy-cwd':
        // BUG-105 pattern — main-process clipboard write (no gesture
        // requirement inside a native NSMenu handler).
        if (tab.cwd) { try { await window.electron.clipboard.writeText(tab.cwd) } catch { /* denied */ } }
        return
      case 'move-left':
        onMoveTab(-1)
        return
      case 'move-right':
        onMoveTab(1)
        return
      case 'close':
        onCloseSelf()
        return
      case 'close-others':
        onCloseOthers?.()
        return
    }
  }

  const onClick = () => {
    onSelect()
  }

  return (
    <button
      ref={buttonRef}
      // ENH-132 — ARIA tab semantics. Parent has `role="tablist"`.
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      onContextMenu={onContextMenu}
      // ENH-187 — HTML5 drag-reorder. Draggable only when the parent
      // wired reorder handlers.
      draggable={canReorder}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={[
        'group relative flex items-center gap-1.5 px-2.5 h-7 max-w-[200px] rounded-t-lg shrink-0 transition-colors',
        isActive
          // Active: paper bg merges into the pane below; chip "outline" on
          // top + sides via inset shadows (paper-rule). 2px accent stripe
          // at the top renders as an absolute child below.
          ? 'bg-surface-0 text-ink shadow-[inset_0_1px_0_var(--duo-paper-rule),inset_1px_0_var(--duo-paper-rule),inset_-1px_0_var(--duo-paper-rule)] font-serif italic text-[13px] font-medium'
          : 'text-ink-mute hover:text-ink-soft hover:bg-surface-3 text-xs',
        // ENH-187 — drop-target insertion cue. Same accent ring the
        // canvas strip (WorkingTabItem) uses for its drag affordance.
        isDropTarget ? 'ring-2 ring-accent ring-inset' : ''
      ].join(' ')}
      title={tab.title}
    >
      {/* Accent top-stripe for active — mirrors WorkingTabStrip + the mock. */}
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute left-0 right-0 top-0 h-0.5 bg-accent rounded-t-lg"
        />
      )}

      <TabIcon kind={tab.kind} active={isActive} />

      <span className="truncate leading-none not-italic">{tab.title}</span>

      {canClose && (
        <span
          onClick={(e) => { e.stopPropagation(); onCloseSelf() }}
          role="button"
          tabIndex={0}
          aria-label={`Close ${tab.title}`}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onCloseSelf() } }}
          className={[
            'flex items-center justify-center w-3.5 h-3.5 rounded shrink-0 transition-opacity transition-colors',
            isActive
              ? 'opacity-80 text-ink-mute hover:text-ink hover:bg-surface-2'
              : 'opacity-0 group-hover:opacity-100 text-ink-ghost hover:text-ink-soft hover:bg-surface-2'
          ].join(' ')}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </span>
      )}
    </button>
  )
}

// Stage 19c D26 — per-kind glyph so a mixed strip of shell + claude
// tabs reads at a glance. The shell glyph keeps the original 10×10
// terminal mark; the claude glyph is a small filled spark — visually
// distinct but quiet, since the title prefix `claude · ` already does
// the heavy lifting.
function TabIcon({ kind, active }: { kind: TabSession['kind']; active: boolean }) {
  return kind === 'claude'
    ? <ClaudeIcon active={active} />
    : <TerminalIcon active={active} />
}

function TerminalIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={active ? 'text-accent' : 'text-ink-ghost'}
    >
      <path d="M1.3 1.3h7.4v7.4H1.3V1.3Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M2.8 4l1.4 1-1.4 1M5 7h2.2" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ClaudeIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={active ? 'text-accent' : 'text-ink-ghost'}
    >
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

// ENH-044 — clawd glyph for the new-Claude split-button affordance.
// Source: Inkscape canvas authored by Geoff (`renderer/assets/icons/clawd.svg`).
// Cropped from the original 210mm × 297mm A4 canvas to the creature's
// bounding box.
//
// v0.6.3 follow-up — two fixes from walk-1 owner notes:
//   1. The previous viewBox (y=38.2, h=22.4) cut off the top ~3 units
//      of the creature — the body's MIN y is 1122.52 (transformed:
//      35.05), not 1218 as I'd misread. Corrected to (27 35 39 26)
//      so the full silhouette renders with no clipping.
//   2. Switched body fill from fixed #c15f3c to currentColor so the
//      glyph follows the button's text color (text-ink-mute → text-ink
//      on hover) — matches the Atelier convention used by every other
//      icon in the strip (Plus, Right Caret, ClaudeIcon, TerminalIcon).
//      The owner note: "should not be orange — should match rest of
//      atelier buttons." Eyes stay white as visual cutouts.
function ClawdGlyph() {
  return (
    <svg
      width="14"
      height="9"
      viewBox="27 35 39 26"
      aria-hidden="true"
    >
      <g transform="matrix(0.03329941,0,0,0.03329941,60.408867,-2.3441801)">
        <path
          d="m -31.782336,1890.5197 v -384 H 160.21767 v -192 H -31.782336 v -192 H -799.78233 v 192 h -192.00002 v 192 h 192.00002 v 384 h 96 v -192 h 96 v 192 h 96 v -192 h 192 v 192 h 96 v -192 h 96 v 192 z"
          fill="currentColor"
        />
        <path d="m -223.78233,1314.5197 v -96 h 96 v 96 z" fill="#ffffff" />
        <path d="m -607.78233,1218.5197 v 96 h -96 v -96 z" fill="#ffffff" />
      </g>
    </svg>
  )
}
