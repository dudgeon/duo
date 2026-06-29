// ENH-241 — unit tests for the pure frontmatter vault-link tokenizer that backs
// cmd+click navigation in the Properties panel. Render-time concerns (md-link
// in-vault resolvability, the cmd-click gate, the dispatch) are exercised live;
// these pin the syntax classification — especially the "wikilinks win over
// md-links" ordering that keeps `[[Foo]]` from being mis-parsed.

import { describe, it, expect } from 'vitest'
import { tokenizeFrontmatterLinks, type FmLinkToken } from './FrontmatterPanel'

const kinds = (toks: FmLinkToken[]) => toks.map(t => t.kind)

describe('tokenizeFrontmatterLinks', () => {
  it('returns a single text token for a link-free string', () => {
    expect(tokenizeFrontmatterLinks('just a value')).toEqual([
      { kind: 'text', text: 'just a value' }
    ])
  })

  it('returns [] semantics for empty input (no tokens)', () => {
    expect(tokenizeFrontmatterLinks('')).toEqual([])
  })

  it('parses a bare wikilink, carrying the inner target verbatim', () => {
    expect(tokenizeFrontmatterLinks('[[Foo Bar]]')).toEqual([
      { kind: 'wikilink', raw: '[[Foo Bar]]', target: 'Foo Bar' }
    ])
  })

  it('keeps alias / section text in the target (App.tsx owns stripping, like the body)', () => {
    expect(tokenizeFrontmatterLinks('[[Note#Heading]]')).toEqual([
      { kind: 'wikilink', raw: '[[Note#Heading]]', target: 'Note#Heading' }
    ])
  })

  it('parses an md-link into label + href', () => {
    expect(tokenizeFrontmatterLinks('[Display](./sub/foo.md)')).toEqual([
      { kind: 'mdlink', raw: '[Display](./sub/foo.md)', label: 'Display', href: './sub/foo.md' }
    ])
  })

  it('matches wikilinks FIRST so [[Foo]] is never read as an md-link', () => {
    const toks = tokenizeFrontmatterLinks('[[Foo]]')
    expect(kinds(toks)).toEqual(['wikilink'])
    expect((toks[0] as Extract<FmLinkToken, { kind: 'wikilink' }>).target).toBe('Foo')
  })

  it('splits surrounding text and multiple links in order', () => {
    const toks = tokenizeFrontmatterLinks('see [[A]] and [B](./b.md) end')
    expect(kinds(toks)).toEqual(['text', 'wikilink', 'text', 'mdlink', 'text'])
    expect(toks[0]).toEqual({ kind: 'text', text: 'see ' })
    expect(toks[2]).toEqual({ kind: 'text', text: ' and ' })
    expect(toks[4]).toEqual({ kind: 'text', text: ' end' })
  })

  it('tokenizes links inside JSON-ish array text (the expanded list view shape)', () => {
    // expandedValue() JSON.stringifies arrays; links sit inside quotes.
    const toks = tokenizeFrontmatterLinks('["[[A]]", "[[B]]"]')
    expect(kinds(toks).filter(k => k === 'wikilink')).toHaveLength(2)
  })

  it('classifies an external md-link syntactically (resolvability decided at render)', () => {
    const toks = tokenizeFrontmatterLinks('[site](https://example.com)')
    expect(toks).toEqual([
      { kind: 'mdlink', raw: '[site](https://example.com)', label: 'site', href: 'https://example.com' }
    ])
  })

  it('is stateless across calls (the shared /g regex lastIndex is reset each call)', () => {
    const a = tokenizeFrontmatterLinks('[[X]]')
    const b = tokenizeFrontmatterLinks('[[Y]]')
    expect((a[0] as Extract<FmLinkToken, { kind: 'wikilink' }>).target).toBe('X')
    expect((b[0] as Extract<FmLinkToken, { kind: 'wikilink' }>).target).toBe('Y')
  })
})
