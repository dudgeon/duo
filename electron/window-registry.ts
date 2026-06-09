// ENH-191 P0 (seam 1) — the registry-of-one spine, extracted as a pure
// node-env module (mirrors electron/safe-send.ts) so the multi-window
// routing contract is unit-testable without mounting Electron.
//
// This replaces the single `let mainWindow` module global in main.ts with a
// `Map<windowId, WindowContext>`. Through P0–P4 the registry holds EXACTLY
// ONE context, so `only()` returns the same sole window `mainWindow` does
// today — making the registry adoption (the 41 main->renderer send sites,
// re-grepped at the P2 baseline) provably byte-identical until a second
// window can open (P5a). P0 shipped the module + harness; P2 wires it into
// main.ts (createWindow registers a context; safeSend + the resolve helpers
// read it).
//
// The cardinal rule (spec §2.3): app-wide default sends resolve by IDENTITY
// — `registry.only()` — never by focus. `only()` THROWS at N>1 rather than
// silently picking the first context, so a missing per-window route can
// never masquerade as working before P5.

import type { WindowLike } from './safe-send'
import type { ActiveWorkspace } from '../shared/types'

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
  /**
   * P3 (item 10) — this window's active-workspace pointer (the source for its
   * title + the WORKSPACE_FILE_ACTIVE_CHANGED badge). Seeded from
   * ActiveWorkspaceService at boot + dual-written at every set/clear. Plain
   * `{path,name}` (zero Electron). Persistence is the P4 envelope's job — the
   * standalone active-workspace.json is a single slot two windows would clobber.
   */
  activeWorkspace?: ActiveWorkspace | null
  /**
   * P3 (item 8) — this window's ClaudePresenceProbe. Kept `unknown` so the
   * registry imports zero Electron/core; main.ts casts it to ClaudePresenceProbe
   * at the use site (the harness fakes it).
   */
  presence?: unknown
  /**
   * P3 (item 8 / S8c) — this window's set of tab ids that have hosted a live
   * Claude process (gates the ENH-183 S3 enrichment). Per-window so the shared
   * PTY pool's same-cwd terminals from other windows can't leak eligibility.
   */
  tabsThatHostedClaude?: Set<string>
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

  /**
   * The PRIMARY context — the deterministic app-wide default target at ANY N
   * (the P5a successor to `only()` for default-resolution). Returns the
   * lowest-id live context (the oldest surviving window), or `undefined` when
   * empty. Resolves by IDENTITY, NEVER by focus (the locked cardinal rule
   * §2.3): the lowest-id pick is stable + reproducible, so a windowId-less CLI
   * command / app-global default send lands in ONE predictable window instead
   * of `only()`'s pre-P5 fail-loud throw. Use `get(id)` for per-window
   * addressing (resolveBySender / DUO_WINDOW) and `all()` for broadcasts.
   */
  primary(): WindowContext | undefined {
    let best: WindowContext | undefined
    for (const ctx of this.contexts.values()) {
      if (best === undefined || ctx.id < best.id) best = ctx
    }
    return best
  }
}
