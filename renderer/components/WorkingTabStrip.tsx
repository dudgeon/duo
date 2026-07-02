// Stage 10 Phase 3 — unified tab strip for the WorkingPane.
//
// Supersedes the old `BrowserTabStrip`. Tabs are mixed-type, identified by
// `type`; each chip shows a small leading icon indicating the type so a
// browser page, a markdown preview, and an image preview can sit side by
// side without visual ambiguity (Stage 10 § D26).
//
// ENH-050 (v0.6.3) — context menu + confirmation modals migrated to
// native primitives (Menu.popup + dialog.showMessageBox via the new
// `window.electron.menu` + `window.electron.dialog` IPC surfaces).
// macOS draws these at the window-server level, composing correctly
// above the WebContentsView regardless of z-index — eliminates the
// BUG-058 WCV-mute flicker entirely. The in-renderer <ContextMenu>
// and <PinnedCloseConfirm> components are no longer used here. See
// `docs/DECISIONS.md § WCV-occlusion remediation` for rationale.

import { useEffect, useRef, useState } from 'react'
import type { MenuTemplateItem, WorkingTab, WorkingTabType } from '@shared/types'
import { pathFromFileUrl } from './urlUtils'
import { useWorktreeBadgesForDirs, type WorktreeBadge } from '../hooks/useWorktreeBadges'
import { projectColorToken } from '../projectColors'

/** ENH-210 (D1-part1) — the file directory a working tab belongs to, or
 *  '' for tabs with no local path (http browser tabs). Reuses the same
 *  `tab.path ?? pathFromFileUrl(tab.url)` resolution the strip already
 *  uses for reveal/menu, so file:// browser tabs resolve too. */
function dirOfWorkingTab(tab: WorkingTab): string {
  const p = tab.path ?? pathFromFileUrl(tab.url)
  if (!p) return ''
  const i = p.lastIndexOf('/')
  return i > 0 ? p.slice(0, i) : ''
}

interface WorkingTabStripProps {
  tabs: WorkingTab[]
  onSelect: (id: string) => void
  /** ENH-006 — split-button new affordance, mirrors TabBar (terminal).
   *  `+` (left, primary, wider) opens the new-file interstitial (⌘N).
   *  Globe (right, secondary, narrow) opens a new browser tab (⌘T). */
  onNewFile: () => void
  onNewBrowserTab: () => void
  onClose: (id: string) => void
  /** Stage 24 — toggle the pinned state for a tab. Called from the
   *  right-click context menu. */
  onTogglePin?: (id: string) => void
  /** BUG-003 fix — tint the strip when the working pane has keyboard
   *  focus. The strip is renderer DOM, unaffected by WebContentsView
   *  occlusion (which kills any inset shadow on the column wrapper). */
  focused?: boolean
  /** ENH-026 — Reveal the tab's underlying file in the navigator
   *  (selects + scrolls + expands). Called from the right-click
   *  context menu. Only fires when the tab has a `path` (i.e. file
   *  tabs, not browser tabs). */
  onRevealInNavigator?: (path: string) => void
  /** ENH-026 — Move the tab's file to the Trash AND close the tab.
   *  Strip handles confirmation via system sheet (ENH-050) before
   *  invoking. */
  onTrashFile?: (id: string, path: string) => void
  /** ENH-026 — Reveal the tab's file in the navigator AND put the
   *  tree row into rename mode. Custom-event-driven so we don't
   *  need to lift FileTree's renamingPath state up to App. */
  onStartRenameFromTab?: (path: string) => void
  /** ENH-042 — reorder by id pair. Source moves to target's zone
   *  position; drag direction (sourceIdx vs targetIdx in tabOrder)
   *  determines insert-before vs insert-after semantics. Cross-zone
   *  moves are gated here in the strip (we have pin info on tabs)
   *  before reaching the parent. */
  onReorderTab?: (sourceId: string, targetId: string) => void
  /** Sprint 3 Phase 3b — Move tab into the Split View aux slot.
   *  Surfaced in the right-click menu for file tabs. Called with
   *  the tab's absolute path; App.tsx routes through the same state
   *  mutations the workingAux.onOpen handler applies (drop from
   *  main, set as aux's only path). */
  onMoveToSplit?: (path: string) => void
  /** Sprint 7 Phase 3c — Move a browser tab into the Split View aux
   *  slot. Same right-click menu item as `onMoveToSplit` but takes a
   *  numeric BrowserTab id (extracted from the tab's `b:<n>` strip
   *  id). App.tsx routes via splitViewMoveBrowserTab. The menu
   *  builder picks this callback when `tab.type === 'browser'`. */
  onMoveBrowserTabToSplit?: (browserTabId: number) => void
  /** ENH-097 — "Edit in canvas" entry shown on `file://` browser tabs.
   *  Closes the browser tab and re-opens the file in canvas mode
   *  (kind: 'page'). Forces canvas mount even if the file declares
   *  `<meta duo-open-in="browser">`, so the user can edit the
   *  playground's source while its scripts stay inert. */
  onEditInCanvas?: (browserTabId: number, path: string) => void
  /** ENH-131 — "Open in browser" entry shown on canvas tabs backed by
   *  an HTML file. Inverse of `onEditInCanvas` — closes the canvas
   *  tab and re-opens the same path as a browser tab so scripts run
   *  / buttons fire (the playground modality). */
  onOpenInBrowser?: (fileTabId: string, path: string) => void
  /** ENH-083 (v0.6.5) — collapse-canvas button moved from titlebar to
   *  the new-tab cluster. Same pattern as TabBar's terminal-collapse
   *  variant; active (collapsed) state inverts to accent fill. */
  isCanvasCollapsed?: boolean
  onToggleCanvasCollapsed?: () => void
}

// Stage 12 Phase 3 — tab-strip rhyme. Strip + chip language matches
// TabBar (terminal). Differentiator: strip bg = paper-deep here vs
// paper-edge for the terminal strip. Mock reference:
// docs/design/atelier/project/duo-components.jsx ~L286.
//
// BUG-068 (v0.6.3) — restructure: tabs render inside a `flex-1
// overflow-x-auto` scroller; the new-tab split-button cluster is a
// sibling OUTSIDE that scroller so it stays sticky at the right edge
// regardless of how many tabs / how far the user has panned. Mirrors
// TabBar.tsx's pattern. Pre-fix the cluster was inside the scroller
// and would scroll off-screen with the tabs.
export function WorkingTabStrip({
  tabs,
  onSelect,
  onNewFile,
  onNewBrowserTab,
  onClose,
  onTogglePin,
  focused = false,
  onRevealInNavigator,
  onTrashFile,
  onStartRenameFromTab,
  onReorderTab,
  onMoveToSplit,
  onMoveBrowserTabToSplit,
  onEditInCanvas,
  onOpenInBrowser,
  isCanvasCollapsed = false,
  onToggleCanvasCollapsed
}: WorkingTabStripProps) {
  // ENH-042 — drag visual state. While a tab is being dragged, the
  // tab being hovered shows an accent-colored insertion cue. Cleared
  // on drop / dragend.
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  // ENH-210 (D1-part1) — per-checkout provenance: a file open from a
  // linked worktree gets the same hue dot + ⎇ as its terminal tab, so
  // the same file from two checkouts is no longer indistinguishable.
  // Keyed by the tab's file dir; main-checkout / pathless tabs get none.
  const worktreeBadges = useWorktreeBadgesForDirs(tabs.map(dirOfWorkingTab))

  // ENH-042 — zone-aware neighbor lookup for menu items + drag drop.
  const moveTabBy = (id: string, delta: -1 | 1) => {
    if (!onReorderTab) return
    const tab = tabs.find(t => t.id === id)
    if (!tab) return
    const zone = tabs.filter(t => t.pinned === tab.pinned)
    const idx = zone.findIndex(t => t.id === id)
    const targetIdx = idx + delta
    if (targetIdx < 0 || targetIdx >= zone.length) return
    onReorderTab(id, zone[targetIdx].id)
  }
  const tryReorderDrop = (sourceId: string, targetId: string) => {
    if (!onReorderTab) return
    const source = tabs.find(t => t.id === sourceId)
    const target = tabs.find(t => t.id === targetId)
    // Cross-zone drops are silently ignored — pinned tabs always sort
    // leftmost. The user gets no visual confirmation of the rejection;
    // accept this as v1, document if it surfaces as confusing.
    if (!source || !target || source.pinned !== target.pinned) return
    onReorderTab(sourceId, targetId)
  }

  // ENH-050 — right-click → native NSMenu via the main process. The
  // renderer fires `menu.popup({ items })` and awaits the chosen id;
  // the corresponding handler runs locally. No state in the strip
  // for menu position / open / close — the OS owns the lifecycle.
  // BUG-058's setOverlayMuted calls REMOVED — native menus composite
  // correctly above the WCV without any mute pattern.
  const handleContextMenu = async (e: React.MouseEvent, tab: WorkingTab) => {
    e.preventDefault()
    // BUG-045 — when a browser tab points at a local file (file://
    // URL), expose the same file-management menu as file tabs. Lets
    // the user Reveal / Rename / Trash the underlying file even when
    // they explicitly chose to open it in the browser pane (smoke-
    // walk pages, agent-generated dashboards, local previews). Falls
    // through to null for remote URLs.
    const path = tab.path ?? pathFromFileUrl(tab.url)
    const items = buildTabMenuTemplate({
      tabId: tab.id,
      pinned: !!tab.pinned,
      path,
      tabs,
      onTogglePin,
      onRevealInNavigator,
      onStartRenameFromTab,
      onMoveTab: onReorderTab ? moveTabBy : undefined,
      // Phase 3c — pass BOTH callbacks; the menu builder decides
      // which to wire based on tab.type (browser vs file).
      onMoveToSplit,
      onMoveBrowserTabToSplit,
      // ENH-097 — pass the callback so the menu builder can decide
      // whether to render the "Edit in canvas" entry (file:// browser
      // tabs only).
      onEditInCanvas,
      // ENH-131 — inverse direction; menu builder gates on canvas
      // tabs backed by HTML.
      onOpenInBrowser
    })
    if (items.length === 0) return
    const result = await window.electron.menu.popup({
      items,
      x: e.clientX,
      y: e.clientY
    })
    if (!result.chosenId) return
    // Map the chosen id to its action. Centralized here so the menu
    // template stays a pure data structure without click-handler
    // closures riding through the IPC boundary.
    handleMenuChoice(result.chosenId, { tab, path })
  }

  // ENH-050 — sheet-confirmation for destructive actions. Replaces
  // the in-renderer PinnedCloseConfirm modal that was getting
  // occluded by the WCV (BUG-064). dialog.showMessageBox composites
  // natively above the WCV; no mute pattern needed.
  const handleMenuChoice = async (
    chosenId: string,
    ctx: { tab: WorkingTab; path: string | null }
  ) => {
    const { tab, path } = ctx
    switch (chosenId) {
      case 'reveal':
        if (path && onRevealInNavigator) onRevealInNavigator(path)
        return
      case 'rename':
        if (path && onStartRenameFromTab) onStartRenameFromTab(path)
        return
      case 'move-left':
        moveTabBy(tab.id, -1)
        return
      case 'move-right':
        moveTabBy(tab.id, 1)
        return
      case 'copy-path': {
        // ENH-074 (v0.6.3) — copy path item mirrors the navigator's
        // FileTree right-click. Visible only when the tab has a
        // resolvable path (file tabs always; browser tabs only when
        // their URL is a file:// pointing at a local artifact —
        // see pathFromFileUrl above).
        //
        // BUG-105 (Sprint 10) — pre-fix used `navigator.clipboard.
        // writeText`, which silently rejects when called from inside
        // a native NSMenu's click handler (no user-gesture context).
        // Routing through main's `clipboard` module sidesteps the
        // gesture requirement entirely.
        if (!path) return
        try { await window.electron.clipboard.writeText(path) } catch { /* permission denied */ }
        return
      }
      case 'pin':
        onTogglePin?.(tab.id)
        return
      case 'move-to-split':
        // Phase 3c — branch on tab kind. Browser tabs route through
        // the BrowserManager-aware path so the WCV repositions into
        // the aux slot directly (scripts keep running). File tabs
        // route through the path-based file-aux flow. Handlers are
        // App.tsx's splitViewMoveBrowserTab and splitViewMoveTabByPath
        // respectively.
        if (tab.type === 'browser') {
          const parsedId = parseBrowserId(tab.id)
          if (parsedId !== null) onMoveBrowserTabToSplit?.(parsedId)
        } else if (path) {
          onMoveToSplit?.(path)
        }
        return
      case 'edit-in-canvas': {
        // ENH-097 — close the browser tab and re-open the file in
        // canvas mode. Only fires for file:// browser tabs; menu
        // builder gated the entry on path being a local file.
        if (!path || tab.type !== 'browser' || !onEditInCanvas) return
        const parsedId = parseBrowserId(tab.id)
        if (parsedId !== null) onEditInCanvas(parsedId, path)
        return
      }
      case 'open-in-browser': {
        // ENH-131 — inverse of edit-in-canvas. Close the canvas tab
        // and re-open the same HTML file as a browser tab so scripts
        // run / buttons fire (the playground modality).
        if (!path || tab.type !== 'page' || !onOpenInBrowser) return
        onOpenInBrowser(tab.id, path)
        return
      }
      case 'view-source':
        // FOLLOWUP-015 — activate the right-clicked tab FIRST so the
        // editor / canvas listener (gated on isActive) responds for
        // the user's intended tab, not whichever happens to be active
        // at right-click time. setTimeout(0) defers the dispatch to
        // after React's commit phase, so isActiveRef has been
        // refreshed before the event lands. Same window-event funnel
        // the chord and View menu use.
        onSelect(tab.id)
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('duo-view-source'))
        }, 0)
        return
      case 'trash': {
        if (!path || !onTrashFile) return
        const result = await window.electron.dialog.confirm({
          title: `Move "${tabLabel(tab)}" to the Trash?`,
          message: 'The file will be moved to the macOS Trash. You can restore it from there. Open tabs on this file will close.',
          buttons: ['Cancel', 'Move to Trash'],
          defaultId: 1,
          cancelId: 0,
          type: 'warning'
        })
        if (result.response === 1) {
          onTrashFile(tab.id, path)
        }
        return
      }
    }
  }

  // ENH-050 — pinned-close confirm via system sheet. Same migration
  // as the trash confirm above.
  const handleClose = async (tab: WorkingTab) => {
    if (tab.pinned) {
      const result = await window.electron.dialog.confirm({
        title: `Close pinned tab "${tabLabel(tab)}"?`,
        message: 'This tab is pinned. Closing it removes the pin and the tab.',
        buttons: ['Cancel', 'Close tab'],
        defaultId: 1,
        cancelId: 0,
        type: 'warning'
      })
      if (result.response === 1) {
        onClose(tab.id)
      }
      return
    }
    onClose(tab.id)
  }

  // ENH-024 — when the active tab changes (click, ⌃Tab, ⌘1–9, CLI),
  // scroll it into view inside the overflow-x-auto scroller. `inline:
  // 'nearest'` + `block: 'nearest'` only scrolls when the tab is
  // actually clipped — clicking an already-visible tab is a no-op.
  const activeTabRef = useRef<HTMLButtonElement | null>(null)
  const activeTabId = tabs.find(t => t.isActive)?.id
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [activeTabId])

  return (
    <div
      className={[
        'flex items-end h-9 border-b shrink-0 px-2 gap-0.5 transition-colors',
        focused ? 'bg-accent-soft border-accent' : 'bg-surface-1 border-border'
      ].join(' ')}
    >
      {/* BUG-068 — tabs render inside a flex-1 overflow-x-auto scroller
          so they pan independently. New-tab cluster lives OUTSIDE this
          div so it stays pinned at the right edge no matter how many
          tabs are open / how far the user has panned. Pattern mirrors
          TabBar.tsx (terminal strip). */}
      {/* ENH-132 (Sprint 14, 2026-05-10) — ARIA tablist role for screen
          readers. Per-tab `role="tab"` + `aria-selected` are set on the
          WorkingTabItem button. */}
      <div role="tablist" aria-label="Working pane tabs" className="flex items-end flex-1 overflow-x-auto scrollbar-none gap-0.5">
        {tabs.map(tab => (
          <WorkingTabItem
            key={tab.id}
            tab={tab}
            worktree={worktreeBadges.get(dirOfWorkingTab(tab))}
            onSelect={() => onSelect(tab.id)}
            onClose={(e) => {
              e.stopPropagation()
              void handleClose(tab)
            }}
            onContextMenu={(e) => { void handleContextMenu(e, tab) }}
            // ENH-212/ENH-228 — Home AND the Vault tab are non-closable
            // permanent slots; never render their close glyph. closeFileTab
            // also hard-refuses f:home / f:vault, but suppressing the
            // affordance keeps the contract visible to the user.
            canClose={tabs.length > 1 && tab.type !== 'home' && tab.type !== 'vault' && tab.type !== 'rollups'}
            // ENH-024 — only the active tab gets the ref so the
            // useEffect above can scroll it into view.
            buttonRef={tab.isActive ? activeTabRef : undefined}
            // ENH-042 — HTML5 drag-and-drop reorder. Each tab is
            // draggable; dropTargetId paints the accent cue on the
            // hovered tab. Disabled when no parent reorder callback
            // (defensive — every consumer wires one in v0.6.3+).
            draggable={!!onReorderTab}
            isDropTarget={dropTargetId === tab.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('application/x-duo-tab-id', tab.id)
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('application/x-duo-tab-id')) {
                e.preventDefault()
                setDropTargetId(tab.id)
              }
            }}
            onDragLeave={() => {
              // Only clear if we're the current target; multiple tabs
              // race their leave/over events on adjacent moves.
              setDropTargetId(prev => (prev === tab.id ? null : prev))
            }}
            onDrop={(e) => {
              e.preventDefault()
              const sourceId = e.dataTransfer.getData('application/x-duo-tab-id')
              setDropTargetId(null)
              if (sourceId) tryReorderDrop(sourceId, tab.id)
            }}
            onDragEnd={() => setDropTargetId(null)}
          />
        ))}
      </div>

      {/* ENH-073 (v0.6.3) — visible paper-rule separator between the
          tab list and the new-tab cluster. Owner walk-2: "there
          should be a more visible line that separates the buttons
          from the tab section." Slightly taller + more prominent
          than the in-cluster divider between the two split-button
          halves. */}
      <span aria-hidden="true" className="shrink-0 w-px h-5 bg-paper-rule mb-1 mx-1.5" />

      {/* ENH-006 + ENH-068 + ENH-083 — split button: + new file | globe
          new browser tab | collapse-canvas. Three buttons in one rounded
          cluster, in-cluster h-3 paper-rule dividers between each, all
          sharing the same baseline (mirrors TabBar's terminal-strip
          three-button cluster). BUG-068 — sibling of the scroller
          above, so this cluster stays pinned to the right edge
          regardless of tab count / pan position. */}
      <div className="shrink-0 flex items-center mb-1 rounded overflow-hidden">
        <button
          onClick={onNewFile}
          className="w-7 h-6 flex items-center justify-center text-ink-mute hover:text-ink hover:bg-surface-3 transition-colors"
          title="New file (⌘N)"
          aria-label="New file"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <span aria-hidden="true" className="w-px h-3 bg-paper-rule" />
        <button
          onClick={onNewBrowserTab}
          className="w-6 h-6 flex items-center justify-center text-ink-mute hover:text-ink hover:bg-surface-3 transition-colors"
          title="New browser tab (⌘T)"
          aria-label="New browser tab"
        >
          <BrowserGlobeGlyph />
        </button>
        {onToggleCanvasCollapsed && (
          <>
            <span aria-hidden="true" className="w-px h-3 bg-paper-rule" />
            <button
              type="button"
              onClick={onToggleCanvasCollapsed}
              title={isCanvasCollapsed ? 'Show canvas (right pane)' : 'Hide canvas (terminal takes full width)'}
              aria-label={isCanvasCollapsed ? 'Show canvas' : 'Hide canvas'}
              className={[
                'w-6 h-6 flex items-center justify-center transition-colors',
                isCanvasCollapsed
                  ? 'bg-accent text-white'
                  : 'text-ink-mute hover:bg-surface-3 hover:text-ink'
              ].join(' ')}
            >
              <svg width="13" height="11" viewBox="0 0 13 11" fill="none" aria-hidden="true">
                <rect x="1" y="1" width="6" height="9" rx="0.5" stroke="currentColor" strokeWidth="1" fill="none" />
                <rect x="8" y="1" width="4" height="9" rx="0.5" stroke="currentColor" strokeWidth="1" fill={isCanvasCollapsed ? 'currentColor' : 'none'} />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

interface ItemProps {
  tab: WorkingTab
  /** ENH-210 — present only when this tab's file is in a LINKED worktree. */
  worktree?: WorktreeBadge
  onSelect: () => void
  onClose: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  canClose: boolean
  /** ENH-024 — passed by the parent on the active tab so it can
   *  `scrollIntoView` whenever the active tab changes. */
  buttonRef?: React.Ref<HTMLButtonElement>
  /** ENH-042 — drag-and-drop reorder. Strip-level state passed down. */
  draggable?: boolean
  isDropTarget?: boolean
  onDragStart?: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragOver?: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragLeave?: (e: React.DragEvent<HTMLButtonElement>) => void
  onDrop?: (e: React.DragEvent<HTMLButtonElement>) => void
  onDragEnd?: (e: React.DragEvent<HTMLButtonElement>) => void
}

function WorkingTabItem({
  tab,
  worktree,
  onSelect,
  onClose,
  onContextMenu,
  canClose,
  buttonRef,
  draggable,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd
}: ItemProps) {
  const label = tabLabel(tab)
  const baseTooltip = tab.path ?? tab.url ?? label
  const tooltip = worktree
    ? `Worktree of ${worktree.repoName || 'repo'} · ⎇ ${worktree.branch || 'detached'}\n${baseTooltip}`
    : baseTooltip
  return (
    <button
      ref={buttonRef}
      // ENH-132 — ARIA tab semantics. `role="tab"` + `aria-selected`
      // turn this from a plain button into a screen-reader-announced
      // tab ("Smoke walk, tab 6 of 12, selected") instead of just
      // "Smoke walk, button". Parent has `role="tablist"`.
      role="tab"
      aria-selected={tab.isActive}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={[
        'group relative flex items-center gap-1.5 px-2.5 h-7 max-w-[200px] rounded-t-lg shrink-0 transition-colors',
        tab.isActive
          ? 'bg-surface-0 text-ink shadow-[inset_0_1px_0_var(--duo-paper-rule),inset_1px_0_var(--duo-paper-rule),inset_-1px_0_var(--duo-paper-rule)] font-serif italic text-[13px] font-medium'
          : 'text-ink-mute hover:text-ink-soft hover:bg-surface-2 text-xs',
        // ENH-042 — accent ring when this tab is the drop target.
        isDropTarget ? 'ring-2 ring-accent ring-inset' : ''
      ].join(' ')}
      title={tooltip}
    >
      {tab.isActive && (
        <span
          aria-hidden="true"
          className="absolute left-0 right-0 top-0 h-0.5 bg-accent rounded-t-lg"
        />
      )}
      {/* ENH-210 (D1-part1) — per-checkout hue dot: this file is open from
          a linked worktree. Mirrors the terminal-tab treatment (D3-B hue
          thread); main-checkout files have no badge. */}
      {worktree && (
        <span
          aria-hidden="true"
          className="shrink-0 w-[7px] h-[7px] rounded-sm"
          style={{ backgroundColor: projectColorToken(worktree.colorIndex) }}
        />
      )}
      {tab.pinned ? <PinIcon active={tab.isActive} /> : <TypeIcon type={tab.type} active={tab.isActive} />}
      <span className="truncate leading-none not-italic">{label}</span>
      {/* ENH-210 — ⎇ marker in the checkout's hue: the color-blind-safe
          redundant carrier (color is never the only signal). Repo + branch
          ride in the tooltip; the working strip stays lighter than the
          terminal tab's full chip since file tabs are dense. */}
      {worktree && (
        <span
          aria-hidden="true"
          className="shrink-0 not-italic text-[11px] leading-none font-sans"
          style={{ color: projectColorToken(worktree.colorIndex) }}
        >
          ⎇
        </span>
      )}
      {tab.dirty && (
        <span
          aria-label="Unsaved changes"
          title="Unsaved changes"
          className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
        />
      )}
      {canClose && (
        <span
          onClick={onClose}
          role="button"
          tabIndex={0}
          aria-label={`Close ${label}`}
          onKeyDown={(e) => e.key === 'Enter' && onClose(e as unknown as React.MouseEvent)}
          className={[
            'flex items-center justify-center w-3.5 h-3.5 rounded shrink-0 transition-opacity transition-colors',
            tab.isActive
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

/** Phase 3c — extract the numeric BrowserTab id from a strip-id of
 *  the form `b:<n>`. Returns null if the id isn't a browser strip-id
 *  or the numeric portion doesn't parse. Mirrors the
 *  `parseId({kind:'browser'})` helper in WorkingPane.tsx but scoped
 *  to the browser case the strip needs for the Move-to-Split-View
 *  right-click handler. */
function parseBrowserId(stripId: string): number | null {
  if (!stripId.startsWith('b:')) return null
  const n = parseInt(stripId.slice(2), 10)
  return Number.isInteger(n) ? n : null
}

function tabLabel(tab: WorkingTab): string {
  if (tab.type === 'browser') return tab.title || tab.url || 'New tab'
  // ENH-212 — Home's title falls back to "Home" so a synthesized tab with
  // no explicit title still reads correctly.
  if (tab.type === 'home') return tab.title || 'Home'
  // ENH-228 — same for the synthesized Vault tab.
  if (tab.type === 'vault') return tab.title || 'Vault'
  // ENH-243 — same for the synthesized Rollups tab.
  if (tab.type === 'rollups') return tab.title || 'Rollups'
  return tab.title
}

// BUG-045 — convert a file:// URL back to a filesystem path so a
// browser tab pointing at a local artifact (smoke walks, agent-
// generated reports, local previews) can offer the same Reveal /
// Rename / Trash menu items as a file tab. Returns null for any
// non-file URL or malformed input — caller falls through to the
// existing "browser tab → Pin/Unpin only" branch.
// ENH-050 — assemble the menu template for the right-click context
// menu. File-bearing tabs (path != null) get Reveal in navigator /
// Rename / Move to Trash; browser tabs only get Pin/Unpin. Pin is
// also shown for file tabs for symmetry with the navigator pins.
//
// The template is pure data — no click handlers. Each item carries
// a stable `id` that the parent's handleMenuChoice maps back to an
// action after `menu.popup` returns. This keeps the IPC boundary
// clean (no closures riding through serialization) and keeps the
// menu logic testable in isolation.
function buildTabMenuTemplate(opts: {
  tabId: string
  pinned: boolean
  path: string | null
  tabs: WorkingTab[]
  onTogglePin?: (id: string) => void
  onRevealInNavigator?: (path: string) => void
  onStartRenameFromTab?: (path: string) => void
  onMoveTab?: (id: string, delta: -1 | 1) => void
  onMoveToSplit?: (path: string) => void
  /** Phase 3c — browser-tab variant of the move-to-split entry. */
  onMoveBrowserTabToSplit?: (browserTabId: number) => void
  /** ENH-097 — "Edit in canvas" entry. Shown only on file:// browser
   *  tabs (where path resolves to a local file). */
  onEditInCanvas?: (browserTabId: number, path: string) => void
  /** ENH-131 (Sprint 14) — inverse of "Edit in canvas". Shown only on
   *  canvas tabs (`tab.type === 'page'`) backed by an HTML file. Closes
   *  the canvas tab and re-opens the same path as a browser tab so
   *  scripts run / buttons fire (the playground modality). */
  onOpenInBrowser?: (fileTabId: string, path: string) => void
}): MenuTemplateItem[] {
  const { tabId, pinned, path, tabs, onTogglePin, onRevealInNavigator, onStartRenameFromTab, onMoveTab, onMoveToSplit, onMoveBrowserTabToSplit, onEditInCanvas, onOpenInBrowser } = opts
  const tab = tabs.find(t => t.id === tabId)
  const items: MenuTemplateItem[] = []

  // ENH-212 [V] — Home gets an EMPTY context menu. Its sentinel
  // `path: 'duo://home'` is truthy, so without this guard the file-mgmt
  // block below would offer Reveal / Rename / Copy path / Trash on a
  // non-file. "Pin tab" and "Move to Split View" are ALSO excluded
  // (return-early covers them): both would persist the `duo://home`
  // sentinel into pins.json / the aux-split SessionState field and break
  // restore. (Move-tab-left/right is suppressed too — Home always sorts
  // leftmost, so reordering it is meaningless.)
  if (tab?.type === 'home') return items
  // ENH-228 — the Vault tab gets the same EMPTY context menu: its sentinel
  // `path: 'duo://vault'` is a non-file, and pinning / moving-to-split would
  // persist the sentinel and break restore.
  if (tab?.type === 'vault') return items
  // ENH-243 — the Rollups tab: same sentinel treatment as Vault.
  if (tab?.type === 'rollups') return items

  if (path) {
    if (onRevealInNavigator) {
      items.push({ id: 'reveal', label: 'Reveal in navigator' })
    }
    if (onStartRenameFromTab) {
      items.push({ id: 'rename', label: 'Rename…' })
    }
    // ENH-074 — Copy path. Mirrors the FileTree right-click menu.
    // Always shown when path is resolvable; clipboard write happens
    // in handleMenuChoice (renderer-side, no IPC needed).
    items.push({ id: 'copy-path', label: 'Copy path' })
  }

  // ENH-042 — Move left / Move right. Disabled when the tab is at
  // the edge of its zone (pinned-leftmost or unpinned-rightmost).
  if (onMoveTab && tab) {
    const zone = tabs.filter(t => t.pinned === tab.pinned)
    const zoneIdx = zone.findIndex(t => t.id === tabId)
    const canMoveLeft = zoneIdx > 0
    const canMoveRight = zoneIdx >= 0 && zoneIdx < zone.length - 1
    if (items.length > 0 && (canMoveLeft || canMoveRight)) {
      items.push({ type: 'separator' })
    }
    if (canMoveLeft) {
      items.push({ id: 'move-left', label: 'Move tab left' })
    }
    if (canMoveRight) {
      items.push({ id: 'move-right', label: 'Move tab right' })
    }
  }

  if (onTogglePin) {
    if (items.length > 0) items.push({ type: 'separator' })
    items.push({
      id: 'pin',
      label: pinned ? 'Unpin tab' : 'Pin tab'
    })
  }

  // Sprint 3 Phase 3b → Sprint 7 Phase 3c — Move to Split View.
  // Browser tabs route through `onMoveBrowserTabToSplit` (the
  // BrowserManager pins the WCV into the aux slot directly, so
  // scripts keep running — fixes BUG-092). File tabs route through
  // `onMoveToSplit` (path-based file-aux flow). Show the entry when
  // the appropriate callback exists for the tab's kind.
  const canMoveBrowserToSplit = !!(onMoveBrowserTabToSplit && tab && tab.type === 'browser')
  const canMoveFileToSplit = !!(onMoveToSplit && path && tab && tab.type !== 'browser')
  if (canMoveBrowserToSplit || canMoveFileToSplit) {
    if (items.length > 0) items.push({ type: 'separator' })
    items.push({ id: 'move-to-split', label: 'Move to Split View' })
  }

  // ENH-097 — "Edit in canvas" on file:// browser tabs. Pairs with
  // the modality lock: a playground HTML file routes to browser by
  // default (scripts run, buttons fire). To edit the source, the
  // user opens the same file in canvas mode where buttons render
  // but clicks place a cursor. Only shown when the browser tab's
  // URL resolved to a local file path AND the file is HTML.
  const canEditInCanvas = !!(
    onEditInCanvas
    && tab
    && tab.type === 'browser'
    && path
    && /\.html?$/i.test(path)
  )
  if (canEditInCanvas) {
    if (items.length > 0) items.push({ type: 'separator' })
    items.push({ id: 'edit-in-canvas', label: 'Edit in canvas' })
  }

  // ENH-131 — "Open in browser" — inverse of "Edit in canvas". Shown
  // when the canvas tab is backed by an HTML file. Closes the canvas
  // tab and re-opens as a browser tab (scripts run, buttons fire).
  // Useful for: previewing how a playground actually behaves while
  // editing it in canvas mode, or just shifting an HTML doc to the
  // browser pane to drive its interactivity.
  const canOpenInBrowser = !!(
    onOpenInBrowser
    && tab
    && tab.type === 'page'
    && path
    && /\.html?$/i.test(path)
  )
  if (canOpenInBrowser) {
    if (items.length > 0) items.push({ type: 'separator' })
    items.push({ id: 'open-in-browser', label: 'Open in browser' })
  }

  // FOLLOWUP-015 (ENH-117 v2) — View source on editor / page tabs.
  // Read-only panel-fill that swaps the editor / canvas content area
  // for a monospace render of the source. Same surface as the ⌘⌥V
  // chord and the View → View source menu. Browser tabs have their
  // own DevTools; not exposed here.
  if (tab && (tab.type === 'editor' || tab.type === 'page')) {
    if (items.length > 0) items.push({ type: 'separator' })
    items.push({
      id: 'view-source',
      label: 'View source',
      // Display-only label — accelerator on a context menu doesn't
      // bind globally; the chord lives in globalShortcuts.ts. This
      // just shows the user the chord for muscle-memory training.
      accelerator: 'CmdOrCtrl+Alt+V'
    })
  }

  if (path && tab) {
    if (items.length > 0) items.push({ type: 'separator' })
    items.push({ id: 'trash', label: 'Move to Trash…' })
  }

  return items
}

// Stage 24 — pin glyph replaces TypeIcon when a tab is pinned. Same
// 10x10 grid as TypeIcon so the tab chip layout is unchanged.
function PinIcon({ active }: { active: boolean }) {
  const cls = active ? 'text-accent shrink-0' : 'text-ink-mute shrink-0'
  return (
    <span className={cls} title="Pinned">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
        <path d="M5 0.5l1.5 2v2.5l1.5 1.5v0.5h-2.5v3l-0.5 0.5l-0.5-0.5v-3h-2.5v-0.5l1.5-1.5v-2.5z" />
      </svg>
    </span>
  )
}

function TypeIcon({ type, active }: { type: WorkingTabType; active: boolean }) {
  // 10×10 glyphs, monochrome. Matches the per-type set we'll grow in the
  // navigator (Phase 4). Keep the set small and recognizable.
  // Stage 12 Phase 3: active tabs paint the icon in accent (matches
  // TabBar's terminal glyph), inactive in ink-ghost.
  const cls = active ? 'text-accent shrink-0' : 'text-ink-ghost shrink-0'
  const inner = (() => {
    switch (type) {
      case 'browser':
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <circle cx="5" cy="5" r="3.7" stroke="currentColor" strokeWidth="1" />
            <path d="M1.3 5h7.4M5 1.3C6.2 2.6 6.8 4.2 6.8 5S6.2 7.4 5 8.7C3.8 7.4 3.2 5.8 3.2 5S3.8 2.6 5 1.3Z" stroke="currentColor" strokeWidth="0.8" />
          </svg>
        )
      case 'editor':
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2 1.5h4l2 2v5h-6Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
            <path d="M3.5 5h3M3.5 6.5h3M3.5 8h2" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
          </svg>
        )
      case 'page':
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <rect x="1" y="2" width="8" height="6" rx="0.5" stroke="currentColor" strokeWidth="1" />
            <path d="M2.5 4l1.2 1.5L2.5 7M5 7h2.5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      case 'home':
        // ENH-212 — house glyph for the permanent Home tab.
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1.4 5L5 1.6 8.6 5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2.4 4.4V8.3h5.2V4.4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      case 'vault':
        // ENH-228 — open-book glyph for the Vault tab.
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M5 2.4C4.2 1.9 2.9 1.7 1.5 1.9V7.7c1.4-.2 2.7 0 3.5.5.8-.5 2.1-.7 3.5-.5V1.9C7.1 1.7 5.8 1.9 5 2.4Z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
            <path d="M5 2.4V8.2" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
          </svg>
        )
      case 'rollups':
        // ENH-243 — stacked-rows glyph for the Rollups tab.
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <rect x="1.4" y="1.6" width="7.2" height="1.8" rx="0.5" stroke="currentColor" strokeWidth="0.9" />
            <rect x="2.6" y="4.3" width="6" height="1.8" rx="0.5" stroke="currentColor" strokeWidth="0.9" />
            <rect x="3.8" y="7" width="4.8" height="1.8" rx="0.5" stroke="currentColor" strokeWidth="0.9" />
          </svg>
        )
      case 'image':
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <rect x="1" y="2" width="8" height="6" rx="0.5" stroke="currentColor" strokeWidth="1" />
            <circle cx="3" cy="4.2" r="0.6" fill="currentColor" />
            <path d="M2 7l2-2 2 2 1.5-1.5L9 7" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
          </svg>
        )
      case 'pdf':
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2 1.5h4l2 2v5h-6Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
            <path d="M3 5.5h0.8M4 5.5q0.7 0 0.7 0.7V8M5.5 5.5h1q0.7 0 0.7 0.7v0.6q0 0.7 -0.7 0.7h-1Z" stroke="currentColor" strokeWidth="0.6" fill="none" />
          </svg>
        )
      default:
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
          </svg>
        )
    }
  })()
  return <span className={cls}>{inner}</span>
}

// ENH-068 (v0.6.3) — globe glyph for the new-browser-tab split-button.
// Replaces the previous `>` chevron, which didn't visually suggest
// "browser." Owner observation walk-1: "current button for new browser
// tab is `>`, should be something more obviously browser like — like a
// globe image or something." Mirrors the TerminalIcon's globe-line
// pattern (circle + meridians) so the strip's visual language stays
// coherent. currentColor follows the button's text-ink-mute → text-ink.
function BrowserGlobeGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1" />
      <path
        d="M1.5 5.5h8M5.5 1.5C6.8 2.9 7.5 4.6 7.5 5.5S6.8 8.1 5.5 9.5C4.2 8.1 3.5 6.4 3.5 5.5S4.2 2.9 5.5 1.5Z"
        stroke="currentColor"
        strokeWidth="0.8"
      />
    </svg>
  )
}
