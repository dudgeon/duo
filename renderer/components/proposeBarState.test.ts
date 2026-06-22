import { describe, it, expect } from 'vitest'
import { proposeBarState } from './proposeBarState'

describe('proposeBarState', () => {
  it('hides for an ordinary file (not in a managed checkout)', () => {
    // The D10 zero-footprint case — divergence/PR irrelevant when not a checkout.
    expect(proposeBarState({ inCheckout: false, diverged: false, hasPr: false }))
      .toEqual({ visible: false, mode: 'hidden' })
    expect(proposeBarState({ inCheckout: false, diverged: true, hasPr: true }).visible).toBe(false)
    expect(proposeBarState({ inCheckout: false, diverged: true, hasPr: true }).mode).toBe('hidden')
  })

  it('hides for a clean checkout with no divergence and no PR', () => {
    expect(proposeBarState({ inCheckout: true, diverged: false, hasPr: false }))
      .toEqual({ visible: false, mode: 'hidden' })
  })

  it('proposes when the checkout has diverged (no PR yet)', () => {
    expect(proposeBarState({ inCheckout: true, diverged: true, hasPr: false }))
      .toEqual({ visible: true, mode: 'propose' })
  })

  it('shows the view (View PR) mode when a PR exists and there is no divergence', () => {
    expect(proposeBarState({ inCheckout: true, diverged: false, hasPr: true }))
      .toEqual({ visible: true, mode: 'view' })
  })

  it('prefers propose over view when both diverged AND a PR exist (Update PR)', () => {
    // Edited again after proposing → still offer the Update-PR button.
    expect(proposeBarState({ inCheckout: true, diverged: true, hasPr: true }))
      .toEqual({ visible: true, mode: 'propose' })
  })

  it('is always visible when mode is not hidden, and hidden when not visible', () => {
    const cases = [
      { inCheckout: false, diverged: false, hasPr: false },
      { inCheckout: true, diverged: false, hasPr: false },
      { inCheckout: true, diverged: true, hasPr: false },
      { inCheckout: true, diverged: false, hasPr: true },
      { inCheckout: true, diverged: true, hasPr: true }
    ]
    for (const c of cases) {
      const s = proposeBarState(c)
      expect(s.visible).toBe(s.mode !== 'hidden')
    }
  })
})
