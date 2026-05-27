// ENH-186 — project tile abbreviation tests.
//
// Coverage for the word-aware, collision-free tile labels that replaced
// the naive "first two characters" rule (which collapsed every `ai*` /
// `aipm*` project to a duplicative "AI").

import { describe, expect, it } from 'vitest'
import { splitProjectWords, computeProjectAbbreviations } from './projects'

// Small helper: build the {root, name} shape from a name list, deriving
// a unique root per name so callers can read results back by name.
function abbr(names: string[]): Record<string, string> {
  const projects = names.map((name, i) => ({ root: `/p/${i}/${name}`, name }))
  const map = computeProjectAbbreviations(projects)
  const out: Record<string, string> = {}
  for (const p of projects) out[p.name] = map.get(p.root)!
  return out
}

describe('splitProjectWords', () => {
  it('splits on hyphen, underscore, space, and dot', () => {
    expect(splitProjectWords('ai-pm-tools')).toEqual(['ai', 'pm', 'tools'])
    expect(splitProjectWords('ai_pm_tools')).toEqual(['ai', 'pm', 'tools'])
    expect(splitProjectWords('ai pm tools')).toEqual(['ai', 'pm', 'tools'])
    expect(splitProjectWords('ai.pm.tools')).toEqual(['ai', 'pm', 'tools'])
  })

  it('splits camelCase and PascalCase boundaries', () => {
    expect(splitProjectWords('aiPlatform')).toEqual(['ai', 'Platform'])
    expect(splitProjectWords('AIPlatform')).toEqual(['AI', 'Platform'])
    expect(splitProjectWords('myCoolProject')).toEqual(['my', 'Cool', 'Project'])
  })

  it('strips a leading dot and drops empty segments', () => {
    expect(splitProjectWords('.claude')).toEqual(['claude'])
    expect(splitProjectWords('--foo--bar--')).toEqual(['foo', 'bar'])
    expect(splitProjectWords('')).toEqual([])
    expect(splitProjectWords('...')).toEqual([])
  })

  it('keeps a single word as one element', () => {
    expect(splitProjectWords('platform')).toEqual(['platform'])
    expect(splitProjectWords('duo')).toEqual(['duo'])
  })
})

describe('computeProjectAbbreviations — baseline rules', () => {
  it('single-word name → first two letters (uppercased)', () => {
    expect(abbr(['duo'])).toEqual({ duo: 'DU' })
    expect(abbr(['platform'])).toEqual({ platform: 'PL' })
  })

  it('single-char name → single uppercase letter', () => {
    expect(abbr(['x'])).toEqual({ x: 'X' })
  })

  it('multi-word name → first letters of the first two words', () => {
    expect(abbr(['ai-platform'])).toEqual({ 'ai-platform': 'AP' })
    expect(abbr(['claude-code'])).toEqual({ 'claude-code': 'CC' })
    expect(abbr(['my-cool-project'])).toEqual({ 'my-cool-project': 'MC' })
  })

  it('strips a leading dot before abbreviating', () => {
    expect(abbr(['.claude'])).toEqual({ '.claude': 'CL' })
  })

  it('empty / delimiter-only names fall back to "?"', () => {
    expect(abbr(['---'])).toEqual({ '---': '?' })
  })
})

describe('computeProjectAbbreviations — the ai/aipm motivating case', () => {
  it('no longer collapses ai* projects to a duplicate "AI"', () => {
    const out = abbr(['ai-platform', 'ai-models', 'aipm-dashboard', 'aipm-tools'])
    expect(out).toEqual({
      'ai-platform': 'AP',
      'ai-models': 'AM',
      'aipm-dashboard': 'AD',
      'aipm-tools': 'AT'
    })
    // The whole point: every label is distinct.
    expect(new Set(Object.values(out)).size).toBe(4)
  })
})

describe('computeProjectAbbreviations — collision resolution', () => {
  it('multi-word: same first two words → expand to three initials', () => {
    expect(abbr(['ai-pm-tools', 'ai-pm-dashboard'])).toEqual({
      'ai-pm-tools': 'APT',
      'ai-pm-dashboard': 'APD'
    })
  })

  it('multi-word: three-word collision → numeric suffix by sort order', () => {
    // Both reduce to "APD" even at three initials (dashboard vs data).
    // First by sort order ("dashboard" < "data") keeps the clean form.
    expect(abbr(['ai-pm-dashboard', 'ai-pm-data'])).toEqual({
      'ai-pm-dashboard': 'APD',
      'ai-pm-data': 'APD2'
    })
  })

  it('multi-word: two-word names sharing initials → numeric suffix', () => {
    // Only two words each, so there is no third initial to expand to.
    expect(abbr(['ai-pm', 'ai-platform'])).toEqual({
      'ai-platform': 'AP',
      'ai-pm': 'AP2'
    })
  })

  it('single-word: collision → extend one letter at a time', () => {
    expect(abbr(['platform', 'planet'])).toEqual({
      platform: 'PLAT',
      planet: 'PLAN'
    })
  })

  it('single-word: collision capped at four letters → numeric suffix', () => {
    // "platen" and "platform" share the first four letters; the cap
    // stops the letter ladder and a numeric suffix takes over.
    expect(abbr(['platform', 'platen'])).toEqual({
      platen: 'PLAT',
      platform: 'PLAT2'
    })
  })

  it('identical names → numeric suffix on the (escalated) candidate', () => {
    const map = computeProjectAbbreviations([
      { root: '/a/duo', name: 'duo' },
      { root: '/b/duo', name: 'duo' }
    ])
    expect(map.get('/a/duo')).toBe('DUO')
    expect(map.get('/b/duo')).toBe('DUO2')
  })

  it('only the colliding subset escalates; unique tiles keep the short form', () => {
    const out = abbr(['ai-pm-tools', 'ai-pm-dashboard', 'beta-service'])
    expect(out).toEqual({
      'ai-pm-tools': 'APT',
      'ai-pm-dashboard': 'APD',
      'beta-service': 'BS'
    })
  })
})

describe('computeProjectAbbreviations — determinism', () => {
  it('is independent of input order', () => {
    const names = ['ai-pm-dashboard', 'ai-pm-data', 'platform', 'planet', 'duo']
    const forward = abbr(names)
    const reversed = abbr([...names].reverse())
    expect(reversed).toEqual(forward)
  })

  it('returns a label for every project root', () => {
    const projects = [
      { root: '/a', name: 'ai-platform' },
      { root: '/b', name: 'ai-models' },
      { root: '/c', name: 'duo' }
    ]
    const map = computeProjectAbbreviations(projects)
    expect([...map.keys()].sort()).toEqual(['/a', '/b', '/c'])
  })
})
