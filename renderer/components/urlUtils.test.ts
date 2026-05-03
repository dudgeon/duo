// Unit tests for pathFromFileUrl — locks the file:// → path
// conversion that drives BUG-045 (local-file browser tabs expose
// Reveal / Rename / Trash by resolving their URL back to a path).
// Edge cases worth pinning: URI-encoded spaces / unicode round-trip,
// non-file protocols return null, malformed URLs return null.

import { describe, it, expect } from 'vitest'
import { pathFromFileUrl } from './urlUtils'

describe('pathFromFileUrl', () => {
  describe('file:// URLs', () => {
    it('decodes a plain absolute path', () => {
      expect(pathFromFileUrl('file:///tmp/foo.html')).toBe('/tmp/foo.html')
    })

    it('decodes URI-encoded spaces', () => {
      // file:// URLs encode spaces as %20; pathFromFileUrl uses
      // decodeURIComponent to invert. A path with a space survives
      // a file:// round-trip.
      expect(pathFromFileUrl('file:///tmp/has%20space.html')).toBe('/tmp/has space.html')
    })

    it('decodes URI-encoded unicode (Japanese)', () => {
      // 日本語 encodes as %E6%97%A5%E6%9C%AC%E8%AA%9E
      expect(pathFromFileUrl('file:///tmp/%E6%97%A5%E6%9C%AC%E8%AA%9E.html')).toBe('/tmp/日本語.html')
    })

    it('decodes URI-encoded special chars', () => {
      expect(pathFromFileUrl('file:///tmp/with%2Bplus.html')).toBe('/tmp/with+plus.html')
      expect(pathFromFileUrl('file:///tmp/%23hash.html')).toBe('/tmp/#hash.html')
    })

    it('handles deep paths', () => {
      const url = 'file:///Users/alice/Documents/GitHub/repo/sub/dir/file.md'
      expect(pathFromFileUrl(url)).toBe('/Users/alice/Documents/GitHub/repo/sub/dir/file.md')
    })

    it('handles file:// with no host (POSIX shape)', () => {
      // Three slashes = empty host. Standard POSIX file:// shape.
      expect(pathFromFileUrl('file:///foo')).toBe('/foo')
    })
  })

  describe('non-file URLs return null', () => {
    it('http(s) returns null', () => {
      expect(pathFromFileUrl('http://example.com/foo')).toBeNull()
      expect(pathFromFileUrl('https://example.com/foo')).toBeNull()
    })

    it('about: returns null', () => {
      expect(pathFromFileUrl('about:blank')).toBeNull()
    })

    it('chrome: returns null', () => {
      expect(pathFromFileUrl('chrome://settings')).toBeNull()
    })

    it('data: returns null', () => {
      expect(pathFromFileUrl('data:text/html,<p>hi</p>')).toBeNull()
    })
  })

  describe('falsy / malformed inputs return null', () => {
    it('undefined returns null', () => {
      expect(pathFromFileUrl(undefined)).toBeNull()
    })

    it('empty string returns null', () => {
      expect(pathFromFileUrl('')).toBeNull()
    })

    it('bare `file:` (no slashes) returns null', () => {
      // Doesn't start with 'file://', so the guard returns null
      // before URL parsing.
      expect(pathFromFileUrl('file:foo')).toBeNull()
    })

    it('malformed URL returns null (try/catch fallback)', () => {
      // 'file://' alone is technically valid (URL constructor accepts
      // it as 'file:///'); pick a less-valid input. Encoding edge
      // cases like a bare lone-percent are what new URL throws on.
      expect(pathFromFileUrl('file://[invalid')).toBeNull()
    })
  })
})
