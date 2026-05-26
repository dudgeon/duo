// @vitest-environment jsdom
//
// BUG-186 — source-line-number computation for the editor gutter.
//
// Two layers:
//   1. Pure-math: computeBlockSourceLines with a fake serializer, so the
//      accumulation logic (block span + one blank separator) is pinned
//      independent of any editor.
//   2. Integration: a real headless TipTap editor + tiptap-markdown
//      serializer, asserting the computed line for each block actually
//      points at that block's first line in the full saved markdown.
//      This is the invariant that matters — "editor line N == file line
//      N" — and it catches any drift in the separator assumption.

import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { computeBlockSourceLines } from './LineNumbers'

// ── 1. Pure-math ────────────────────────────────────────────────────────────

interface FakeBlock { __md: string }

function fakeDoc(blockMds: string[]): PMNode {
  return {
    forEach(cb: (child: FakeBlock, offset: number, index: number) => void) {
      blockMds.forEach((md, i) => cb({ __md: md }, 0, i))
    }
  } as unknown as PMNode
}

// Identity schema: topNodeType.create returns the single child as-is, so
// the injected serialize just reads its carried markdown.
const fakeSchema = {
  topNodeType: { create: (_attrs: unknown, child: FakeBlock) => child }
} as unknown as Schema
const fakeSerialize = (block: unknown) => (block as FakeBlock).__md

describe('computeBlockSourceLines — accumulation', () => {
  it('numbers each block at its source line, with a blank separator between', () => {
    const lines = computeBlockSourceLines(
      fakeDoc(['# T', 'Intro', '- a\n- b\n- c', '```\nx\ny\n```', 'End']),
      fakeSchema,
      fakeSerialize
    )
    //  1: # T            (1 line)  → next at 1+1+1 = 3
    //  3: Intro          (1 line)  → next at 3+1+1 = 5
    //  5: - a/- b/- c     (3 lines) → next at 5+3+1 = 9
    //  9: ```/x/y/```     (4 lines) → next at 9+4+1 = 14
    // 14: End
    expect(lines).toEqual([1, 3, 5, 9, 14])
  })

  it('first block is always line 1; empty serialization counts as one line', () => {
    expect(computeBlockSourceLines(fakeDoc(['']), fakeSchema, fakeSerialize)).toEqual([1])
    expect(computeBlockSourceLines(fakeDoc(['', '', '']), fakeSchema, fakeSerialize)).toEqual([1, 3, 5])
  })
})

// ── 2. Integration with the real tiptap-markdown serializer ──────────────────

function makeEditor(markdown: string): Editor {
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

function serializerFor(editor: Editor): (doc: PMNode) => string {
  const storage = (editor.storage as { markdown: { serializer: { serialize: (d: PMNode) => string } } }).markdown
  return (d) => storage.serializer.serialize(d)
}

describe('computeBlockSourceLines — matches the saved markdown', () => {
  // The invariant: for every top-level block, the line the gutter shows
  // is the line in the full saved markdown where that block starts.
  function assertGutterMatchesSource(markdown: string) {
    const editor = makeEditor(markdown)
    try {
      const serialize = serializerFor(editor)
      const doc = editor.state.doc
      const fullLines = serialize(doc).split('\n')
      const computed = computeBlockSourceLines(doc, editor.schema, serialize)

      expect(computed[0]).toBe(1)
      doc.forEach((child, _offset, index) => {
        const blockFirstLine = serialize(editor.schema.topNodeType.create(null, child)).split('\n')[0]
        expect(fullLines[computed[index] - 1]).toBe(blockFirstLine)
      })
      return computed
    } finally {
      editor.destroy()
    }
  }

  it('headings, paragraphs, lists, blockquotes, and code fences line up', () => {
    const md = [
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
    ].join('\n')
    const computed = assertGutterMatchesSource(md)
    // Sanity on the exact mapping (sparse, source-accurate).
    expect(computed).toEqual([1, 3, 5, 9, 13, 18])
  })

  it('handles consecutive paragraphs (the original per-paragraph case)', () => {
    const computed = assertGutterMatchesSource(['First.', '', 'Second.', '', 'Third.'].join('\n'))
    expect(computed).toEqual([1, 3, 5])
  })

  it('handles a code block followed by prose (line refs land in code)', () => {
    const md = ['```python', 'a = 1', 'b = 2', 'c = 3', '```', '', 'After the block.'].join('\n')
    const computed = assertGutterMatchesSource(md)
    expect(computed).toEqual([1, 7])
  })
})
