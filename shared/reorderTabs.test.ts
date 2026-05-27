// ENH-188 — terminal-tab reorder transform tests.
//
// Pins the insert-before/after semantics + the hidden-slot re-threading
// invariant (the bit that's more subtle than the canvas WorkingPane
// version: under ENH-182 project focus the visible strip is a subset,
// and reordering it must not disturb hidden tabs' absolute positions).

import { describe, expect, it } from 'vitest'
import { reorderVisible } from './reorderTabs'

type Tab = { id: string }
const tabs = (...ids: string[]): Tab[] => ids.map(id => ({ id }))
const ids = (list: Tab[]) => list.map(t => t.id)
const allVisible = () => true

describe('reorderVisible — no focus (all visible)', () => {
  it('drag rightward inserts AFTER the target (A→C)', () => {
    expect(ids(reorderVisible(tabs('A', 'B', 'C', 'D'), 'A', 'C', allVisible)))
      .toEqual(['B', 'C', 'A', 'D'])
  })

  it('drag leftward inserts BEFORE the target (D→B)', () => {
    expect(ids(reorderVisible(tabs('A', 'B', 'C', 'D'), 'D', 'B', allVisible)))
      .toEqual(['A', 'D', 'B', 'C'])
  })

  it('adjacent move-left (B→A) swaps the pair', () => {
    expect(ids(reorderVisible(tabs('A', 'B', 'C', 'D'), 'B', 'A', allVisible)))
      .toEqual(['B', 'A', 'C', 'D'])
  })

  it('adjacent move-right (B→C) swaps the pair', () => {
    expect(ids(reorderVisible(tabs('A', 'B', 'C', 'D'), 'B', 'C', allVisible)))
      .toEqual(['A', 'C', 'B', 'D'])
  })
})

describe('reorderVisible — under project focus (hidden tabs preserved)', () => {
  // A and D belong to other projects (hidden); only B and C are in the
  // focused strip.
  const visibleSet = new Set(['B', 'C'])
  const isVisible = (t: Tab) => visibleSet.has(t.id)

  it('reordering visible tabs keeps hidden tabs in their absolute slots', () => {
    expect(ids(reorderVisible(tabs('A', 'B', 'C', 'D'), 'B', 'C', isVisible)))
      .toEqual(['A', 'C', 'B', 'D'])
  })

  it('a hidden tab interleaved between visible tabs keeps its absolute slot', () => {
    // Full array [A, B, C, D, E]; visible strip is B, C, E. Note D is
    // HIDDEN but sits at absolute slot 3 — between visible C (slot 2)
    // and visible E (slot 4). Drag E→B reorders the visible subsequence
    // to [E, B, C], which threads back into the visible slots (1, 2, 4);
    // hidden A (slot 0) and D (slot 3) stay exactly where they were.
    const visible2 = new Set(['B', 'C', 'E'])
    const vis2 = (t: Tab) => visible2.has(t.id)
    expect(ids(reorderVisible(tabs('A', 'B', 'C', 'D', 'E'), 'E', 'B', vis2)))
      .toEqual(['A', 'E', 'B', 'D', 'C'])
  })
})

describe('reorderVisible — no-ops return the original reference', () => {
  it('self-drop is a no-op', () => {
    const input = tabs('A', 'B', 'C')
    expect(reorderVisible(input, 'B', 'B', allVisible)).toBe(input)
  })

  it('unknown source id is a no-op', () => {
    const input = tabs('A', 'B', 'C')
    expect(reorderVisible(input, 'Z', 'B', allVisible)).toBe(input)
  })

  it('target not visible is a no-op', () => {
    const input = tabs('A', 'B', 'C')
    const isVisible = (t: Tab) => t.id !== 'C'
    expect(reorderVisible(input, 'A', 'C', isVisible)).toBe(input)
  })
})
