// BUG-270 — WebContentsView geometry ownership across renderer generations.
//
// Every browser tab in Duo is a native `WebContentsView` that the macOS
// compositor paints ABOVE renderer DOM regardless of z-index. Its rectangle
// has exactly one publisher: a React effect in the renderer that measures a
// DOM host (`BrowserRenderer` for the main pane, `AuxBrowserSlot` for the
// Split View aux slot) and pushes the pixel bounds to main. Those components'
// *cleanups* are also the only thing that ever hides a view (1×1 park).
//
// A renderer reload destroys the document without running React cleanups,
// while the main process keeps every view, the aux pin, and the last cached
// rectangles — so the views keep painting at the pre-reload geometry over a
// freshly-restored editor, and can never move again because their publisher
// is gone. The invariant this module makes explicit:
//
//   A cached WCV rectangle is only valid while the renderer generation that
//   measured it is alive. When that renderer goes away, every view parks and
//   the cache resets; the next renderer re-publishes what it wants visible.
//
// Kept pure + in `shared/` so the contract is unit-testable without an
// Electron mount (`electron/browser-manager.ts` executes the plan).

import type { BrowserBounds } from './types'

/** The "present but invisible" rectangle. 1×1 rather than 0×0 keeps the view
 *  alive (SSO cookies, audio, in-flight loads) while it intercepts nothing
 *  and paints nowhere the user can see. Matches the literal both renderer
 *  components have always used on unmount. */
export const PARKED_WCV_BOUNDS: BrowserBounds = { x: 0, y: 0, width: 1, height: 1 }

export interface HostRendererReloadReconcile {
  /** Every live view id to park at {@link PARKED_WCV_BOUNDS}. Includes the
   *  aux-pinned view: its rectangle is just as stale as the main pane's. */
  park: number[]
  /** The aux pin to drop, or `null` when nothing was pinned. The fresh
   *  renderer has no browser-aux state (it is deliberately not persisted in
   *  the session envelope), so a surviving pin desyncs main from the UI —
   *  `duo tabs` reports `inAux: true` while `duo split-view` reports
   *  `aux: null` (the BUG-195 ghost signature). */
  unpinAux: number | null
  /** What the cached main/aux rectangles become. Parked, not zeroed: a later
   *  `switchTab` re-applies the cache, and 1×1 is the safe "nothing is
   *  claiming a rect right now" value. */
  cachedBounds: BrowserBounds
}

/**
 * Plan the reconcile for "the host renderer is going away" (a reload, a crash
 * recovery, an ErrorBoundary Reload click).
 *
 * Deliberately does NOT touch the active-tab index, focus, or tab identity:
 * the reloaded renderer restores its own active surface from the session
 * envelope, and a re-home/refocus here would hijack it. Parked views become
 * visible again the moment the new renderer mounts `BrowserRenderer` /
 * `AuxBrowserSlot` and publishes real bounds.
 */
export function planHostRendererReloadReconcile(state: {
  tabIds: readonly number[]
  auxTabId: number | null
}): HostRendererReloadReconcile {
  return {
    park: [...state.tabIds],
    unpinAux: state.auxTabId,
    cachedBounds: PARKED_WCV_BOUNDS
  }
}
