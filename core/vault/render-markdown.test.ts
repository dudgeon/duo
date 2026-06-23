// ENH-229 — Markdown rollup serializer + entity-link regression tests.
// Pinned to the frozen prototype vault (same fixture as base.test.ts) with a
// fixed asOf so date-relative formulas stay deterministic. Asserts the MD twin
// of the HTML emitter: GFM tables, per-group headings, and entity links (req
// #6) in BOTH formats from one evaluation.

import { describe, it, expect } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { fileURLToPath } from 'url'
import { renderTarget } from './render'
import { valueToMarkdown } from './render-markdown'
import { Link } from './engine'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VAULT = path.resolve(HERE, '../../docs/research/graphbook-prototype')
const AS_OF = new Date('2026-06-09T12:00:00')
const BASE = 'bases/people-load.base' // groups by note.owner; order leads with file.name

/** Build a throwaway vault from a {relPath: content} map. */
function tmpVault(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rollup-md-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  return root
}
const TASK_BASE = 'filters:\n  and:\n    - type == "task"\nviews:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - owner\n'

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
    expect(r.md).toMatch(/\]\(<\.\.?\//) // [text](<./ or <../  (angle-bracketed href)
    expect(r.html).toContain('<a class="wikilink" href="')
  })

  it('outDir controls href relativity (rel from artifact to note)', () => {
    const atRoot = renderTarget(VAULT, BASE, { asOf: AS_OF, outDir: VAULT })
    const atOut = renderTarget(VAULT, BASE, { asOf: AS_OF, outDir: path.join(VAULT, 'out') })
    expect(atRoot.md).toMatch(/\]\(<\.\//) // ](<./note.md> from the root
    expect(atOut.md).toMatch(/\]\(<\.\.\//) // ](<../note.md> from out/
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

describe('ENH-229 — review fixes (escaping, OKF rel-md, YAML)', () => {
  it('valueToMarkdown escapes []() and backticks so values cannot break links/headings', () => {
    expect(valueToMarkdown('Task [X] (y) `z`')).toBe('Task \\[X\\] \\(y\\) \\`z\\`')
  })

  it('unresolved Link display is escaped, not raw', () => {
    expect(valueToMarkdown(new Link('a]b(c)', 'a]b(c)'))).toBe('a\\]b\\(c\\)')
  })

  it('OKF rel-md frontmatter entity ref resolves + links (req #6 in OKF mode)', () => {
    const root = tmpVault({
      'people/alice-park.md': '---\ntype: person\n---\n# Alice Park\n',
      'notes/task-a.md': '---\ntype: task\nowner: "[Alice Park](./people/alice-park.md)"\n---\n# Task A\n',
      'bases/t.base': TASK_BASE,
    })
    try {
      const r = renderTarget(root, 'bases/t.base', { asOf: AS_OF })
      // owner stored as OKF rel-md → resolved to a markdown link (angle-bracketed href)
      expect(r.md).toMatch(/\[Alice Park\]\(<\.\.?\/people\/alice-park\.md>\)/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('href containing parens is angle-bracketed (valid GFM)', () => {
    const root = tmpVault({
      'notes/weird (draft).md': '---\ntype: task\n---\n# Weird\n',
      'bases/t.base': TASK_BASE,
    })
    try {
      const r = renderTarget(root, 'bases/t.base', { asOf: AS_OF })
      expect(r.md).toContain('(<') // angle-bracketed
      expect(r.md).toMatch(/weird \(draft\)\.md>\)/) // paren path survives inside <>
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('YAML title is double-quoted (survives : / --- / # in the target)', () => {
    const root = tmpVault({ 'a.md': '---\ntype: task\n---\n', 'bases/t.base': TASK_BASE })
    try {
      const r = renderTarget(root, 'bases/t.base', { asOf: AS_OF })
      expect(r.md).toMatch(/^---\ntitle: "/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('ENH-229 phase 2 — snapshot + summary + style (render wiring)', () => {
  const mk = () => tmpVault({ 'notes/a.md': '---\ntype: task\nstatus: blocked\n---\n', 'bases/t.base': TASK_BASE })

  it('embedSnapshot writes a rows-snapshot comment in both formats + returns the snapshot', () => {
    const root = mk()
    try {
      const r = renderTarget(root, 'bases/t.base', { asOf: AS_OF, embedSnapshot: true })
      expect(r.md).toContain('<!--duo:rollup-snapshot ')
      expect(r.html).toContain('<!--duo:rollup-snapshot ')
      expect(r.snapshot.views[0].rows[0].key).toBe('notes/a.md')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('summaryLog renders "What changed" (latest + collapsible history) + embeds the log', () => {
    const root = mk()
    try {
      const log = [
        { date: '2026-Jun-23', text: 'latest note' },
        { date: '2026-Jun-20', text: 'older note' },
      ]
      const r = renderTarget(root, 'bases/t.base', { asOf: AS_OF, summaryLog: log, embedSnapshot: true })
      expect(r.md).toContain('**What changed** · 2026-Jun-23 — latest note')
      expect(r.md).toContain('Change history (1)')
      expect(r.md).toContain('<!--duo:rollup-summary ')
      expect(r.html).toContain('changes-lab')
      expect(r.html).toContain('latest note')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('no summaryLog → no "What changed" section', () => {
    const root = mk()
    try {
      const r = renderTarget(root, 'bases/t.base', { asOf: AS_OF, embedSnapshot: true })
      expect(r.md).not.toContain('What changed')
      // 'changes-lab' appears in the CSS rules regardless; assert on the rendered
      // section markup + text instead.
      expect(r.html).not.toContain('<section class="changes">')
      expect(r.html).not.toContain('What changed')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('styleCss is layered into the HTML head (req #3); </style> in CSS is neutralized', () => {
    const root = mk()
    try {
      const r = renderTarget(root, 'bases/t.base', { asOf: AS_OF, styleCss: 'body{background:#abc}</style><script>x' })
      expect(r.html).toContain('body{background:#abc}')
      expect(r.html).not.toContain('</style><script>') // breakout neutralized
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('HTML artifact carries the Copy-as-Markdown + Refresh toolbar (req #4)', () => {
    const root = mk()
    try {
      const r = renderTarget(root, 'bases/t.base', { asOf: AS_OF, embedSnapshot: true })
      expect(r.html).toContain('data-rollup-copy')
      expect(r.html).toContain('data-event="rollup:refresh"')
      expect(r.html).toContain('window.__rollupMd')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('two embedded base blocks with the same view name → disambiguated snapshot views', () => {
    const root = tmpVault({
      'notes/task-a.md': '---\ntype: task\n---\n',
      'people/p.md': '---\ntype: person\n---\n',
      'notes/dash.md':
        '# Dash\n\n```base\nfilters:\n  and:\n    - type == "task"\nviews:\n  - type: table\n    name: Tasks\n    order: [file.name]\n```\n\n```base\nfilters:\n  and:\n    - type == "person"\nviews:\n  - type: table\n    name: Tasks\n    order: [file.name]\n```\n',
    })
    try {
      const r = renderTarget(root, 'notes/dash.md', { asOf: AS_OF, embedSnapshot: true })
      expect(r.snapshot.views.map((v) => v.name)).toEqual(['Tasks', 'Tasks (2)'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
