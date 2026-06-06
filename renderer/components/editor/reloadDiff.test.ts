// @vitest-environment jsdom
//
// ENH-195 (D3) — the reload change-highlight diff.
//
// The user-facing guarantee: after a file the editor has open changes on
// disk and we reload it, `computeReloadDiff(oldDoc, newDoc)` reports WHERE
// content was inserted (in new-doc PM positions the decoration layer can
// map) and WHERE content was deleted, plus a coarse "how much changed"
// fraction. We build tiny ProseMirror docs through the same StarterKit +
// Markdown path the editor mounts, then assert the diff shape for the
// canonical reload cases: a mid-doc insertion, a deletion, a near-total
// rewrite, an unchanged reload, and a two-site edit.

import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import { computeReloadDiff } from './reloadDiff'

// Build a doc the same way the editor does — StarterKit schema + Markdown —
// and hand back the top-level PM node. We make one disposable editor per doc
// so old/new live in the same schema (ChangeSet diffs them token-by-token).
function docOf(markdown: string): { doc: PMNode; destroy: () => void } {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      Markdown.configure({ tightLists: true, bulletListMarker: '-', breaks: false })
    ]
  })
  editor.commands.setContent(markdown)
  return { doc: editor.state.doc, destroy: () => editor.destroy() }
}

// Run computeReloadDiff over two markdown strings, cleaning up both editors.
function diffMarkdown(oldMd: string, newMd: string) {
  const a = docOf(oldMd)
  const b = docOf(newMd)
  try {
    return { result: computeReloadDiff(a.doc, b.doc), oldDoc: a.doc, newDoc: b.doc }
  } finally {
    a.destroy()
    b.destroy()
  }
}

describe('computeReloadDiff', () => {
  it('pure insertion mid-doc → one inserted range, no deletions, small fraction', () => {
    const { result, newDoc } = diffMarkdown(
      ['First paragraph.', '', 'Third paragraph.'].join('\n'),
      ['First paragraph.', '', 'Second paragraph inserted.', '', 'Third paragraph.'].join('\n')
    )
    expect(result.inserted).toHaveLength(1)
    expect(result.deletedAt).toEqual([])
    // The inserted range sits inside the new doc and is non-empty…
    const span = result.inserted[0]
    expect(span.to).toBeGreaterThan(span.from)
    expect(span.from).toBeGreaterThanOrEqual(0)
    expect(span.to).toBeLessThanOrEqual(newDoc.content.size)
    // …and is a minority of the document (most content is unchanged).
    expect(result.changedFraction).toBeGreaterThan(0)
    expect(result.changedFraction).toBeLessThan(0.5)
  })

  it('pure deletion → one deletion anchor, no inserted ranges', () => {
    const { result, newDoc } = diffMarkdown(
      ['Keep this paragraph.', '', 'Delete this whole paragraph.'].join('\n'),
      ['Keep this paragraph.'].join('\n')
    )
    expect(result.inserted).toEqual([])
    expect(result.deletedAt).toHaveLength(1)
    // The anchor is a valid position in the (smaller) new doc.
    expect(result.deletedAt[0]).toBeGreaterThanOrEqual(0)
    expect(result.deletedAt[0]).toBeLessThanOrEqual(newDoc.content.size)
    // Nothing was inserted, so the inserted-char fraction is zero.
    expect(result.changedFraction).toBe(0)
  })

  it('replace-most (>50% rewritten) → changedFraction > 0.5', () => {
    const { result } = diffMarkdown(
      ['Original sentence one.', '', 'Original sentence two.'].join('\n'),
      [
        'Completely different replacement text here.',
        '',
        'And another wholly new line of replacement prose.'
      ].join('\n')
    )
    expect(result.inserted.length).toBeGreaterThan(0)
    expect(result.changedFraction).toBeGreaterThan(0.5)
  })

  it('identical docs → no inserted, no deleted, fraction 0', () => {
    const same = ['Untouched heading aside.', '', 'A stable body paragraph.'].join('\n')
    const { result } = diffMarkdown(same, same)
    expect(result.inserted).toEqual([])
    expect(result.deletedAt).toEqual([])
    expect(result.changedFraction).toBe(0)
  })

  it('multi-edit: insertions in two paragraphs + deletions in two others → two entries each', () => {
    // Four paragraphs, each touched at a different site so simplification
    // can't merge them: paras 1 & 3 get a pure insertion (shared prefix, new
    // tail), paras 2 & 4 get a pure deletion (shared prefix + suffix, middle
    // removed). That yields exactly two inserted ranges and two delete anchors.
    const { result, newDoc } = diffMarkdown(
      [
        'Alpha bravo.',
        '',
        'Charlie delta echo foxtrot.',
        '',
        'Golf hotel.',
        '',
        'India juliet kilo lima.'
      ].join('\n'),
      [
        'Alpha bravo inserted-one.',
        '',
        'Charlie foxtrot.',
        '',
        'Golf hotel inserted-two.',
        '',
        'India lima.'
      ].join('\n')
    )
    expect(result.inserted).toHaveLength(2)
    expect(result.deletedAt).toHaveLength(2)
    // Every reported position is well-formed and inside the new doc.
    for (const span of result.inserted) {
      expect(span.to).toBeGreaterThan(span.from)
      expect(span.to).toBeLessThanOrEqual(newDoc.content.size)
    }
    for (const anchor of result.deletedAt) {
      expect(anchor).toBeGreaterThanOrEqual(0)
      expect(anchor).toBeLessThanOrEqual(newDoc.content.size)
    }
    expect(result.changedFraction).toBeGreaterThan(0)
  })
})
