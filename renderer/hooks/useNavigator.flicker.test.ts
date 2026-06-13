// @vitest-environment jsdom
//
// ENH-211 P0 (D1 + D2) — the render-stability regression net for the
// navigator listings cache. The watch/refresh lineage (BUG-007 → ENH-147 →
// BUG-125 → ENH-152c → ENH-211) churned the same delete-then-refetch code
// repeatedly with no invariant test; these pin the two P0 guarantees:
//
//   T1 — stale-while-revalidate (D1): a single file event for a path in the
//        cache NEVER transitions its listing through null/undefined during
//        the refetch. The prior DirEntry[] stays until the new one resolves.
//   T2 — coalesce (D2): N events for the same dir within the 100ms debounce
//        window yield exactly ONE files.list call (beyond the mount load).
//
// Both invariants are asserted for BOTH hooks (project + user-claude), per
// G5 (the fix is symmetric). We assert OBSERVABLE state (the listings Map
// values across renders) — never private refs — so they pin behavior.
//
// T1 GATING (why list() is a controllable deferred, not an instant resolve):
// the refetch null-set (if the SWR guard were absent) and the list() resolve
// that overwrites it both land on the microtask queue. If list() resolved
// instantly, a single `await act()` would flush BOTH inside one React batch,
// collapsing the transient so a sample taken afterward only ever sees the
// final array — the test would pass with OR without the guard (a false
// positive). Instead, the mock hands back a promise the test resolves by
// hand: advance the debounce → ensureListing fires → sample the listing
// WHILE list() is still pending (this is the exact window the reverted code
// shows `null`) → only then resolve. Verified: reintroducing the
// delete/null-before-refetch regression makes T1 FAIL here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { DirEntry } from '@shared/types'
import { useNavigator } from './useNavigator'
import { useUserClaudeNavigator } from './useUserClaudeNavigator'

const CWD = '/tmp/proj'
const HOME = '/tmp/home'
const USER_CLAUDE_ROOT = `${HOME}/.claude`

type WatchCb = (e: { kind: 'added' | 'changed' | 'removed'; path: string }) => void

function dirEntry(name: string, parent: string, kind: 'file' | 'directory' = 'file'): DirEntry {
  return { name, path: `${parent}/${name}`, kind }
}

/** Controllable fake for window.electron.files. Tracks list() calls per path
 *  and lets a test push a synthetic watch event to every registered watcher.
 *
 *  Two resolution modes:
 *   - auto (default): list() resolves on the microtask queue with the dir's
 *     current contents. Used by T2, where only the call COUNT matters.
 *   - gated: list() returns a promise the test resolves by hand
 *     (`resolveNextList` / `resolveAllLists`). Used by T1 so the test can
 *     sample the listing WHILE a refetch is in flight — the exact window the
 *     reverted (delete-before-refetch) code would expose `null`. */
function createNavFilesMock() {
  // What each path's list() resolves with. Mutable so a test can change the
  // "disk" between refetches.
  const dirs = new Map<string, DirEntry[]>()
  const listCalls: string[] = []
  const watchers: { paths: string[]; cb: WatchCb }[] = []

  // When gated, every list() call parks here until the test releases it.
  let gated = false
  const pending: Array<{ path: string; resolve: (entries: DirEntry[]) => void }> = []

  const api = {
    list: vi.fn((p: string): Promise<DirEntry[]> => {
      listCalls.push(p)
      const entries = dirs.get(p) ?? []
      if (!gated) return Promise.resolve(entries)
      return new Promise<DirEntry[]>(resolve => {
        pending.push({ path: p, resolve })
      })
    }),
    exists: vi.fn(async (_p: string) => true),
    dirExists: vi.fn(async (_p: string) => true),
    watch: vi.fn(async (paths: string[], cb: WatchCb) => {
      const w = { paths, cb }
      watchers.push(w)
      return async () => {
        const i = watchers.indexOf(w)
        if (i >= 0) watchers.splice(i, 1)
      }
    }),
  }

  return {
    api,
    listCalls,
    setDir: (p: string, entries: DirEntry[]) => dirs.set(p, entries),
    listCallsFor: (p: string) => listCalls.filter(x => x === p).length,
    /** Switch to gated mode: subsequent list() calls park until released. */
    setGated: (v: boolean) => { gated = v },
    /** Number of list() promises currently parked unresolved. */
    pendingCount: () => pending.length,
    /** Resolve every parked list() with its path's CURRENT dir contents. */
    resolveAllLists: () => {
      const batch = pending.splice(0, pending.length)
      for (const { path, resolve } of batch) resolve(dirs.get(path) ?? [])
    },
    pushChange: (p: string, kind: 'added' | 'changed' | 'removed' = 'changed') => {
      for (const w of watchers) if (w.paths.some(wp => p.startsWith(wp))) w.cb({ kind, path: p })
    },
  }
}

function installWindowElectron(filesApi: unknown) {
  const g = globalThis as unknown as { window?: { electron?: unknown } }
  if (!g.window) (g as { window: unknown }).window = g
  const prev = g.window!.electron
  g.window!.electron = {
    files: filesApi,
    env: { HOME, appVersion: '0.0.0-test', windowId: 1 },
  }
  return () => { g.window!.electron = prev }
}

let restore: () => void
let mock: ReturnType<typeof createNavFilesMock>

beforeEach(() => {
  vi.useFakeTimers()
  mock = createNavFilesMock()
  restore = installWindowElectron(mock.api)
  // Seed a stable listing for both roots so the FIRST load resolves to a
  // non-null array (the baseline the SWR invariant must hold thereafter).
  mock.setDir(CWD, [dirEntry('a.md', CWD), dirEntry('b.md', CWD)])
  mock.setDir(USER_CLAUDE_ROOT, [dirEntry('CLAUDE.md', USER_CLAUDE_ROOT)])
})

afterEach(() => {
  restore()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Resolve the in-flight list() promises (microtasks) inside act(). */
async function flushMicro() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

describe('ENH-211 D1 — stale-while-revalidate (T1)', () => {
  it('project pane: a file event in cwd never transitions listings.get(cwd) through null', async () => {
    const view = renderHook(() => useNavigator(CWD))
    // Let the initial cwd load + watch subscription settle (auto mode).
    await flushMicro()

    const initial = view.result.current.state.listings.get(CWD)
    expect(initial).toEqual([dirEntry('a.md', CWD), dirEntry('b.md', CWD)])

    // From here, GATE list() so the refetch promise stays in flight and we
    // can sample the listing mid-refetch — the exact window the reverted
    // (delete/null-before-refetch) code would expose as `null`.
    mock.setGated(true)

    // The "disk" gains a file; fire ONE event for a file in cwd.
    mock.setDir(CWD, [dirEntry('a.md', CWD), dirEntry('b.md', CWD), dirEntry('c.md', CWD)])
    act(() => { mock.pushChange(`${CWD}/c.md`, 'added') })

    // Advance the debounce (synchronous act, NOT awaited) so ensureListing
    // runs and calls list() — which now parks unresolved. Any null-set that
    // a non-SWR implementation does would be committed by this point.
    act(() => { vi.advanceTimersByTime(100) })
    expect(mock.pendingCount()).toBeGreaterThanOrEqual(1) // refetch is genuinely in flight

    // INVARIANT (the whole point of T1): mid-refetch the listing is STILL the
    // prior array, never null/undefined. Under the regression this is `null`.
    const inFlight = view.result.current.state.listings.get(CWD)
    expect(inFlight).toEqual([dirEntry('a.md', CWD), dirEntry('b.md', CWD)])

    // Now release the refetch and confirm it overwrites with the new disk.
    await act(async () => { mock.resolveAllLists(); await Promise.resolve() })
    expect(view.result.current.state.listings.get(CWD)).toEqual([
      dirEntry('a.md', CWD), dirEntry('b.md', CWD), dirEntry('c.md', CWD),
    ])
  })

  it('user-claude pane: a file event never transitions listings.get(root) through null', async () => {
    const view = renderHook(() => useUserClaudeNavigator(HOME))
    await flushMicro()

    const initial = view.result.current.state.listings.get(USER_CLAUDE_ROOT)
    expect(initial).toEqual([dirEntry('CLAUDE.md', USER_CLAUDE_ROOT)])

    mock.setGated(true)

    mock.setDir(USER_CLAUDE_ROOT, [
      dirEntry('CLAUDE.md', USER_CLAUDE_ROOT), dirEntry('settings.json', USER_CLAUDE_ROOT),
    ])
    act(() => { mock.pushChange(`${USER_CLAUDE_ROOT}/settings.json`, 'added') })

    act(() => { vi.advanceTimersByTime(100) })
    expect(mock.pendingCount()).toBeGreaterThanOrEqual(1)

    const inFlight = view.result.current.state.listings.get(USER_CLAUDE_ROOT)
    expect(inFlight).toEqual([dirEntry('CLAUDE.md', USER_CLAUDE_ROOT)])

    await act(async () => { mock.resolveAllLists(); await Promise.resolve() })
    expect(view.result.current.state.listings.get(USER_CLAUDE_ROOT)).toEqual([
      dirEntry('CLAUDE.md', USER_CLAUDE_ROOT), dirEntry('settings.json', USER_CLAUDE_ROOT),
    ])
  })
})

describe('ENH-211 D2 — coalesce/debounce (T2)', () => {
  it('project pane: N events for the same dir within the window → one extra files.list', async () => {
    const view = renderHook(() => useNavigator(CWD))
    await flushMicro()

    const before = mock.listCallsFor(CWD)
    expect(before).toBeGreaterThanOrEqual(1) // mount load (+ resubscribe catch-up)

    // Fire several events for files in cwd, all inside the 100ms window.
    act(() => {
      mock.pushChange(`${CWD}/x1.md`, 'changed')
      mock.pushChange(`${CWD}/x2.md`, 'changed')
      mock.pushChange(`${CWD}/x3.md`, 'changed')
      mock.pushChange(`${CWD}/x4.md`, 'changed')
    })
    // Nothing should have re-listed yet (trailing-edge debounce).
    expect(mock.listCallsFor(CWD)).toBe(before)

    await act(async () => { vi.advanceTimersByTime(100) })
    await flushMicro()

    // Exactly ONE refetch resulted from the burst.
    expect(mock.listCallsFor(CWD)).toBe(before + 1)
    view.unmount()
  })

  it('user-claude pane: N events for the same dir within the window → one extra files.list', async () => {
    const view = renderHook(() => useUserClaudeNavigator(HOME))
    await flushMicro()

    const before = mock.listCallsFor(USER_CLAUDE_ROOT)
    expect(before).toBeGreaterThanOrEqual(1)

    act(() => {
      mock.pushChange(`${USER_CLAUDE_ROOT}/a.json`, 'changed')
      mock.pushChange(`${USER_CLAUDE_ROOT}/b.json`, 'changed')
      mock.pushChange(`${USER_CLAUDE_ROOT}/c.json`, 'changed')
    })
    expect(mock.listCallsFor(USER_CLAUDE_ROOT)).toBe(before)

    await act(async () => { vi.advanceTimersByTime(100) })
    await flushMicro()

    expect(mock.listCallsFor(USER_CLAUDE_ROOT)).toBe(before + 1)
    view.unmount()
  })
})
