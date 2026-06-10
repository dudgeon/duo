// ENH-208 Phase 2 (D4) — gating + placement rules for the silent-stub
// create row. Placement matters: the row must land INSIDE the popover's
// render window (visibleLimit) or the feature's entry point goes
// invisible behind the "+N more" footer.

import { describe, it, expect } from 'vitest'
import { withCreateNoteRow, isCreateNoteItem, type CreateNoteItem } from './createNoteRow'

const files = [
  { basename: 'Jordan Lee', relPath: 'people/Jordan Lee.md' },
  { basename: 'Q3 Launch', relPath: 'initiatives/Q3 Launch/Q3 Launch.md' },
]

// The popover's real render cap is 8 (SuggestionPopover.ITEM_LIMIT_VISIBLE);
// tests pass it explicitly so the rules stay visible at the call site.
const VISIBLE = 8

describe('withCreateNoteRow', () => {
  it('places the create row LAST when the ranked list is short', () => {
    const out = withCreateNoteRow(files, files, 'Riley', true, VISIBLE)
    expect(out.length).toBe(files.length + 1)
    const last = out[out.length - 1]
    expect(isCreateNoteItem(last)).toBe(true)
    expect((last as CreateNoteItem).query).toBe('Riley')
  })

  it('pins the create row inside the visible window when many files match', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      basename: `meeting ${i}`,
      relPath: `meetings/meeting ${i}.md`,
    }))
    const out = withCreateNoteRow(many, many, 'meeting', true, VISIBLE)
    expect(out.length).toBe(21)
    // Row sits at the window's last rendered slot, never past the slice.
    expect(isCreateNoteItem(out[VISIBLE - 1])).toBe(true)
    expect(out.slice(0, VISIBLE - 1).some(isCreateNoteItem)).toBe(false)
  })

  it('offers nothing on an empty / whitespace query', () => {
    expect(withCreateNoteRow(files, files, '', true, VISIBLE)).toEqual(files)
    expect(withCreateNoteRow(files, files, '   ', true, VISIBLE)).toEqual(files)
  })

  it('offers nothing when the vault root is unknown', () => {
    expect(withCreateNoteRow(files, files, 'Riley', false, VISIBLE)).toEqual(files)
  })

  it('suppresses the row when a basename matches case-insensitively', () => {
    expect(withCreateNoteRow(files, files, 'jordan lee', true, VISIBLE)).toEqual(files)
    expect(withCreateNoteRow(files, files, 'JORDAN LEE', true, VISIBLE)).toEqual(files)
  })

  it('checks equality against the FULL index, not the capped ranked list', () => {
    // Ranked is capped to [] (as if the limit cut everything), but the
    // full index still has the exact match — no create row.
    expect(withCreateNoteRow([], files, 'Jordan Lee', true, VISIBLE)).toEqual([])
    // And an unresolved query still lands in the capped list.
    const out = withCreateNoteRow([files[0]], files, 'Riley', true, VISIBLE)
    expect(out.length).toBe(2)
    expect(isCreateNoteItem(out[1])).toBe(true)
  })

  it('a substring (non-equal) basename hit still offers the row', () => {
    const out = withCreateNoteRow(files, files, 'Jordan', true, VISIBLE)
    expect(out.some(isCreateNoteItem)).toBe(true)
  })
})

describe('isCreateNoteItem type guard', () => {
  it('rejects VaultFile- and SmartToken-shaped objects', () => {
    expect(isCreateNoteItem({ kind: 'create-note', query: 'X' })).toBe(true)
    expect(isCreateNoteItem({ basename: 'X', relPath: 'X.md' })).toBe(false)
    expect(isCreateNoteItem({ keyword: 'today', insertText: '2026-06-09' })).toBe(false)
    expect(isCreateNoteItem(null)).toBe(false)
  })
})
