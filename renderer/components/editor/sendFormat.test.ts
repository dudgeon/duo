// ENH-156a — Format A v2 carries selector_path + surrounding when the
// page-side observer captured them. Tests pin the emitted shape so a
// future Format-A change can't silently strip the DOM context that
// Claude needs to know where the selection came from.

import { describe, it, expect } from 'vitest'
import { formatBrowserSendPayload } from './sendFormat'
import type { BrowserSelectionSnapshot } from '@shared/types'

const baseSnap: BrowserSelectionSnapshot = {
  kind: 'browser',
  url: 'https://example.com/article',
  text: 'selected text'
}

describe('formatBrowserSendPayload — Format A', () => {
  it('baseline: emits quoted text + provenance (URL + title)', () => {
    const out = formatBrowserSendPayload(baseSnap, 'a', { pageTitle: 'Article' })
    expect(out).toBe(
      '> selected text\n> (https://example.com/article — "Article")\n'
    )
  })

  it('omits title in provenance when not provided', () => {
    const out = formatBrowserSendPayload(baseSnap, 'a')
    expect(out).toBe(
      '> selected text\n> (https://example.com/article)\n'
    )
  })

  it('appends `> @ <selector>` line when selector_path is present', () => {
    const snap: BrowserSelectionSnapshot = {
      ...baseSnap,
      selector_path: 'html > body > div#main > p:nth-child(3)'
    }
    const out = formatBrowserSendPayload(snap, 'a', { pageTitle: 'Article' })
    expect(out).toContain('> @ html > body > div#main > p:nth-child(3)\n')
  })

  it('omits selector line when selector_path is empty/whitespace', () => {
    const snap: BrowserSelectionSnapshot = { ...baseSnap, selector_path: '   ' }
    const out = formatBrowserSendPayload(snap, 'a')
    expect(out).not.toContain('> @ ')
  })

  it('appends fenced ```context``` block when surrounding is present and differs from text', () => {
    const snap: BrowserSelectionSnapshot = {
      ...baseSnap,
      selector_path: 'p:nth-child(3)',
      surrounding: 'Sentence before. selected text. Sentence after.'
    }
    const out = formatBrowserSendPayload(snap, 'a', { pageTitle: 'Article' })
    expect(out).toContain('````context\n')
    expect(out).toContain('Sentence before. selected text. Sentence after.')
    expect(out).toMatch(/````\n$/)
  })

  it('skips context block when surrounding equals the selection (no extra signal)', () => {
    const snap: BrowserSelectionSnapshot = {
      ...baseSnap,
      surrounding: 'selected text'
    }
    const out = formatBrowserSendPayload(snap, 'a')
    expect(out).not.toContain('context')
    expect(out).not.toContain('````')
  })

  it('skips context block when surrounding is empty/whitespace', () => {
    const snap: BrowserSelectionSnapshot = { ...baseSnap, surrounding: '   ' }
    const out = formatBrowserSendPayload(snap, 'a')
    expect(out).not.toContain('````')
  })

  it('uses 4-backtick fences so triple-backticks inside surrounding round-trip cleanly', () => {
    const snap: BrowserSelectionSnapshot = {
      ...baseSnap,
      surrounding: 'Code: ```js\nconst x = 1\n```'
    }
    const out = formatBrowserSendPayload(snap, 'a')
    expect(out).toContain('````context\n')
    expect(out).toContain('```js')
    expect(out).toMatch(/````\n$/)
  })

  it('full shape — text + provenance + selector + context, in order', () => {
    const snap: BrowserSelectionSnapshot = {
      kind: 'browser',
      url: 'https://example.com/a',
      text: 'middle line',
      selector_path: 'article > p:nth-child(2)',
      surrounding: 'first line\nmiddle line\nthird line'
    }
    const out = formatBrowserSendPayload(snap, 'a', { pageTitle: 'Page' })
    expect(out).toBe(
      '> middle line\n' +
      '> (https://example.com/a — "Page")\n' +
      '> @ article > p:nth-child(2)\n' +
      '\n' +
      '````context\n' +
      'first line\nmiddle line\nthird line\n' +
      '````\n'
    )
  })

  it('multi-line selections still get one `> ` per line', () => {
    const snap: BrowserSelectionSnapshot = {
      kind: 'browser',
      url: 'https://example.com',
      text: 'line one\nline two',
      selector_path: 'p'
    }
    const out = formatBrowserSendPayload(snap, 'a')
    expect(out.startsWith('> line one\n> line two\n')).toBe(true)
  })
})

describe('formatBrowserSendPayload — Format B (unchanged)', () => {
  it('emits literal text + trailing space; ignores selector_path and surrounding', () => {
    const snap: BrowserSelectionSnapshot = {
      ...baseSnap,
      selector_path: 'p',
      surrounding: 'big surrounding block'
    }
    expect(formatBrowserSendPayload(snap, 'b')).toBe('selected text ')
  })
})
