// ENH-208 — the shared home-abbreviation helper (palette footer + the
// Settings → Default Vault menu labels). Moved here from the palette's
// test file when the helper became shared between renderer and main.

import { describe, it, expect } from 'vitest'
import { abbreviateHome } from './path-display'

describe('abbreviateHome (ENH-208 vault-path display)', () => {
  it('abbreviates a path under home', () => {
    expect(abbreviateHome('/Users/g/vault', '/Users/g')).toBe('~/vault')
  })

  it('abbreviates home itself to ~', () => {
    expect(abbreviateHome('/Users/g', '/Users/g')).toBe('~')
  })

  it('does not abbreviate a sibling that merely shares the prefix string', () => {
    // '/Users/gg' starts with '/Users/g' as a string but is NOT under
    // that home dir — the separator check prevents the false positive.
    expect(abbreviateHome('/Users/gg/vault', '/Users/g')).toBe('/Users/gg/vault')
  })

  it('leaves paths outside home untouched', () => {
    expect(abbreviateHome('/tmp/vault', '/Users/g')).toBe('/tmp/vault')
  })

  it('passes through unchanged when home is empty', () => {
    expect(abbreviateHome('/Users/g/vault', '')).toBe('/Users/g/vault')
  })
})
