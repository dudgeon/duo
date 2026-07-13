// @vitest-environment jsdom
//
// ENH-260 S3 — trackedChanges.ts D7 double-mark ("overInsertion") semantics
// + META_SUGGEST_AUTO (D9) stamping on every dispatched accept/reject
// transaction. Real TipTap Editor, per the suggestInlineCode.test.ts
// pattern — StarterKit + Markdown + InsertionMark + DeletionMark +
// HighlightMark, deliberately WITHOUT SuggestingMode (that's package S4's
// reconciler; this package only exercises collectTrackedChanges and the
// accept/reject helpers directly).
//
// D7 nested state under test: a text run can carry BOTH an InsertionMark
// (still-pending insertion, e.g. by 'alice') AND a DeletionMark (a
// different author, e.g. 'bob', suggesting that pending insertion be
// removed). See docs/prd/enh-260-track-changes-composition.md § 1 D7 and
// § 2 "Consumers".

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { InsertionMark } from './extensions/InsertionMark'
import { DeletionMark } from './extensions/DeletionMark'
import { HighlightMark } from './extensions/HighlightMark'
import {
  collectTrackedChanges,
  acceptTrackedChange,
  rejectTrackedChange,
  acceptAllTrackedChanges,
  rejectAllTrackedChanges,
  type TrackedRange
} from './trackedChanges'
import { META_SUGGEST_AUTO } from './suggestMeta'

const editor = new Editor({
  element: document.createElement('div'),
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    Markdown.configure({ html: false }),
    InsertionMark,
    DeletionMark,
    HighlightMark
  ],
  content: ''
})

afterAll(() => editor.destroy())

// ── doc builders ─────────────────────────────────────────────────────────

function setPlainInsertionDoc(): void {
  editor.commands.setContent({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world', marks: [{ type: 'insertionMark', attrs: { author: 'alice', ts: 't1' } }] }
      ]
    }]
  })
}

function setPlainDeletionDoc(): void {
  editor.commands.setContent({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world', marks: [{ type: 'deletionMark', attrs: { author: 'alice', ts: 't1' } }] }
      ]
    }]
  })
}

// D7 — 'world' carries BOTH a still-pending insertion (alice) and a
// deletion (bob) suggesting that pending insertion be removed.
function setDoubleMarkedDoc(): void {
  editor.commands.setContent({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        {
          type: 'text',
          text: 'world',
          marks: [
            { type: 'insertionMark', attrs: { author: 'alice', ts: 't1' } },
            { type: 'deletionMark', attrs: { author: 'bob', ts: 't2' } }
          ]
        }
      ]
    }]
  })
}

// One doc exercising all three range shapes at once, for acceptAll/
// rejectAll — plain insertion ('ins', alice), plain deletion ('del',
// alice), and a D7 double-marked run ('both', ins alice + del bob).
function setCombinedDoc(): void {
  editor.commands.setContent({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [
        { type: 'text', text: 'A ' },
        { type: 'text', text: 'ins', marks: [{ type: 'insertionMark', attrs: { author: 'alice', ts: 't1' } }] },
        { type: 'text', text: ' B ' },
        { type: 'text', text: 'del', marks: [{ type: 'deletionMark', attrs: { author: 'alice', ts: 't1' } }] },
        { type: 'text', text: ' C ' },
        {
          type: 'text',
          text: 'both',
          marks: [
            { type: 'insertionMark', attrs: { author: 'alice', ts: 't1' } },
            { type: 'deletionMark', attrs: { author: 'bob', ts: 't2' } }
          ]
        }
      ]
    }]
  })
}

/** Records every transaction dispatched through editor.view.dispatch while
 *  installed. Used to assert META_SUGGEST_AUTO (D9) independent of the
 *  helper under test's internals. */
function spyOnDispatch(): { trs: Transaction[]; restore: () => void } {
  const original = editor.view.dispatch.bind(editor.view)
  const trs: Transaction[] = []
  editor.view.dispatch = ((tr: Transaction) => {
    trs.push(tr)
    return original(tr)
  }) as typeof editor.view.dispatch
  return { trs, restore: () => { editor.view.dispatch = original } }
}

function findRange(kind: TrackedRange['kind'], overInsertion = false): TrackedRange {
  const ranges = collectTrackedChanges(editor.state.doc)
  const found = ranges.find(r => r.kind === kind && !!r.overInsertion === overInsertion)
  if (!found) throw new Error(`no ${kind} range (overInsertion=${overInsertion}) found in ${JSON.stringify(ranges)}`)
  return found
}

beforeEach(() => {
  setPlainInsertionDoc()
})

describe('collectTrackedChanges — classification', () => {
  it('plain insertion: kind insertion, no overInsertion flag', () => {
    setPlainInsertionDoc()
    const ranges = collectTrackedChanges(editor.state.doc)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].kind).toBe('insertion')
    expect(ranges[0].overInsertion).toBeUndefined()
    expect(ranges[0].author).toBe('alice')
    expect(ranges[0].text).toBe('world')
  })

  it('plain deletion: kind deletion, no overInsertion flag', () => {
    setPlainDeletionDoc()
    const ranges = collectTrackedChanges(editor.state.doc)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].kind).toBe('deletion')
    expect(ranges[0].overInsertion).toBeUndefined()
    expect(ranges[0].author).toBe('alice')
  })

  it('D7 double-marked run (ins alice + del bob): kind deletion, overInsertion true, author bob', () => {
    setDoubleMarkedDoc()
    const ranges = collectTrackedChanges(editor.state.doc)
    expect(ranges).toHaveLength(1)
    const r = ranges[0]
    expect(r.kind).toBe('deletion')
    expect(r.overInsertion).toBe(true)
    expect(r.author).toBe('bob')
    expect(r.text).toBe('world')
  })

  it('an overInsertion run does not merge with an adjacent plain deletion by the same author', () => {
    editor.commands.setContent({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'plain', marks: [{ type: 'deletionMark', attrs: { author: 'bob', ts: 't2' } }] },
          {
            type: 'text',
            text: 'nested',
            marks: [
              { type: 'insertionMark', attrs: { author: 'alice', ts: 't1' } },
              { type: 'deletionMark', attrs: { author: 'bob', ts: 't2' } }
            ]
          }
        ]
      }]
    })
    const ranges = collectTrackedChanges(editor.state.doc)
    expect(ranges).toHaveLength(2)
    expect(ranges[0].overInsertion).toBeUndefined()
    expect(ranges[0].text).toBe('plain')
    expect(ranges[1].overInsertion).toBe(true)
    expect(ranges[1].text).toBe('nested')
  })
})

describe('single accept/reject — D7 double-marked (overInsertion) range', () => {
  it('accept deletes the text (resolves both suggestions)', () => {
    setDoubleMarkedDoc()
    const range = findRange('deletion', true)
    expect(acceptTrackedChange(editor, range)).toBe(true)
    expect(editor.getText()).toBe('Hello ')
    expect(collectTrackedChanges(editor.state.doc)).toHaveLength(0)
  })

  it('reject restores the pending insertion (removes ONLY the DeletionMark)', () => {
    setDoubleMarkedDoc()
    const range = findRange('deletion', true)
    expect(rejectTrackedChange(editor, range)).toBe(true)
    expect(editor.getText()).toBe('Hello world')
    const ranges = collectTrackedChanges(editor.state.doc)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].kind).toBe('insertion')
    expect(ranges[0].author).toBe('alice')
    expect(ranges[0].overInsertion).toBeUndefined()
    // Confirm at the mark level: insertionMark kept, deletionMark gone.
    const para = editor.getJSON().content?.[0] as { content?: Array<{ text?: string; marks?: Array<{ type: string }> }> }
    const worldNode = para?.content?.find(n => n.text === 'world')
    expect(worldNode?.marks?.some(m => m.type === 'insertionMark')).toBe(true)
    expect(worldNode?.marks?.some(m => m.type === 'deletionMark')).toBe(false)
  })
})

describe('single accept/reject — plain ranges (regression, unchanged semantics)', () => {
  it('plain insertion: accept keeps text, strips mark', () => {
    setPlainInsertionDoc()
    const range = findRange('insertion')
    expect(acceptTrackedChange(editor, range)).toBe(true)
    expect(editor.getText()).toBe('Hello world')
    expect(collectTrackedChanges(editor.state.doc)).toHaveLength(0)
  })

  it('plain insertion: reject deletes the text', () => {
    setPlainInsertionDoc()
    const range = findRange('insertion')
    expect(rejectTrackedChange(editor, range)).toBe(true)
    expect(editor.getText()).toBe('Hello ')
    expect(collectTrackedChanges(editor.state.doc)).toHaveLength(0)
  })

  it('plain deletion: accept deletes the text', () => {
    setPlainDeletionDoc()
    const range = findRange('deletion')
    expect(acceptTrackedChange(editor, range)).toBe(true)
    expect(editor.getText()).toBe('Hello ')
    expect(collectTrackedChanges(editor.state.doc)).toHaveLength(0)
  })

  it('plain deletion: reject keeps text, strips mark', () => {
    setPlainDeletionDoc()
    const range = findRange('deletion')
    expect(rejectTrackedChange(editor, range)).toBe(true)
    expect(editor.getText()).toBe('Hello world')
    expect(collectTrackedChanges(editor.state.doc)).toHaveLength(0)
  })
})

describe('acceptAllTrackedChanges / rejectAllTrackedChanges', () => {
  it('acceptAll: plain insertion kept, plain deletion removed, D7 double-marked removed', () => {
    setCombinedDoc()
    const n = acceptAllTrackedChanges(editor)
    expect(n).toBe(3)
    expect(editor.getText()).toBe('A ins B  C ')
    expect(collectTrackedChanges(editor.state.doc)).toHaveLength(0)
  })

  it('rejectAll: plain insertion removed, plain deletion kept (mark stripped), D7 double-marked removed too', () => {
    setCombinedDoc()
    const n = rejectAllTrackedChanges(editor)
    expect(n).toBe(3)
    // 'ins' (rejected insertion) gone; 'del' (rejected deletion == keep
    // text) stays; 'both' (D7 — reject-all rejects the nested insertion
    // too) gone.
    expect(editor.getText()).toBe('A  B del C ')
    expect(collectTrackedChanges(editor.state.doc)).toHaveLength(0)
  })

  it('acceptAll on an all-plain doc matches pre-ENH-260 semantics', () => {
    setPlainInsertionDoc()
    const n = acceptAllTrackedChanges(editor)
    expect(n).toBe(1)
    expect(editor.getText()).toBe('Hello world')
  })

  it('rejectAll on an all-plain doc matches pre-ENH-260 semantics', () => {
    setPlainDeletionDoc()
    const n = rejectAllTrackedChanges(editor)
    expect(n).toBe(1)
    expect(editor.getText()).toBe('Hello world')
  })
})

describe('D9 — every dispatched transaction carries META_SUGGEST_AUTO', () => {
  it('acceptTrackedChange', () => {
    setPlainDeletionDoc()
    const range = findRange('deletion')
    const spy = spyOnDispatch()
    acceptTrackedChange(editor, range)
    expect(spy.trs).toHaveLength(1)
    expect(spy.trs[0].getMeta(META_SUGGEST_AUTO)).toBe(true)
    spy.restore()
  })

  it('rejectTrackedChange', () => {
    setDoubleMarkedDoc()
    const range = findRange('deletion', true)
    const spy = spyOnDispatch()
    rejectTrackedChange(editor, range)
    expect(spy.trs).toHaveLength(1)
    expect(spy.trs[0].getMeta(META_SUGGEST_AUTO)).toBe(true)
    spy.restore()
  })

  it('acceptAllTrackedChanges', () => {
    setCombinedDoc()
    const spy = spyOnDispatch()
    acceptAllTrackedChanges(editor)
    expect(spy.trs).toHaveLength(1)
    expect(spy.trs[0].getMeta(META_SUGGEST_AUTO)).toBe(true)
    spy.restore()
  })

  it('rejectAllTrackedChanges', () => {
    setCombinedDoc()
    const spy = spyOnDispatch()
    rejectAllTrackedChanges(editor)
    expect(spy.trs).toHaveLength(1)
    expect(spy.trs[0].getMeta(META_SUGGEST_AUTO)).toBe(true)
    spy.restore()
  })
})
