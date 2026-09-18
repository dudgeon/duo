// BUG-270 — the WCV-geometry-across-renderer-generations contract.
//
// The bug this pins: a renderer reload destroys the only publisher of a
// WebContentsView's rectangle without running its React cleanup, so the
// native view kept painting at the pre-reload geometry over the restored
// editor — unmovable, because nothing was left to move it. The plan below is
// what `BrowserManager.reconcileForHostRendererReload()` executes.

import { describe, it, expect } from 'vitest'
import { planHostRendererReloadReconcile, PARKED_WCV_BOUNDS } from './wcv-bounds'

describe('planHostRendererReloadReconcile — BUG-270', () => {
  it('parks every live view, including the aux-pinned one', () => {
    const plan = planHostRendererReloadReconcile({ tabIds: [1, 2, 5], auxTabId: 5 })
    // The aux view's rectangle is exactly as stale as the main pane's — it is
    // the one that was occluding the editor, so it must not be spared.
    expect(plan.park).toEqual([1, 2, 5])
    expect(plan.cachedBounds).toEqual(PARKED_WCV_BOUNDS)
  })

  it('drops the aux pin so main and the fresh renderer agree', () => {
    // BUG-195 ghost signature: `duo tabs` says inAux:true while
    // `duo split-view` says aux:null. Browser-aux is deliberately not
    // persisted, so the reloaded renderer can never re-adopt the pin.
    const plan = planHostRendererReloadReconcile({ tabIds: [1, 5], auxTabId: 5 })
    expect(plan.unpinAux).toBe(5)
  })

  it('reports no pin to drop when nothing was in aux', () => {
    const plan = planHostRendererReloadReconcile({ tabIds: [1, 2], auxTabId: null })
    expect(plan.unpinAux).toBeNull()
    expect(plan.park).toEqual([1, 2])
  })

  it('is a no-op shape on the very first load (no tabs yet)', () => {
    const plan = planHostRendererReloadReconcile({ tabIds: [], auxTabId: null })
    expect(plan.park).toEqual([])
    expect(plan.unpinAux).toBeNull()
  })

  it('parks at 1×1, never 0×0 — the view stays alive but invisible', () => {
    // 0×0 would risk the view being treated as detached by Chromium; 1×1 is
    // the literal both renderer components have always used on unmount, so
    // SSO cookies / audio / in-flight loads survive a reload.
    expect(PARKED_WCV_BOUNDS).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('copies the tab-id list rather than aliasing the caller state', () => {
    const tabIds = [1, 2]
    const plan = planHostRendererReloadReconcile({ tabIds, auxTabId: null })
    tabIds.push(3)
    expect(plan.park).toEqual([1, 2])
  })
})
