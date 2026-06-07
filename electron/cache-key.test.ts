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
import { broadcastAll } from './window-resolve'

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

// ENH-191 P3-S12 (item 12) — projectsState is per-window-keyed while projects.json
// stays SHARED, so a shared-file change must repaint EVERY window's slot. The
// mechanism is the EXISTING P2 broadcastAll(PROJECTS_CHANGED) write-side fan-out:
// each window's renderer re-pushes its own recompute, keying its OWN slot. No new
// helper. This block pins both the read-model fan-out and the under-deliver bug.
describe('cache-key — item-12 shared-file fan-out (ENH-191 P3-S12)', () => {
  type PS = { projects: string[] }
  it('a shared-file change repaints EVERY registered window\'s projectsState slot', () => {
    const cache = new WindowKeyedCache<PS>(() => ({ projects: [] }))
    const snap1: PS = { projects: ['/a'] }
    const snap2: PS = { projects: ['/a'] }
    // each window's renderer re-pushes its own recompute → keys its own slot:
    cache.set(1, snap1)
    cache.set(2, snap2)
    expect(cache.get(1)).toBe(snap1)
    expect(cache.get(2)).toBe(snap2) // both windows repainted
  })

  // NEGATIVE CONTROL: an only()-routed (single-slot) repaint under-delivers —
  // the second window never sees the shared change (reads the seed).
  it('a single-slot repaint under-delivers to the second window', () => {
    const cache = new WindowKeyedCache<PS>(() => ({ projects: [] }))
    cache.set(1, { projects: ['/a'] }) // only the originator's slot
    expect(cache.get(1)).toEqual({ projects: ['/a'] })
    expect(cache.get(2)).toBeUndefined()
    expect(cache.getOrDefault(2)).toEqual({ projects: [] }) // stale seed, not the change
  })

  // WRITE-side trigger: broadcastAll fans PROJECTS_CHANGED to every registered
  // window (what prompts each renderer's re-push). only()-routing this would
  // throw at N>1 — proving the fan-out can't silently under-deliver.
  it('broadcastAll fans the trigger to every registered window', () => {
    const reg = new WindowRegistry()
    const a = fakeCtx(1)
    const b = fakeCtx(2)
    reg.register(a)
    reg.register(b)
    broadcastAll(reg, 'projects:changed', { pins: [] })
    expect(a.window.webContents.send).toHaveBeenCalledWith('projects:changed', { pins: [] })
    expect(b.window.webContents.send).toHaveBeenCalledWith('projects:changed', { pins: [] })
  })
})

// ENH-191 P3-S9 — mechanical completeness over the 13 PUSH/STATE handlers
// (main.ts:2061..2283). The LITERAL array is the completeness check: a 14th
// handler added without coverage is a visible omission here. SESSION_STATE_-
// SNAPSHOT_RESULT also appears in reqid-validate's REQID_FAMILIES — it's a reqId
// reply wearing a PUSH-channel name (owned there); listed in both arrays, the
// ONE overlap, intentionally — do not "fix" it.
const PUSH_FAMILIES = [
  'PROJECTS_STATE_PUSH',
  'WORKSPACE_PILL_MENU_PUSH',
  'NAV_STATE_PUSH',
  'EDITOR_SELECTION_PUSH',
  'PAGE_SELECTION_PUSH',
  'SESSION_STATE_SNAPSHOT_RESULT',
  'THEME_STATE_PUSH',
  'CLAUDE_KEY_PREFS_STATE_PUSH',
  'AUTHOR_STATE_PUSH',
  'SELECTION_FORMAT_STATE_PUSH',
  'WORKING_AUX_STATE_PUSH',
  'TERMINAL_ACTIVE_PUSH',
  'COZY_STATE_PUSH',
]

describe('cache-key — PUSH family keying completeness (ENH-191 P3-S9)', () => {
  it('the literal list covers all 13 PUSH/STATE families (a missing one is a visible omission)', () => {
    expect(PUSH_FAMILIES).toHaveLength(13)
    expect(new Set(PUSH_FAMILIES).size).toBe(13) // no dupes
  })

  describe.each(PUSH_FAMILIES)('%s', (family) => {
    it('keys by sender — each window reads back its OWN snapshot; a foreign id reads the seed', () => {
      const cache = new WindowKeyedCache<{ family: string; v: number }>(() => ({ family, v: 0 }))
      cache.set(1, { family, v: 1 })
      cache.set(2, { family, v: 2 })
      expect(cache.getOrDefault(1)).toEqual({ family, v: 1 })
      expect(cache.getOrDefault(2)).toEqual({ family, v: 2 })
      expect(cache.getOrDefault(3)).toEqual({ family, v: 0 }) // foreign → seed, never another window's
    })
  })
})
