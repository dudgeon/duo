// ENH-191 P4 (seam 2) — pins the per-window prune-isolation contract: a prune
// scoped to window A's tabs cannot delete window B's entries. The load-bearing
// negative control is the C13 shape — one SHARED map pruned against only one
// window's live ids, which deletes the other window's data.

import { describe, it, expect } from 'vitest'
import { pruneByTab } from './perTabPrune'

describe('perTabPrune — pruneByTab (ENH-191 P4 seam 2)', () => {
  it('keeps live tab entries, drops dead ones, never mutates the input', () => {
    const input = { a: true, b: false, c: true }
    const out = pruneByTab(input, ['a', 'c'])
    expect(out).toEqual({ a: true, c: true })
    expect(input).toEqual({ a: true, b: false, c: true }) // unchanged
  })

  it('accepts a Set or any iterable of live ids', () => {
    expect(pruneByTab({ a: 1, b: 2 }, new Set(['b']))).toEqual({ b: 2 })
    expect(pruneByTab({ a: 1, b: 2 }, ['a'])).toEqual({ a: 1 })
  })

  it('preserves falsy per-tab values (false / 0) for live tabs', () => {
    expect(pruneByTab({ a: false, b: 0 } as Record<string, unknown>, ['a', 'b'])).toEqual({ a: false, b: 0 })
  })

  // PRUNE-ISOLATION (the C13 fix): when each window owns its OWN byTab map,
  // window A pruning its map against A's live ids leaves window B's map intact.
  it('per-window maps: pruning window A cannot touch window B\'s entries', () => {
    const winA = { 'A-tab1': true, 'A-tab2': true }
    const winB = { 'B-tab1': true }
    const prunedA = pruneByTab(winA, ['A-tab1']) // A closed A-tab2
    expect(prunedA).toEqual({ 'A-tab1': true })
    expect(winB).toEqual({ 'B-tab1': true }) // B's separate map untouched
  })

  // NEGATIVE CONTROL: the C13 bug — ONE shared map pruned against only window
  // A's live ids silently deletes window B's still-live entry.
  it('a SHARED map pruned against one window\'s live ids deletes the other window\'s data (C13)', () => {
    const shared = { 'A-tab1': true, 'B-tab1': true } // both windows in one map
    const liveInWindowA = ['A-tab1'] // window A only knows its own tabs
    const pruned = pruneByTab(shared, liveInWindowA)
    expect(pruned['B-tab1']).toBeUndefined() // window B's entry WRONGLY deleted
    expect(pruned).toEqual({ 'A-tab1': true })
  })
})
