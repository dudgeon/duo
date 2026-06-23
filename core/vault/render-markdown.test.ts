// ENH-229 — Markdown rollup serializer + entity-link regression tests.
// Pinned to the frozen prototype vault (same fixture as base.test.ts) with a
// fixed asOf so date-relative formulas stay deterministic. Asserts the MD twin
// of the HTML emitter: GFM tables, per-group headings, and entity links (req
// #6) in BOTH formats from one evaluation.

import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { renderTarget } from './render'
import { valueToMarkdown } from './render-markdown'
import { Link } from './engine'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VAULT = path.resolve(HERE, '../../docs/research/graphbook-prototype')
const AS_OF = new Date('2026-06-09T12:00:00')
const BASE = 'bases/people-load.base' // groups by note.owner; order leads with file.name

describe('ENH-229 — Markdown rollup serializer', () => {
  it('renderTarget returns both html and md from one evaluation', () => {
    const r = renderTarget(VAULT, BASE, { asOf: AS_OF })
    expect(r.html).toContain('<table>')
    expect(typeof r.md).toBe('string')
    expect(r.md).toMatch(/^---\n/) // YAML frontmatter
    expect(r.md).toContain('source_hash:')
    expect(r.md).toContain('Build artifact')
  })

  it('emits a GFM table (header + divider)', () => {
    const r = renderTarget(VAULT, BASE, { asOf: AS_OF })
    expect(r.md).toContain('| --- |')
  })

  it('grouped view → per-group #### headings', () => {
    const r = renderTarget(VAULT, BASE, { asOf: AS_OF })
    expect(r.md).toMatch(/\n#### .+\(\d+\)/) // "#### <owner> (n)"
  })

  it('entity links — every row links its note in both formats (req #6)', () => {
    const r = renderTarget(VAULT, BASE, { asOf: AS_OF })
    expect(r.md).toMatch(/\]\(\.\.?\//) // [text](./ or ../
    expect(r.html).toContain('<a class="wikilink" href="')
  })

  it('outDir controls href relativity (rel from artifact to note)', () => {
    const atRoot = renderTarget(VAULT, BASE, { asOf: AS_OF, outDir: VAULT })
    const atOut = renderTarget(VAULT, BASE, { asOf: AS_OF, outDir: path.join(VAULT, 'out') })
    expect(atRoot.md).toMatch(/\]\(\.\//) // ./note.md from the root
    expect(atOut.md).toMatch(/\]\(\.\.\//) // ../note.md from out/
  })

  it('valueToMarkdown — unresolved Link is plain text; null/number normalize', () => {
    expect(valueToMarkdown(new Link('No Such Note', 'No Such Note'))).toBe('No Such Note')
    expect(valueToMarkdown(null)).toBe('—')
    expect(valueToMarkdown(42)).toBe('42')
  })

  it('valueToMarkdown — pipes in a value are GFM-escaped (no broken table cell)', () => {
    expect(valueToMarkdown('a | b')).toBe('a \\| b')
  })
})
