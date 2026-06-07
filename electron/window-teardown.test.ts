// ENH-191 P0 (seam 2) — pins the teardown-once invariants (H5). The two
// negative controls are load-bearing: a missing app-once guard double-stops
// the socket (the closed→before-quit quit-loop class), and a skipped dispose
// leaks a window. Pure node-env, mirrors safe-send.test.ts.

import { describe, it, expect, vi } from 'vitest'
import { makeWindowTeardown } from './window-teardown'

function fakes() {
  return {
    detach: vi.fn(),
    disposeBrowser: vi.fn(),
    stopSocket: vi.fn(),
    disposeExternal: vi.fn()
  }
}

function perWindow(f: ReturnType<typeof fakes>) {
  return { cdpBridge: { detach: f.detach }, browserManager: { dispose: f.disposeBrowser } }
}

function appServices(f: ReturnType<typeof fakes>) {
  return { socket: { stop: f.stopSocket }, external: { dispose: f.disposeExternal } }
}

describe('window-teardown — per-window vs app teardown (ENH-191 P0)', () => {
  it('teardownWindow detaches cdp then disposes the browser manager, once', () => {
    const f = fakes()
    const t = makeWindowTeardown()
    t.teardownWindow(1, perWindow(f))
    expect(f.detach).toHaveBeenCalledTimes(1)
    expect(f.disposeBrowser).toHaveBeenCalledTimes(1)
  })

  it('teardownWindow is idempotent per window (a re-close no-ops)', () => {
    const f = fakes()
    const t = makeWindowTeardown()
    t.teardownWindow(1, perWindow(f))
    t.teardownWindow(1, perWindow(f))
    expect(f.detach).toHaveBeenCalledTimes(1)
    expect(f.disposeBrowser).toHaveBeenCalledTimes(1)
  })

  it('teardownApp stops socket + disposes external exactly once (H5)', () => {
    const f = fakes()
    const t = makeWindowTeardown()
    t.teardownApp(appServices(f))
    expect(f.stopSocket).toHaveBeenCalledTimes(1)
    expect(f.disposeExternal).toHaveBeenCalledTimes(1)
  })

  // NEGATIVE CONTROL (double-dispose / the quit-loop class): a last-window
  // `closed` followed by `before-quit` must NOT double-stop the socket.
  // Remove the `appTornDown` guard in window-teardown.ts and this goes red.
  it('teardownApp is idempotent — closed THEN before-quit does not double-stop', () => {
    const f = fakes()
    const t = makeWindowTeardown()
    t.teardownApp(appServices(f)) // last-window close
    t.teardownApp(appServices(f)) // before-quit
    expect(f.stopSocket).toHaveBeenCalledTimes(1)
    expect(f.disposeExternal).toHaveBeenCalledTimes(1)
  })

  // NEGATIVE CONTROL (missed-dispose): the full last/only-window teardown
  // must fire EVERY effect at least once. A variant that skips any one
  // (e.g. forgets external.dispose) trips one of these.
  it('last/only window: window + app teardown fire every effect (no missed dispose)', () => {
    const f = fakes()
    const t = makeWindowTeardown()
    t.teardownWindow(1, perWindow(f))
    t.teardownApp(appServices(f)) // isLastWindow → app teardown too
    expect(f.detach).toHaveBeenCalled()
    expect(f.disposeBrowser).toHaveBeenCalled()
    expect(f.stopSocket).toHaveBeenCalled()
    expect(f.disposeExternal).toHaveBeenCalled()
  })

  it('a non-last window close does NOT stop app services', () => {
    const f = fakes()
    const t = makeWindowTeardown()
    // P1's split handler calls teardownWindow always, teardownApp only on
    // last-window/before-quit. Closing a non-last window must leave the
    // shared socket + external-domains service running.
    t.teardownWindow(2, perWindow(f))
    expect(f.stopSocket).not.toHaveBeenCalled()
    expect(f.disposeExternal).not.toHaveBeenCalled()
  })

  // ENH-191 P1 dock-reopen regression (the gap the v2 adversary flagged —
  // there was previously NO activate/reopen/reset case here). On macOS,
  // closing the only window does NOT quit; the user dock-reopens via
  // app.on('activate') → createWindow(). Because the socket is app-lifetime
  // (constructed once in whenReady, stopped ONLY in before-quit), window
  // closes must NEVER touch it — otherwise the CLI bridge dies after the
  // first close and the reopened window has no socket. This pins THAT model:
  // app teardown is quit-only; any number of window closes leave it running.
  it('app-lifetime socket: window closes never stop app services; only before-quit does (dock-reopen safe)', () => {
    const f = fakes()
    const t = makeWindowTeardown()
    t.teardownWindow(1, perWindow(f)) // close the only window (red light)
    expect(f.stopSocket).not.toHaveBeenCalled() // socket stays UP for dock-reopen
    t.teardownWindow(2, perWindow(f)) // reopen (new id) then close again
    expect(f.stopSocket).not.toHaveBeenCalled() // still UP across the cycle
    t.teardownApp(appServices(f)) // before-quit — the ONLY app teardown
    expect(f.stopSocket).toHaveBeenCalledTimes(1)
    expect(f.disposeExternal).toHaveBeenCalledTimes(1)
  })

  it('no-ops cleanly when optional resources/services are absent', () => {
    const t = makeWindowTeardown()
    expect(() => t.teardownWindow(1, {})).not.toThrow()
    expect(() => t.teardownApp({})).not.toThrow()
  })
})
