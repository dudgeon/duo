// @vitest-environment jsdom
//
// FOLLOWUP-009 — comment-anchor reconciliation regression coverage.
//
// The duplicate-id-on-clone bug class (BUG-088 / BUG-090 / BUG-087) is
// the recurring-regression class that landed durable test coverage
// per the feedback memory ("when a bug returns after we've fixed it,
// add a regression test"). The fix (commit `feat: idInjector
// duplicate-detect`, Sprint 7 rev6) lives in `installAutoStampIds`
// inside `idInjector.ts`. These tests pin the exact contentEditable
// Enter-clone shape that triggered the bug AND the broader patterns
// (paste of stamped fragment, undo/redo) the fix covers.

import { describe, it, expect, beforeEach } from 'vitest'
import { installAutoStampIds, injectIds, countDuoIds } from './idInjector'

function loadDoc(html: string): Document {
  document.body.innerHTML = html
  return document
}

function ids(doc: Document, selector: string): string[] {
  return Array.from(doc.body.querySelectorAll<HTMLElement>(selector))
    .map((el) => el.getAttribute('data-duo-id') ?? '')
}

describe('installAutoStampIds (BUG-088/090/087 root-cause regression)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('stamps fresh ids on initial sweep when body has elements without data-duo-id', () => {
    const doc = loadDoc('<main><h1>Title</h1><p>body</p></main>')
    const cleanup = installAutoStampIds(doc)
    try {
      const elementIds = ids(doc, '[data-duo-id]')
      expect(elementIds.length).toBeGreaterThanOrEqual(3) // main, h1, p
      // Every stamped id is unique
      expect(new Set(elementIds).size).toBe(elementIds.length)
    } finally {
      cleanup()
    }
  })

  it('preserves existing ids on initial sweep (idempotent on already-stamped doc)', () => {
    const doc = loadDoc(`
      <main data-duo-id="01main"><h1 data-duo-id="01h1">Title</h1><p data-duo-id="01p">body</p></main>
    `)
    const cleanup = installAutoStampIds(doc)
    try {
      expect(doc.querySelector('main')!.getAttribute('data-duo-id')).toBe('01main')
      expect(doc.querySelector('h1')!.getAttribute('data-duo-id')).toBe('01h1')
      expect(doc.querySelector('p')!.getAttribute('data-duo-id')).toBe('01p')
    } finally {
      cleanup()
    }
  })

  it('CORE REGRESSION: re-stamps a duplicate-id <li> simulating contentEditable Enter clone', async () => {
    // Pre-fix: pressing Enter at the end of an <li> caused contentEditable
    // to clone the source <li> — the new sibling kept the parent's
    // data-duo-id. The auto-stamp observer saw "an existing id" and
    // skipped it, so all bullets in the list shared one id and comments
    // anchored to any of them resolved to the first sibling. Post-fix
    // (idInjector.ts § stampElement), the new sibling is detected as a
    // duplicate and gets a fresh ULID; the original keeps its id so
    // existing comments still resolve.
    const doc = loadDoc(`
      <main data-duo-id="m"><ul data-duo-id="ul"><li data-duo-id="li-orig">first</li></ul></main>
    `)
    const cleanup = installAutoStampIds(doc)
    try {
      const ul = doc.querySelector('ul')!
      const cloned = doc.createElement('li')
      cloned.setAttribute('data-duo-id', 'li-orig') // simulates contentEditable's clone
      cloned.textContent = 'second'
      ul.appendChild(cloned)
      // MutationObserver is microtask-batched in jsdom; wait one tick.
      await new Promise((resolve) => setTimeout(resolve, 0))
      const liIds = ids(doc, 'li')
      expect(liIds.length).toBe(2)
      // First-in-document keeps the original id; the duplicate gets a fresh one.
      expect(liIds[0]).toBe('li-orig')
      expect(liIds[1]).not.toBe('li-orig')
      expect(liIds[1].length).toBeGreaterThan(0)
    } finally {
      cleanup()
    }
  })

  it('handles multiple consecutive Enter clones (third bullet also gets a unique id)', async () => {
    const doc = loadDoc(`
      <main data-duo-id="m"><ul data-duo-id="ul"><li data-duo-id="li-orig">first</li></ul></main>
    `)
    const cleanup = installAutoStampIds(doc)
    try {
      const ul = doc.querySelector('ul')!
      // Two Enter-clones in sequence (matches the user's repro: type
      // bullet, Enter, type bullet, Enter, type bullet).
      for (const text of ['second', 'third']) {
        const li = doc.createElement('li')
        li.setAttribute('data-duo-id', 'li-orig')
        li.textContent = text
        ul.appendChild(li)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      const liIds = ids(doc, 'li')
      expect(liIds.length).toBe(3)
      // All three li ids are distinct.
      expect(new Set(liIds).size).toBe(3)
      // First keeps original; second + third have fresh ids.
      expect(liIds[0]).toBe('li-orig')
    } finally {
      cleanup()
    }
  })

  it('stamps a fresh element added without an id (markdown-shortcut conversion path)', async () => {
    const doc = loadDoc('<main data-duo-id="m"></main>')
    const cleanup = installAutoStampIds(doc)
    try {
      const main = doc.querySelector('main')!
      // Markdown shortcut converts an inline span to a heading; the
      // converter doesn't carry over a data-duo-id (markdownShortcuts.ts
      // creates fresh elements).
      const h1 = doc.createElement('h1')
      h1.textContent = 'New heading'
      main.appendChild(h1)
      await new Promise((resolve) => setTimeout(resolve, 0))
      const stamped = h1.getAttribute('data-duo-id')
      expect(stamped).toBeTruthy()
      expect(stamped!.length).toBeGreaterThan(0)
    } finally {
      cleanup()
    }
  })

  it('skips BR + HR elements (they have no comment / agent semantics)', async () => {
    const doc = loadDoc('<main data-duo-id="m"><p data-duo-id="p"></p></main>')
    const cleanup = installAutoStampIds(doc)
    try {
      const p = doc.querySelector('p')!
      const br = doc.createElement('br')
      const hr = doc.createElement('hr')
      p.appendChild(br)
      p.appendChild(hr)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(br.hasAttribute('data-duo-id')).toBe(false)
      expect(hr.hasAttribute('data-duo-id')).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('respects opt-out marker', async () => {
    const doc = loadDoc(`
      <main data-duo-id="m"><div data-duo-id="opt-out">never stamp me</div></main>
    `)
    const cleanup = installAutoStampIds(doc)
    try {
      // Initial sweep: opt-out element should keep the marker.
      expect(doc.querySelector('div')!.getAttribute('data-duo-id')).toBe('opt-out')
    } finally {
      cleanup()
    }
  })

  it('handles paste of a complex stamped fragment (multiple existing ids, all unique → no re-stamping)', async () => {
    const doc = loadDoc('<main data-duo-id="m"></main>')
    const cleanup = installAutoStampIds(doc)
    try {
      const main = doc.querySelector('main')!
      // Paste a fragment with already-unique ids (typical paste from
      // another canvas).
      const frag = doc.createDocumentFragment()
      const h1 = doc.createElement('h1')
      h1.setAttribute('data-duo-id', 'pasted-h1')
      h1.textContent = 'Pasted heading'
      const p = doc.createElement('p')
      p.setAttribute('data-duo-id', 'pasted-p')
      p.textContent = 'Pasted body'
      frag.appendChild(h1)
      frag.appendChild(p)
      main.appendChild(frag)
      await new Promise((resolve) => setTimeout(resolve, 0))
      // Both ids should survive untouched (no duplicate, so no re-stamp).
      expect(doc.querySelector('h1')!.getAttribute('data-duo-id')).toBe('pasted-h1')
      expect(doc.querySelector('p')!.getAttribute('data-duo-id')).toBe('pasted-p')
    } finally {
      cleanup()
    }
  })

  it('handles paste of a fragment whose ids collide with existing ids (re-stamps the pasted ones)', async () => {
    const doc = loadDoc(`
      <main data-duo-id="m"><h1 data-duo-id="existing">Existing heading</h1></main>
    `)
    const cleanup = installAutoStampIds(doc)
    try {
      const main = doc.querySelector('main')!
      // Paste a fragment whose root id collides with an existing element.
      const cloned = doc.createElement('p')
      cloned.setAttribute('data-duo-id', 'existing') // collision
      cloned.textContent = 'Pasted'
      main.appendChild(cloned)
      await new Promise((resolve) => setTimeout(resolve, 0))
      // First-in-document wins: the original h1 keeps its id; the paste
      // gets a fresh one.
      expect(doc.querySelector('h1')!.getAttribute('data-duo-id')).toBe('existing')
      expect(doc.querySelector('p')!.getAttribute('data-duo-id')).not.toBe('existing')
    } finally {
      cleanup()
    }
  })

  it('cleanup function disconnects the observer (no further stamping after disconnect)', async () => {
    const doc = loadDoc('<main data-duo-id="m"></main>')
    const cleanup = installAutoStampIds(doc)
    cleanup()
    const main = doc.querySelector('main')!
    const p = doc.createElement('p')
    main.appendChild(p)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Observer is disconnected → new element should NOT get stamped.
    expect(p.hasAttribute('data-duo-id')).toBe(false)
  })
})

describe('injectIds (initial-stamp helper)', () => {
  it('stamps every body element with a fresh data-duo-id', () => {
    const doc = loadDoc('<main><h1>Title</h1><p>body</p><ul><li>one</li></ul></main>')
    const result = injectIds(doc)
    expect(result.injected).toBeGreaterThanOrEqual(5) // main, h1, p, ul, li
    expect(result.total).toBe(result.injected)
    // Every element has a unique id.
    const allIds = Array.from(doc.body.querySelectorAll<HTMLElement>('[data-duo-id]'))
      .map((el) => el.getAttribute('data-duo-id'))
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('skips BR + HR + opt-out elements', () => {
    const doc = loadDoc(`
      <main>
        <p>p</p>
        <br>
        <hr>
        <div data-duo-id="opt-out">opted out</div>
      </main>
    `)
    injectIds(doc)
    expect(doc.querySelector('br')!.hasAttribute('data-duo-id')).toBe(false)
    expect(doc.querySelector('hr')!.hasAttribute('data-duo-id')).toBe(false)
    expect(doc.querySelector('div')!.getAttribute('data-duo-id')).toBe('opt-out')
  })
})

describe('countDuoIds', () => {
  it('counts elements with real ids (excludes opt-out sentinels)', () => {
    const doc = loadDoc(`
      <main data-duo-id="m">
        <h1 data-duo-id="h">Title</h1>
        <div data-duo-id="opt-out">opted out</div>
      </main>
    `)
    expect(countDuoIds(doc)).toBe(2) // main + h1; opt-out excluded
  })

  it('returns zero on a doc with no stamped elements', () => {
    const doc = loadDoc('<main><h1>Title</h1></main>')
    expect(countDuoIds(doc)).toBe(0)
  })
})
