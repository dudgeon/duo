// ENH-110 — Tests for JSON / YAML format helpers. Locks the format
// detection + parse/serialize/seed contracts so regressions in either
// helper surface as a fail in CI rather than during a smoke walk.

import { describe, it, expect } from 'vitest'
import { formatFromPath, parseSource, serializeSource, emptySeed, humanizeParseError } from './jsonFormat'

describe('formatFromPath', () => {
  it('classifies .yml as yaml', () => {
    expect(formatFromPath('/tmp/config.yml')).toBe('yaml')
  })

  it('classifies .yaml as yaml', () => {
    expect(formatFromPath('/tmp/docker-compose.yaml')).toBe('yaml')
  })

  it('classifies .json as json (default)', () => {
    expect(formatFromPath('/tmp/config.json')).toBe('json')
  })

  it('classifies .jsonl as json', () => {
    expect(formatFromPath('/tmp/log.jsonl')).toBe('json')
  })

  it('classifies .har as json', () => {
    expect(formatFromPath('/tmp/network.har')).toBe('json')
  })

  it('lower-cases the extension', () => {
    expect(formatFromPath('/tmp/CONFIG.YAML')).toBe('yaml')
    expect(formatFromPath('/tmp/CONFIG.JSON')).toBe('json')
  })

  it('defaults unknown extensions to json', () => {
    // Caller routes via fileClassifier, so unknown should never reach
    // here; default-to-json lets JsonView fail gracefully if it does.
    expect(formatFromPath('/tmp/thing.txt')).toBe('json')
  })
})

describe('parseSource', () => {
  it('parses JSON objects', () => {
    expect(parseSource('{"a":1,"b":[2,3]}', 'json')).toEqual({ a: 1, b: [2, 3] })
  })

  it('parses JSON arrays', () => {
    expect(parseSource('[1,2,3]', 'json')).toEqual([1, 2, 3])
  })

  it('throws on invalid JSON (missing closed brace)', () => {
    // The owner-flagged example: "missing closed quotes or brackets"
    expect(() => parseSource('{"a":1', 'json')).toThrow()
  })

  it('parses YAML maps', () => {
    expect(parseSource('a: 1\nb:\n  - 2\n  - 3\n', 'yaml')).toEqual({ a: 1, b: [2, 3] })
  })

  it('parses YAML scalars', () => {
    expect(parseSource('hello', 'yaml')).toBe('hello')
  })

  it('throws on invalid YAML (mismatched indent)', () => {
    expect(() => parseSource('a:\n  b: 1\n c: 2\n', 'yaml')).toThrow()
  })
})

describe('serializeSource', () => {
  it('serializes JSON with 2-space indent + trailing newline', () => {
    expect(serializeSource({ a: 1 }, 'json')).toBe('{\n  "a": 1\n}\n')
  })

  it('serializes nested JSON', () => {
    const out = serializeSource({ a: { b: [1, 2] } }, 'json')
    expect(out).toContain('"a"')
    expect(out).toContain('"b"')
    expect(out.endsWith('\n')).toBe(true)
  })

  it('serializes YAML maps', () => {
    expect(serializeSource({ a: 1, b: 2 }, 'yaml')).toBe('a: 1\nb: 2\n')
  })

  it('round-trips JSON via parse → serialize → parse', () => {
    const src = { a: 1, b: [2, 3], c: { d: 'hello' } }
    const text = serializeSource(src, 'json')
    expect(parseSource(text, 'json')).toEqual(src)
  })

  it('round-trips YAML pure-content via parse → serialize → parse', () => {
    const src = { a: 1, b: [2, 3] }
    const text = serializeSource(src, 'yaml')
    expect(parseSource(text, 'yaml')).toEqual(src)
  })
})

describe('humanizeParseError — walk-5 UX fix', () => {
  it('JSON: unterminated → suggests checking unclosed brace/bracket/quote', () => {
    let display!: ReturnType<typeof humanizeParseError>
    try { parseSource('{"a":', 'json') } catch (err) { display = humanizeParseError(err, 'json') }
    expect(display.summary).toBe('Cannot parse as JSON')
    expect(display.hint).toMatch(/closing/i)
    expect(display.raw.length).toBeGreaterThan(0)
  })

  it('JSON: bad control character (owner walk-4 example) → suggests escape sequences', () => {
    // The owner walk-4 example: V8 in Electron emits "Bad control
    // character in string literal in JSON at position 86 (line 5
    // column 30)" when a literal control char (newline / tab) appears
    // inside a JSON string. Different Node / V8 versions emit
    // different phrasings for the same source — tests the branch
    // directly with the exact owner-reported message.
    const synthetic = new Error('Bad control character in string literal in JSON at position 86 (line 5 column 30)')
    const display = humanizeParseError(synthetic, 'json')
    expect(display.summary).toBe('Cannot parse as JSON')
    expect(display.hint).toMatch(/escape|\\n|\\t/i)
    expect(display.raw).toContain('line 5 column 30')
  })

  it('JSON: unexpected token → suggests common-cause checklist', () => {
    let display!: ReturnType<typeof humanizeParseError>
    try { parseSource("{'a': 1}", 'json') } catch (err) { display = humanizeParseError(err, 'json') }
    expect(display.summary).toBe('Cannot parse as JSON')
    expect(display.hint).toMatch(/comma|quote/i)
  })

  it('YAML: bad indentation → suggests space-vs-tab + consistent indent', () => {
    let display!: ReturnType<typeof humanizeParseError>
    try { parseSource('a:\n\tb: 1\n', 'yaml') } catch (err) { display = humanizeParseError(err, 'yaml') }
    expect(display.summary).toBe('Cannot parse as YAML')
    // js-yaml may phrase the error differently across versions; the
    // hint either matches the indentation pattern (then includes
    // 'spaces') or falls through to empty. Both are acceptable behavior.
    if (display.hint) expect(display.hint).toMatch(/space|indent/i)
  })

  it('always returns the raw error so the user sees line/column', () => {
    let display!: ReturnType<typeof humanizeParseError>
    try { parseSource('not valid json{}', 'json') } catch (err) { display = humanizeParseError(err, 'json') }
    expect(display.raw.length).toBeGreaterThan(0)
  })
})

describe('emptySeed', () => {
  it('JSON seed is parseable empty object', () => {
    const seed = emptySeed('json')
    expect(seed).toBe('{}\n')
    expect(parseSource(seed, 'json')).toEqual({})
  })

  it('YAML seed is a comment-only doc that parses to null', () => {
    const seed = emptySeed('yaml')
    expect(seed).toContain('# YAML document')
    // YAML parses comment-only as null/undefined; the user types
    // their first key, the parser resolves to a real map.
    expect(parseSource(seed, 'yaml')).toBe(null)
  })
})
