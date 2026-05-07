// Regression coverage for the global-shortcut matcher.
//
// Why this file exists: BUG-075 (v0.6.4 + v0.6.5 smoke walks) — Split
// View chords kept failing for two distinct reasons:
//   (1) The original ⌘\ / ⌘⇧\ chords used `e.key === '\\'` checks,
//       but Shift+\ produces e.key === '|' (the shifted character),
//       so the matcher could NEVER hit the shifted branch. Fix: use
//       `e.code === 'Backslash'` (modifier-independent physical-key
//       API). v1 of this file tested THAT fix.
//   (2) v0.6.5 owner walk: 1Password's system-level Cmd+\ autofill
//       grab intercepted the chord BEFORE Chromium / Duo could see
//       it. Re-pick: ⌘/ + ⌘⇧/. Same `e.code` lesson — Shift+/
//       produces e.key === '?', so the matcher uses
//       `e.code === 'Slash'`.
//
// These tests now anchor BOTH lessons: the chord is on `Slash`, and
// the shifted case is asserted to keep matching even when e.key
// changes to the shifted character.
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
 * (`Shift+/` → key='?', code='Slash') — we model both correctly
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
  it('matches ⌘/ → splitViewToggle (unshifted, key === "/", code === "Slash")', () => {
    const m = matchGlobalShortcut(chord({ key: '/', code: 'Slash', meta: true }), ctx)
    expect(m).toEqual({ id: 'splitViewToggle' })
  })

  it('matches ⌘⇧/ → splitViewPromote (shifted: key === "?", code === "Slash")', () => {
    // BUG-075 anchor: the shifted form produces e.key === '?', NOT
    // '/'. Using e.code === 'Slash' catches both shifted + unshifted
    // forms uniformly. A regression to e.key checks would skip this
    // case and the chord would silently drop on shift.
    const m = matchGlobalShortcut(chord({ key: '?', code: 'Slash', meta: true, shift: true }), ctx)
    expect(m).toEqual({ id: 'splitViewPromote' })
  })

  it('does not match ⌘? (e.key === "?" but no shift) — should fall through', () => {
    // Defensive: a synthetic ⌘? WITHOUT shift shouldn't match either
    // chord. (Real keyboards can't produce this — but test the matcher
    // shape, not just the most-likely path.)
    const m = matchGlobalShortcut(chord({ key: '?', code: 'IntlBackslash', meta: true, shift: false }), ctx)
    expect(m).toBeNull()
  })

  it('does not match plain ⌘/ when alt or ctrl is also held', () => {
    const withAlt = matchGlobalShortcut(chord({ key: '/', code: 'Slash', meta: true, alt: true }), ctx)
    const withCtrl = matchGlobalShortcut(chord({ key: '/', code: 'Slash', meta: true, ctrl: true }), ctx)
    expect(withAlt).toBeNull()
    expect(withCtrl).toBeNull()
  })

  it('shift-modifier specificity: ⌘⇧/ matches splitViewPromote, NOT splitViewToggle', () => {
    // The matcher uses first-match-wins ordering — splitViewPromote
    // (shift) is declared before splitViewToggle (no-shift). Confirm
    // the shifted case never accidentally falls through to the
    // unshifted branch.
    const m = matchGlobalShortcut(chord({ key: '?', code: 'Slash', meta: true, shift: true }), ctx)
    expect(m?.id).not.toBe('splitViewToggle')
    expect(m?.id).toBe('splitViewPromote')
  })

  it('does NOT match ⌘\\ — the old chord is no longer wired (BUG-075 v3 re-pick)', () => {
    // 1Password grabs Cmd+\ at the system level on most macOS users'
    // machines, so the chord couldn't fire even with the e.code fix.
    // Confirms the chord changed AND that any future regression to
    // ⌘\ would surface as a test failure (not just a silent broken
    // chord like BUG-075 v1).
    const m = matchGlobalShortcut(chord({ key: '\\', code: 'Backslash', meta: true }), ctx)
    expect(m).toBeNull()
  })
})

describe('matchGlobalShortcut — ENH-098 pane-jump chords (Sprint 9)', () => {
  // Walk-1 chord re-pick (Sprint 9, 2026-05-07): originally ⌘⌥L/;/'
  // but owner's system-level window manager intercepts meta+alt
  // before the renderer sees it. Re-picked to ⌘⇧L/;/'. Shift
  // modifies the produced character on US layouts (Shift+L = 'L',
  // Shift+; = ':', Shift+' = '"'); use `e.code` for layout-
  // independent matching.

  it('matches ⌘⇧L → focusTerminalPane (key === "L", code === "KeyL")', () => {
    const m = matchGlobalShortcut(
      chord({ key: 'L', code: 'KeyL', meta: true, shift: true }),
      ctx
    )
    expect(m).toEqual({ id: 'focusTerminalPane' })
  })

  it('matches ⌘⇧; → focusMainPane (key === ":", code === "Semicolon")', () => {
    const m = matchGlobalShortcut(
      chord({ key: ':', code: 'Semicolon', meta: true, shift: true }),
      ctx
    )
    expect(m).toEqual({ id: 'focusMainPane' })
  })

  it("matches ⌘⇧' → focusAuxPane (key === '\"', code === \"Quote\")", () => {
    const m = matchGlobalShortcut(
      chord({ key: '"', code: 'Quote', meta: true, shift: true }),
      ctx
    )
    expect(m).toEqual({ id: 'focusAuxPane' })
  })

  it('does NOT match plain ⌘L (shift missing) — that fires focusAddressBar', () => {
    const m = matchGlobalShortcut(
      chord({ key: 'l', code: 'KeyL', meta: true, shift: false }),
      ctx
    )
    expect(m).toEqual({ id: 'focusAddressBar' })
  })

  it('does NOT match the OLD ⌘⌥L chord (post-walk-1 re-pick)', () => {
    // Anchors the rejection of the previous chord set so a future
    // refactor can't accidentally re-add it without us noticing.
    const m = matchGlobalShortcut(
      chord({ key: '¬', code: 'KeyL', meta: true, alt: true }),
      ctx
    )
    expect(m).toBeNull()
  })

  it('does NOT match ⌘⇧L when alt is also held', () => {
    // No design intent for ⌘⌥⇧L at this time — leave room for future.
    const m = matchGlobalShortcut(
      chord({ key: 'L', code: 'KeyL', meta: true, shift: true, alt: true }),
      ctx
    )
    expect(m).toBeNull()
  })

  it('does NOT match plain shift+L (no meta)', () => {
    const m = matchGlobalShortcut(
      chord({ key: 'L', code: 'KeyL', shift: true }),
      ctx
    )
    expect(m).toBeNull()
  })

  it('still matches the chords inside an editable surface (chord must escape TipTap)', () => {
    // Pane-jump is a global navigation gesture; it must NOT yield to
    // the editor like ⌘B does. Confirm the matcher fires regardless
    // of inEditableSurface.
    const editorCtx = { inEditableSurface: true }
    expect(matchGlobalShortcut(chord({ key: 'L', code: 'KeyL', meta: true, shift: true }), editorCtx))
      .toEqual({ id: 'focusTerminalPane' })
    expect(matchGlobalShortcut(chord({ key: ':', code: 'Semicolon', meta: true, shift: true }), editorCtx))
      .toEqual({ id: 'focusMainPane' })
    expect(matchGlobalShortcut(chord({ key: '"', code: 'Quote', meta: true, shift: true }), editorCtx))
      .toEqual({ id: 'focusAuxPane' })
  })
})

describe('matchGlobalShortcut — ENH-102 delete current file (Sprint 9)', () => {
  it('matches ⌘⇧⌫ → deleteCurrentFile (e.code === "Backspace")', () => {
    const m = matchGlobalShortcut(
      chord({ key: 'Backspace', code: 'Backspace', meta: true, shift: true }),
      ctx
    )
    expect(m).toEqual({ id: 'deleteCurrentFile' })
  })

  it('does NOT match plain ⌫ (no meta, no shift)', () => {
    const m = matchGlobalShortcut(
      chord({ key: 'Backspace', code: 'Backspace' }),
      ctx
    )
    expect(m).toBeNull()
  })

  it('does NOT match ⌘⌫ alone (missing shift)', () => {
    const m = matchGlobalShortcut(
      chord({ key: 'Backspace', code: 'Backspace', meta: true }),
      ctx
    )
    expect(m).toBeNull()
  })

  it('does NOT match ⇧⌫ alone (missing meta)', () => {
    const m = matchGlobalShortcut(
      chord({ key: 'Backspace', code: 'Backspace', shift: true }),
      ctx
    )
    expect(m).toBeNull()
  })

  it('does NOT match ⌘⌥⇧⌫ (alt is a different intent — leave room for future chord)', () => {
    const m = matchGlobalShortcut(
      chord({ key: 'Backspace', code: 'Backspace', meta: true, shift: true, alt: true }),
      ctx
    )
    expect(m).toBeNull()
  })

  it('still matches inside an editable surface (file deletion is higher-priority than line-edit)', () => {
    const editorCtx = { inEditableSurface: true }
    const m = matchGlobalShortcut(
      chord({ key: 'Backspace', code: 'Backspace', meta: true, shift: true }),
      editorCtx
    )
    expect(m).toEqual({ id: 'deleteCurrentFile' })
  })
})
