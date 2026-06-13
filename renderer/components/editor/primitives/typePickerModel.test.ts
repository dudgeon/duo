// ENH-208 Phase 2 (D4) — TypePickerPopover filter + new-row rules.

import { describe, it, expect } from 'vitest'
import { buildTypeChoices } from './typePickerModel'

const TYPES = ['initiative', 'meeting', 'milestone', 'person', 'theme']

describe('buildTypeChoices', () => {
  it('empty filter lists every type with no new row', () => {
    const rows = buildTypeChoices(TYPES, '')
    expect(rows.map((r) => r.type)).toEqual(TYPES)
    expect(rows.every((r) => r.kind === 'existing')).toBe(true)
  })

  it('filters by case-insensitive substring', () => {
    const rows = buildTypeChoices(TYPES, 'MEE')
    expect(rows.filter((r) => r.kind === 'existing').map((r) => r.type)).toEqual(['meeting'])
  })

  it('a non-exact filter appends the new row LAST', () => {
    const rows = buildTypeChoices(TYPES, 'mi')
    expect(rows.map((r) => r.type)).toEqual(['milestone', 'mi'])
    expect(rows[rows.length - 1].kind).toBe('new')
  })

  it('an exact match (any case) suppresses the new row', () => {
    expect(buildTypeChoices(TYPES, 'person').some((r) => r.kind === 'new')).toBe(false)
    expect(buildTypeChoices(TYPES, 'PERSON').some((r) => r.kind === 'new')).toBe(false)
  })

  it('a filter matching nothing yields just the new row', () => {
    const rows = buildTypeChoices(TYPES, 'decision')
    expect(rows).toEqual([{ kind: 'new', type: 'decision' }])
  })

  it('trims the filter for the new row but keeps its typed casing', () => {
    const rows = buildTypeChoices(TYPES, '  Decision ')
    expect(rows).toEqual([{ kind: 'new', type: 'Decision' }])
  })

  it('whitespace-only filter behaves like empty', () => {
    expect(buildTypeChoices(TYPES, '   ').length).toBe(TYPES.length)
  })

  it('an empty type registry with a filter still offers the new row', () => {
    expect(buildTypeChoices([], 'person')).toEqual([{ kind: 'new', type: 'person' }])
  })
})
