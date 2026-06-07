// ENH-191 P3 (seam M3) — the addressed ambient-cue router, extracted as a pure
// node-env module (mirrors window-resolve.ts / cache-key.ts) so SocketServer's
// cue routing is unit-testable without mounting Electron and core/socket-server
// stays Electron-free (it learns only an opaque window-id number).
//
// SocketServer pushes two ambient cues through its eventSink that today funnel
// to the sole window via safeSend → so at N>1 they'd always paint in window 1:
//   - `claude:read-selection` — the read-glow (the `duo selection` flash)
//   - `browser:focus-gained` — the `duo open` supplemental focus push
// (the canonical browser:focus-gained emit from browser-manager.ts is already
// per-window-correct via P2's per-window BrowserManager — only the socket-server
// supplemental push used the window-1 path.)
//
// The command emitting a cue already knows which window it addressed; that id is
// threaded here and the cue lands in THAT window via resolveBySender, falling
// back to the sole window (resolveDefault → only()) when the id is absent or
// stale so a cue is never silently dropped at N=1.
//
// CARDINAL RULE (spec §2.3): NEVER getFocusedWindow. The undefined-id fallback
// is the only()-default (which THROWS at N>1 — the fail-loud signal that P5a
// must thread a real addressed window), NOT a focus/first pick. This module is
// outside scripts/check-window-routing.sh's scope (it scans only main.ts), so
// eventsink-route.test.ts pins the no-focus property with a source-grep control.

import type { WindowRegistry } from './window-registry'
import { resolveBySender, resolveDefault } from './window-resolve'

/**
 * Route an ambient cue (`channel`/`payload`) to the addressed window. Falls back
 * to the default-target window (the sole window at N=1) when `windowId` is
 * undefined or names no live window, so a cue addressed to a just-closed window
 * still paints somewhere at N=1 rather than vanishing. A destroyed target is
 * guarded (no send) — the cue is dropped, not redirected.
 */
export function routeAmbientCue(
  registry: WindowRegistry,
  windowId: number | undefined,
  channel: string,
  payload: unknown
): void {
  const win =
    (windowId != null ? resolveBySender(registry, windowId) : undefined) ??
    resolveDefault(registry)
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}
