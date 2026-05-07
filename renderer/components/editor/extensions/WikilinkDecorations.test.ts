// @vitest-environment jsdom
//
// ENH-096 (B1) — click-resolver test.
//
// The walk-rev3 symptom was "cmd+click is no-op." The resolver fix
// in v0.6.8 (case-insensitive normalize) was downstream — the
// click handler's DOM walk never reached the resolver because
// `event.target` is a Text node when the click hits visible text
// inside our decoration span. `Element.closest` is undefined on
// Text nodes; the optional chain returned null and we bailed.
//
// These tests fixture the relevant DOM shapes against the helper
// extracted from handleClick. They don't spin up a real
// ProseMirror editor (which would require importing the full
// schema + StarterKit machinery and offers no extra signal here);
// they simulate the two real-world target shapes ProseMirror emits.

import { describe, expect, it, vi } from 'vitest'
import { resolveWikilinkTargetAtClick } from './WikilinkDecorations'

function makeWikilinkSpan(target: string, text = '[[Other Note]]') {
  const span = document.createElement('span')
  span.className = 'duo-wikilink'
  span.setAttribute('data-duo-wikilink-target', target)
  span.appendChild(document.createTextNode(text))
  document.body.appendChild(span)
  return span
}

function fakeView(_pluginState: unknown = null) {
  // The DOM-walk path doesn't read view.state, so a stub is fine
  // for hypothesis #2 coverage. The pos-based fallback exercises
  // PLUGIN_KEY.getState(view.state) — which we can't fake without
  // the full editor — so those tests skip the fallback by relying
  // on the DOM path landing first.
  return { state: {} } as never
}

describe('resolveWikilinkTargetAtClick — DOM walk', () => {
  it('resolves when event.target is the wikilink span itself', () => {
    const span = makeWikilinkSpan('Other Note')
    const out = resolveWikilinkTargetAtClick(fakeView(), 0, { target: span })
    expect(out).toBe('Other Note')
    span.remove()
  })

  it('resolves when event.target is a Text node child of the span (the v0.6.8 walk-3 root cause)', () => {
    const span = makeWikilinkSpan('Other Note')
    const textNode = span.firstChild
    expect(textNode?.nodeType).toBe(Node.TEXT_NODE)
    const out = resolveWikilinkTargetAtClick(fakeView(), 0, { target: textNode })
    expect(out).toBe('Other Note')
    span.remove()
  })

  it('resolves when event.target is a nested element inside the span', () => {
    const span = makeWikilinkSpan('Other Note', '')
    const inner = document.createElement('em')
    inner.textContent = '[[Other Note]]'
    span.appendChild(inner)
    const out = resolveWikilinkTargetAtClick(fakeView(), 0, { target: inner })
    expect(out).toBe('Other Note')
    span.remove()
  })

  it('resolves path-bearing targets', () => {
    const span = makeWikilinkSpan('Notes/Nested Note')
    const out = resolveWikilinkTargetAtClick(fakeView(), 0, { target: span.firstChild })
    expect(out).toBe('Notes/Nested Note')
    span.remove()
  })

  it('returns null when the click target is outside any wikilink span', () => {
    const para = document.createElement('p')
    para.textContent = 'plain text, no wikilink here'
    document.body.appendChild(para)
    // Pos-based fallback won't fire either (pluginState is null in fakeView).
    const out = resolveWikilinkTargetAtClick(fakeView(), 0, { target: para.firstChild })
    expect(out).toBeNull()
    para.remove()
  })

  it('returns null when event.target is null', () => {
    const out = resolveWikilinkTargetAtClick(fakeView(), 0, { target: null })
    expect(out).toBeNull()
  })

  it('handles the v0.6.8 walk-3 normalize case end-to-end (target lookup not normalize)', () => {
    // The decoration carries the target from the source markdown verbatim
    // (`[[Other Note]]` → "Other Note"). The downstream resolver in
    // App.tsx does the normalize. This test confirms the click handler
    // hands off the verbatim target — normalization is the resolver's job.
    const span = makeWikilinkSpan('Other Note')
    const out = resolveWikilinkTargetAtClick(fakeView(), 0, { target: span.firstChild })
    expect(out).toBe('Other Note')
    span.remove()
  })
})
