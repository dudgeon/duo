// ENH-216 OKF Vault Mode — coverage for the single node-free link helper.
// Pins slug, rel-path math, OKF serialization round-trip, mixed-syntax
// extraction (with external/image/anchor drops + dedup), and the move-proof
// targetKey equivalence between a wikilink and its slugged mdlink.

import { describe, it, expect } from 'vitest'
import {
  slugStem,
  targetKey,
  relLink,
  serializeOkfLink,
  serializeWikilink,
  linkSerializerFor,
  extractLinkRefs,
  extractLinkKeys,
  resolveMarkdownLinkHref,
  normalizePosix,
} from './vaultLinks'

describe('slugStem (D6)', () => {
  it('slugs a human name to a path-safe stem', () => {
    expect(slugStem('Customer Orders')).toBe('customer-orders')
  })

  it('lowercases, strips diacritics, folds underscores + spaces', () => {
    expect(slugStem('Café  Notes_Draft')).toBe('cafe-notes-draft')
  })

  it('drops path-unsafe punctuation and collapses hyphen runs', () => {
    expect(slugStem('Q3 / Launch: "Plan"!!')).toBe('q3-launch-plan')
  })

  it('trims leading/trailing separators', () => {
    expect(slugStem('  --Hello--  ')).toBe('hello')
  })

  it('falls back to "note" for an empty/punctuation-only name', () => {
    expect(slugStem('')).toBe('note')
    expect(slugStem('!!!')).toBe('note')
  })

  it('caps length to ~80 chars without a trailing hyphen', () => {
    const slug = slugStem('a '.repeat(60))
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('relLink (pure POSIX, ./-anchored)', () => {
  it('links between sibling folders with a ../ climb', () => {
    expect(relLink('initiatives/Q3 Launch.md', 'people/alice.md')).toBe('../people/alice.md')
  })

  it('anchors a same-folder target with ./', () => {
    expect(relLink('notes/a.md', 'notes/b.md')).toBe('./b.md')
  })

  it('descends into a subfolder with ./', () => {
    expect(relLink('index.md', 'people/alice.md')).toBe('./people/alice.md')
  })

  it('climbs out of a nested source', () => {
    expect(relLink('initiatives/Q3/milestone.md', 'log.md')).toBe('../../log.md')
  })
})

describe('serializeOkfLink (D3) + round-trip', () => {
  it('writes a standard markdown relative link, never a wikilink', () => {
    const link = serializeOkfLink('initiatives/q3.md', 'people/alice.md', 'Alice Park')
    expect(link).toBe('[Alice Park](../people/alice.md)')
    expect(link).not.toContain('[[')
  })

  it('falls back to the target basename when no display given', () => {
    expect(serializeOkfLink('index.md', 'people/alice.md')).toBe('[alice](./people/alice.md)')
  })

  it('round-trips: the serialized href re-resolves to the target', () => {
    const src = 'initiatives/Q3/plan.md'
    const tgt = 'people/alice.md'
    const link = serializeOkfLink(src, tgt, 'Alice')
    const href = link.slice(link.indexOf('(') + 1, link.lastIndexOf(')'))
    expect(resolveMarkdownLinkHref(href, src)).toBe(tgt)
  })
})

describe('serializeWikilink (obsidian)', () => {
  it('reduces a target path to its basename', () => {
    expect(serializeWikilink('a/b.md', 'people/alice.md')).toBe('[[alice]]')
  })

  it('emits a |display alias when it differs from the stem', () => {
    expect(serializeWikilink('a/b.md', 'people/alice.md', 'Alice Park')).toBe('[[alice|Alice Park]]')
  })

  it('omits a redundant alias equal to the stem', () => {
    expect(serializeWikilink('a/b.md', 'people/alice.md', 'alice')).toBe('[[alice]]')
  })
})

describe('linkSerializerFor (mode dispatch)', () => {
  it('obsidian → wikilink serializer (the default)', () => {
    expect(linkSerializerFor('obsidian')('a.md', 'b.md')).toBe('[[b]]')
  })

  it('okf → markdown-relative serializer', () => {
    expect(linkSerializerFor('okf')('a.md', 'b.md')).toBe('[b](./b.md)')
  })
})

describe('extractLinkRefs (mixed wikilink + mdlink)', () => {
  it('scans BOTH syntaxes in document order with provenance', () => {
    const text = 'See [[Customer Orders]] then [Alice](./people/alice.md).'
    const refs = extractLinkRefs(text)
    expect(refs.map((r) => r.syntax)).toEqual(['wikilink', 'mdlink'])
    expect(refs[0]).toMatchObject({
      key: 'customer-orders',
      display: 'Customer Orders',
      rawTarget: 'Customer Orders',
      syntax: 'wikilink',
    })
    expect(refs[1]).toMatchObject({
      key: 'alice',
      display: 'Alice',
      rawTarget: './people/alice.md',
      syntax: 'mdlink',
    })
  })

  it('captures a wikilink |display alias', () => {
    const [ref] = extractLinkRefs('[[Customer Orders|the orders]]')
    expect(ref.display).toBe('the orders')
    expect(ref.rawTarget).toBe('Customer Orders')
    expect(ref.key).toBe('customer-orders')
  })

  it('drops external (http/mailto), protocol-relative, pure-anchor, image links', () => {
    const text = [
      '[site](https://example.com)',
      '[mail](mailto:a@b.com)',
      '[proto](//cdn.example.com/x)',
      '[anchor](#section)',
      '![img](./pic.png)',
      '[keep](./real.md)',
    ].join(' ')
    const refs = extractLinkRefs(text)
    expect(refs).toHaveLength(1)
    expect(refs[0].rawTarget).toBe('./real.md')
  })

  it('keeps every occurrence (no dedup) in extractLinkRefs', () => {
    const refs = extractLinkRefs('[[Foo]] and again [[Foo]]')
    expect(refs).toHaveLength(2)
  })
})

describe('extractLinkKeys (deduped, feeds VaultFile.links)', () => {
  it('dedupes by key across both syntaxes, preserving first-seen order', () => {
    const text = '[[Customer Orders]] [also](./customer-orders.md) [[Alice]]'
    expect(extractLinkKeys(text)).toEqual(['customer-orders', 'alice'])
  })
})

describe('targetKey equivalence', () => {
  it('a wikilink and its slugged mdlink share a key', () => {
    expect(targetKey('Customer Orders', 'wikilink')).toBe(
      targetKey('./customer-orders.md', 'mdlink'),
    )
  })

  it('strips anchors and folds path/extension to a basename key', () => {
    expect(targetKey('Customer Orders#Heading', 'wikilink')).toBe('customer-orders')
    expect(targetKey('../people/customer-orders.md#h', 'mdlink')).toBe('customer-orders')
  })
})

describe('normalizePosix', () => {
  it('resolves . and .. and collapses //', () => {
    expect(normalizePosix('a/./b/../c//d')).toBe('a/c/d')
  })
})
