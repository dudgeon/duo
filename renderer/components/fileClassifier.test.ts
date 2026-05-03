// Unit tests for fileClassifier — locks the extension → WorkingTabType
// mapping that drives FileTree double-click, `duo edit`, `duo view`,
// new-file boilerplate dispatch, and the openFileSmart routing. A
// regression here (`.md` routing to canvas, `.html` routing to editor)
// breaks user expectations across multiple surfaces at once.
//
// Note on case-insensitivity: classifyFile lower-cases the extension
// before the switch, so 'README.MD' classifies the same as 'README.md'.
// macOS file systems are case-preserving but case-insensitive by
// default, so this matches user expectations.

import { describe, it, expect } from 'vitest'
import { classifyFile } from './fileClassifier'

describe('classifyFile', () => {
  describe('markdown — Stage 11 default to rich editor', () => {
    it('classifies .md as editor with text/markdown mime', () => {
      expect(classifyFile('/tmp/foo.md')).toEqual({
        type: 'editor',
        mime: 'text/markdown'
      })
    })

    it('classifies .markdown as editor', () => {
      expect(classifyFile('/tmp/foo.markdown')).toEqual({
        type: 'editor',
        mime: 'text/markdown'
      })
    })

    it('lower-cases the extension (README.MD treated like README.md)', () => {
      expect(classifyFile('/tmp/README.MD')).toEqual({
        type: 'editor',
        mime: 'text/markdown'
      })
    })
  })

  describe('html — Stage 17a default to canvas', () => {
    it('classifies .html as html-canvas', () => {
      expect(classifyFile('/tmp/page.html')).toEqual({
        type: 'html-canvas',
        mime: 'text/html'
      })
    })

    it('classifies .htm as html-canvas (same as .html)', () => {
      expect(classifyFile('/tmp/page.htm')).toEqual({
        type: 'html-canvas',
        mime: 'text/html'
      })
    })
  })

  describe('images — type=image, per-format mime', () => {
    it('classifies .png as image/png', () => {
      expect(classifyFile('/tmp/photo.png')).toEqual({
        type: 'image',
        mime: 'image/png'
      })
    })

    it('classifies .jpg AND .jpeg as image/jpeg', () => {
      expect(classifyFile('/tmp/photo.jpg').mime).toBe('image/jpeg')
      expect(classifyFile('/tmp/photo.jpeg').mime).toBe('image/jpeg')
    })

    it('classifies .gif as image/gif', () => {
      expect(classifyFile('/tmp/anim.gif').mime).toBe('image/gif')
    })

    it('classifies .webp as image/webp', () => {
      expect(classifyFile('/tmp/photo.webp').mime).toBe('image/webp')
    })

    it('classifies .svg as image/svg+xml', () => {
      expect(classifyFile('/tmp/icon.svg').mime).toBe('image/svg+xml')
    })
  })

  describe('pdf', () => {
    it('classifies .pdf as application/pdf', () => {
      expect(classifyFile('/tmp/manual.pdf')).toEqual({
        type: 'pdf',
        mime: 'application/pdf'
      })
    })
  })

  describe('unknown / fallback', () => {
    it('files with no extension classify as unknown', () => {
      expect(classifyFile('/tmp/Makefile')).toEqual({
        type: 'unknown',
        mime: 'application/octet-stream'
      })
    })

    it('files with unrecognized extensions classify as unknown', () => {
      expect(classifyFile('/tmp/data.xyz').type).toBe('unknown')
      expect(classifyFile('/tmp/script.py').type).toBe('unknown')
      expect(classifyFile('/tmp/config.toml').type).toBe('unknown')
    })

    it('uses last-dot extension parsing (filename.tar.gz → gz)', () => {
      // .gz isn't a recognized type; falls through to unknown. This
      // documents the parsing rule rather than the lookup outcome.
      expect(classifyFile('/tmp/archive.tar.gz').type).toBe('unknown')
    })
  })

  describe('path-shape edge cases', () => {
    it('handles absolute paths', () => {
      expect(classifyFile('/Users/foo/bar.md').type).toBe('editor')
    })

    it('handles relative paths', () => {
      expect(classifyFile('./relative/path.md').type).toBe('editor')
    })

    it('handles tilde paths (no expansion at this layer)', () => {
      // classifyFile is purely textual; tilde expansion happens
      // upstream (see core/path-utils.ts § expandTilde).
      expect(classifyFile('~/notes/foo.md').type).toBe('editor')
    })

    it('handles bare filenames', () => {
      expect(classifyFile('foo.md').type).toBe('editor')
    })

    it('handles filenames with multiple dots', () => {
      expect(classifyFile('/tmp/some.name.with.dots.md').type).toBe('editor')
    })
  })
})
