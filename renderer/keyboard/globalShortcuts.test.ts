// Regression coverage for the global-shortcut matcher.
//
// Why this file exists: BUG-075 (v0.6.4 smoke walk) — the ⌘⇧\
// chord for splitViewPromote was silently dropped because the matcher
// checked `e.key === '\\'` AND `shift === true`. On US keyboards
// pressing Shift+\ produces `e.key === '|'` (the shifted character),
// so the AND condition was physically impossible. The fix switches
// to `e.code === 'Backslash'` (modifier-independent physical-key API).
//
// The "Recurring regressions need durable test coverage" memory
// (Duo) says regressions need a test, not just a smoke-checklist
// line. This file is that anchor.

import { describe, it, expect } from 'vitest'
import { matchGlobalShortcut } from './globalShortcuts'

const ctx = { inEditableSurface: false }

/**
 * Build a KeyboardEvent-shaped object that mirrors what the browser
 * produces for a chord. We cast to KeyboardEvent because the matcher
 * only reads {key, code, metaKey, shiftKey, altKey, ctrlKey} — a plain
 * object with those fields is enough, and a plain object works in
 * Vitest's default Node environment (no JSDOM dependency).
 *
 * The `key` and `code` fields differ in shift-modified cases
 * (`Shift+\` → key='|', code='Backslash') — we model both correctly
 * so the test can catch a regression that confuses the two.
 */
function chord(opts: {
  key: string
  code?: string
  meta?: boolean
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
}): KeyboardEvent {
  return {
    key: opts.key,
    code: opts.code ?? opts.key,
    metaKey: opts.meta ?? false,
    shiftKey: opts.shift ?? false,
    altKey: opts.alt ?? false,
    ctrlKey: opts.ctrl ?? false
  } as KeyboardEvent
}

describe('matchGlobalShortcut — Split View chords (BUG-075 regression)', () => {
  it('matches ⌘\\ → splitViewToggle (unshifted, key === code === Backslash)', () => {
    const m = matchGlobalShortcut(chord({ key: '\\', code: 'Backslash', meta: true }), ctx)
    expect(m).toEqual({ id: 'splitViewToggle' })
  })

  it('matches ⌘⇧\\ → splitViewPromote (shifted: key === "|", code === "Backslash")', () => {
    // BUG-075 anchor: this is the case that the old `e.key === "\\"`
    // matcher could NEVER hit, because Shift+\ produces "|", not "\".
    // Switching to `e.code === "Backslash"` fixes it.
    const m = matchGlobalShortcut(chord({ key: '|', code: 'Backslash', meta: true, shift: true }), ctx)
    expect(m).toEqual({ id: 'splitViewPromote' })
  })

  it('does not match ⌘| (e.key === "|" but no shift) — should fall through', () => {
    // Defensive: a synthetic ⌘| WITHOUT shift shouldn't match either
    // chord. (Real keyboards can't produce this — but test the matcher
    // shape, not just the most-likely path.)
    const m = matchGlobalShortcut(chord({ key: '|', code: 'IntlBackslash', meta: true, shift: false }), ctx)
    expect(m).toBeNull()
  })

  it('does not match plain ⌘\\ when alt or ctrl is also held', () => {
    const withAlt = matchGlobalShortcut(chord({ key: '\\', code: 'Backslash', meta: true, alt: true }), ctx)
    const withCtrl = matchGlobalShortcut(chord({ key: '\\', code: 'Backslash', meta: true, ctrl: true }), ctx)
    expect(withAlt).toBeNull()
    expect(withCtrl).toBeNull()
  })

  it('shift-modifier specificity: ⌘⇧\\ matches splitViewPromote, NOT splitViewToggle', () => {
    // The matcher uses first-match-wins ordering — splitViewPromote
    // (shift) is declared before splitViewToggle (no-shift). Confirm
    // the shifted case never accidentally falls through to the
    // unshifted branch.
    const m = matchGlobalShortcut(chord({ key: '|', code: 'Backslash', meta: true, shift: true }), ctx)
    expect(m?.id).not.toBe('splitViewToggle')
    expect(m?.id).toBe('splitViewPromote')
  })
})
