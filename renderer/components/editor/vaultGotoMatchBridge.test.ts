// @vitest-environment jsdom
//
// ENH-208 Phase 2 (D22) — the docMatchIndex BRIDGE test: one fixture fed
// through BOTH sides of the palette → editor handoff. core/vault search
// computes docMatchIndex against the RAW body text on disk; the editor's
// jumpToMatch counts occurrences in the RENDERED doc. This test pins
// where they agree — and documents the accepted divergence where they
// can't (markdown link URLs, see below).
//
// NOTE: excluded from tsconfig.web.json (core/vault is node-only, so the
// composite web project can't list it) — vitest still runs it.

import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { search } from '../../../core/vault/search'
import { findAllMatches } from './extensions/FindHighlight'
import { jumpToMatch } from './gotoMatchJump'

const host = document.createElement('div')
document.body.appendChild(host)

const editor = new Editor({
  element: host,
  extensions: [StarterKit]
})

afterAll(() => editor.destroy())

function makeVault(noteBody: string): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-goto-bridge-'))
  fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true })
  fs.writeFileSync(path.join(root, 'note.md'), noteBody)
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

describe('docMatchIndex bridge — core search() → editor jumpToMatch()', () => {
  it('a frontmatter+body fixture jumps to exactly the hit search indexed', () => {
    // Frontmatter holds the needle too (docMatchIndex null — no doc
    // twin); the body has occurrences spread across lines, mixed case.
    const { root, cleanup } = makeVault(
      '---\nstatus: alpha\n---\n\nAlpha beta ALPHA\n\nalpha end\n'
    )
    try {
      const hits = search(root, 'alpha')
      // disk lines: 2 (frontmatter), 5 (two occurrences), 7 ('alpha end')
      expect(hits.map((h) => [h.line, h.docMatchIndex])).toEqual([
        [2, null],
        [5, 0],
        [7, 2],
      ])

      // The editor renders the BODY (frontmatter stripped to a panel).
      editor.commands.setContent('<p>Alpha beta ALPHA</p><p>alpha end</p>')
      const lastHit = hits[hits.length - 1]
      expect(jumpToMatch(editor, { query: 'alpha', matchIndex: lastHit.docMatchIndex! })).toBe(true)
      // The selection must land on the SAME occurrence the disk hit
      // describes: the 'alpha' of 'alpha end', i.e. the third (and last)
      // doc occurrence.
      const matches = findAllMatches(editor.state.doc, 'alpha', false)
      expect(editor.state.selection.from).toBe(matches[2].from)
      expect(editor.state.selection.to).toBe(matches[2].to)
      expect(
        editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)
      ).toBe('alpha')
    } finally {
      cleanup()
    }
  })

  it('DOCUMENTED DIVERGENCE: a needle inside a markdown link URL shifts the index', () => {
    // ACCEPTED LIMITATION (ENH-208 D22): core search scans the RAW
    // markdown, where '[alpha link](https://x.test/alpha-page)' contains
    // the needle TWICE (link text + URL). The rendered doc contains only
    // the link text, so every later docMatchIndex is one too high and
    // jumpToMatch's overshoot fallback (first occurrence) can kick in.
    // Fixing this would mean teaching search the renderer's markdown
    // semantics (or the editor raw offsets) — out of scope for a
    // substring engine; the first-match fallback keeps the jump useful.
    const { root, cleanup } = makeVault(
      '[alpha link](https://x.test/alpha-page)\n\nalpha end\n'
    )
    try {
      const hits = search(root, 'alpha')
      const endHit = hits.find((h) => h.excerpt === 'alpha end')!
      // Raw counting: line 1 holds occurrences 0 (text) + 1 (URL), so the
      // 'alpha end' hit gets index 2…
      expect(endHit.docMatchIndex).toBe(2)

      // …but the rendered doc has only TWO occurrences ('alpha link',
      // 'alpha end' — the URL is an attribute, not text), so index 2
      // overshoots and falls back to the FIRST occurrence.
      editor.commands.setContent(
        '<p><a href="https://x.test/alpha-page">alpha link</a></p><p>alpha end</p>'
      )
      const matches = findAllMatches(editor.state.doc, 'alpha', false)
      expect(matches).toHaveLength(2)
      expect(jumpToMatch(editor, { query: 'alpha', matchIndex: endHit.docMatchIndex! })).toBe(true)
      expect(editor.state.selection.from).toBe(matches[0].from) // fallback, NOT 'alpha end'
    } finally {
      cleanup()
    }
  })
})
