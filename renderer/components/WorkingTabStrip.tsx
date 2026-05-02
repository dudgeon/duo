// Stage 10 Phase 3 — unified tab strip for the WorkingPane.
//
// Supersedes the old `BrowserTabStrip`. Tabs are mixed-type, identified by
// `type`; each chip shows a small leading icon indicating the type so a
// browser page, a markdown preview, and an image preview can sit side by
// side without visual ambiguity (Stage 10 § D26).

import { useEffect, useRef, useState } from 'react'
import type { WorkingTab, WorkingTabType } from '@shared/types'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { PinnedCloseConfirm } from './PinnedCloseConfirm'

interface WorkingTabStripProps {
  tabs: WorkingTab[]
  onSelect: (id: string) => void
  /** ENH-006 — split-button new affordance, mirrors TabBar (terminal).
   *  `+` (left, primary, wider) opens the new-file interstitial (⌘N).
   *  `>` (right, secondary, narrow) opens a new browser tab (⌘T). */
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
   *  App.tsx confirms the action, calls `files.trash`, and closes
   *  the tab. */
  onTrashFile?: (id: string, path: string) => void
  /** ENH-026 — Reveal the tab's file in the navigator AND put the
   *  tree row into rename mode. Custom-event-driven so we don't
   *  need to lift FileTree's renamingPath state up to App. */
  onStartRenameFromTab?: (path: string) => void
}

// Stage 12 Phase 3 — tab-strip rhyme. Strip + chip language matches
// TabBar (terminal). Differentiator: strip bg = paper-deep here vs
// paper-edge for the terminal strip. Mock reference:
// docs/design/atelier/project/duo-components.jsx ~L286.
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
  onStartRenameFromTab
}: WorkingTabStripProps) {
  // Stage 24 — context menu state (which tab + position) and pinned-tab
  // close-confirm modal state.
  // ENH-026 — extended ctxMenu to carry the tab's path (or null) so we
  // can decide which items are applicable without re-finding the tab.
  const [ctxMenu, setCtxMenu] = useState<
    | { tabId: string; pinned: boolean; path: string | null; x: number; y: number }
    | null
  >(null)
  const [confirmClose, setConfirmClose] = useState<{ tabId: string; label: string } | null>(null)
  // ENH-026 — separate confirm dialog for trash (different copy +
  // different action than the pinned-close confirm).
  const [confirmTrash, setConfirmTrash] = useState<{ tabId: string; path: string; label: string } | null>(null)

  const handleContextMenu = (e: React.MouseEvent, tab: WorkingTab) => {
    e.preventDefault()
    setCtxMenu({
      tabId: tab.id,
      pinned: !!tab.pinned,
      // BUG-045 — when a browser tab points at a local file
      // (file:// URL), expose the same file-management menu as
      // file tabs. Lets the user Reveal / Rename / Trash the
      // underlying file even when they explicitly chose to open
      // it in the browser pane (smoke-walk pages, agent-generated
      // dashboards, local previews). Falls through to null for
      // remote URLs.
      path: tab.path ?? pathFromFileUrl(tab.url),
      x: e.clientX,
      y: e.clientY
    })
    // BUG-047 / BUG-058 — when the working pane currently shows a
    // browser tab, the WebContentsView occludes the area below the
    // strip+address-bar zone. The context menu opens at the click
    // point and its lower rows extend INTO the WCV's area where
    // browser content shows through (renderer-DOM portal can't beat
    // a native subview at the macOS compositor layer).
    //
    // Walk-2 BUG-058 narrowed this: the original BUG-047 fix only
    // muted when the user right-clicked a browser tab. But the
    // occlusion depends on what's CURRENTLY VISIBLE in the working
    // pane, not on what tab was right-clicked. If a browser tab is
    // the active working tab and the user right-clicks ANY tab in
    // the strip (file, canvas, browser), the menu still gets
    // occluded by the visible WCV. Fix: mute whenever any tab in
    // the strip is active AND of kind 'browser'.
    const activeIsBrowser = tabs.some(t => t.isActive && t.type === 'browser')
    if (activeIsBrowser) {
      window.electron.browser.setOverlayMuted(true)
    }
  }

  const handleClose = (tab: WorkingTab) => {
    if (tab.pinned) {
      setConfirmClose({ tabId: tab.id, label: tabLabel(tab) })
      return
    }
    onClose(tab.id)
  }

  // ENH-024 — when the active tab changes (click, ⌃Tab, ⌘1–9, CLI),
  // scroll it into view inside the overflow-x-auto strip. `inline:
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
        'flex items-end h-9 px-2 gap-0.5 border-b shrink-0 overflow-x-auto scrollbar-none transition-colors',
        focused ? 'bg-accent-soft border-accent' : 'bg-surface-1 border-border'
      ].join(' ')}
    >
      {tabs.map(tab => (
        <WorkingTabItem
          key={tab.id}
          tab={tab}
          onSelect={() => onSelect(tab.id)}
          onClose={(e) => {
            e.stopPropagation()
            handleClose(tab)
          }}
          onContextMenu={(e) => handleContextMenu(e, tab)}
          canClose={tabs.length > 1}
          // ENH-024 — only the active tab gets the ref so the
          // useEffect above can scroll it into view.
          buttonRef={tab.isActive ? activeTabRef : undefined}
        />
      ))}

      {/* ENH-006 — split button: + new file (primary) | > new browser
          tab (secondary). Mirrors TabBar's terminal-strip split: the
          opinionated default keeps the existing "click the +" muscle
          memory (⌘N file flow), the secondary half exposes the browser-
          tab path that used to require ⌥-click. */}
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
          className="w-5 h-6 flex items-center justify-center text-ink-ghost hover:text-ink hover:bg-surface-3 transition-colors"
          title="New browser tab (⌘T)"
          aria-label="New browser tab"
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <path d="M2.5 2.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {ctxMenu && (
        <ContextMenu
          position={{ x: ctxMenu.x, y: ctxMenu.y }}
          items={buildTabContextMenuItems({
            ctxMenu,
            tabs,
            onTogglePin,
            onRevealInNavigator,
            onStartRenameFromTab,
            onTrashRequest: (tabId, path, label) => {
              setConfirmTrash({ tabId, path, label })
            },
            onClose: () => {
              setCtxMenu(null)
              // BUG-047 — unmute the WebContentsView when the menu
              // closes (mirror the mute on open in handleContextMenu).
              window.electron.browser.setOverlayMuted(false)
            }
          })}
          onClose={() => {
            setCtxMenu(null)
            // BUG-047 — also unmute when the user dismisses via
            // outside-click / Escape (ContextMenu calls onClose).
            window.electron.browser.setOverlayMuted(false)
          }}
        />
      )}

      {confirmClose && (
        <PinnedCloseConfirm
          label={confirmClose.label}
          onConfirm={() => {
            onClose(confirmClose.tabId)
            setConfirmClose(null)
          }}
          onCancel={() => setConfirmClose(null)}
        />
      )}

      {confirmTrash && (
        <PinnedCloseConfirm
          // BUG-049 — explicit title/body (was reusing the
          // pinned-close `label` prop, which sandwiched the trash
          // copy between hardcoded "Close pinned tab?" / "is pinned.
          // Close it anyway?" strings).
          title="Move to Trash?"
          body={
            <>
              <span className="text-ink">{confirmTrash.label}</span> will be moved to the Trash. The tab will close.
            </>
          }
          confirmLabel="Move to Trash"
          onConfirm={() => {
            onTrashFile?.(confirmTrash.tabId, confirmTrash.path)
            setConfirmTrash(null)
          }}
          onCancel={() => setConfirmTrash(null)}
        />
      )}
    </div>
  )
}

interface ItemProps {
  tab: WorkingTab
  onSelect: () => void
  onClose: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  canClose: boolean
  /** ENH-024 — passed by the parent on the active tab so it can
   *  `scrollIntoView` whenever the active tab changes. */
  buttonRef?: React.Ref<HTMLButtonElement>
}

function WorkingTabItem({ tab, onSelect, onClose, onContextMenu, canClose, buttonRef }: ItemProps) {
  const label = tabLabel(tab)
  const tooltip = tab.path ?? tab.url ?? label
  return (
    <button
      ref={buttonRef}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={[
        'group relative flex items-center gap-1.5 px-2.5 h-7 max-w-[200px] rounded-t-lg shrink-0 transition-colors',
        tab.isActive
          ? 'bg-surface-0 text-ink shadow-[inset_0_1px_0_var(--duo-paper-rule),inset_1px_0_var(--duo-paper-rule),inset_-1px_0_var(--duo-paper-rule)] font-serif italic text-[13px] font-medium'
          : 'text-ink-mute hover:text-ink-soft hover:bg-surface-2 text-xs'
      ].join(' ')}
      title={tooltip}
    >
      {tab.isActive && (
        <span
          aria-hidden="true"
          className="absolute left-0 right-0 top-0 h-0.5 bg-accent rounded-t-lg"
        />
      )}
      {tab.pinned ? <PinIcon active={tab.isActive} /> : <TypeIcon type={tab.type} active={tab.isActive} />}
      <span className="truncate leading-none not-italic">{label}</span>
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

function tabLabel(tab: WorkingTab): string {
  if (tab.type === 'browser') return tab.title || tab.url || 'New tab'
  return tab.title
}

// BUG-045 — convert a file:// URL back to a filesystem path so a
// browser tab pointing at a local artifact (smoke walks, agent-
// generated reports, local previews) can offer the same Reveal /
// Rename / Trash menu items as a file tab. Returns null for any
// non-file URL or malformed input — caller falls through to the
// existing "browser tab → Pin/Unpin only" branch.
function pathFromFileUrl(url: string | undefined): string | null {
  if (!url || !url.startsWith('file://')) return null
  try {
    return decodeURIComponent(new URL(url).pathname)
  } catch {
    return null
  }
}

// ENH-026 — assemble the right-click context menu items for a working
// tab. File-bearing tabs (path != null) get Reveal in navigator /
// Rename / Move to Trash; browser tabs only get Pin/Unpin. Pin is
// also shown for file tabs for symmetry with the navigator pins.
function buildTabContextMenuItems(opts: {
  ctxMenu: { tabId: string; pinned: boolean; path: string | null }
  tabs: WorkingTab[]
  onTogglePin?: (id: string) => void
  onRevealInNavigator?: (path: string) => void
  onStartRenameFromTab?: (path: string) => void
  onTrashRequest: (tabId: string, path: string, label: string) => void
  onClose: () => void
}): ContextMenuItem[] {
  const { ctxMenu, tabs, onTogglePin, onRevealInNavigator, onStartRenameFromTab, onTrashRequest, onClose } = opts
  const items: ContextMenuItem[] = []
  const tab = tabs.find(t => t.id === ctxMenu.tabId)
  const path = ctxMenu.path

  if (path) {
    if (onRevealInNavigator) {
      items.push({
        label: 'Reveal in navigator',
        onClick: () => {
          onRevealInNavigator(path)
          onClose()
        }
      })
    }
    if (onStartRenameFromTab) {
      items.push({
        label: 'Rename…',
        onClick: () => {
          onStartRenameFromTab(path)
          onClose()
        }
      })
    }
  }

  if (onTogglePin) {
    items.push({
      label: ctxMenu.pinned ? 'Unpin tab' : 'Pin tab',
      separatorBefore: items.length > 0,
      onClick: () => {
        onTogglePin(ctxMenu.tabId)
        onClose()
      }
    })
  }

  if (path && tab) {
    items.push({
      label: 'Move to Trash…',
      separatorBefore: items.length > 0,
      onClick: () => {
        onTrashRequest(ctxMenu.tabId, path, tabLabel(tab))
        onClose()
      }
    })
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
            <path d="M1.5 1.5h5l2 2v5h-7v-7Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
            <path d="M6.5 1.5v2h2" stroke="currentColor" strokeWidth="1" />
            <path d="M3 5h3M3 6.5h3M3 8h2" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
          </svg>
        )
      case 'markdown-preview':
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1.5 1.5h5l2 2v5h-7v-7Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
            <path d="M6.5 1.5v2h2" stroke="currentColor" strokeWidth="1" />
            <path d="M3 6.5l1-1 1 1 1-1 1 1" stroke="currentColor" strokeWidth="0.9" />
          </svg>
        )
      case 'image':
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <rect x="1.3" y="1.5" width="7.4" height="7" rx="1" stroke="currentColor" strokeWidth="1" />
            <circle cx="3.5" cy="4" r="0.8" stroke="currentColor" strokeWidth="0.8" />
            <path d="M8 6.5L6 4.5l-1.5 2L3 5l-1.5 1.5" stroke="currentColor" strokeWidth="0.9" />
          </svg>
        )
      case 'pdf':
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1.5 1.5h5l2 2v5h-7v-7Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
            <path d="M6.5 1.5v2h2" stroke="currentColor" strokeWidth="1" />
            <text x="3.5" y="7.5" fontSize="2.8" fill="currentColor" fontFamily="system-ui">pdf</text>
          </svg>
        )
      default:
        return (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1.5 1.5h5l2 2v5h-7v-7Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
            <path d="M6.5 1.5v2h2" stroke="currentColor" strokeWidth="1" />
          </svg>
        )
    }
  })()
  return <span className={cls}>{inner}</span>
}
