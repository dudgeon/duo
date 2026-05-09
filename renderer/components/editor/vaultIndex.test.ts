// Sprint 11 — pin down the vault-file scoring + ranking contract.
// All three suggestion features (`[[` popover, `@` mention, `⌘O`
// quick switcher) read from the same scorer; drift in the priority
// would silently break ranking across all of them.

import { describe, it, expect } from 'vitest'
import { scoreVaultFile, rankVaultFiles } from './vaultIndex'
import type { VaultFile } from './wikilinkResolver'

const f = (basename: string, relPath = `${basename}.md`): VaultFile => ({
  absPath: `/vault/${relPath}`,
  relPath,
  basename,
  ext: relPath.includes('.') ? relPath.slice(relPath.lastIndexOf('.') + 1) : ''
})

describe('scoreVaultFile — ranking priority', () => {
  it('exact basename match wins (1000)', () => {
    expect(scoreVaultFile(f('Foo'), 'Foo')).toBe(1000)
  })

  it('case-insensitive exact match also wins', () => {
    expect(scoreVaultFile(f('Foo'), 'foo')).toBe(1000)
    expect(scoreVaultFile(f('FOO'), 'foo')).toBe(1000)
  })

  it('basename starts-with beats contains', () => {
    expect(scoreVaultFile(f('Foobar'), 'foo')).toBe(500)
    expect(scoreVaultFile(f('barFoo'), 'foo')).toBeLessThan(500)
  })

  it('basename contains scores by position (earlier = higher)', () => {
    // 'foo' at idx 0 → 200 - 0 = 200; at idx 3 → 200 - 3 = 197
    expect(scoreVaultFile(f('foobar'), 'foo')).toBe(500) // starts-with overrides
    expect(scoreVaultFile(f('xxfoo'), 'foo')).toBeLessThan(scoreVaultFile(f('xfoo'), 'foo'))
  })

  it('falls through to relPath contains when basename has no match', () => {
    const file = f('thing', 'sub/dir/thing.md')
    // 'sub' is in relPath but not basename
    expect(scoreVaultFile(file, 'sub')).toBeGreaterThan(0)
    expect(scoreVaultFile(file, 'sub')).toBeLessThan(200) // basename-contain floor
  })

  it('returns -1 when no match anywhere', () => {
    expect(scoreVaultFile(f('Foo', 'a/Foo.md'), 'xyz')).toBe(-1)
  })

  it('empty query returns 0 (caller treats as "show everything")', () => {
    expect(scoreVaultFile(f('Foo'), '')).toBe(0)
  })
})

describe('rankVaultFiles — filter + sort', () => {
  const files = [
    f('Other Note'),
    f('Foo'),
    f('Foobar'),
    f('barFoo'),
    f('zeta', 'a/zeta.md'),
    f('alpha')
  ]

  it('empty query returns all files alphabetical', () => {
    const out = rankVaultFiles(files, '')
    expect(out.map((x) => x.basename)).toEqual([
      'alpha', 'barFoo', 'Foo', 'Foobar', 'Other Note', 'zeta'
    ])
  })

  it('non-empty query filters then sorts by score', () => {
    const out = rankVaultFiles(files, 'foo')
    // Exact "Foo" wins; "Foobar" beats "barFoo" because starts-with > contains.
    expect(out.map((x) => x.basename)).toEqual(['Foo', 'Foobar', 'barFoo'])
  })

  it('honors the limit cap', () => {
    expect(rankVaultFiles(files, '', 2).length).toBe(2)
  })

  it('drops files that don\'t match', () => {
    const out = rankVaultFiles(files, 'foo')
    expect(out.find((x) => x.basename === 'alpha')).toBeUndefined()
    expect(out.find((x) => x.basename === 'zeta')).toBeUndefined()
  })

  it('case-insensitive matching across alphabetical sort', () => {
    // alpha-sorting: lowercase letters sort lowercase together; the
    // test above already shows mixed-case ordering. Verify the
    // case-insensitive prefix matches still work end-to-end.
    const out = rankVaultFiles(files, 'OTHER')
    expect(out[0]?.basename).toBe('Other Note')
  })
})
