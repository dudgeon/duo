// ENH-191 P0 (seam 2) — teardown orchestrator, extracted pure (mirrors
// safe-send.ts) so the teardown-once / no-double-stop invariants are
// unit-testable without Electron.
//
// Before P1, main.ts's single `closed` handler tore down BOTH the closing
// window's per-window resources AND the app-scoped singletons (socket,
// external-domains) on ANY close. P1 split that into:
//   - teardownWindow(id, res)  — on EVERY window close (cdp.detach +
//       browserManager.dispose), idempotent per window id.
//   - teardownApp(services)    — app-scoped stop (socket.stop +
//       external.dispose), called ONLY from before-quit. The wired `closed`
//       handler NEVER calls it: on macOS a last-window-close is NOT a quit
//       (window-all-closed no-ops; the user dock-reopens via app.activate →
//       createWindow), so the socket must stay UP across a window close.
//
// This module guarantees the two safety properties the BUG-190 quit-loop
// class depends on:
//   1. per-window teardown is idempotent per window (a stray second close
//      can't double-dispose), and
//   2. app teardown runs EXACTLY ONCE across the lifecycle — the appTornDown
//      latch makes a second teardownApp call a no-op (order-independent),
//      defending a hypothetical re-entry such as a non-darwin
//      window-all-closed→quit that also reaches it.
// Wired into main.ts at P1: closed handler → teardownWindow; before-quit →
// teardownApp.

/** The closing window's per-window resources (duck-typed; the real
 *  BrowserManager / CdpBridge land in P2). Both optional so the orchestrator
 *  no-ops cleanly on a window that never got them. */
export interface PerWindowResources {
  browserManager?: { dispose(): void }
  cdpBridge?: { detach(): void }
}

/** App-scoped singletons, stopped only on last-window-close / before-quit. */
export interface AppServices {
  socket?: { stop(): void }
  external?: { dispose(): void }
}

export interface WindowTeardown {
  /** Dispose one window's per-window resources. Idempotent per window id. */
  teardownWindow(id: number, res: PerWindowResources): void
  /** Stop app-scoped services. Runs EXACTLY ONCE for the whole app
   *  lifecycle (guards the closed→before-quit double-stop). */
  teardownApp(services: AppServices): void
}

/**
 * Build a teardown orchestrator with the per-window + app-once guards.
 * One instance per app (holds the lifecycle's teardown state), the same
 * way `makeSafeSend` returns a closure over the live window.
 */
export function makeWindowTeardown(): WindowTeardown {
  const tornDownWindows = new Set<number>()
  let appTornDown = false

  return {
    teardownWindow(id, res) {
      if (tornDownWindows.has(id)) return // idempotent: a re-close no-ops
      tornDownWindows.add(id)
      // Detach the CDP debugger BEFORE disposing the manager — an
      // in-flight CDP event during disposal would otherwise fire against a
      // half-torn-down WebContentsView (mirrors main.ts ordering).
      res.cdpBridge?.detach()
      res.browserManager?.dispose()
    },

    teardownApp(services) {
      if (appTornDown) return // EXACTLY ONCE — closed→before-quit can't double-stop
      appTornDown = true
      services.socket?.stop()
      services.external?.dispose()
    }
  }
}
