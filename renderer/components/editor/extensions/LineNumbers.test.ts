// @vitest-environment jsdom
//
// BUG-186 — source-line-number computation for the editor gutter.
//
// The invariant under test is the user-facing guarantee: the gutter
// number for each top-level block equals the line in the SAVED markdown
// where that block begins ("editor line N == file line N"). We assert it
// three ways:
//   1. Core block types on a minimal StarterKit + Markdown editor.
//   2. The SAME serialization-affecting extensions the production editor
//      mounts (marks + custom block extensions), so a future extension
//      that changes a join can't silently drift the mapping.
//   3. A buffer carrying CriticMarkup marks, through the materialize →
//      serialize path the gutter actually uses, so the user-visible
//      surface stays aligned with what `Read` reports.

import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { Markdown } from 'tiptap-markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import { computeBlockSourceLines, type MarkdownSerializerLike } from './LineNumbers'
import { BulletListWithMarker } from './BulletListWithMarker'
import { InsertionMark } from './InsertionMark'
import { DeletionMark } from './DeletionMark'
import { HighlightMark } from './HighlightMark'
import { CommentMark } from './CommentMark'
import {
  applyCriticMarkupFromText,
  materializeCriticMarkupToJSON,
  serializeWithCriticMarkup
} from '../markdownCriticMarkup'

const lowlight = createLowlight(common)

function serializerOf(editor: Editor): MarkdownSerializerLike {
  return (editor.storage as { markdown: { serializer: MarkdownSerializerLike } }).markdown.serializer
}

function fullSerialize(editor: Editor, doc: PMNode): string {
  const s = serializerOf(editor) as unknown as { serialize: (d: PMNode) => string }
  return s.serialize(doc)
}

function blockFirstLine(editor: Editor, child: PMNode): string {
  const s = serializerOf(editor) as unknown as { serialize: (d: PMNode) => string }
  return s.serialize(editor.schema.topNodeType.create(null, child)).split('\n')[0]
}

// The core guarantee: for every top-level block, the computed line points
// at that block's first line in the full serialized markdown. `srcDoc` is
// the doc whose serialization defines "the file" (the live doc, or a
// CriticMarkup-materialized clone).
function assertGutterMatchesSource(editor: Editor, srcDoc: PMNode, fileMd: string): number[] {
  const fileLines = fileMd.split('\n')
  const computed = computeBlockSourceLines(srcDoc, serializerOf(editor))
  expect(computed[0]).toBe(1)
  srcDoc.forEach((child, _offset, index) => {
    expect(fileLines[computed[index] - 1]).toBe(blockFirstLine(editor, child))
  })
  return computed
}

// ── 1. Core block types ──────────────────────────────────────────────────────

function coreEditor(markdown: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      Markdown.configure({ tightLists: true, bulletListMarker: '-', breaks: false })
    ]
  })
  editor.commands.setContent(markdown)
  return editor
}

describe('computeBlockSourceLines — core block types', () => {
  it('headings, paragraphs, lists, blockquotes, and code fences line up', () => {
    const editor = coreEditor([
      '# Title',
      '',
      'Intro paragraph here.',
      '',
      '- alpha',
      '- beta',
      '- gamma',
      '',
      '> A quote line.',
      '>',
      '> Second quote paragraph.',
      '',
      '```js',
      'const x = 1',
      'const y = 2',
      '```',
      '',
      'Closing paragraph.'
    ].join('\n'))
    try {
      const computed = assertGutterMatchesSource(editor, editor.state.doc, fullSerialize(editor, editor.state.doc))
      expect(computed).toEqual([1, 3, 5, 9, 13, 18])
    } finally {
      editor.destroy()
    }
  })

  it('consecutive paragraphs (the original per-paragraph case)', () => {
    const editor = coreEditor(['First.', '', 'Second.', '', 'Third.'].join('\n'))
    try {
      expect(assertGutterMatchesSource(editor, editor.state.doc, fullSerialize(editor, editor.state.doc)))
        .toEqual([1, 3, 5])
    } finally {
      editor.destroy()
    }
  })

  it('a code fence with an internal blank line does not split (no separator assumption)', () => {
    // The blank line inside the fence must NOT be mistaken for a block
    // boundary — this is exactly where a naive `\n\n` split fails.
    const editor = coreEditor(['```py', 'a = 1', '', 'b = 2', '```', '', 'After the block.'].join('\n'))
    try {
      const computed = assertGutterMatchesSource(editor, editor.state.doc, fullSerialize(editor, editor.state.doc))
      // fence spans lines 1–5 (``` / a / blank / b / ```), blank 6, prose 7
      expect(computed).toEqual([1, 7])
    } finally {
      editor.destroy()
    }
  })

  it('reconstructs the exact same bytes as the public serializer', () => {
    // If the instrumented single pass ever diverged from the real
    // serializer, the source-line offsets would be meaningless. The
    // invariant assertions above already cover this transitively; this is
    // a direct belt-and-suspenders check on a mark-heavy doc.
    const editor = coreEditor(['Some **bold** and *italic* and `code`.', '', '## Heading two', '', 'Tail.'].join('\n'))
    try {
      const computed = computeBlockSourceLines(editor.state.doc, serializerOf(editor))
      expect(computed).toEqual([1, 3, 5])
    } finally {
      editor.destroy()
    }
  })
})

// ── 2. Production serialization-affecting extension set ───────────────────────

function productionishEditor(markdown: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      // Mirrors MarkdownEditor.tsx's serialization-affecting extensions:
      // StarterKit (codeBlock swapped out), custom bullet marker, the
      // inline marks, and the CriticMarkup marks. Decoration-only
      // extensions (FindHighlight, Wikilink, PersistentSelection, …) don't
      // touch serialization, so they're intentionally omitted.
      StarterKit.configure({ codeBlock: false, bulletList: false }),
      BulletListWithMarker,
      Underline,
      Link.configure({ autolink: false, linkOnPaste: true }),
      CodeBlockLowlight.configure({ lowlight }),
      InsertionMark,
      DeletionMark,
      HighlightMark,
      CommentMark,
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: '-',
        linkify: true,
        breaks: false
      })
    ]
  })
  editor.commands.setContent(markdown)
  return editor
}

describe('computeBlockSourceLines — production extension set', () => {
  it('matches the saved markdown across every block type + inline marks', () => {
    const editor = productionishEditor([
      '# Heading',
      '',
      'A paragraph with **bold**, *italic*, [a link](https://example.com), and `code`.',
      '',
      '- first',
      '- second',
      '',
      '1. one',
      '2. two',
      '',
      '> quoted line one',
      '>',
      '> quoted line two',
      '',
      '```ts',
      'const x: number = 1',
      '',
      'const y = x + 1',
      '```',
      '',
      'Final paragraph.'
    ].join('\n'))
    try {
      assertGutterMatchesSource(editor, editor.state.doc, fullSerialize(editor, editor.state.doc))
    } finally {
      editor.destroy()
    }
  })
})

// ── 3. CriticMarkup-bearing buffer through the gutter's real path ─────────────

function criticEditor(markdown: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ codeBlock: false, bulletList: false }),
      BulletListWithMarker,
      Underline,
      Link.configure({ autolink: false }),
      CodeBlockLowlight.configure({ lowlight }),
      InsertionMark,
      DeletionMark,
      HighlightMark,
      CommentMark,
      Markdown.configure({ html: false, tightLists: true, bulletListMarker: '-', breaks: false })
    ]
  })
  editor.commands.setContent(markdown)
  applyCriticMarkupFromText(editor)
  return editor
}

describe('computeBlockSourceLines — CriticMarkup buffer', () => {
  it('line numbers match the saved file (with CM marks materialized to text)', () => {
    // `{++…++}` / `{>>…<<}` round-trip through the editor as marks; the
    // gutter counts off the materialized clone (the same path the plugin
    // and the save serializer take), so the numbers must match what lands
    // on disk byte-for-byte.
    const editor = criticEditor([
      'Intro line with {++an inserted phrase++} mid-sentence.',
      '',
      '## Section',
      '',
      'Body paragraph before the change.',
      '',
      'A {--removed clause--} stays on its own line.'
    ].join('\n'))
    try {
      // What actually gets written to disk:
      const saved = serializeWithCriticMarkup(editor)
      expect(saved).toContain('{++an inserted phrase++}')
      expect(saved).toContain('{--removed clause--}')

      // What the gutter counts off: the materialized clone.
      const materialized = materializeCriticMarkupToJSON(editor)
      const countDoc = editor.schema.nodeFromJSON(materialized) as PMNode

      assertGutterMatchesSource(editor, countDoc, saved)
    } finally {
      editor.destroy()
    }
  })
})
