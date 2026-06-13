// ENH-208 Vault — search congruence tests (Phase 2 review fixes). The
// docMatchIndex contract: a hit's occurrence index must count what the
// EDITOR doc contains (body only, every non-overlapping occurrence per
// line), because the ⌘⇧F palette hands it to the editor's goto-match jump.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { search, searchAsync, VAULT_SEARCH_DEFAULT_LIMIT } from './search'

let dir: string

function note(rel: string, content: string): void {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-vault-search-'))
  fs.mkdirSync(path.join(dir, '.obsidian'), { recursive: true })
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('search docMatchIndex (palette → editor goto-match congruence)', () => {
  it('counts every non-overlapping occurrence in earlier body lines', () => {
    note('a.md', 'foo foo\nbar foo\n')
    const hits = search(dir, 'foo')
    // Line 1 holds occurrences 0+1; the line-2 hit therefore starts at 2.
    expect(hits.map((h) => [h.line, h.docMatchIndex])).toEqual([
      [1, 0],
      [2, 2],
    ])
  })

  it('frontmatter hits carry null and do not advance the body counter', () => {
    note('b.md', '---\nstatus: blocked\n---\n\nblocked once\nstill blocked\n')
    const hits = search(dir, 'blocked')
    expect(hits.map((h) => [h.line, h.docMatchIndex])).toEqual([
      [2, null], // frontmatter — no doc twin
      [5, 0],
      [6, 1],
    ])
  })

  it('a file without frontmatter starts counting at line 1', () => {
    note('c.md', 'plain pricing line\n')
    expect(search(dir, 'pricing')[0].docMatchIndex).toBe(0)
  })

  it('an unclosed frontmatter fence is body (mirrors splitFrontmatter)', () => {
    note('d.md', '---\nstatus: open\nno closing fence\n')
    const hits = search(dir, 'open')
    expect(hits[0].docMatchIndex).toBe(0) // not null — splitFrontmatter would not strip it
  })

  it('CRLF files count like the editor (fences with \\r, excerpts without)', () => {
    // The editor's splitter tolerates \r and trailing whitespace on fence
    // lines (markdown-io FENCE_RE) — search must agree or docMatchIndex
    // drifts by however many needles the frontmatter holds.
    note('crlf.md', '---\r\nstatus: blocked\r\n--- \r\n\r\nblocked once\r\nstill blocked\r\n')
    const hits = search(dir, 'blocked')
    expect(hits.map((h) => [h.line, h.docMatchIndex])).toEqual([
      [2, null], // frontmatter — fence recognized despite \r + trailing space
      [5, 0],
      [6, 1],
    ])
    for (const h of hits) expect(h.excerpt).not.toContain('\r')
  })

  it('non-overlapping advance matches the editor scan rule', () => {
    note('e.md', 'aaaa\nfind aa here\n')
    // 'aa' in 'aaaa' = 2 non-overlapping occurrences (not 3).
    const hits = search(dir, 'aa')
    expect(hits.map((h) => h.docMatchIndex)).toEqual([0, 2])
  })
})

describe('searchAsync parity with search', () => {
  it('returns byte-identical results on the same vault', async () => {
    note('x/one.md', '---\ntags: review\n---\nreview me\nreview again review\n')
    note('y/two.md', 'nothing here\n')
    note('z/three.md', 'review at last\n')
    const sync = search(dir, 'review')
    const async_ = await searchAsync(dir, 'review')
    expect(async_).toEqual(sync)
    expect(sync.length).toBe(4)
  })

  it('honors the shared default limit', async () => {
    const lines = Array.from({ length: 30 }, () => 'cap me').join('\n')
    for (let i = 0; i < 10; i++) note(`n${i}.md`, lines)
    expect(search(dir, 'cap me', 7).length).toBe(7)
    expect((await searchAsync(dir, 'cap me', 7)).length).toBe(7)
    expect(VAULT_SEARCH_DEFAULT_LIMIT).toBe(200)
  })

  it('the async walk skips the same dirs as the sync one', async () => {
    note('.obsidian/config.md', 'skipped needle\n')
    note('templates/person.md', 'skipped needle\n')
    note('real.md', 'skipped needle\n')
    const sync = search(dir, 'skipped needle')
    const async_ = await searchAsync(dir, 'skipped needle')
    expect(async_).toEqual(sync)
    expect(async_.map((h) => h.path)).toEqual(['real.md'])
  })

  it('returns [] for an empty query', async () => {
    note('q.md', 'anything\n')
    expect(search(dir, '')).toEqual([])
    expect(await searchAsync(dir, '')).toEqual([])
  })
})
