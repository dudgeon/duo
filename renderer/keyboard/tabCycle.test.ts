// Unit tests for cycleNext — the pure tab-cycle helper that drives
// ⌃Tab / ⌃⇧Tab routing (BUG-001 / BUG-021 / BUG-038 lineage). The
// math has been stable since BUG-021 v3; the recurring failure modes
// (closure staleness, xterm key swallowing) all live in the call
// sites, not here. These tests lock the contract so a future
// "simplification" of cycleNext doesn't accidentally break the
// wrap-around or the -1-idx fallback.

import { describe, it, expect } from 'vitest'
import { cycleNext } from './tabCycle'

const TABS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('cycleNext', () => {
  describe('forward (delta=1)', () => {
    it('a → b', () => expect(cycleNext(TABS, 'a', 1)).toBe('b'))
    it('b → c', () => expect(cycleNext(TABS, 'b', 1)).toBe('c'))
    it('c → a (wrap)', () => expect(cycleNext(TABS, 'c', 1)).toBe('a'))
  })

  describe('backward (delta=-1)', () => {
    it('a → c (wrap)', () => expect(cycleNext(TABS, 'a', -1)).toBe('c'))
    it('b → a', () => expect(cycleNext(TABS, 'b', -1)).toBe('a'))
    it('c → b', () => expect(cycleNext(TABS, 'c', -1)).toBe('b'))
  })

  describe('stale activeTabId fallback (idx === -1)', () => {
    it('forward fallback returns the FIRST tab', () => {
      // Documents the asymmetric fallback: forward steps to the start,
      // backward steps to the end. The mod arithmetic alone would
      // route forward correctly but produce length-2 backward (off by
      // one); cycleNext handles this explicitly.
      expect(cycleNext(TABS, 'unknown-id', 1)).toBe('a')
    })

    it('backward fallback returns the LAST tab', () => {
      expect(cycleNext(TABS, 'unknown-id', -1)).toBe('c')
    })

    it('empty-string id is treated as missing (forward → first)', () => {
      expect(cycleNext(TABS, '', 1)).toBe('a')
    })
  })

  describe('empty / single tab', () => {
    it('empty tabs returns null', () => {
      expect(cycleNext([], 'anything', 1)).toBeNull()
    })

    it('single tab cycles to itself (forward)', () => {
      expect(cycleNext([{ id: 'only' }], 'only', 1)).toBe('only')
    })

    it('single tab cycles to itself (backward)', () => {
      expect(cycleNext([{ id: 'only' }], 'only', -1)).toBe('only')
    })

    it('single tab + stale id falls back to itself', () => {
      expect(cycleNext([{ id: 'only' }], 'unknown', 1)).toBe('only')
    })
  })

  describe('readonly + structural-typing contract', () => {
    it('accepts ReadonlyArray (declared in signature)', () => {
      const ro: ReadonlyArray<{ id: string }> = [{ id: 'x' }, { id: 'y' }]
      expect(cycleNext(ro, 'x', 1)).toBe('y')
    })

    it('accepts objects with extra fields beyond `id` (structural typing)', () => {
      // Real call sites pass TabSession / WorkingTab which have many
      // more fields. cycleNext only reads `.id`; structural typing
      // covers this — locking the contract against accidental
      // narrowing.
      const richTabs = [
        { id: 'a', title: 'A', kind: 'shell' as const, cwd: '/' },
        { id: 'b', title: 'B', kind: 'claude' as const, cwd: '/' }
      ]
      expect(cycleNext(richTabs, 'a', 1)).toBe('b')
    })
  })
})
