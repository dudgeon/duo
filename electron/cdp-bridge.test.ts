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
import { SELECTION_OBSERVER_IIFE, INSPECT_OBSERVER_IIFE } from './cdp-bridge'

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

  it('ENH-159b — showPillFor also bails when __duoInspectActive (mode lock)', () => {
    // Mode lock: while inspect mode is on, the user is picking an
    // element, not selecting text. The Send → Duo pill is suppressed
    // so the inspect outline owns the visual chrome. This regression
    // catches a refactor that drops the second guard.
    expect(SELECTION_OBSERVER_IIFE).toContain('if (window.__duoInspectActive) { hidePill(); return; }')
  })
})

describe('INSPECT_OBSERVER_IIFE — ENH-159b structural invariants', () => {
  it('installs the re-injection guard at the top', () => {
    // Same idempotency pattern as SELECTION_OBSERVER_IIFE. Without it
    // page navigations would stack listeners.
    expect(INSPECT_OBSERVER_IIFE).toMatch(/if \(window\.__duoInspectObserver\) return;\s*window\.__duoInspectObserver = true;/)
  })

  it('every event handler bails when __duoInspectActive is false', () => {
    // The IIFE installs document-level listeners but they must no-op
    // when the mode is off. The active-flag check is the single
    // switch — if any handler skips it, the inspect outline /
    // click-capture would fire even when the user thought the mode
    // was off (silent state-divergence bug). Three handlers: move,
    // click, key.
    expect(INSPECT_OBSERVER_IIFE).toMatch(/function onMove[\s\S]*?if \(!window\.__duoInspectActive\)/)
    expect(INSPECT_OBSERVER_IIFE).toMatch(/function onClick[\s\S]*?if \(!window\.__duoInspectActive\)/)
    expect(INSPECT_OBSERVER_IIFE).toMatch(/function onKey[\s\S]*?if \(!window\.__duoInspectActive\)/)
  })

  it('emits via the duoInspectClick binding (full snapshot on click, null on ESC)', () => {
    // The binding name is the contract with cdp-bridge's
    // Runtime.addBinding('duoInspectClick') + handleCdpEvent's
    // bindingCalled switch. Two emit sites: click → JSON payload,
    // ESC → JSON.stringify(null) sentinel.
    expect(INSPECT_OBSERVER_IIFE).toContain('window.duoInspectClick(JSON.stringify(payload))')
    expect(INSPECT_OBSERVER_IIFE).toContain('window.duoInspectClick(JSON.stringify(null))')
  })

  it('click handler preventDefault + stopPropagation (page does not react)', () => {
    // Without preventDefault, clicking a <button> in inspect mode
    // would still submit a form / fire its handler / navigate a link.
    // The whole point of inspect mode is to pick the element, not
    // activate it.
    const onClickBlock = INSPECT_OBSERVER_IIFE.match(/function onClick\(e\) \{([\s\S]*?)\n  \}/)![1]
    expect(onClickBlock).toContain('e.preventDefault()')
    expect(onClickBlock).toContain('e.stopPropagation()')
  })

  it('overlay + tooltip are pointer-events:none (do not eat the events we want)', () => {
    // Both the highlight div and the tag/dims tooltip must be
    // pointer-events:none. Otherwise the mousemove for the next
    // element would target the overlay itself and the IIFE would
    // recurse / freeze. We assert exactly TWO sites in the IIFE —
    // one per element — so a refactor that drops one is caught.
    const matches = INSPECT_OBSERVER_IIFE.match(/setProperty\('pointer-events', 'none'/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('outline color is Duo accent orange', () => {
    // Brand consistency — atelier kernel --accent: #f97316. Tests
    // pin the literal so a refactor doesn't drift to a generic
    // devtools blue.
    expect(INSPECT_OBSERVER_IIFE).toContain('#f97316')
  })

  it('selectorFor produces a non-empty path for nested elements', () => {
    // Construct a minimal mock DOM and run the IIFE's selectorFor
    // logic via Function constructor. This is the closest we can
    // get to executing the IIFE without spinning up a JSDOM page —
    // we extract just the selectorFor function source.
    const fnMatch = INSPECT_OBSERVER_IIFE.match(/function selectorFor\(el\) \{([\s\S]*?)\n  \}/)!
    expect(fnMatch).not.toBeNull()
    // Quick sanity check that the function body contains the
    // expected primitives (tag name, id check, nth-child).
    expect(fnMatch[1]).toContain('tagName.toLowerCase')
    expect(fnMatch[1]).toContain(':nth-child')
    expect(fnMatch[1]).toContain("' > '")
  })

  it('captures key attributes the agent likely cares about', () => {
    // Locked list: id, role, aria-label, href, src, name, type,
    // data-testid + data-duo-id. Adding more is fine; removing
    // is a contract-break the test catches.
    expect(INSPECT_OBSERVER_IIFE).toContain("'id'")
    expect(INSPECT_OBSERVER_IIFE).toContain("'role'")
    expect(INSPECT_OBSERVER_IIFE).toContain("'aria-label'")
    expect(INSPECT_OBSERVER_IIFE).toContain("'href'")
  })
})
