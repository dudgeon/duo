// @vitest-environment jsdom
//
// ENH-208 (D22 re-pick) — pin the `data-duo-findbar` attribute contract.
//
// The find bars (editor FindBar.tsx, canvas PageFindBar.tsx) mark their
// container with `data-duo-findbar`, and useKeyboardShortcuts derives
// `ctx.inFindBar` from it via isInFindBar — the yield that keeps ⌘⇧F
// input-local (find-previous) instead of opening the vault-search
// palette. The attribute name is a cross-file contract: renaming it on
// either side silently breaks the yield, so this test pins it.

import { describe, it, expect, afterEach } from 'vitest'
import { isInFindBar } from './globalShortcuts'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('isInFindBar — the ctx.inFindBar derivation', () => {
  it('true when a child input of a [data-duo-findbar] element has focus', () => {
    const bar = document.createElement('div')
    // The exact attribute FindBar.tsx / PageFindBar.tsx render — keep
    // these literals in sync (that sync is the point of the test).
    bar.setAttribute('data-duo-findbar', '1')
    const input = document.createElement('input')
    bar.appendChild(input)
    document.body.appendChild(bar)
    input.focus()
    expect(document.activeElement).toBe(input)
    expect(isInFindBar(document)).toBe(true)
  })

  it('true when the bar element itself has focus', () => {
    const bar = document.createElement('div')
    bar.setAttribute('data-duo-findbar', 'page')
    bar.tabIndex = -1
    document.body.appendChild(bar)
    bar.focus()
    expect(isInFindBar(document)).toBe(true)
  })

  it('false for a focused input outside any find bar', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    expect(isInFindBar(document)).toBe(false)
  })

  it('false when nothing has focus', () => {
    expect(isInFindBar(document)).toBe(false)
  })
})
