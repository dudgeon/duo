// ENH-191 P0 (seam 2) — teardown orchestrator, extracted pure (mirrors
// safe-send.ts) so the teardown-once / no-double-stop invariants are
// unit-testable without Electron.
//
// Today main.ts's single `closed` handler tears down BOTH the closing
// window's per-window resources AND the app-scoped singletons (socket,
// external-domains) on ANY close. Under multi-window that's wrong: closing
// one of two windows must NOT stop the shared socket. P1 splits the handler
// to call:
//   - teardownWindow(id, res)  — ALWAYS, for the closing window.
//   - teardownApp(services)    — ONLY on last-window-close OR before-quit.
//
// This module guarantees the two safety properties that the BUG-190
// quit-loop class depends on:
//   1. per-window teardown is idempotent per window (a stray second close
//      can't double-dispose), and
//   2. app teardown runs EXACTLY ONCE across the lifecycle — a `closed` of
//      the last window followed by `before-quit` must not double-stop the
//      socket.
// NOT wired into main.ts yet — P0 ships the module + harness; P1 wires it.

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
