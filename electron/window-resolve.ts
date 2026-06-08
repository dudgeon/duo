// ENH-191 P2 (seam 1) — the single resolution seam between the
// WindowRegistry and every main→renderer send, extracted as a pure node-env
// module (mirrors electron/safe-send.ts + electron/window-registry.ts) so the
// taxonomy is unit-testable without mounting Electron.
//
// The three verbs map onto the send taxonomy (spec §3.1). At N=1 all three
// collapse — only() === all()[0] === the old mainWindow — so adopting them is
// byte-identical until a second window can open (P5a):
//   - resolveDefault → registry.primary() (class i, app-wide-single, lowest-id)
//   - resolveBySender → registry.get(id) (class iii, per-window-addressed)
//   - resolveAll / broadcastAll → registry.all() (class ii, shared-state
//       broadcast — the projects.json / nav-pins.json / external-domains
//       fan-out that must repaint EVERY window's rail, not just the originator)
//
// CARDINAL RULE (spec §2.3): app-wide default sends resolve by IDENTITY via
// resolveDefault → registry.primary() (the lowest-id window). There is
// deliberately NO focus-based resolver in this module — a focus-resolved
// default send is the exact foot-gun the registry-of-one invariant exists to
// make unrepresentable. P0–P4 enforced this by THROWING at N>1 (only()); P5a
// resolves the deterministic lowest-id window instead (still identity, never
// focus). The grep-gate (scripts/check-window-routing.sh) keeps any
// getFocusedWindow/getFocusedWebContents default-resolution from creeping in.

import type { WindowLike } from './safe-send'
import type { WindowRegistry, WindowContext } from './window-registry'

/**
 * Class (i) — the app-wide-single default-send target, resolved by IDENTITY.
 * Returns the PRIMARY (lowest-id) live window; `undefined` only when no window
 * exists yet or after full teardown. P0–P4 used `registry.only()` here, which
 * fail-loud THREW at N>1 — the pre-P5 placeholder that forced every send site
 * to be categorized (broadcast vs per-window vs default) before a 2nd window
 * could open. P5a retires that placeholder (the categorization is done): this
 * now resolves `registry.primary()`, the deterministic lowest-id window. Still
 * resolved by IDENTITY, NEVER by focus (the locked cardinal rule §2.3) — the
 * lowest-id pick is reproducible, so a windowId-less default send / CLI command
 * lands in one predictable window. Per-window addressing is `get(id)`
 * (resolveBySender / DUO_WINDOW); shared-state broadcasts are `broadcastAll`.
 */
export function resolveDefault(registry: WindowRegistry): WindowLike | undefined {
  return registry.primary()?.window
}

/**
 * Class (iii) — the per-window-addressed reply target. Callers map the IPC
 * `event.sender` (a WebContents) to its owning window id via
 * `BrowserWindow.fromWebContents(event.sender)?.id` (kept OUT of this pure
 * module so it imports zero Electron) and pass that id here. The canonical
 * live exemplar is `FilesService.startWatch`'s `event.sender` routing in
 * main.ts. Full cache-keying by sender lands in P3; P2 only ships the seam.
 */
export function resolveBySender(registry: WindowRegistry, windowId: number): WindowLike | undefined {
  return registry.get(windowId)?.window
}

/**
 * Class (ii) — every LIVE window, with the BUG-190 destroyed-guard applied so
 * a closed/destroyed window can never throw mid-fan-out and abort the rest.
 * The shared-state-broadcast target.
 */
export function resolveAll(registry: WindowRegistry): WindowLike[] {
  return registry
    .all()
    .map((c: WindowContext) => c.window)
    .filter((w) => !w.isDestroyed() && !w.webContents.isDestroyed())
}

/**
 * Guarded class-(ii) fan-out: send `channel`/`payload` to EVERY live window.
 * At N=1 this is byte-identical to the old single `mainWindow.webContents.send`;
 * at N>1 it repaints every window's rail (the projects/nav-pins/external
 * broadcasts). Use this — never `resolveDefault` — for a shared-state change.
 */
export function broadcastAll(registry: WindowRegistry, channel: string, payload?: unknown): void {
  for (const w of resolveAll(registry)) w.webContents.send(channel, payload)
}
