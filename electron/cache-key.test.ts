// ENH-191 P3 (seam M1) — pins the per-window-keyed cache contract with the two
// load-bearing negative controls: a mis-keyed read (a constant-key cache that
// ignores the window id) and a focus/first default pick (the cardinal-rule
// foot-gun) must BOTH be unrepresentable. Pure node-env, mirrors
// window-resolve.test.ts (fake WindowLike) + the REAL WindowRegistry.
//
// The describe.each over the 13 PUSH_FAMILIES (mechanical completeness) is
// consolidated in P3-S9-harness; this file pins the primitive M1 ships.

import { describe, it, expect, vi } from 'vitest'
import { WindowRegistry, type WindowContext } from './window-registry'
import { WindowKeyedCache, defaultWindowId } from './cache-key'

function fakeCtx(id: number, opts: { destroyed?: boolean; wcDestroyed?: boolean } = {}): WindowContext {
  return {
    id,
    window: {
      isDestroyed: () => opts.destroyed ?? false,
      webContents: { isDestroyed: () => opts.wcDestroyed ?? false, send: vi.fn() },
    },
  }
}

type Theme = { mode: string; effective: string }
const SEED: () => Theme = () => ({ mode: 'system', effective: 'dark' })

describe('cache-key — WindowKeyedCache<T> (ENH-191 P3 M1)', () => {
  // ---- the byte-identity-at-N=1 happy path -------------------------------
  it('per-window slots: each window reads back its OWN snapshot', () => {
    const c = new WindowKeyedCache<Theme>(SEED)
    c.set(1, { mode: 'dark', effective: 'dark' })
    c.set(2, { mode: 'light', effective: 'light' })
    expect(c.getOrDefault(1)).toEqual({ mode: 'dark', effective: 'dark' })
    expect(c.getOrDefault(2)).toEqual({ mode: 'light', effective: 'light' })
  })

  it('getOrDefault returns a fresh seed for an unwritten window or an undefined id', () => {
    const c = new WindowKeyedCache<Theme>(SEED)
    c.set(1, { mode: 'dark', effective: 'dark' })
    expect(c.getOrDefault(2)).toEqual(SEED())
    expect(c.getOrDefault(undefined)).toEqual(SEED())
  })

  it('the seed factory yields a FRESH object per unwritten read (no shared-mutable aliasing)', () => {
    const c = new WindowKeyedCache<Theme>(SEED)
    const a = c.getOrDefault(2)
    const b = c.getOrDefault(3)
    expect(a).toEqual(b)
    expect(a).not.toBe(b) // distinct objects — mutating one window's default can't leak to another
  })

  it('getDefault at N=1 returns the sole window\'s snapshot (byte-identical to the old global)', () => {
    const reg = new WindowRegistry()
    reg.register(fakeCtx(1))
    const c = new WindowKeyedCache<Theme>(SEED)
    expect(c.getDefault(reg)).toEqual(SEED()) // before any push → the seed (old initializer)
    c.set(defaultWindowId(reg), { mode: 'dark', effective: 'dark' })
    expect(c.getDefault(reg)).toEqual({ mode: 'dark', effective: 'dark' })
  })

  // has()-based read so a legitimately-stored falsy/null snapshot is returned,
  // not masked by the seed (editorSelection/canvasSelection/activeTerminalId
  // are all `… | null`).
  it('a stored null snapshot is returned as null, NOT replaced by the seed', () => {
    const c = new WindowKeyedCache<Theme | null>(() => ({ mode: 'system', effective: 'dark' }))
    c.set(1, null)
    expect(c.getOrDefault(1)).toBeNull()
    expect(c.getOrDefault(2)).toEqual(SEED()) // unwritten still seeds
  })

  // ---- cold-start guard ---------------------------------------------------
  it('set(undefined, …) NO-OPS (cold-start guard) — no bogus slot', () => {
    const c = new WindowKeyedCache<Theme>(SEED)
    c.set(undefined, { mode: 'dark', effective: 'dark' })
    c.put(undefined, { mode: 'light', effective: 'light' })
    expect(c.size()).toBe(0)
  })

  // ---- teardown -----------------------------------------------------------
  it('delete drops a window\'s slot (teardown on close)', () => {
    const c = new WindowKeyedCache<Theme>(SEED)
    c.set(1, { mode: 'dark', effective: 'dark' })
    expect(c.size()).toBe(1)
    c.delete(1)
    expect(c.size()).toBe(0)
    expect(c.getOrDefault(1)).toEqual(SEED()) // back to the seed
  })

  // ---- NEGATIVE CONTROL: a mis-keyed (constant-key) cache --------------
  // A cache whose writes ignore the window id would return window 1's value
  // for window 2 — the exact mis-route P3 must make impossible. WindowKeyedCache
  // keys by id, so a foreign-id read returns the DEFAULT, never another
  // window's snapshot. (A constant-key impl would fail this assertion.)
  it('mis-keyed read is unrepresentable: a foreign id reads the default, never another window\'s value', () => {
    const c = new WindowKeyedCache<Theme>(SEED)
    const V = { mode: 'dark', effective: 'dark' }
    c.set(1, V)
    expect(c.getOrDefault(2)).not.toEqual(V)
    expect(c.getOrDefault(2)).toEqual(SEED())
  })

  // ---- NEGATIVE CONTROL: the cardinal rule (no focus/first pick) -------
  // At N>1 there is no single "the default window", so defaultWindowId/getDefault
  // must THROW (via only()) rather than silently pick the first/focused one.
  it('defaultWindowId THROWS at N>1 — no silent focus/first pick', () => {
    const reg = new WindowRegistry()
    reg.register(fakeCtx(1))
    reg.register(fakeCtx(2))
    expect(() => defaultWindowId(reg)).toThrow(/all\(\) \(broadcast\) or get\(id\)/)
  })

  it('getDefault THROWS at N>1 (inherits only()) rather than reading the wrong slot', () => {
    const reg = new WindowRegistry()
    reg.register(fakeCtx(1))
    reg.register(fakeCtx(2))
    const c = new WindowKeyedCache<Theme>(SEED)
    c.set(1, { mode: 'dark', effective: 'dark' })
    expect(() => c.getDefault(reg)).toThrow()
  })

  it('defaultWindowId is undefined when no window is registered', () => {
    expect(defaultWindowId(new WindowRegistry())).toBeUndefined()
  })
})
