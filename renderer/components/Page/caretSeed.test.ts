// @vitest-environment jsdom
//
// ENH-091 — caret-seed regression tests. The seedCaretInEmptyParagraph
// helper is conservative by design: it only repositions the caret when
// the doc has a clearly-recognizable boilerplate shape. These tests
// pin the boundary between "seed" and "leave alone" so future shape
// changes can't silently regress the behavior.

import { describe, it, expect, beforeEach } from 'vitest'
import { seedCaretInEmptyParagraph } from './caretSeed'

// Tests share the test-runner's live window+document. `createHTMLDocument`
// creates a doc without a window association in jsdom (Selection lives on
// Window, so `getSelection()` returns null on a detached doc). Using the
// shared `document` keeps the Selection API live; `beforeEach` resets the
// body + selection between tests so they stay isolated.
function loadCanvas(html: string): Document {
  document.body.innerHTML = html
  return document
}

describe('seedCaretInEmptyParagraph (ENH-091)', () => {
  beforeEach(() => {
    // Reset selection between tests so leakage from one test can't
    // mask a no-op in another.
    const sel = window.getSelection()
    sel?.removeAllRanges()
  })

  it('seeds the caret inside the empty trailing <p> on a boilerplate-shaped canvas', () => {
    const doc = loadCanvas('<main><h1>Title</h1><p></p></main>')
    seedCaretInEmptyParagraph(doc)
    const sel = window.getSelection()
    expect(sel).toBeTruthy()
    expect(sel!.rangeCount).toBe(1)
    const range = sel!.getRangeAt(0)
    expect((range.startContainer as Element).tagName).toBe('P')
    expect(range.collapsed).toBe(true)
  })

  it('also handles boilerplate without the <main> wrapper', () => {
    const doc = loadCanvas('<h1>Title</h1><p></p>')
    seedCaretInEmptyParagraph(doc)
    const sel = doc.getSelection()
    expect(sel!.rangeCount).toBe(1)
    expect((sel!.getRangeAt(0).startContainer as Element).tagName).toBe('P')
  })

  it('treats a single whitespace-only text node in the <p> as empty', () => {
    const doc = loadCanvas('<main><h1>Title</h1><p>   </p></main>')
    seedCaretInEmptyParagraph(doc)
    expect(window.getSelection()!.rangeCount).toBe(1)
  })

  it('does NOT seed when the <p> contains real text', () => {
    const doc = loadCanvas('<main><h1>Title</h1><p>existing prose</p></main>')
    seedCaretInEmptyParagraph(doc)
    // No-op assertion: in jsdom, an unwritten selection returns null.
    // The helper only mutates the selection on a positive shape match,
    // so a null selection here proves we didn't touch it.
    const sel = window.getSelection()
    expect(sel === null || sel.rangeCount === 0).toBe(true)
  })

  it('does NOT seed when there is content between the H1 and the trailing <p>', () => {
    const doc = loadCanvas('<main><h1>Title</h1><p>some content</p><p></p></main>')
    seedCaretInEmptyParagraph(doc)
    // No-op assertion: in jsdom, an unwritten selection returns null.
    // The helper only mutates the selection on a positive shape match,
    // so a null selection here proves we didn't touch it.
    const sel = window.getSelection()
    expect(sel === null || sel.rangeCount === 0).toBe(true)
  })

  it('does NOT seed when the first child is not an H1', () => {
    const doc = loadCanvas('<main><p>paragraph first</p><p></p></main>')
    seedCaretInEmptyParagraph(doc)
    // No-op assertion: in jsdom, an unwritten selection returns null.
    // The helper only mutates the selection on a positive shape match,
    // so a null selection here proves we didn't touch it.
    const sel = window.getSelection()
    expect(sel === null || sel.rangeCount === 0).toBe(true)
  })

  it('does NOT seed when the last child is not a <p> (e.g. ends with a list)', () => {
    const doc = loadCanvas('<main><h1>Title</h1><ul><li>item</li></ul></main>')
    seedCaretInEmptyParagraph(doc)
    // No-op assertion: in jsdom, an unwritten selection returns null.
    // The helper only mutates the selection on a positive shape match,
    // so a null selection here proves we didn't touch it.
    const sel = window.getSelection()
    expect(sel === null || sel.rangeCount === 0).toBe(true)
  })

  it('does NOT seed when the <p> contains a child element (e.g. an <em>)', () => {
    const doc = loadCanvas('<main><h1>Title</h1><p><em></em></p></main>')
    seedCaretInEmptyParagraph(doc)
    // No-op assertion: in jsdom, an unwritten selection returns null.
    // The helper only mutates the selection on a positive shape match,
    // so a null selection here proves we didn't touch it.
    const sel = window.getSelection()
    expect(sel === null || sel.rangeCount === 0).toBe(true)
  })

  it('is a no-op on a richly-populated canvas (existing user content)', () => {
    const doc = loadCanvas(`
      <main>
        <h1>Title</h1>
        <p>First paragraph with content.</p>
        <h2>Section</h2>
        <ul><li>bullet</li></ul>
        <p>Final thoughts.</p>
      </main>
    `)
    seedCaretInEmptyParagraph(doc)
    // No-op assertion: in jsdom, an unwritten selection returns null.
    // The helper only mutates the selection on a positive shape match,
    // so a null selection here proves we didn't touch it.
    const sel = window.getSelection()
    expect(sel === null || sel.rangeCount === 0).toBe(true)
  })

  it('is a no-op when the body is empty (no boilerplate yet)', () => {
    const doc = loadCanvas('')
    seedCaretInEmptyParagraph(doc)
    // No-op assertion: in jsdom, an unwritten selection returns null.
    // The helper only mutates the selection on a positive shape match,
    // so a null selection here proves we didn't touch it.
    const sel = window.getSelection()
    expect(sel === null || sel.rangeCount === 0).toBe(true)
  })

  it('survives missing body gracefully (defensive guard)', () => {
    // Simulate a doc whose body hasn't been populated yet (the iframe
    // pre-load window). We can't actually remove the test runner's
    // body, so build a fake Document-shaped object that only carries
    // the fields the helper reads. The helper guards on `!doc.body`
    // first, so any falsy body terminates safely.
    const fakeDoc = {} as unknown as Document
    expect(() => seedCaretInEmptyParagraph(fakeDoc)).not.toThrow()
  })
})
