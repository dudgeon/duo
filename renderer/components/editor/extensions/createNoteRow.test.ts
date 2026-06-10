// ENH-208 Phase 2 (D4) — gating rules for the silent-stub create row.

import { describe, it, expect } from 'vitest'
import { withCreateNoteRow, isCreateNoteItem, type CreateNoteItem } from './createNoteRow'

const files = [
  { basename: 'Jordan Lee', relPath: 'people/Jordan Lee.md' },
  { basename: 'Q3 Launch', relPath: 'initiatives/Q3 Launch/Q3 Launch.md' },
]

describe('withCreateNoteRow', () => {
  it('appends the create row as the FINAL entry for an unresolved query', () => {
    const out = withCreateNoteRow(files, files, 'Riley', true)
    expect(out.length).toBe(files.length + 1)
    const last = out[out.length - 1]
    expect(isCreateNoteItem(last)).toBe(true)
    expect((last as CreateNoteItem).query).toBe('Riley')
  })

  it('offers nothing on an empty / whitespace query', () => {
    expect(withCreateNoteRow(files, files, '', true)).toEqual(files)
    expect(withCreateNoteRow(files, files, '   ', true)).toEqual(files)
  })

  it('offers nothing when the vault root is unknown', () => {
    expect(withCreateNoteRow(files, files, 'Riley', false)).toEqual(files)
  })

  it('suppresses the row when a basename matches case-insensitively', () => {
    expect(withCreateNoteRow(files, files, 'jordan lee', true)).toEqual(files)
    expect(withCreateNoteRow(files, files, 'JORDAN LEE', true)).toEqual(files)
  })

  it('checks equality against the FULL index, not the capped ranked list', () => {
    // Ranked is capped to [] (as if the limit cut everything), but the
    // full index still has the exact match — no create row.
    expect(withCreateNoteRow([], files, 'Jordan Lee', true)).toEqual([])
    // And an unresolved query still appends to the capped list.
    const out = withCreateNoteRow([files[0]], files, 'Riley', true)
    expect(out.length).toBe(2)
    expect(isCreateNoteItem(out[1])).toBe(true)
  })

  it('a substring (non-equal) basename hit still offers the row', () => {
    const out = withCreateNoteRow(files, files, 'Jordan', true)
    expect(isCreateNoteItem(out[out.length - 1])).toBe(true)
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
