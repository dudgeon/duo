// ENH-041 / BUG-270 — the one aux-ratio clamp shared by the divider drag,
// the WORKING_AUX_RESIZE subscriber and `duo split-view resize`.

import { describe, it, expect } from 'vitest'
import {
  clampAuxSplitFraction,
  clampAuxSplitPct,
  AUX_SPLIT_MIN,
  AUX_SPLIT_MAX,
  AUX_SPLIT_EVEN
} from './split-view'

describe('clampAuxSplitFraction — the divider-drag / IPC form', () => {
  it('passes an in-range fraction through', () => {
    expect(clampAuxSplitFraction(0.35)).toBe(0.35)
  })

  it('clamps a drag past the pane edge to the MAX aux width, not the min', () => {
    // A drag left of the working pane's left edge computes (right - x) / width
    // > 1. Re-reading that as a percentage (1.1 → 0.011) would snap the aux
    // column to its minimum — the opposite of the gesture.
    expect(clampAuxSplitFraction(1.1)).toBe(AUX_SPLIT_MAX)
    expect(clampAuxSplitFraction(3)).toBe(AUX_SPLIT_MAX)
  })

  it('clamps a drag past the right edge to the MIN aux width', () => {
    expect(clampAuxSplitFraction(-0.4)).toBe(AUX_SPLIT_MIN)
  })

  it('falls back to even on a non-finite fraction (zero-width container)', () => {
    expect(clampAuxSplitFraction(NaN)).toBe(AUX_SPLIT_EVEN)
    expect(clampAuxSplitFraction(Infinity)).toBe(AUX_SPLIT_EVEN)
  })
})

describe('clampAuxSplitPct — ENH-041 § 7 / BUG-270', () => {
  it('passes an in-range decimal through untouched', () => {
    expect(clampAuxSplitPct(0.35)).toBe(0.35)
    expect(clampAuxSplitPct(AUX_SPLIT_EVEN)).toBe(0.5)
  })

  it('clamps to the locked [0.20, 0.80] range', () => {
    expect(clampAuxSplitPct(0.01)).toBe(AUX_SPLIT_MIN)
    expect(clampAuxSplitPct(0.99)).toBe(AUX_SPLIT_MAX)
    expect(clampAuxSplitPct(-4)).toBe(AUX_SPLIT_MIN)
  })

  it('reads anything above 1 as a percentage (CLI convenience)', () => {
    expect(clampAuxSplitPct(35)).toBeCloseTo(0.35, 10)
    expect(clampAuxSplitPct(50)).toBe(0.5)
    expect(clampAuxSplitPct(95)).toBe(AUX_SPLIT_MAX)
  })

  it('falls back to even on a non-finite value instead of poisoning the layout', () => {
    // splitPct feeds a CSS flex-grow on BOTH columns: a NaN (or a negative
    // `1 - pct` from an out-of-range value) invalidates the shorthand and
    // the main column collapses under the aux — the pinned-width symptom.
    expect(clampAuxSplitPct(NaN)).toBe(AUX_SPLIT_EVEN)
    expect(clampAuxSplitPct(Infinity)).toBe(AUX_SPLIT_EVEN)
    expect(clampAuxSplitPct(undefined as unknown as number)).toBe(AUX_SPLIT_EVEN)
  })

  it('always yields a main-column grow factor that is positive', () => {
    for (const input of [-1, 0, 0.1, 0.5, 0.9, 1, 20, 80, 120, NaN]) {
      const pct = clampAuxSplitPct(input)
      expect(1 - pct).toBeGreaterThan(0)
      expect(pct).toBeGreaterThan(0)
    }
  })
})
