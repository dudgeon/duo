// ENH-175 — `duo navigate <url>` opens a new tab or focuses an existing
// matching one. The URL-match helper is the only externally-testable
// pure piece; the full BrowserManager.navigateOrFocus path needs an
// Electron mount and is verified live.

import { describe, it, expect } from 'vitest'
import { normalizeForTabMatch } from './browser-manager'

describe('normalizeForTabMatch — ENH-175', () => {
  it('returns null for falsy input', () => {
    expect(normalizeForTabMatch(null)).toBeNull()
    expect(normalizeForTabMatch(undefined)).toBeNull()
    expect(normalizeForTabMatch('')).toBeNull()
    expect(normalizeForTabMatch('   ')).toBeNull()
  })

  it('returns null for about:blank (so empty tabs never match)', () => {
    expect(normalizeForTabMatch('about:blank')).toBeNull()
  })

  it('preserves exact URLs unchanged', () => {
    expect(normalizeForTabMatch('https://example.com/path')).toBe('https://example.com/path')
  })

  it('strips trailing slash so X and X/ match', () => {
    const a = normalizeForTabMatch('https://example.com')
    const b = normalizeForTabMatch('https://example.com/')
    expect(a).toBe(b)
    expect(a).toBe('https://example.com')
  })

  it('keeps lone trailing slash on bare schemes (file:/)', () => {
    // Don't collapse `file:/` to `file:` — pathological but we shouldn't
    // turn a 6-char URL into a 5-char different URL via normalization.
    // The `u.length > 1` guard handles this.
    expect(normalizeForTabMatch('/')).toBe('/')
  })

  it('strips hash fragment', () => {
    const a = normalizeForTabMatch('https://example.com/path#section')
    const b = normalizeForTabMatch('https://example.com/path')
    expect(a).toBe(b)
  })

  it('preserves query string (different ?id= are different pages)', () => {
    const a = normalizeForTabMatch('https://example.com/page?id=1')
    const b = normalizeForTabMatch('https://example.com/page?id=2')
    expect(a).not.toBe(b)
  })

  it('handles file:// URLs', () => {
    const path = 'file:///Users/test/docs/example.html'
    expect(normalizeForTabMatch(path)).toBe(path)
    expect(normalizeForTabMatch(path + '#section')).toBe(path)
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeForTabMatch('  https://example.com  ')).toBe('https://example.com')
  })
})
