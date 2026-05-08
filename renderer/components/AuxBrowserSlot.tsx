// Sprint 7 Phase 3c — aux-pane render branch for a browser tab pinned
// to Split View.
//
// Mirrors `BrowserRenderer.tsx` for the main pane: mounts an empty
// container in the aux slot, measures it, and pushes the pixel bounds
// through `window.electron.browser.setAuxBounds` so main can
// reposition the WebContentsView under those coordinates. Adds a
// minimal header (URL + Promote / Close) that calls the App.tsx-owned
// callbacks. The actual web content lives in BrowserManager's
// auxTabId-tagged WebContentsView, NOT a React iframe — exactly the
// same architecture as the main browser pane, which is why scripts
// run normally (the canvas script-block restriction never enters the
// picture).
//
// What this fixes (vs. pre-Phase-3c BUG-092):
// - A worksheet / smoke-walk page in the browser pane, moved to
//   Split View, used to get promoted to a file tab and rendered in
//   the script-blocked canvas iframe — Copy buttons inert, JS dead.
// - With this component, the same gesture keeps the page in a real
//   Chromium tab, just repositioned into the aux slot. Scripts run.
// - Bounds-push parity with BrowserRenderer means the aux slot
//   resizes correctly on window resize, split divider drag, and
//   working-column collapse.

import { useRef, useEffect } from 'react'
import { pathFromFileUrl } from './urlUtils'

interface AuxBrowserSlotProps {
  /** Numeric BrowserTab id of the pinned tab. Forwarded into the
   *  header's right-click "Reveal in tab strip" if/when wired up
   *  (deferred); used for cleanup on unmount via setAuxBounds(1×1). */
  browserTabId: number
  /** Tab's current URL — shown in the header. Updated by App.tsx
   *  from the BrowserTab broadcast as the tab navigates. */
  url: string
  /** Tab's current title — shown in the header above the URL. */
  title: string
  /** Header ✕ — promote-to-main + close split. */
  onClose?: () => void
  /** Header ⇤ — promote aux back to main strip (single-action). */
  onPromote?: () => void
  /** ENH-084 / v0.6.5 lineage — focus glow on the aux header when
   *  the aux subpane has focus. App.tsx tells us whether to glow;
   *  we just style the header band. */
  focused?: boolean
}

export function AuxBrowserSlot({
  browserTabId,
  url,
  title,
  onClose,
  onPromote,
  focused = false
}: AuxBrowserSlotProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // BUG-105 walk-1 (Sprint 10) — pre-fix the aux pane's browser-slot
  // header had no `onContextMenu` handler at all, so right-clicking it
  // showed nothing (the user expected the same "Copy path / Copy URL /
  // Move back to main" menu the file-aux header has). AuxHeader covers
  // file tabs in split view; this covers browser tabs.
  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    const filePath = pathFromFileUrl(url)
    const items: import('@shared/types').MenuTemplateItem[] = []
    // Copy path / Copy URL — pathFromFileUrl returns null for non-file
    // URLs; in that case show "Copy URL" instead. Always available.
    items.push({
      id: 'aux-browser-copy',
      label: filePath ? 'Copy path' : 'Copy URL'
    })
    if (onPromote) {
      items.push({ id: 'aux-browser-sep', type: 'separator' })
      items.push({ id: 'aux-browser-promote', label: 'Move back to main' })
    }
    const result = await window.electron.menu.popup({
      items,
      x: e.clientX,
      y: e.clientY
    })
    if (!result.chosenId) return
    switch (result.chosenId) {
      case 'aux-browser-copy': {
        const text = filePath ?? url
        if (!text) return
        try { await window.electron.clipboard.writeText(text) } catch { /* perm denied */ }
        return
      }
      case 'aux-browser-promote':
        onPromote?.()
        return
    }
  }

  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    const send = () => {
      const r = el.getBoundingClientRect()
      window.electron.browser.setAuxBounds({
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height)
      })
    }

    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    window.addEventListener('resize', send)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', send)
      // On unmount (split closed / browser unpinned), shrink the aux
      // slot to 1×1 so the now-stale aux bounds don't leave the WCV
      // visible over whatever takes the aux pane's place. Symmetric
      // with BrowserRenderer's main-side cleanup. BrowserManager will
      // also clear its `auxTabId` separately via the release call —
      // this is a defensive belt-and-braces in case the unmount races
      // the release.
      window.electron.browser.setAuxBounds({ x: 0, y: 0, width: 1, height: 1 })
    }
    // browserTabId is in the dep array so a re-pin to a different
    // tab gets fresh bounds wired (the host element's geometry is
    // stable, but we want the unmount cleanup to fire on tab swap).
  }, [browserTabId])

  // Title bar: URL + buttons. Mirrors AuxHeader's visual treatment
  // (paper-deep band, accent border-bottom on focus) so the two aux
  // surfaces look consistent.
  const headerClass = [
    'shrink-0 flex items-center gap-2 px-3 py-1.5 border-b text-xs',
    'bg-surface-1 text-ink-soft',
    focused ? 'border-accent' : 'border-stroke'
  ].join(' ')

  return (
    <div className="flex flex-col h-full w-full">
      <div className={headerClass} onContextMenu={(e) => { void handleContextMenu(e) }}>
        <div className="flex flex-col min-w-0 flex-1 gap-0">
          <div className="truncate text-ink font-medium" title={title || url}>
            {title || url || '(loading)'}
          </div>
          {url && title && (
            <div className="truncate text-ink-mute" style={{ fontSize: '11px' }} title={url}>
              {url}
            </div>
          )}
        </div>
        {/* Sprint 7 rev6 — single ✕ button. Closes the split and
            promotes the pinned tab back to the main strip (App.tsx
            wires both onClose and onPromote to splitViewPromote). The
            previous separate ⇤ button was redundant. */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 px-2 py-0.5 rounded border border-stroke bg-surface-0 hover:bg-surface-2 text-ink"
            title="Move back to main (close split)"
            aria-label="Move back to main"
          >
            ✕
          </button>
        )}
      </div>
      {/* Bounds host. Empty by design — the WebContentsView lives in
          main and gets positioned over this DOM rectangle via
          setAuxBounds. ResizeObserver above keeps the WCV in sync. */}
      <div ref={contentRef} className="flex-1 min-h-0 bg-surface-0" />
    </div>
  )
}
