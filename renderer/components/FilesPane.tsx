// Stage 10 Phase 4 — the real file navigator.
// Header (breadcrumb + pin) + tree (lazy-loaded, folder-first, dotfile rule)
// + collapsed rail. Contents drive pending-CWD for new terminal tabs and
// file-open requests for the working pane (wired in App.tsx).

import { forwardRef, useImperativeHandle, useRef, useState, useCallback, useEffect } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, TransitionEvent as ReactTransitionEvent } from 'react'
import { Breadcrumb, type BreadcrumbHandle } from './Breadcrumb'
import { FileTree } from './FileTree'
import { PinnedNav } from './PinnedNav'
import { UserClaudePane } from './UserClaudePane'
import { ProjectClaudeContext } from './ProjectClaudeContext'
import type { DirEntry, NavPinEntry } from '@shared/types'
import type { NavigatorState, NavigatorActions } from '../hooks/useNavigator'
import type { NavPinsApi } from '../hooks/useNavPins'
import type { UserClaudeNavigatorApi } from '../hooks/useUserClaudeNavigator'

// ─── ENH-190 — locked navigator sizing + temporary-widen timing ──────────
// The navigator has exactly two RESTING sizes: rail (44) and expanded (208).
// There is no persistent custom width — any widen (a rail hover-peek or
// dragging the expanded border wider) is transient and eases back. Only
// crossing the collapse threshold while dragging changes the resting state.
const NAV_RAIL_W = 44
const NAV_EXPANDED_W = 208
const NAV_PEEK_W = 200            // rail hover-peek opens to this
const NAV_MAX_W = 360             // ceiling for a drag-widen
const NAV_COLLAPSE_THRESHOLD = 96 // drag the expanded border below this → collapse on release
const NAV_HOVER_IN_MS = 260       // rest on the rail this long before it peeks
const NAV_SNAP_BACK_MS = 1500     // ease back this long after the cursor leaves
const NAV_ANIM_MS = 220
const NAV_EASE = 'cubic-bezier(.22,.61,.36,1)'

interface FilesPaneProps {
  collapsed: boolean
  focused: boolean
  home: string
  state: NavigatorState
  actions: NavigatorActions
  onOpenFile: (entry: DirEntry) => void
  onOpenTerminalHere: (folderPath: string) => void
  /** Stage 26 item 7 \u2014 hover \"new Claude here\" button. Spawns a new
   *  terminal tab with kind='claude' and an explicit CWD. */
  onOpenClaudeIn: (folderPath: string) => void
  revealChip: string | null
  onDismissRevealChip: () => void
  /** Stage 22 \u2014 independent state machine for the "Your Claude
   *  settings" pane. Lives in App.tsx so its `expanded` set persists
   *  across re-mounts of FilesPane. */
  userClaudeNav: UserClaudeNavigatorApi
  /** Stage 26 PR 2 (ENH-010) \u2014 navigator pins API. */
  navPins: NavPinsApi
  /** Flip collapsed state. Needed as a click-to-expand affordance so users
   *  stuck with \u2318B swallowed by an editor tab (bold) always have an escape. */
  onToggleCollapsed: () => void
  /** ENH-190 \u2014 set the resting collapsed state explicitly. Used by the
   *  right-border drag handle: drag past the threshold \u2192 onSetCollapsed(true);
   *  click-anywhere to commit a rail-peek \u2192 onSetCollapsed(false). */
  onSetCollapsed: (collapsed: boolean) => void
  /** Stage 26 PR 3 item 2 \u2014 front terminal's launch CWD. Threaded
   *  through to FileTree so folder rows whose path matches render an
   *  ambient accent dot. `null` when no terminal exists or its cwd
   *  isn't tracked yet. */
  activeTerminalCwd?: string | null
  /** Stage 26 PR 3 item 3 \u2014 set of file paths currently open in any
   *  WorkingPane tab. Threaded down so file rows render with brighter
   *  text. */
  openFilePaths?: ReadonlySet<string>
  /** Stage 26 PR 3 item 3 \u2014 path of the currently-active file tab.
   *  The matching file row gets an accent dot (mirrors
   *  `activeTerminalCwd` on folders). */
  activeFilePath?: string | null
  /** Stage 26 PR 3 item 8 \u2014 fired when the editable breadcrumb
   *  resolves to a file. Host (App.tsx) routes to "navigate to
   *  parent + open file." */
  onRevealFile?: (path: string) => void
  /** Sprint 3 Phase 3b \u2014 fired when a FileTree row's right-click
   *  menu picks "Open in Split View". App.tsx routes to
   *  splitViewMoveTabByPath. */
  onOpenInSplit?: (path: string) => void
  /** ENH-169 (Sprint 20) \u2014 fired when a breadcrumb segment or its
   *  whitespace is right-clicked. App.tsx pops the context menu
   *  scoped to the given folder path. */
  onBreadcrumbContextMenu?: (folderPath: string, x: number, y: number) => void
  /** ENH-212 D7 — activate the permanent Home tab. Threaded to PinnedNav's
   *  synthesized slot-0 row. */
  onActivateHome: () => void
  /** ENH-212 — true when the Home tab is the active working surface (paints
   *  the slot-0 row selected). */
  homeActive?: boolean
}

export interface FilesPaneHandle {
  /** Stage 26 PR 3 item 8 \u2014 programmatically open the breadcrumb's
   *  editable input. Wired to \u2318\u21e7G in App.tsx via useKeyboardShortcuts. */
  focusBreadcrumbEdit: () => void
}

export const FilesPane = forwardRef<FilesPaneHandle, FilesPaneProps>(function FilesPane({
  collapsed,
  focused,
  home,
  state,
  actions,
  userClaudeNav,
  navPins,
  onOpenFile,
  onOpenTerminalHere,
  onOpenClaudeIn,
  revealChip,
  onDismissRevealChip,
  onToggleCollapsed,
  onSetCollapsed,
  activeTerminalCwd = null,
  openFilePaths,
  activeFilePath = null,
  onRevealFile,
  onOpenInSplit,
  onBreadcrumbContextMenu,
  onActivateHome,
  homeActive = false
}: FilesPaneProps, ref) {
  const breadcrumbRef = useRef<BreadcrumbHandle | null>(null)
  useImperativeHandle(ref, () => ({
    focusBreadcrumbEdit: () => {
      // Auto-expand if collapsed; otherwise focus is invisible.
      if (collapsed) onToggleCollapsed()
      // requestAnimationFrame so the layout settles after the
      // collapsed→expanded transition before the input mounts/focuses.
      requestAnimationFrame(() => breadcrumbRef.current?.focusEdit())
    }
  }), [collapsed, onToggleCollapsed])

  // ─── ENH-190: temporary-widen (peek) + drag-collapse ───────────────────
  // `override` carries the transient px width during a peek/drag; null means
  // "use the resting width" (collapsed ? rail : expanded). peekActive marks a
  // rail hover-peek; widenActive marks an expanded drag-widen awaiting
  // snap-back. Both ease back to resting NAV_SNAP_BACK_MS after the cursor
  // leaves the navigator.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [override, setOverride] = useState<number | null>(null)
  const [peekActive, setPeekActive] = useState(false)
  const [widenActive, setWidenActive] = useState(false)
  const [willCollapse, setWillCollapse] = useState(false)
  const draggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWRef = useRef(0)
  const hoverInRef = useRef<number | null>(null)
  const dwellRef = useRef<number | null>(null)

  const clearHoverIn = () => { if (hoverInRef.current != null) { window.clearTimeout(hoverInRef.current); hoverInRef.current = null } }
  const clearDwell = () => { if (dwellRef.current != null) { window.clearTimeout(dwellRef.current); dwellRef.current = null } }
  // Clear timers on unmount.
  useEffect(() => () => { clearHoverIn(); clearDwell() }, [])
  // Reset transient state whenever the resting collapsed state changes
  // (⌘B, the View menu, AUTO_COLLAPSE on window resize, or our own
  // commit/collapse calls). External toggles still animate via the resting
  // width; this just clears any stale peek/widen bookkeeping + timers.
  useEffect(() => {
    clearHoverIn(); clearDwell()
    setPeekActive(false); setWidenActive(false); setWillCollapse(false)
    setOverride(null)
  }, [collapsed])

  const enterPeek = useCallback(() => {
    if (!collapsed || draggingRef.current) return
    setPeekActive(true)
    setOverride(NAV_PEEK_W)
  }, [collapsed])

  const snapBack = useCallback(() => {
    clearDwell()
    setPeekActive(false)
    setWidenActive(false)
    setOverride(collapsed ? NAV_RAIL_W : NAV_EXPANDED_W)
  }, [collapsed])

  const onRootMouseEnter = () => {
    if (draggingRef.current) return
    if (peekActive || widenActive) { clearDwell(); return } // re-entry keeps it open
    if (collapsed) {
      clearHoverIn()
      hoverInRef.current = window.setTimeout(() => enterPeek(), NAV_HOVER_IN_MS)
    }
  }
  const onRootMouseLeave = () => {
    clearHoverIn()
    if (peekActive || widenActive) {
      clearDwell()
      dwellRef.current = window.setTimeout(() => snapBack(), NAV_SNAP_BACK_MS)
    }
  }
  // Locked commit mechanism: while peeking the rail, a click anywhere in the
  // body (not a header button) makes it stay open.
  const onRootClick = (e: ReactMouseEvent) => {
    clearHoverIn() // a click to expand the rail must cancel a pending peek
    if (!peekActive) return
    if ((e.target as HTMLElement).closest('button')) return
    clearDwell()
    setPeekActive(false)
    setOverride(NAV_EXPANDED_W)
    onSetCollapsed(false)
  }
  const onRootTransitionEnd = (e: ReactTransitionEvent) => {
    if (e.propertyName !== 'width') return
    if (!draggingRef.current && !peekActive && !widenActive) setOverride(null)
  }

  const onHandlePointerDown = (e: ReactPointerEvent) => {
    if (collapsed) return // no drag-expand from the rail (locked decision)
    e.preventDefault()
    draggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWRef.current = rootRef.current?.offsetWidth ?? NAV_EXPANDED_W
    clearHoverIn(); clearDwell()
    setPeekActive(false); setWidenActive(false)
    // Re-render now (with draggingRef true) so the width transition is off
    // before the first move — the drag should track the pointer 1:1.
    setOverride(dragStartWRef.current)
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  const onHandlePointerMove = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return
    let w = dragStartWRef.current + (e.clientX - dragStartXRef.current)
    w = Math.max(30, Math.min(NAV_MAX_W, w))
    setOverride(w)
    setWillCollapse(w < NAV_COLLAPSE_THRESHOLD)
  }
  const onHandlePointerUp = (e: ReactPointerEvent) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    const w = rootRef.current?.offsetWidth ?? NAV_EXPANDED_W
    setWillCollapse(false)
    if (w < NAV_COLLAPSE_THRESHOLD) {
      onSetCollapsed(true)          // crossed the threshold → collapse
      setOverride(NAV_RAIL_W)
    } else if (w > NAV_EXPANDED_W + 6) {
      setWidenActive(true)          // temporary widen → snaps back on cursor-leave
      setOverride(w)
    } else {
      setOverride(NAV_EXPANDED_W)   // narrowed but didn't collapse → back to 208
    }
  }

  const showRail = collapsed && !peekActive
  const widthPx = override != null ? override : (collapsed ? NAV_RAIL_W : NAV_EXPANDED_W)
  const rootStyle: CSSProperties = {
    width: `${widthPx}px`,
    flexShrink: 0,
    transition: draggingRef.current
      ? 'border-color 150ms'
      : `width ${NAV_ANIM_MS}ms ${NAV_EASE}, border-color 150ms`,
    ...(willCollapse ? { borderRightColor: '#C8553D' } : {})
  }

  return (
    <div
      className={[
        // BUG-003 fix (rev 2): the inset-shadow ring approach was misleading
        // — it appeared to encircle the focused pane but xterm canvas
        // (Terminal) and WebContentsView (Working) painted over three of
        // four sides, leaving only an ambiguous seam line. The new
        // indicator lives in the chrome strip (renderer DOM, never
        // occluded): the column's header tints to `accent-soft` when
        // focused. Files pane's "header" is the breadcrumb row below.
        // Seam border still flips to full-opacity accent as a secondary
        // cue.
        //
        // Stage 26 PR 3 item 11 (v0.5.4) — focus signal extended from
        // chrome-only to a 2px LEFT-EDGE accent stripe on the column
        // wrapper itself. The column has no occluding child (unlike
        // Terminal's xterm canvas or Working's WebContentsView), so the
        // wrapper's own border paints unambiguously. Read together with
        // the existing tinted-header pattern: header chrome tints +
        // left edge stripes when focused = whole pane reads as
        // "this is the focused column."
        'relative flex flex-col h-full bg-surface-1 border-r border-l-2',
        focused ? 'border-r-accent border-l-accent' : 'border-r-border border-l-transparent'
      ].join(' ')}
      style={rootStyle}
      ref={rootRef}
      onMouseEnter={onRootMouseEnter}
      onMouseLeave={onRootMouseLeave}
      onClick={onRootClick}
      onTransitionEnd={onRootTransitionEnd}
      aria-label="Files"
    >
      {showRail ? (
        <CollapsedRail
          onExpand={onToggleCollapsed}
          projectName={state.cwd.split('/').filter(Boolean).pop() ?? '/'}
        />
      ) : (
        <div className="flex flex-col h-full min-w-0">
          {/* ENH-086 (v0.6.5) — project tree + breadcrumb is now the
              top of the navigator. The "Your Claude settings" pane
              moved to the bottom (after PinnedNav) since users live
              in the project tree day-to-day; user-level context is a
              global anchor, more naturally placed below. */}
          <div
            className={[
              'flex items-center border-b shrink-0 transition-colors',
              focused ? 'bg-accent-soft border-accent' : 'border-border'
            ].join(' ')}
          >
            <div className="flex-1 min-w-0">
              <Breadcrumb
                ref={breadcrumbRef}
                cwd={state.cwd}
                home={home}
                onNavigate={actions.navigateTo}
                onRevealFile={onRevealFile}
                onSegmentContextMenu={onBreadcrumbContextMenu}
              />
            </div>
            <PinButton pinned={state.pinned} onClick={actions.togglePinned} />
            <CollapseButton onClick={onToggleCollapsed} />
          </div>

          {/* Reveal chip — Stage 10 § D16 */}
          {revealChip && (
            <RevealChip path={revealChip} onDismiss={onDismissRevealChip} />
          )}

          {/* Stage 22 — project Claude context group: ./CLAUDE.md,
              ./.claude/, ./tasks.md, ./AGENTS.md when they exist.
              Hides when none exist so projects without Claude context
              don't show an empty section header. */}
          <ProjectClaudeContext
            state={state}
            actions={actions}
            onOpenFile={onOpenFile}
            onOpenTerminalHere={onOpenTerminalHere}
          />

          {/* Project tree */}
          <FileTree
            state={state}
            actions={actions}
            onOpenFile={onOpenFile}
            onOpenTerminalHere={onOpenTerminalHere}
            onOpenClaudeIn={onOpenClaudeIn}
            navPins={navPins}
            activeTerminalCwd={activeTerminalCwd}
            openFilePaths={openFilePaths}
            activeFilePath={activeFilePath}
            onOpenInSplit={onOpenInSplit}
          />

          {/* Stage 26 PR 2 (ENH-010) — Pinned files & folders.
              Hidden when empty; collapsible header when populated. */}
          <PinnedNav
            pins={navPins.pins}
            home={home}
            selectedPath={state.selected?.path ?? null}
            // ENH-212 D7 — slot 0 Home row (above pins, visible at zero pins).
            onActivateHome={onActivateHome}
            homeActive={homeActive}
            onSelect={(entry) => actions.selectItem(entry.path, entry.kind)}
            onOpenFile={(entry) => {
              // Build a DirEntry-shaped record so onOpenFile (which
              // expects DirEntry, not NavPinEntry) routes through the
              // same fileClassifier path as the project tree.
              onOpenFile({
                name: entry.title ?? entry.path.split('/').pop() ?? entry.path,
                path: entry.path,
                kind: 'file'
              })
            }}
            onOpenFolder={(entry) => actions.navigateTo(entry.path)}
            onOpenTerminalHere={onOpenTerminalHere}
            onRevealInFinder={(p) => window.electron.files.revealInFinder(p)}
            onUnpin={(entry) => navPins.toggle(entry)}
            onOpenInSplit={onOpenInSplit}
          />

          {/* ENH-086 (v0.6.5) — "Your Claude settings" pane at the
              BOTTOM of the navigator. User-level context (~/.claude/)
              is a global anchor; the project tree above is the
              everyday work surface. Pinned files (PinnedNav) sit
              above this pane. Collapsible; defaults collapsed. */}
          <UserClaudePane
            nav={userClaudeNav}
            onOpenFile={onOpenFile}
            onOpenTerminalHere={onOpenTerminalHere}
            focused={focused}
          />
        </div>
      )}

      {/* ENH-190 — right-border drag handle. Drag wider to un-truncate a
          long name (snaps back), or drag left past the threshold to
          collapse. Hidden when collapsed — there's no drag-expand from the
          rail (locked decision). Carries the hover-reveal grip-pill
          affordance shared with the terminal↔canvas divider. */}
      {!collapsed && (
        <div
          className={['nav-resize-handle', willCollapse ? 'will-collapse' : ''].join(' ')}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize navigator (drag left past the edge to collapse)"
        >
          <span className="resize-grip" aria-hidden="true"><i /><i /><i /></span>
        </div>
      )}
      {willCollapse && (
        <div className="nav-collapse-hint" aria-hidden="true">Release to collapse</div>
      )}
    </div>
  )
})

function CollapsedRail({ onExpand, projectName }: { onExpand: () => void; projectName: string }) {
  return (
    <button
      onClick={onExpand}
      title={`Show navigator: ${projectName} (\u2318B)`}
      aria-label={`Show navigator: ${projectName}`}
      className="h-full w-full flex flex-col items-center pt-3 gap-2 text-ink-mute hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M3 4.5A1.5 1.5 0 0 1 4.5 3h4l1.5 1.5h5.5A1.5 1.5 0 0 1 17 6v9.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
      {/* ENH-079 (v0.6.4) \u2014 vertical "Navigator: {project}" label,
          mirroring CollapsedPaneRail's terminal/canvas labels (font /
          size / writing-mode / rotation match exactly). Shows the
          basename of the project's cwd so a user with multiple Duo
          windows knows at a glance which one this rail belongs to. */}
      <span
        className="font-serif italic text-[13px] text-ink-mute mt-1 tracking-wide"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {`Navigator: ${projectName}`}
      </span>
    </button>
  )
}

function RevealChip({ path, onDismiss }: { path: string; onDismiss: () => void }) {
  // Stage 10 § D16 — surfaces agent-driven navigator changes so the user
  // knows the tree moved without their input. Short-lived; dismissable.
  const shortPath = path.length > 40 ? '…' + path.slice(path.length - 40) : path
  return (
    <div className="mx-2 mt-2 mb-1 px-2 py-1.5 rounded bg-accent/15 text-accent-foreground flex items-center gap-2 text-[11px]">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="text-accent shrink-0">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6 3.5v2.5l2 1.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <span className="truncate flex-1 text-zinc-300">Claude moved to <span className="text-zinc-100" title={path}>{shortPath}</span></span>
      <button
        onClick={onDismiss}
        className="shrink-0 w-4 h-4 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-surface-3 transition-colors"
        aria-label="Dismiss"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

function PinButton({ pinned, onClick }: { pinned: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={pinned ? 'Unpin (navigator follows the active terminal tab)' : 'Pin (freeze navigator regardless of terminal tab)'}
      className={[
        'shrink-0 w-7 h-7 flex items-center justify-center rounded transition-colors',
        pinned ? 'text-accent hover:bg-surface-3' : 'text-zinc-600 hover:text-zinc-300 hover:bg-surface-3'
      ].join(' ')}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d="M6 8.5v2.2M4 2.5h4M6 2.5v5l-1.8 1.5h3.6L6 7.5v-5Z"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </button>
  )
}

// Stage 12 — collapse the Files column to a 44px rail. Pairs with
// CollapsedRail (which is the click-to-expand affordance). Atelier
// annotation showed a chevron-into-rail glyph next to the pin button.
function CollapseButton({ onClick }: { onClick: () => void }) {
  // ENH-015 — discoverability: bumped color from text-zinc-600 (barely
  // visible against the cream paper bg) to text-ink-mute, so the button
  // reads as "present and clickable" at rest. Glyph swapped from a
  // chevron-into-rail to the macOS-Finder-style sidebar-toggle (rail +
  // filled column on one side) — that pattern is already in users'
  // muscle memory from Finder, VS Code, Mail. The two visual cues
  // together (better contrast + recognizable glyph) close the
  // user-reported "cannot find the button to collapse the file
  // navigator" gap; the optional first-launch coach-mark from the
  // task entry is deferred to Stage 18 FTUX.
  return (
    <button
      onClick={onClick}
      title="Collapse files column (⌘B)"
      aria-label="Collapse files column"
      className="shrink-0 w-7 h-7 mr-1 flex items-center justify-center rounded transition-colors text-ink-mute hover:text-ink hover:bg-surface-3"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        {/* Sidebar-toggle glyph: rounded outer rect + a left-side filled
            column representing "the sidebar." Mirrors macOS Finder's
            sidebar-toggle in the toolbar. Wider/taller than the previous
            chevron so it reads at rest. */}
        <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <rect x="1.5" y="2.5" width="3.5" height="9" fill="currentColor" opacity="0.55" />
      </svg>
    </button>
  )
}
