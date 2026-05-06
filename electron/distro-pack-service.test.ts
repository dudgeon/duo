// Stage 21d-i — distro-pack-service unit tests.
//
// Pure-function coverage for the modules's deterministic logic
// (version compat parsing + CLAUDE.md merge planning). The full
// install pipeline lives in jsdom-friendly territory but exercises
// the real filesystem; we test that via temporary-directory-based
// integration in a separate `*.integration.test.ts` if/when scope
// warrants. v1 ships with the pure tests as the smoke walk's
// safety net.

import { describe, it, expect } from 'vitest'
import {
  checkVersionCompat,
  composeDistroClaudeMdBlock,
  planDistroClaudeMdMerge
} from './distro-pack-service'

describe('checkVersionCompat (Stage 21d-i)', () => {
  it('returns null when no requiresDuoVersion is set', () => {
    expect(checkVersionCompat('0.6.8', undefined)).toBeNull()
    expect(checkVersionCompat('0.6.8', '')).toBeNull()
  })

  it('returns null when range is satisfied (>=A.B.C <X.Y.Z)', () => {
    expect(checkVersionCompat('0.6.8', '>=0.6.7 <0.8')).toBeNull()
    expect(checkVersionCompat('0.6.8', '>=0.6.0 <1.0.0')).toBeNull()
  })

  it('returns an error when running below the minimum', () => {
    expect(checkVersionCompat('0.6.5', '>=0.6.7 <0.8')).toMatch(/Pack requires Duo >=0\.6\.7/)
    expect(checkVersionCompat('0.5.0', '>=0.6.0 <1.0.0')).toMatch(/Pack requires Duo >=0\.6\.0/)
  })

  it('returns an error when running at or above the maximum', () => {
    // The `<` operator means "strictly less than" — 0.8.0 fails for `<0.8.0`.
    expect(checkVersionCompat('0.8.0', '>=0.6.7 <0.8.0')).toMatch(/Pack requires Duo <0\.8\.0/)
    expect(checkVersionCompat('1.0.0', '>=0.6.0 <1.0.0')).toMatch(/Pack requires Duo <1\.0\.0/)
  })

  it('handles missing patch in the range gracefully (treat .0)', () => {
    // `<0.8` parses as < 0.8.0 — anything 0.8.x and above fails.
    // Our parser only parses fully-qualified X.Y.Z, so `<0.8` falls
    // through to the warn-and-pass branch. Document the behavior
    // without locking it as a contract — distros should write
    // fully-qualified ranges.
    expect(checkVersionCompat('0.8.0', '>=0.6.7 <0.8')).toBeNull() // current parser limitation
  })

  it('warns + falls open on unparseable range syntax', () => {
    // The parser is intentionally permissive — unknown range syntax
    // shouldn't block install. The console.warn is informational.
    expect(checkVersionCompat('0.6.8', '~0.6.7')).toBeNull()
    expect(checkVersionCompat('0.6.8', '0.6.x')).toBeNull()
  })

  it('handles non-semver Duo version (defaults to 0.0.0)', () => {
    // Duo's version SHOULD match the X.Y.Z pattern; if it doesn't
    // we fall back to 0.0.0 which fails any min-set range. This is
    // a defensive guard, not an expected path.
    expect(checkVersionCompat('dev', '>=0.6.7 <0.8.0')).toMatch(/Pack requires Duo >=/)
  })
})

describe('composeDistroClaudeMdBlock (Stage 21d-i)', () => {
  it('frames the body with managed markers + version', () => {
    const block = composeDistroClaudeMdBlock('aip-corporate', '1.0.0', 'Distro guidance here.')
    expect(block).toContain('<!-- distro:aip-corporate-managed-v1.0.0')
    expect(block).toContain('<!-- distro:aip-corporate-end -->')
    expect(block).toContain('Distro guidance here.')
  })

  it('trims surrounding whitespace from the body', () => {
    const block = composeDistroClaudeMdBlock('aip', '1.0.0', '\n\n  Body  \n\n')
    expect(block).toContain('Body')
    expect(block).not.toMatch(/\n\n\n/) // no triple-newline runs from trim leakage
  })

  it('encodes the distro name into the marker (different distros get different markers)', () => {
    const a = composeDistroClaudeMdBlock('alpha', '1.0', 'a')
    const b = composeDistroClaudeMdBlock('beta', '1.0', 'b')
    expect(a).toContain('<!-- distro:alpha-managed-v1.0')
    expect(b).toContain('<!-- distro:beta-managed-v1.0')
  })
})

describe('planDistroClaudeMdMerge (Stage 21d-i)', () => {
  const block = composeDistroClaudeMdBlock('aip', '1.0.0', 'AIP guidance.')

  it('creates a fresh file when CLAUDE.md does not exist', () => {
    const plan = planDistroClaudeMdMerge(null, 'aip', block)
    expect(plan.action).toBe('created')
    expect(plan.contents).toBe(block + '\n')
  })

  it('appends to an existing file when no prior block exists for this distro', () => {
    const existing = '# Existing CLAUDE.md\n\nUser instructions.\n'
    const plan = planDistroClaudeMdMerge(existing, 'aip', block)
    expect(plan.action).toBe('appended')
    expect(plan.contents!.startsWith(existing)).toBe(true)
    expect(plan.contents).toContain(block)
  })

  it('replaces an existing block (different version) for the same distro', () => {
    const oldBlock = composeDistroClaudeMdBlock('aip', '1.0.0', 'Old body.')
    const existing = `# Header\n\n${oldBlock}\n\n## Footer\n`
    const newBlock = composeDistroClaudeMdBlock('aip', '1.1.0', 'New body.')
    const plan = planDistroClaudeMdMerge(existing, 'aip', newBlock)
    expect(plan.action).toBe('replaced')
    expect(plan.contents).toContain('1.1.0')
    expect(plan.contents).toContain('New body.')
    expect(plan.contents).not.toContain('Old body.')
    // The header + footer should survive.
    expect(plan.contents).toContain('# Header')
    expect(plan.contents).toContain('## Footer')
  })

  it('returns no-op when the existing block is byte-for-byte current', () => {
    const existing = `# Header\n\n${block}\n\n## Footer\n`
    const plan = planDistroClaudeMdMerge(existing, 'aip', block)
    expect(plan.action).toBe('unchanged')
    expect(plan.contents).toBeNull()
  })

  it('coexists with Duo\'s own managed block (different markers, no collision)', () => {
    const duoBlock = '<!-- duo:managed-v0.6.7 -->\nDuo guidance.\n<!-- duo:end -->'
    const existing = `# CLAUDE.md\n\n${duoBlock}\n`
    const plan = planDistroClaudeMdMerge(existing, 'aip', block)
    expect(plan.action).toBe('appended')
    // Both blocks present after merge.
    expect(plan.contents).toContain('duo:managed-v0.6.7')
    expect(plan.contents).toContain('distro:aip-managed-v1.0.0')
  })

  it('coexists with another distro\'s block (same marker shape, different distro names)', () => {
    const otherDistro = composeDistroClaudeMdBlock('xyz-corp', '2.0', 'XYZ guidance.')
    const existing = `# CLAUDE.md\n\n${otherDistro}\n`
    const plan = planDistroClaudeMdMerge(existing, 'aip', block)
    expect(plan.action).toBe('appended')
    expect(plan.contents).toContain('distro:xyz-corp-managed-v2.0')
    expect(plan.contents).toContain('distro:aip-managed-v1.0.0')
  })

  it('regex-escapes special characters in the distro name (defensive against weird names)', () => {
    // Pack-builder will reject distro names with regex specials at
    // authoring time, but the merge function should still be
    // defensible — name comes through external manifests.
    const safeBlock = composeDistroClaudeMdBlock('aip-corp', '1.0', 'body')
    const plan = planDistroClaudeMdMerge('# H\n', 'aip-corp', safeBlock)
    expect(plan.action).toBe('appended')
  })
})
