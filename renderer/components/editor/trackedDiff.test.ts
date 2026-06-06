// @vitest-environment jsdom
//
// ENH-195 (D3) — the "View diff" round-trip invariant.
//
// `applyTrackedDiff(editor, oldDoc, attrs)` rewrites the reloaded editor doc
// (newDoc) into a tracked-changes view of oldDoc → newDoc. The whole point —
// and the only ground truth we assert — is that the editor's EXISTING bulk
// accept/reject helpers are its exact inverses:
//
//   • acceptAllTrackedChanges(editor)  →  doc === newDoc  (take the disk version)
//   • rejectAllTrackedChanges(editor)  →  doc === oldDoc  (keep the user's version)
//
// compared with ProseMirror `Node.eq`. We build old/new docs through the same
// StarterKit + Markdown path the editor mounts, but ALSO load InsertionMark +
// DeletionMark so the schema actually has the suggesting marks `applyTrackedDiff`
// stamps. Crucially every doc is built from ONE editor (hence ONE schema):
// `Node.eq` compares mark/node *types by reference*, so docs from two separate
// editors never compare equal even when structurally identical.

import { describe, it, expect, afterAll } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import { InsertionMark } from './extensions/InsertionMark'
import { DeletionMark } from './extensions/DeletionMark'
import { applyTrackedDiff } from './trackedDiff'
import {
  acceptAllTrackedChanges,
  rejectAllTrackedChanges,
  countTrackedChanges
} from './trackedChanges'

const ATTRS = { author: 'tester', ts: '2026-06-06T00:00:00.000Z' }

// One editor → one schema, shared by every doc we build and by the
// editor-under-test. Includes the suggesting marks so `editor.schema.marks`
// has insertionMark / deletionMark.
const editor = new Editor({
  element: document.createElement('div'),
  extensions: [
    StarterKit,
    Markdown.configure({ tightLists: true, bulletListMarker: '-', breaks: false }),
    InsertionMark,
    DeletionMark
  ]
})

afterAll(() => editor.destroy())

/** Snapshot the top-level PM node for a markdown string, in the shared schema. */
function docOf(markdown: string): PMNode {
  editor.commands.setContent(markdown)
  return editor.state.doc
}

/**
 * Drive the full round-trip for an old→new markdown pair and return the
 * observed facts. We build oldDoc/newDoc first, then for each direction reset
 * the editor to newMd (the reloaded state `applyTrackedDiff` expects), stamp
 * the diff, and accept (or reject) — capturing whether the result `Node.eq`s
 * the expected doc.
 */
function roundTrip(oldMd: string, newMd: string) {
  const oldDoc = docOf(oldMd)
  const newDoc = docOf(newMd)

  // Accept path: tracked diff, then accept-all should reproduce newDoc.
  editor.commands.setContent(newMd)
  const stamped = applyTrackedDiff(editor, oldDoc, ATTRS)
  const trackedCount = countTrackedChanges(editor.state.doc)
  acceptAllTrackedChanges(editor)
  const acceptEqNew = editor.state.doc.eq(newDoc)
  const afterAccept = editor.state.doc

  // Reject path: fresh build, then reject-all should reproduce oldDoc.
  editor.commands.setContent(newMd)
  applyTrackedDiff(editor, oldDoc, ATTRS)
  rejectAllTrackedChanges(editor)
  const rejectEqOld = editor.state.doc.eq(oldDoc)
  const afterReject = editor.state.doc

  return { stamped, trackedCount, acceptEqNew, rejectEqOld, afterAccept, afterReject, oldDoc, newDoc }
}

describe('applyTrackedDiff — accept/reject round-trip', () => {
  it('identity (old === new) → 0 changes, no marks, both sides unchanged', () => {
    const same = ['First paragraph.', '', 'Second paragraph.'].join('\n')
    const r = roundTrip(same, same)
    expect(r.stamped).toBe(0)
    expect(r.trackedCount).toBe(0)
    expect(r.acceptEqNew).toBe(true)
    expect(r.rejectEqOld).toBe(true)
  })

  it('pure insertion mid-doc → accept===new, reject===old', () => {
    const r = roundTrip(
      ['First paragraph.', '', 'Third paragraph.'].join('\n'),
      ['First paragraph.', '', 'Second paragraph inserted.', '', 'Third paragraph.'].join('\n')
    )
    expect(r.stamped).toBeGreaterThan(0)
    expect(r.trackedCount).toBeGreaterThan(0)
    expect(r.acceptEqNew).toBe(true)
    expect(r.rejectEqOld).toBe(true)
  })

  it('pure deletion of a whole paragraph → accept===new, reject===old', () => {
    const r = roundTrip(
      ['Keep this paragraph.', '', 'Delete this whole paragraph.'].join('\n'),
      ['Keep this paragraph.'].join('\n')
    )
    expect(r.stamped).toBeGreaterThan(0)
    expect(r.trackedCount).toBeGreaterThan(0)
    expect(r.acceptEqNew).toBe(true)
    expect(r.rejectEqOld).toBe(true)
  })

  it("substitution (a paragraph's text replaced) → accept===new, reject===old", () => {
    const r = roundTrip(
      ['Intro stays put.', '', 'Alpha bravo charlie delta.'].join('\n'),
      ['Intro stays put.', '', 'Alpha XRAY charlie delta.'].join('\n')
    )
    expect(r.stamped).toBeGreaterThan(0)
    expect(r.trackedCount).toBeGreaterThan(0)
    expect(r.acceptEqNew).toBe(true)
    expect(r.rejectEqOld).toBe(true)
    // A same-block substitution shows BOTH an insertion and a deletion.
    expect(r.trackedCount).toBeGreaterThanOrEqual(2)
  })

  it('massive overwrite (every block replaced with disjoint content) → accept===new, reject===old', () => {
    // The owner's case: a destructive external write swaps the entire doc.
    const r = roundTrip(
      [
        'Original alpha line of prose.',
        '',
        'Original bravo line of prose.',
        '',
        'Original charlie line of prose.'
      ].join('\n'),
      [
        'Replacement xylophone content here.',
        '',
        'Replacement yarn content here.',
        '',
        'Replacement zebra content here.'
      ].join('\n')
    )
    expect(r.stamped).toBeGreaterThan(0)
    expect(r.trackedCount).toBeGreaterThan(0)
    expect(r.acceptEqNew).toBe(true)
    expect(r.rejectEqOld).toBe(true)
  })

  it('dissimilar same-type block (wholly different heading) → clean WHOLE-BLOCK strike+insert, not char-interleaved', () => {
    // The owner's massive-overwrite case. A same-type block whose content is
    // wholly replaced must render as a struck old block + an inserted new block
    // (clean), NOT a noisy char-level interleave inside one block. We assert the
    // structure: SOME top-level block is entirely deletion-marked (the struck
    // old heading) and SOME is entirely insertion-marked (the inserted new one).
    const oldMd = ['# Alpha bravo charlie', '', 'Shared body paragraph stays put.'].join('\n')
    const newMd = ['# Xylophone yarn zebra', '', 'Shared body paragraph stays put.'].join('\n')
    const r = roundTrip(oldMd, newMd)
    expect(r.acceptEqNew).toBe(true)
    expect(r.rejectEqOld).toBe(true)

    editor.commands.setContent(newMd)
    applyTrackedDiff(editor, r.oldDoc, ATTRS)
    const doc = editor.state.doc
    const hasBlockEntirely = (markName: string): boolean => {
      let found = false
      doc.forEach((block) => {
        if (!block.isTextblock || block.textContent.length === 0) return
        let all = true
        block.forEach((child) => {
          if (!child.isText || !child.marks.some((m) => m.type.name === markName)) all = false
        })
        if (all) found = true
      })
      return found
    }
    expect(hasBlockEntirely('deletionMark')).toBe(true)   // a fully-struck old block
    expect(hasBlockEntirely('insertionMark')).toBe(true)  // a fully-inserted new block
  })

  it('returns 0 (no-op) when the schema lacks the suggesting marks', () => {
    // A plain editor without InsertionMark / DeletionMark — applyTrackedDiff
    // must bail gracefully rather than throw.
    const plain = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, Markdown]
    })
    plain.commands.setContent('Whatever.')
    // oldDoc here is in `plain`'s schema; with no marks present we never reach
    // the diff, so the schema mismatch is irrelevant.
    const stamped = applyTrackedDiff(plain, plain.state.doc, ATTRS)
    expect(stamped).toBe(0)
    plain.destroy()
  })
})
