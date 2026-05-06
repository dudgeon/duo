// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { normalizeWikilinkName } from './wikilinkResolver'

describe('normalizeWikilinkName', () => {
  it('lowercases', () => {
    expect(normalizeWikilinkName('Other Note')).toBe('other note')
    expect(normalizeWikilinkName('OTHER NOTE')).toBe('other note')
  })

  it('treats hyphen and underscore as space', () => {
    expect(normalizeWikilinkName('other-note')).toBe('other note')
    expect(normalizeWikilinkName('other_note')).toBe('other note')
    expect(normalizeWikilinkName('multi-word-name')).toBe('multi word name')
  })

  it('collapses whitespace runs', () => {
    expect(normalizeWikilinkName('Other  Note')).toBe('other note')
    expect(normalizeWikilinkName('Other\tNote')).toBe('other note')
  })

  it('trims', () => {
    expect(normalizeWikilinkName('  Other Note  ')).toBe('other note')
  })

  it('matches across the smoke-walk scenario', () => {
    // Walk v0.6.8: user typed [[Other Note]], file was other-note.md
    // — must collapse to identical normalized form.
    expect(normalizeWikilinkName('Other Note')).toBe(normalizeWikilinkName('other-note'))
  })

  it('preserves cross-form distinctness when intended', () => {
    // Different words still distinguish.
    expect(normalizeWikilinkName('Other Note')).not.toBe(normalizeWikilinkName('OtherNote'))
    expect(normalizeWikilinkName('foo bar')).not.toBe(normalizeWikilinkName('foobar'))
  })

  it('handles already-normalized input idempotently', () => {
    const norm = normalizeWikilinkName('other note')
    expect(normalizeWikilinkName(norm)).toBe(norm)
  })

  it('handles empty + whitespace-only input', () => {
    expect(normalizeWikilinkName('')).toBe('')
    expect(normalizeWikilinkName('   ')).toBe('')
    expect(normalizeWikilinkName('\t\n')).toBe('')
  })
})
