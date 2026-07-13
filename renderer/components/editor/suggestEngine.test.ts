// @vitest-environment jsdom
//
// ENH-260 package S1 — pure-function coverage for `suggestEngine.ts`. This
// exercises `buildSuggestionTr` directly against `EditorState`/`Transaction`
// pairs (no live SuggestingMode plugin, no dispatch): build a user `tr` on
// `state0`, apply it to get `state1`, call
// `buildSuggestionTr(state0, [tr], state1, author, direction)`, apply the
// result (if any) to get the reconciled state, and assert.
//
// A TipTap `Editor` is used only as a convenient schema/state factory (same
// pattern as `suggestInlineCode.test.ts`) — `editor.view` is never dispatched
// into by these tests, so the live editor stays inert and doesn't need
// resetting between assertions within a test.

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Fragment } from '@tiptap/pm/model'
import { InsertionMark } from './extensions/InsertionMark'
import { DeletionMark } from './extensions/DeletionMark'
import { HighlightMark } from './extensions/HighlightMark'
import {
  isOwnSuggestionMark,
  findDeletionRun,
  checkSuggestionInvariant,
  buildSuggestionTr
} from './suggestEngine'
import { META_SUGGEST_AUTO } from './suggestMeta'

const editor = new Editor({
  element: document.createElement('div'),
  extensions: [
    StarterKit, // codeBlock enabled (not disabled) — D10 coverage needs it.
    Markdown.configure({ html: false }),
    InsertionMark,
    DeletionMark,
    HighlightMark
    // Deliberately NOT SuggestingMode — this suite tests the pure engine.
  ],
  content: ''
})

afterAll(() => editor.destroy())

function setDoc(json: Record<string, unknown>): EditorState {
  editor.commands.setContent(json)
  return editor.state
}

/** Apply `tr` to `state` and reconcile via the engine; returns both the
 *  raw (un-reconciled) and the final (reconciled, or raw if the engine
 *  declined) states, plus the engine's own transaction (or null). */
function reconcile(
  state0: EditorState,
  tr: Transaction,
  author: string,
  direction: 'backspace' | 'forward' | null = null
): { state1: EditorState, engineTr: Transaction | null, final: EditorState } {
  const state1 = state0.apply(tr)
  const engineTr = buildSuggestionTr(state0, [tr], state1, author, direction)
  const final = engineTr ? state1.apply(engineTr) : state1
  return { state1, engineTr, final }
}

function textOf(doc: PMNode): string {
  return doc.textBetween(0, doc.content.size, '\n', '\n')
}

function marksAt(doc: PMNode, pos: number): string[] {
  const $pos = doc.resolve(pos)
  const node = $pos.nodeAfter ?? $pos.nodeBefore
  return node ? node.marks.map(m => m.type.name) : []
}

beforeEach(() => {
  ;(editor.storage as any).suggestingMode = { enabled: false, getAuthor: () => '' }
})

describe('isOwnSuggestionMark (D1)', () => {
  it('null author counts as own', () => {
    expect(isOwnSuggestionMark(null, 'tester')).toBe(true)
  })
  it('same author counts as own', () => {
    expect(isOwnSuggestionMark('tester', 'tester')).toBe(true)
  })
  it('different non-null author is foreign', () => {
    expect(isOwnSuggestionMark('alice', 'bob')).toBe(false)
  })
})

describe('findDeletionRun (D4/D3 primitive)', () => {
  it('finds the contiguous run for backspace at its right edge', () => {
    const state = setDoc({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world', marks: [{ type: 'deletionMark', attrs: { author: 'x', ts: null } }] }
        ]
      }]
    })
    // "Hello " = pos 1-7, "world" = pos 7-12.
    const run = findDeletionRun(state.doc, 12, 'backspace')
    expect(run).toEqual({ from: 7, to: 12 })
  })

  it('finds the contiguous run for forward-delete at its left edge', () => {
    const state = setDoc({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'world', marks: [{ type: 'deletionMark', attrs: { author: 'x', ts: null } }] },
          { type: 'text', text: ' Hello' }
        ]
      }]
    })
    const run = findDeletionRun(state.doc, 1, 'forward')
    expect(run).toEqual({ from: 1, to: 6 })
  })

  it('returns null when pos is not against a deletion run', () => {
    const state = setDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain text' }] }]
    })
    expect(findDeletionRun(state.doc, 5, 'backspace')).toBeNull()
    expect(findDeletionRun(state.doc, 5, 'forward')).toBeNull()
  })
})

describe('checkSuggestionInvariant', () => {
  it('reports no violation for the sanctioned D7 cross-author state', () => {
    const state = setDoc({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'world',
          marks: [
            { type: 'insertionMark', attrs: { author: 'alice', ts: null } },
            { type: 'deletionMark', attrs: { author: 'bob', ts: null } }
          ]
        }]
      }]
    })
    expect(checkSuggestionInvariant(state.doc)).toEqual([])
  })

  it('reports a violation for a same-author double mark', () => {
    const state = setDoc({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'oops',
          marks: [
            { type: 'insertionMark', attrs: { author: 'bob', ts: null } },
            { type: 'deletionMark', attrs: { author: 'bob', ts: null } }
          ]
        }]
      }]
    })
    const violations = checkSuggestionInvariant(state.doc)
    expect(violations.length).toBe(1)
    expect(violations[0].text).toBe('oops')
  })

  it('reports a violation for a null-author insertion double-marked', () => {
    const state = setDoc({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'oops',
          marks: [
            { type: 'insertionMark', attrs: { author: null, ts: null } },
            { type: 'deletionMark', attrs: { author: 'bob', ts: null } }
          ]
        }]
      }]
    })
    expect(checkSuggestionInvariant(state.doc).length).toBe(1)
  })
})

describe('buildSuggestionTr — P1 net-zero delete of own insertion', () => {
  it('deleting part of your own pending insertion nets to zero, no reinstate', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'XY', marks: [{ type: 'insertionMark', attrs: { author: 'tester', ts: null } }] },
          { type: 'text', text: 'world' }
        ]
      }]
    })
    // "Hello " = 1-7, "X" = 7-8, "Y" = 8-9. Delete "Y".
    const tr = state0.tr.delete(8, 9)
    const { engineTr, final } = reconcile(state0, tr, 'tester', 'backspace')
    expect(engineTr).toBeNull()
    expect(textOf(final.doc)).toBe('Hello Xworld')
    const json = JSON.stringify(final.doc.toJSON())
    expect(json).not.toContain('deletionMark')
    // "X" is still insertion-marked; nothing else is.
    expect((json.match(/insertionMark/g) ?? []).length).toBe(1)
  })
})

describe('buildSuggestionTr — plain-text delete', () => {
  it('reinstates the deleted text with a deletionMark, caret before it on backspace', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }]
    })
    // "world" = pos 7-12.
    const tr = state0.tr.delete(7, 12)
    const { engineTr, final } = reconcile(state0, tr, 'tester', 'backspace')
    expect(engineTr).not.toBeNull()
    expect(textOf(final.doc)).toBe('Hello world')
    const json = final.doc.toJSON()
    const para = json.content[0]
    const worldNode = para.content.find((n: any) => n.text === 'world')
    expect(worldNode.marks?.some((m: any) => m.type === 'deletionMark' && m.attrs.author === 'tester')).toBe(true)
    // Selection collapsed to just before the reinstated "world" (pos 7).
    expect(final.selection.from).toBe(7)
    expect(final.selection.to).toBe(7)
  })
})

describe('buildSuggestionTr — mixed range (own-insertion + plain)', () => {
  it('drops the own-insertion slice, reinstates the plain slice, preserves order', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'XY', marks: [{ type: 'insertionMark', attrs: { author: 'tester', ts: null } }] },
          { type: 'text', text: 'world' }
        ]
      }]
    })
    // "Hello "=1-7, "X"=7-8, "Y"=8-9, "world"=9-14. Delete "Y"+"wor" = [8,12).
    const tr = state0.tr.delete(8, 12)
    const { final } = reconcile(state0, tr, 'tester', 'backspace')
    const para = final.doc.toJSON().content[0]
    const texts = para.content.map((n: any) => n.text)
    expect(texts).toEqual(['Hello ', 'X', 'wor', 'ld'])
    const worNode = para.content.find((n: any) => n.text === 'wor')
    expect(worNode.marks?.some((m: any) => m.type === 'deletionMark')).toBe(true)
    const xNode = para.content.find((n: any) => n.text === 'X')
    expect(xNode.marks?.some((m: any) => m.type === 'insertionMark')).toBe(true)
    expect(textOf(final.doc)).toBe('Hello Xworld')
  })
})

describe('buildSuggestionTr — D7 foreign insertion', () => {
  it('deleting a foreign pending insertion keeps BOTH marks', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world', marks: [{ type: 'insertionMark', attrs: { author: 'alice', ts: null } }] }
        ]
      }]
    })
    const tr = state0.tr.delete(7, 12)
    const { final } = reconcile(state0, tr, 'bob', 'backspace')
    expect(textOf(final.doc)).toBe('Hello world')
    const para = final.doc.toJSON().content[0]
    const worldNode = para.content.find((n: any) => n.text === 'world')
    const marks = worldNode.marks ?? []
    expect(marks.some((m: any) => m.type === 'insertionMark' && m.attrs.author === 'alice')).toBe(true)
    expect(marks.some((m: any) => m.type === 'deletionMark' && m.attrs.author === 'bob')).toBe(true)
    expect(checkSuggestionInvariant(final.doc)).toEqual([])
  })
})

describe('buildSuggestionTr — already-deleted content', () => {
  it('reinstates as-is, preserving the ORIGINAL author (no double-strike)', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world', marks: [{ type: 'deletionMark', attrs: { author: 'X', ts: null } }] }
        ]
      }]
    })
    const tr = state0.tr.delete(7, 12)
    const { final } = reconcile(state0, tr, 'tester', 'backspace')
    expect(textOf(final.doc)).toBe('Hello world')
    const para = final.doc.toJSON().content[0]
    const worldNode = para.content.find((n: any) => n.text === 'world')
    const delMarks = (worldNode.marks ?? []).filter((m: any) => m.type === 'deletionMark')
    expect(delMarks.length).toBe(1)
    expect(delMarks[0].attrs.author).toBe('X')
  })
})

describe('buildSuggestionTr — D8 structural (paragraph-join) deletion', () => {
  it('passes untracked: no reinstatement, the join stands', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Para one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Para two' }] }
      ]
    })
    // Para1: open 0, content 1-9, close at 10. Para2: open 10, content 11-19.
    // Deleting [9, 11) removes only the paragraph boundary (no text chars).
    const tr = state0.tr.delete(9, 11)
    const state1 = state0.apply(tr)
    expect(state1.doc.childCount).toBe(1) // paragraphs merged
    const { engineTr, final } = reconcile(state0, tr, 'tester', 'backspace')
    expect(engineTr).toBeNull()
    expect(final.doc.childCount).toBe(1)
    expect(textOf(final.doc)).toBe('Para onePara two')
  })
})

describe('buildSuggestionTr — multi-block selection delete', () => {
  it('reinstates with structure: two paragraphs restored, struck text', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Foo bar' }] }
      ]
    })
    // Para1: content 1-12 ("Hello world"). Para2: open 13, content 14-21 ("Foo bar").
    // Select from pos 7 (after "Hello ") to pos 18 (after "Foo " in para2).
    const tr = state0.tr.delete(7, 18)
    const { final } = reconcile(state0, tr, 'tester', 'backspace')
    expect(final.doc.childCount).toBe(2)
    const p1 = final.doc.child(0)
    const p2 = final.doc.child(1)
    expect(textOf(p1)).toBe('Hello world')
    expect(textOf(p2)).toBe('Foo bar')
    const p1Json = p1.toJSON()
    const worldNode = p1Json.content.find((n: any) => n.text === 'world')
    expect(worldNode.marks?.some((m: any) => m.type === 'deletionMark')).toBe(true)
    const p2Json = p2.toJSON()
    const fooNode = p2Json.content.find((n: any) => n.text === 'Foo ')
    expect(fooNode.marks?.some((m: any) => m.type === 'deletionMark')).toBe(true)
  })
})

describe('buildSuggestionTr — P2 type-over', () => {
  it('produces del-before-ins ordering: {--world--}{++planet++}', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }]
    })
    const tr = state0.tr.replaceWith(7, 12, state0.schema.text('planet'))
    const { final } = reconcile(state0, tr, 'tester', null)
    const para = final.doc.toJSON().content[0]
    const texts = para.content.map((n: any) => n.text)
    expect(texts).toEqual(['Hello ', 'world', 'planet'])
    const worldNode = para.content.find((n: any) => n.text === 'world')
    const planetNode = para.content.find((n: any) => n.text === 'planet')
    expect(worldNode.marks?.some((m: any) => m.type === 'deletionMark')).toBe(true)
    expect(planetNode.marks?.some((m: any) => m.type === 'insertionMark')).toBe(true)
  })
})

describe('buildSuggestionTr — P4/D3 insertion inside a deletion run', () => {
  it('relocates the insertion to just after the (now-contiguous) run', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'world', marks: [{ type: 'deletionMark', attrs: { author: 'tester', ts: null } }] }
        ]
      }]
    })
    // Insert "Z" strictly inside the deletion-marked run, WITH the
    // deletionMark attached (as native typing mid-run would inherit it) —
    // constructing this explicitly keeps the test independent of jsdom's
    // exact mark-inheritance heuristics; the engine only cares about what's
    // in newState.doc after the step, not how it got there.
    const delMark = state0.schema.marks.deletionMark.create({ author: 'tester', ts: null })
    const tr = state0.tr.insert(4, state0.schema.text('Z', [delMark]))
    const { final } = reconcile(state0, tr, 'tester', null)

    expect(textOf(final.doc)).toBe('worldZ')
    const para = final.doc.toJSON().content[0]
    // Exactly one contiguous deletion-marked "world" and one insertion "Z" —
    // no text node carries both marks.
    expect(checkSuggestionInvariant(final.doc)).toEqual([])
    const worldNode = para.content.find((n: any) => n.text === 'world')
    const zNode = para.content.find((n: any) => n.text === 'Z')
    expect(worldNode.marks?.some((m: any) => m.type === 'deletionMark')).toBe(true)
    expect(worldNode.marks?.some((m: any) => m.type === 'insertionMark')).toBeFalsy()
    expect(zNode.marks?.some((m: any) => m.type === 'insertionMark')).toBe(true)
    expect(zNode.marks?.some((m: any) => m.type === 'deletionMark')).toBeFalsy()
    // Selection lands right after "Z" (end of the paragraph's content).
    const endPos = 1 + final.doc.firstChild!.content.size
    expect(final.selection.from).toBe(endPos)
  })
})

describe('buildSuggestionTr — skip guards (D9)', () => {
  it('a transaction carrying META_SUGGEST_AUTO is skipped', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }]
    })
    const tr = state0.tr.delete(7, 12)
    tr.setMeta(META_SUGGEST_AUTO, true)
    const state1 = state0.apply(tr)
    expect(buildSuggestionTr(state0, [tr], state1, 'tester', 'backspace')).toBeNull()
  })

  it('a transaction with addToHistory: false is skipped (undo/redo)', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }]
    })
    const tr = state0.tr.delete(7, 12)
    tr.setMeta('addToHistory', false)
    const state1 = state0.apply(tr)
    expect(buildSuggestionTr(state0, [tr], state1, 'tester', 'backspace')).toBeNull()
  })

  it('a non-doc-changing transaction is skipped', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }]
    })
    const tr = state0.tr.setSelection(state0.selection)
    const state1 = state0.apply(tr)
    expect(buildSuggestionTr(state0, [tr], state1, 'tester', 'backspace')).toBeNull()
  })
})

describe('buildSuggestionTr — D10 code contexts stay untracked', () => {
  it('deleting an entire inline-code span actually deletes it (no reinstate)', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a ' },
          { type: 'text', text: 'code', marks: [{ type: 'code' }] },
          { type: 'text', text: ' b' }
        ]
      }]
    })
    // "a "=1-3, "code"=3-7, " b"=7-9. Delete the whole code span.
    const tr = state0.tr.delete(3, 7)
    const { engineTr, final } = reconcile(state0, tr, 'tester', 'backspace')
    expect(engineTr).toBeNull()
    expect(textOf(final.doc)).toBe('a  b')
  })

  it('inserting inside a codeBlock is not tracked (no insertionMark)', () => {
    const state0 = setDoc({
      type: 'doc',
      content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1' }] }]
    })
    const tr = state0.tr.insertText('!', 5)
    const { engineTr, final } = reconcile(state0, tr, 'tester', null)
    expect(engineTr).toBeNull()
    expect(JSON.stringify(final.doc.toJSON())).not.toContain('insertionMark')
  })
})

describe('buildSuggestionTr — property battery', () => {
  it('accept-simulation matches the no-engine script; reject-simulation matches baseline', () => {
    const insMarkType = editor.schema.marks.insertionMark
    const delMarkType = editor.schema.marks.deletionMark

    /** Locally-implemented accept: drop deletionMark-ed text, strip insertionMark. */
    function stripAccept(fragment: Fragment): Fragment {
      const out: PMNode[] = []
      fragment.forEach((node) => {
        if (node.isText) {
          if (delMarkType.isInSet(node.marks)) return // deleted — drop
          if (insMarkType.isInSet(node.marks)) {
            out.push(node.mark(insMarkType.removeFromSet(node.marks)))
            return
          }
          out.push(node)
          return
        }
        out.push(node.copy(stripAccept(node.content)))
      })
      return Fragment.fromArray(out)
    }

    /** Locally-implemented reject: drop insertionMark-ed text, strip deletionMark. */
    function stripReject(fragment: Fragment): Fragment {
      const out: PMNode[] = []
      fragment.forEach((node) => {
        if (node.isText) {
          if (insMarkType.isInSet(node.marks)) return // rejected insertion — drop
          if (delMarkType.isInSet(node.marks)) {
            out.push(node.mark(delMarkType.removeFromSet(node.marks)))
            return
          }
          out.push(node)
          return
        }
        out.push(node.copy(stripReject(node.content)))
      })
      return Fragment.fromArray(out)
    }

    const author = 'tester'
    const baselineJson = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }]
    }

    // ---- Plain trajectory: same script, no engine, no marks. ----
    let plainState = setDoc(baselineJson)
    // A: insert "XY" after "Hello " (pos 7).
    plainState = plainState.apply(plainState.tr.insert(7, plainState.schema.text('XY')))
    expect(textOf(plainState.doc)).toBe('Hello XYworld')
    // B: delete "Y" (pos 8-9).
    plainState = plainState.apply(plainState.tr.delete(8, 9))
    expect(textOf(plainState.doc)).toBe('Hello Xworld')
    // C: delete "world" (pos 8-13, tail of "Hello Xworld").
    plainState = plainState.apply(plainState.tr.delete(8, 13))
    expect(textOf(plainState.doc)).toBe('Hello X')
    // D: type-over "X" (pos 7-8) with "planet".
    plainState = plainState.apply(plainState.tr.replaceWith(7, 8, plainState.schema.text('planet')))
    expect(textOf(plainState.doc)).toBe('Hello planet')
    const plainFinalDoc = plainState.doc

    // ---- Engine trajectory: same logical script, each user tr reconciled. ----
    let engineState = setDoc(baselineJson)

    // A: insert "XY" after "Hello ".
    {
      const tr = engineState.tr.insert(7, engineState.schema.text('XY'))
      const state1 = engineState.apply(tr)
      const eTr = buildSuggestionTr(engineState, [tr], state1, author, null)
      engineState = eTr ? state1.apply(eTr) : state1
    }
    expect(textOf(engineState.doc)).toBe('Hello XYworld')

    // B: delete "Y" — own insertion, nets to zero.
    {
      const tr = engineState.tr.delete(8, 9)
      const state1 = engineState.apply(tr)
      const eTr = buildSuggestionTr(engineState, [tr], state1, author, 'backspace')
      expect(eTr).toBeNull()
      engineState = state1
    }
    expect(textOf(engineState.doc)).toBe('Hello Xworld')

    // C: delete "world" — plain delete, reinstated struck.
    {
      const tr = engineState.tr.delete(8, 13)
      const state1 = engineState.apply(tr)
      const eTr = buildSuggestionTr(engineState, [tr], state1, author, 'backspace')
      expect(eTr).not.toBeNull()
      engineState = state1.apply(eTr as Transaction)
    }
    expect(textOf(engineState.doc)).toBe('Hello Xworld') // "world" struck, still visible

    // D: type-over "X" (own insertion) with "planet".
    {
      const tr = engineState.tr.replaceWith(7, 8, engineState.schema.text('planet'))
      const state1 = engineState.apply(tr)
      const eTr = buildSuggestionTr(engineState, [tr], state1, author, null)
      engineState = eTr ? state1.apply(eTr) : state1
    }
    const engineFinalDoc = engineState.doc
    expect(textOf(engineFinalDoc)).toBe('Hello planetworld')

    // ---- Verify the invariant. ----
    const acceptedDoc = engineFinalDoc.copy(stripAccept(engineFinalDoc.content))
    const rejectedDoc = engineFinalDoc.copy(stripReject(engineFinalDoc.content))
    const baselineDoc = setDoc(baselineJson).doc

    expect(acceptedDoc.eq(plainFinalDoc)).toBe(true)
    expect(rejectedDoc.eq(baselineDoc)).toBe(true)
  })
})
