// @vitest-environment jsdom
//
// FOLLOWUP-014 (Sprint 13) regression coverage for the canvas
// paste-image v2 serializer hook. The serializer's `attrString` now
// recognizes `data-duo-original-src` on img elements (set by
// `imageHydrate.ts` when the live <img> displays a blob URL hydrated
// from disk) and swaps src ← data-duo-original-src at save time so
// the persisted HTML carries the portable relative path, not the
// ephemeral blob URL.
//
// Without these tests, a future refactor to attrString could silently
// drop the swap and we'd reintroduce v0.6.10's blob-URL-in-source bug.

import { describe, it, expect } from 'vitest'
import { serializeDocument } from './serialize'

function makeDoc(bodyHtml: string): Document {
  const doc = document.implementation.createHTMLDocument('test')
  doc.body.innerHTML = bodyHtml
  return doc
}

describe('FOLLOWUP-014 — img src ↔ data-duo-original-src swap on serialize', () => {
  it('swaps src to data-duo-original-src and drops the marker attr', () => {
    const doc = makeDoc(
      '<img src="blob:http://localhost:5173/abc" data-duo-original-src="red.png" alt="r">'
    )
    const out = serializeDocument(doc)
    expect(out).toContain('<img alt="r" src="red.png">')
    expect(out).not.toContain('blob:')
    expect(out).not.toContain('data-duo-original-src')
  })

  it('preserves src when data-duo-original-src is absent', () => {
    const doc = makeDoc('<img src="https://example.com/x.png" alt="ex">')
    const out = serializeDocument(doc)
    expect(out).toContain('<img alt="ex" src="https://example.com/x.png">')
  })

  it('handles abs filesystem path round-trip', () => {
    const doc = makeDoc(
      '<img src="blob:http://localhost:5173/zzz" data-duo-original-src="/tmp/v2/red.png" alt="">'
    )
    const out = serializeDocument(doc)
    expect(out).toContain('src="/tmp/v2/red.png"')
    expect(out).not.toContain('blob:')
  })

  it('does NOT touch src on non-img elements with data-duo-original-src', () => {
    // The marker is img-specific; if some unrelated element happens
    // to carry it (defensive — shouldn't happen in practice), the
    // swap must not fire on its src attribute (which probably isn't
    // even a thing on that element).
    const doc = makeDoc(
      '<div data-duo-original-src="ignored">content</div>'
    )
    const out = serializeDocument(doc)
    expect(out).toContain('data-duo-original-src="ignored"')
  })
})
