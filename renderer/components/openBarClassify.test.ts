// ENH-224 — the Open bar's search-vs-target heuristic. The resolver itself is
// covered in core/open-resolve.test.ts; this pins the ONE decision layered on
// top: a bare token fuzzy-finds the vault, anything path-shaped or a URL opens.

import { describe, it, expect } from 'vitest'
import { classifyInput } from './openBarClassify'

describe('classifyInput — search vs open-target (ENH-224 D18)', () => {
  it('empty / whitespace → empty mode', () => {
    expect(classifyInput('').mode).toBe('empty')
    expect(classifyInput('   ').mode).toBe('empty')
  })

  it('a bare token → SEARCH (preserves the old ⌘O fuzzy-find)', () => {
    expect(classifyInput('roadmap')).toEqual({ mode: 'search', query: 'roadmap' })
    expect(classifyInput('  notes  ')).toEqual({ mode: 'search', query: 'notes' })
  })

  it('a token with a dot but no slash is still a SEARCH (filename-ish query)', () => {
    // "roadmap.md" with no slash reads as a search term, not a relative path —
    // the user is most likely fuzzy-finding by filename.
    expect(classifyInput('roadmap.md')).toEqual({ mode: 'search', query: 'roadmap.md' })
  })

  it('anything with a slash → open-TARGET (local-path)', () => {
    const r = classifyInput('docs/roadmap.md')
    expect(r.mode).toBe('target')
    if (r.mode === 'target') expect(r.target.kind).toBe('local-path')
  })

  it('leading ~ / / / ./ / ../ → open-TARGET', () => {
    for (const p of ['~/x.md', '/abs/x.md', './rel.md', '../up.md', '~']) {
      const r = classifyInput(p)
      expect(r.mode).toBe('target')
      if (r.mode === 'target') expect(r.target.kind).toBe('local-path')
    }
  })

  it('file:// URL → open-TARGET (local-path)', () => {
    const r = classifyInput('file:///Users/me/x.md')
    expect(r.mode).toBe('target')
    if (r.mode === 'target') {
      expect(r.target.kind).toBe('local-path')
      if (r.target.kind === 'local-path') expect(r.target.path).toBe('/Users/me/x.md')
    }
  })

  it('a web URL → open-TARGET (url)', () => {
    const r = classifyInput('https://example.com/page')
    expect(r.mode).toBe('target')
    if (r.mode === 'target') expect(r.target.kind).toBe('url')
  })

  it('a GitHub file URL → open-TARGET (github-file, drives the file-vs-repo choice)', () => {
    const r = classifyInput('https://github.com/dudgeon/duo/blob/main/docs/roadmap.md')
    expect(r.mode).toBe('target')
    if (r.mode === 'target') expect(r.target.kind).toBe('github-file')
  })

  it('a GitHub repo URL → open-TARGET (github-repo)', () => {
    const r = classifyInput('https://github.com/vercel/next.js')
    expect(r.mode).toBe('target')
    if (r.mode === 'target') expect(r.target.kind).toBe('github-repo')
  })

  it('a bare github.com host (no scheme) → open-TARGET, not a search', () => {
    const r = classifyInput('github.com/dudgeon/duo')
    expect(r.mode).toBe('target')
    if (r.mode === 'target') expect(r.target.kind).toBe('github-repo')
  })
})
