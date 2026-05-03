// Unit tests for the tilde-expansion helper extracted from main.ts
// (BUG-067 / ENH-039 lineage — smoke-walk page-link clicks emit `~/...`
// paths verbatim from the manifest; the fix is to expand BEFORE the
// renderer's openFileSmart calls fs.stat against the literal string).
//
// Locked behavior:
// - Bare `~` → home
// - `~/foo/bar` → home/foo/bar (POSIX join, preserves separators)
// - Anything else → returned unchanged (absolute paths, http URLs,
//   relative paths, file:// URLs, paths with embedded `~`)

import { describe, it, expect } from 'vitest'
import { expandTilde } from './path-utils'

describe('expandTilde', () => {
  const HOME = '/Users/test'

  it('expands bare ~', () => {
    expect(expandTilde('~', HOME)).toBe(HOME)
  })

  it('expands ~/path/to/file', () => {
    expect(expandTilde('~/foo/bar.md', HOME)).toBe('/Users/test/foo/bar.md')
  })

  it('expands ~/ alone (preserves trailing semantics)', () => {
    expect(expandTilde('~/', HOME)).toBe('/Users/test')
  })

  it('does NOT expand absolute paths', () => {
    expect(expandTilde('/etc/hosts', HOME)).toBe('/etc/hosts')
  })

  it('does NOT expand relative paths without ~', () => {
    expect(expandTilde('./foo.md', HOME)).toBe('./foo.md')
    expect(expandTilde('foo/bar.md', HOME)).toBe('foo/bar.md')
  })

  it('does NOT expand http(s) URLs', () => {
    expect(expandTilde('https://example.com', HOME)).toBe('https://example.com')
    expect(expandTilde('file:///tmp/x.html', HOME)).toBe('file:///tmp/x.html')
  })

  it('does NOT expand `~user/...` (other-user home, intentionally unsupported)', () => {
    // Documented carve-out — `~user/...` is rare in this context;
    // until a real ask shows up, we treat it as a literal path.
    expect(expandTilde('~someone/file.md', HOME)).toBe('~someone/file.md')
  })

  it('does NOT expand a `~` mid-path (only leading ~ is special)', () => {
    expect(expandTilde('/etc/~/file', HOME)).toBe('/etc/~/file')
  })
})
