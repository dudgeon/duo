// ENH-191 P0 (seam 1) — the registry-of-one spine, extracted as a pure
// node-env module (mirrors electron/safe-send.ts) so the multi-window
// routing contract is unit-testable without mounting Electron.
//
// This replaces the single `let mainWindow` module global in main.ts with a
// `Map<windowId, WindowContext>`. Through P0–P4 the registry holds EXACTLY
// ONE context, so `only()` returns the same sole window `mainWindow` does
// today — making the 134-site refactor provably byte-identical until a
// second window can open (P5a). NOT wired into main.ts yet: P0 ships the
// module + harness only; P2 adopts it.
//
// The cardinal rule (spec §2.3): app-wide default sends resolve by IDENTITY
// — `registry.only()` — never by focus. `only()` THROWS at N>1 rather than
// silently picking the first context, so a missing per-window route can
// never masquerade as working before P5.

import type { WindowLike } from './safe-send'

/** A guarded send bound to one window (the BUG-190 shape from safe-send.ts). */
export type SafeSend = (channel: string, payload?: unknown) => void

/**
 * All per-window resources, keyed by `id` in the registry. `id` + `window`
 * are set at construction; the remaining fields are populated as later
 * phases relocate per-window resources off main.ts module globals (P2:
 * browserManager / cdpBridge / safeSend). Kept optional + structurally
 * typed so this module imports zero Electron — the harness fakes them.
 */
export interface WindowContext {
  /** The window's id (BrowserWindow.id at wiring time). */
  readonly id: number
  readonly window: WindowLike
  /** P2 — this window's BrowserManager (WebContentsView owner). */
  browserManager?: unknown
  /** P2 — this window's CdpBridge (DevTools Protocol). */
  cdpBridge?: unknown
  /** P2 — this window's BUG-190-guarded send. */
  safeSend?: SafeSend
}

/**
 * O(1) registry of `WindowContext`s. Resolution helpers:
 *   - `only()`  — the sole context (app-wide default-send target through P4).
 *   - `get(id)` — a specific context (the `event.sender` → context path, P3).
 *   - `all()`   — every context (the shared-state broadcast target, P2 item 10).
 */
export class WindowRegistry {
  private readonly contexts = new Map<number, WindowContext>()

  /** Add (or replace) a context by its id. */
  register(ctx: WindowContext): void {
    this.contexts.set(ctx.id, ctx)
  }

  /** Remove a context by id; no-op if absent. */
  unregister(id: number): void {
    this.contexts.delete(id)
  }

  /** A specific context by id, or undefined. */
  get(id: number): WindowContext | undefined {
    return this.contexts.get(id)
  }

  /** Every registered context, in insertion order. */
  all(): WindowContext[] {
    return [...this.contexts.values()]
  }

  /** Number of registered windows. */
  count(): number {
    return this.contexts.size
  }

  /**
   * The sole context — the app-wide default-send target through P0–P4.
   * Returns `undefined` when empty (no window yet / fully torn down).
   * THROWS when more than one window is registered: at N>1 there is no
   * single "the window", and silently returning the first would route
   * app-wide sends to an arbitrary window — the exact silent foot-gun the
   * registry-of-one invariant exists to prevent. Callers that legitimately
   * target every window use `all()`; targeted sends use `get(id)`.
   */
  only(): WindowContext | undefined {
    if (this.contexts.size > 1) {
      throw new Error(
        `WindowRegistry.only() called with ${this.contexts.size} windows — ` +
          'resolve app-wide sends via all() (broadcast) or get(id) (targeted) once N>1.'
      )
    }
    for (const ctx of this.contexts.values()) return ctx
    return undefined
  }
}
