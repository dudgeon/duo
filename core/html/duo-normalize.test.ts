// @vitest-environment jsdom
//
// Vitest coverage for core/html/duo-normalize.ts
//
// Owner-locked behavior (BUG-125 v2 playground 2026-05-17):
//   - normalize() strips data-duo-* attributes from every element
//   - normalize() removes <style data-duo-style> + [data-duo-injected]
//   - normalize() is idempotent
//   - normalizedEqual(a, b) handles the baseline-vs-disk reconciliation
//   - externalStrippedDuoIds() detects the anchor-loss case for Q2

import { describe, it, expect } from 'vitest'
import { normalize, normalizedEqual, externalStrippedDuoIds } from './duo-normalize'

describe('normalize()', () => {
  it('strips data-duo-id attributes', () => {
    const input = '<!DOCTYPE html><html><body><p data-duo-id="01HX">hello</p></body></html>'
    const out = normalize(input)
    expect(out).not.toContain('data-duo-id')
    expect(out).toContain('hello')
  })

  it('strips multiple data-duo-* attributes on the same element', () => {
    const input = '<p data-duo-id="A" data-duo-action="click" id="real">x</p>'
    const out = normalize(input)
    expect(out).not.toContain('data-duo-id')
    expect(out).not.toContain('data-duo-action')
    expect(out).toContain('id="real"')
  })

  it('preserves non-duo data-* attributes', () => {
    const input = '<p data-keep="yes" data-duo-id="strip">x</p>'
    const out = normalize(input)
    expect(out).toContain('data-keep="yes"')
    expect(out).not.toContain('data-duo-id')
  })

  it('removes <style data-duo-style> elements entirely', () => {
    const input = '<html><head><style data-duo-style="duo-image-selection-tint">.tint{}</style></head><body><p>real</p></body></html>'
    const out = normalize(input)
    expect(out).not.toContain('data-duo-style')
    expect(out).not.toContain('.tint')
    expect(out).toContain('real')
  })

  it('removes elements marked with data-duo-injected', () => {
    const input = '<body><div data-duo-injected="overlay">ghost</div><p>real</p></body>'
    const out = normalize(input)
    expect(out).not.toContain('ghost')
    expect(out).not.toContain('data-duo-injected')
    expect(out).toContain('real')
  })

  it('is idempotent — normalize(normalize(x)) === normalize(x)', () => {
    const input = '<p data-duo-id="01HX" id="real">hello</p>'
    const once = normalize(input)
    const twice = normalize(once)
    expect(twice).toBe(once)
  })

  it('returns empty string on empty input', () => {
    expect(normalize('')).toBe('')
  })

  it('returns the input on completely malformed content (defensive fallback)', () => {
    // DOMParser actually handles garbage by producing a parse error
    // document with the input embedded; this test just confirms we
    // never throw.
    expect(() => normalize('<<<>>>')).not.toThrow()
  })

  it('preserves real user-meaningful content (table, headings, attrs)', () => {
    const input = '<html><body><h1>Title</h1><table><tr><td>A</td></tr></table></body></html>'
    const out = normalize(input)
    expect(out).toContain('Title')
    expect(out).toContain('table')
    expect(out).toContain('<td')
  })
})

describe('normalizedEqual()', () => {
  it('returns true for byte-equal inputs (fast path)', () => {
    const a = '<p>hello</p>'
    expect(normalizedEqual(a, a)).toBe(true)
  })

  it('returns true when only difference is data-duo-* attrs', () => {
    const baseline = '<p data-duo-id="01HX">hello</p>'
    const disk = '<p>hello</p>'
    expect(normalizedEqual(baseline, disk)).toBe(true)
  })

  it('returns true when only difference is injected <style data-duo-style>', () => {
    const baseline = '<html><head><style data-duo-style="x">.tint{}</style></head><body><p>real</p></body></html>'
    const disk = '<html><body><p>real</p></body></html>'
    expect(normalizedEqual(baseline, disk)).toBe(true)
  })

  it('returns false when user-meaningful content differs', () => {
    const baseline = '<p data-duo-id="01HX">hello</p>'
    const disk = '<p>goodbye</p>'
    expect(normalizedEqual(baseline, disk)).toBe(false)
  })

  it('returns true for pretty-print formatting differences (tag case)', () => {
    const baseline = '<!doctype html><html><body><p>x</p></body></html>'
    const disk = '<!DOCTYPE html><HTML><BODY><P>x</P></BODY></HTML>'
    expect(normalizedEqual(baseline, disk)).toBe(true)
  })
})

describe('externalStrippedDuoIds()', () => {
  it('returns false when baseline has no duo-ids', () => {
    expect(externalStrippedDuoIds('<p>x</p>', '<p>y</p>')).toBe(false)
  })

  it('returns true when disk strips all duo-ids from baseline', () => {
    const baseline = '<p data-duo-id="01HX">x</p><p data-duo-id="01HY">y</p>'
    const disk = '<p>x</p><p>y</p>'
    expect(externalStrippedDuoIds(baseline, disk)).toBe(true)
  })

  it('returns true when disk strips only some duo-ids', () => {
    const baseline = '<p data-duo-id="01HX">x</p><p data-duo-id="01HY">y</p>'
    const disk = '<p data-duo-id="01HX">x</p><p>y</p>'
    expect(externalStrippedDuoIds(baseline, disk)).toBe(true)
  })

  it('returns false when disk preserves all duo-ids', () => {
    const baseline = '<p data-duo-id="01HX">x</p>'
    const disk = '<p data-duo-id="01HX">x updated</p>'
    expect(externalStrippedDuoIds(baseline, disk)).toBe(false)
  })

  it('returns false on empty inputs', () => {
    expect(externalStrippedDuoIds('', '<p>x</p>')).toBe(false)
    expect(externalStrippedDuoIds('<p>x</p>', '')).toBe(false)
  })
})
