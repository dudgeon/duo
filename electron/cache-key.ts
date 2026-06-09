// ENH-191 P3 (seam M1) — the per-window-keyed read-model cache, extracted as a
// pure node-env module (mirrors electron/window-resolve.ts + safe-send.ts) so
// the keying contract is unit-testable without mounting Electron.
//
// Replaces the ~12 identity-free module-global `let`/`const` snapshot caches in
// main.ts (navState, editorSelection, projectsState, themeState, …). Each
// becomes a `WindowKeyedCache<T>` over a private `Map<windowId, T>`: a PUSH
// handler WRITES its window's slot (keyed by `BrowserWindow.fromWebContents(
// event.sender)?.id` — resolved in main.ts, the impure boundary, and passed in
// as a plain number, exactly like resolveBySender(registry, id)); a CLI getter
// READS the default-target window's slot via `getDefault(registry)`.
//
// At N=1 (the registry-of-one, P0–P4) this degenerates to the old global:
// the sole window is the only key, so `getDefault` === `getOrDefault(only().id)`
// === the single stored snapshot (or the seed before any push, reproducing the
// old initializer). The byte-identity is therefore provable until a second
// window can open (P5a).
//
// CARDINAL RULE (spec §2.3): the default-target window resolves by IDENTITY via
// `defaultWindowId` → `registry.primary()` (lowest-id) — NOT by focus. P0–P4
// enforced this by THROWING at N>1 (only()) so a getter that still resolved the
// default (rather than an explicit sender) failed loudly before a 2nd window
// existed; P5a resolves the deterministic lowest-id window instead (still
// identity, never focus). The cold-start guard (`set(undefined, …)` no-ops) mirrors
// the BUG-190 destroyed-guard: a push that arrives before/around window
// registration must not write a bogus slot.

import type { WindowRegistry } from './window-registry'

/**
 * The default-target window id, resolved by IDENTITY (the PRIMARY / lowest-id
 * window). `undefined` when no window is registered yet or after full teardown.
 * P0–P4 used `registry.only()` here, which fail-loud THREW at N>1 — the pre-P5
 * placeholder forcing each read site to become an explicit `event.sender`-keyed
 * read before a 2nd window opened. P5a retires that placeholder: this resolves
 * `registry.primary()` (deterministic lowest-id), kept in lockstep with
 * `resolveDefault` (window-resolve.ts) so `defaultWindowId(reg)` ===
 * `resolveDefault(reg)?.id` — the invariant the eager-write/echo same-slot
 * sites (e.g. setAuthor) depend on. Still IDENTITY, never focus (cardinal §2.3).
 */
export function defaultWindowId(registry: WindowRegistry): number | undefined {
  return registry.primary()?.id
}

/**
 * A per-window-keyed snapshot cache. `T` is the snapshot shape the old
 * module-global held (e.g. `NavStateSnapshot`, `EditorSelectionSnapshot | null`).
 * Seeded by a factory so an unwritten window reads a FRESH default equal to the
 * old initializer (the value is serialized over IPC, so deep-equality — not
 * reference-identity — is what byte-identity requires).
 */
export class WindowKeyedCache<T> {
  private readonly slots = new Map<number, T>()

  constructor(private readonly seed: () => T) {}

  /**
   * WRITER — store `value` as this window's snapshot. A null/undefined
   * `windowId` NO-OPS (cold-start guard): a push that fires before/around
   * window registration must not write an `undefined`-keyed slot. Both `set`
   * and `put` are exposed so every downstream consumer binds cleanly.
   */
  set(windowId: number | undefined, value: T): void {
    if (windowId == null) return
    this.slots.set(windowId, value)
  }

  /** Alias for {@link set}. */
  put(windowId: number | undefined, value: T): void {
    this.set(windowId, value)
  }

  /** Raw read — the stored snapshot for `windowId`, or `undefined` if unwritten. */
  get(windowId: number): T | undefined {
    return this.slots.get(windowId)
  }

  /**
   * READER — `windowId`'s stored snapshot, or a fresh seed when the slot is
   * unwritten (or the id is undefined). Uses `has()` so a legitimately-stored
   * `null` / `false` / `0` snapshot is returned, not masked by the seed.
   */
  getOrDefault(windowId: number | undefined): T {
    if (windowId == null || !this.slots.has(windowId)) return this.seed()
    return this.slots.get(windowId) as T
  }

  /**
   * READER — the default-target window's snapshot (the sole window at N=1).
   * THROWS at N>1 via `defaultWindowId` → `registry.only()`: the fail-loud
   * signal that this read site still needs an explicit `event.sender` key.
   */
  getDefault(registry: WindowRegistry): T {
    return this.getOrDefault(defaultWindowId(registry))
  }

  /** Teardown — drop a closed window's slot so it can't linger past unregister. */
  delete(windowId: number): void {
    this.slots.delete(windowId)
  }

  /** Number of windows with a written slot (test/diagnostic). */
  size(): number {
    return this.slots.size
  }
}
