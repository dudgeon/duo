// ENH-175 — `duo navigate <url>` opens a new tab or focuses an existing
// matching one. The URL-match helper is the only externally-testable
// pure piece; the full BrowserManager.navigateOrFocus path needs an
// Electron mount and is verified live.

import { describe, it, expect } from 'vitest'
import { normalizeForTabMatch, isLocalUrlForBrowserMode } from './browser-manager'

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

describe('isLocalUrlForBrowserMode — ENH-178', () => {
  it('returns false for null / empty / falsy', () => {
    expect(isLocalUrlForBrowserMode(null)).toBe(false)
    expect(isLocalUrlForBrowserMode(undefined)).toBe(false)
    expect(isLocalUrlForBrowserMode('')).toBe(false)
    expect(isLocalUrlForBrowserMode('   ')).toBe(false)
  })

  it('returns true for file:// URLs', () => {
    expect(isLocalUrlForBrowserMode('file:///tmp/foo.html')).toBe(true)
    expect(isLocalUrlForBrowserMode('file:///Users/x/Documents/doc.md')).toBe(true)
  })

  it('returns true for about: schemes', () => {
    expect(isLocalUrlForBrowserMode('about:blank')).toBe(true)
    expect(isLocalUrlForBrowserMode('about:srcdoc')).toBe(true)
  })

  it('returns true for devtools:// URLs', () => {
    expect(isLocalUrlForBrowserMode('devtools://devtools/bundled/inspector.html')).toBe(true)
  })

  it('returns true for localhost (with + without port)', () => {
    expect(isLocalUrlForBrowserMode('http://localhost')).toBe(true)
    expect(isLocalUrlForBrowserMode('http://localhost:3000')).toBe(true)
    expect(isLocalUrlForBrowserMode('https://localhost:8443/path')).toBe(true)
  })

  it('returns true for 127.0.0.1', () => {
    expect(isLocalUrlForBrowserMode('http://127.0.0.1')).toBe(true)
    expect(isLocalUrlForBrowserMode('http://127.0.0.1:5173/vite')).toBe(true)
  })

  it('returns true for IPv6 loopback', () => {
    expect(isLocalUrlForBrowserMode('http://[::1]:3000')).toBe(true)
  })

  it('returns false for arbitrary external hosts', () => {
    expect(isLocalUrlForBrowserMode('https://example.com')).toBe(false)
    expect(isLocalUrlForBrowserMode('http://google.com')).toBe(false)
    expect(isLocalUrlForBrowserMode('https://github.com/user/repo')).toBe(false)
  })

  it('returns false for hosts that LOOK local but aren\'t (subdomain trick)', () => {
    // `localhost.evil.com` is NOT local — only the literal `localhost` host.
    expect(isLocalUrlForBrowserMode('http://localhost.evil.com')).toBe(false)
    // Same for 127.0.0.1-prefix subdomain tricks.
    expect(isLocalUrlForBrowserMode('http://127.0.0.1.evil.com')).toBe(false)
  })

  it('returns false for malformed URLs (safer to bounce externally)', () => {
    expect(isLocalUrlForBrowserMode('://not-a-url')).toBe(false)
    expect(isLocalUrlForBrowserMode('http://')).toBe(false)
  })

  it('is case-insensitive for hostnames', () => {
    expect(isLocalUrlForBrowserMode('http://LocalHost:3000')).toBe(true)
    expect(isLocalUrlForBrowserMode('https://Example.com')).toBe(false)
  })
})
