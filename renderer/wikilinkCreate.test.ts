// Sprint 10 ENH-108 — pin down the wikilink create-path contract.
// Drift would either break Obsidian-parity (e.g. `Foo.html` becoming
// `Foo.html.md`) or open a path-traversal escape from the vault root.

import { describe, it, expect } from 'vitest'
import { buildWikilinkCreatePath } from './wikilinkCreate'

describe('buildWikilinkCreatePath', () => {
  describe('extension handling', () => {
    it('appends .md to a bare target', () => {
      expect(buildWikilinkCreatePath('/v', 'Foo')).toBe('/v/Foo.md')
    })

    it('keeps an existing .md extension (no double-up)', () => {
      expect(buildWikilinkCreatePath('/v', 'Foo.md')).toBe('/v/Foo.md')
    })

    it('keeps an existing .html extension', () => {
      expect(buildWikilinkCreatePath('/v', 'Foo.html')).toBe('/v/Foo.html')
    })

    it('keeps an existing .htm extension', () => {
      expect(buildWikilinkCreatePath('/v', 'Foo.htm')).toBe('/v/Foo.htm')
    })

    it('keeps an existing .txt extension', () => {
      expect(buildWikilinkCreatePath('/v', 'Foo.txt')).toBe('/v/Foo.txt')
    })

    it('extension match is case-insensitive', () => {
      expect(buildWikilinkCreatePath('/v', 'Foo.MD')).toBe('/v/Foo.MD')
      expect(buildWikilinkCreatePath('/v', 'Foo.Html')).toBe('/v/Foo.Html')
    })

    it('appends .md when the trailing dot is part of the basename, not an extension', () => {
      // "Mr." is a name with a trailing period, not an extension.
      // The recognized list catches only md/html/htm/txt, so this
      // gets `.md` appended — correct for Obsidian-parity.
      expect(buildWikilinkCreatePath('/v', 'Mr.')).toBe('/v/Mr..md')
    })
  })

  describe('path-bearing targets', () => {
    it('keeps subdirectory shape and appends .md', () => {
      expect(buildWikilinkCreatePath('/v', 'notes/Foo')).toBe('/v/notes/Foo.md')
    })

    it('keeps deep subdirectory shape', () => {
      expect(buildWikilinkCreatePath('/v', 'a/b/c/Foo')).toBe('/v/a/b/c/Foo.md')
    })

    it('keeps existing extension on path-bearing target', () => {
      expect(buildWikilinkCreatePath('/v', 'notes/Foo.md')).toBe('/v/notes/Foo.md')
    })
  })

  describe('vault-root sanitization', () => {
    it('strips trailing slashes from vault root', () => {
      expect(buildWikilinkCreatePath('/v/', 'Foo')).toBe('/v/Foo.md')
      expect(buildWikilinkCreatePath('/v///', 'Foo')).toBe('/v/Foo.md')
    })
  })

  describe('path-traversal defense', () => {
    it('strips leading slashes from target (prevents absolute-path escape)', () => {
      expect(buildWikilinkCreatePath('/v', '/etc/passwd')).toBe('/v/etc/passwd.md')
    })

    it('drops .. segments (prevents up-traversal)', () => {
      expect(buildWikilinkCreatePath('/v', '../secret')).toBe('/v/secret.md')
      expect(buildWikilinkCreatePath('/v', 'notes/../../secret')).toBe('/v/notes/secret.md')
    })

    it('drops . segments (cosmetic but consistent)', () => {
      expect(buildWikilinkCreatePath('/v', './Foo')).toBe('/v/Foo.md')
      expect(buildWikilinkCreatePath('/v', 'a/./b/Foo')).toBe('/v/a/b/Foo.md')
    })

    it('drops empty segments (collapses double slashes)', () => {
      expect(buildWikilinkCreatePath('/v', 'a//b//Foo')).toBe('/v/a/b/Foo.md')
    })
  })

  describe('special characters in basename', () => {
    it('preserves spaces (Obsidian convention)', () => {
      expect(buildWikilinkCreatePath('/v', 'Hello World')).toBe('/v/Hello World.md')
    })

    it('preserves unicode in basename', () => {
      expect(buildWikilinkCreatePath('/v', 'Tëst Nøtē')).toBe('/v/Tëst Nøtē.md')
    })
  })
})
