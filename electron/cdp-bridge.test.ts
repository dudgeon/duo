// BUG-056 regression — the in-page Send → Duo pill must NEVER render
// without an active Claude session in the terminal pane. The gate
// lives inside SELECTION_OBSERVER_IIFE.showPillFor as
//   `if (!window.__duoClaudeLive) { hidePill(); return; }`
// at the very top of the function. Any refactor that drops or
// reorders this guard re-opens the bug, which has recurred across
// multiple smoke walks.
//
// The smoke-walk skill (.claude/skills/smoke-walk/SKILL.md) lists
// this as a mandatory regression item walked on every cut. This
// test moves the regression off the manual walk: the guard's
// presence is asserted in the IIFE source string, so a CI-side
// refactor break is caught before it ships. Owner-flagged 2026-05-07
// walk-1: "why do I need to walk this every session? please include
// in YOUR regression testing, not mine."

import { describe, expect, it } from 'vitest'
import { SELECTION_OBSERVER_IIFE } from './cdp-bridge'

describe('SELECTION_OBSERVER_IIFE — BUG-056 pill gating regression', () => {
  it('contains the __duoClaudeLive guard at the top of showPillFor', () => {
    // The literal guard expression — exact text. If a future refactor
    // wants to change the variable name (e.g. window.__duoClaudeLive →
    // window.duoState.claudeLive), update BOTH this test AND the
    // setClaudeLive method below in cdp-bridge.ts in the SAME PR — the
    // guard string is the contract between main and the page.
    expect(SELECTION_OBSERVER_IIFE).toContain('if (!window.__duoClaudeLive)')
    expect(SELECTION_OBSERVER_IIFE).toContain('hidePill();')
  })

  it('places the guard inside showPillFor, before any element-creation work', () => {
    // Find the showPillFor function block and confirm the guard is
    // among the first statements. If the guard ever lands AFTER the
    // pill is already mounted to the DOM, the bug returns: the pill
    // briefly flashes before being hidden, which is what BUG-056
    // originally reported.
    const fnMatch = SELECTION_OBSERVER_IIFE.match(/function showPillFor\(rect\) \{([\s\S]*?)\n  \}/)
    expect(fnMatch, 'showPillFor function should exist in the IIFE').not.toBeNull()
    const body = fnMatch![1]
    const guardIndex = body.indexOf('if (!window.__duoClaudeLive)')
    const ensurePillIndex = body.indexOf('ensurePill(')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(ensurePillIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(ensurePillIndex)
  })

  it('the IIFE has exactly ONE active gate read (excluding documentation comments)', () => {
    // Defensive: if a future refactor adds a SECOND read of the flag
    // elsewhere in code, this test forces the author to think about
    // what that means for gating semantics — does the new site need
    // the same hidePill() escape? Comments mentioning the flag for
    // documentation purposes are fine and excluded from the count.
    const codeOnly = SELECTION_OBSERVER_IIFE.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const matches = codeOnly.match(/window\.__duoClaudeLive/g) ?? []
    expect(matches.length).toBe(1)
  })
})
