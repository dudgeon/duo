// BUG-138 Phase 1b — round-trip tests for the JSON serialize side.
//
// Coverage focus: doc-JSON in → CriticMarkup-wrapped doc-JSON out.
// The PARSE side (applyCriticMarkupFromText) requires a live TipTap
// editor; those tests live in MarkdownEditor.test.tsx alongside other
// editor integration tests.

import { describe, it, expect } from 'vitest'
import { materializeCriticMarkupToJSON } from './markdownCriticMarkup'

// Minimal editor-shape for the test surface — only `isDestroyed` and
// `getJSON` are touched.
function fakeEditor(doc: unknown) {
  return {
    isDestroyed: false,
    getJSON: () => doc
  } as unknown as import('@tiptap/react').Editor
}

describe('materializeCriticMarkupToJSON — insertion', () => {
  it('wraps text with insertionMark in {++…++}', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world', marks: [{ type: 'insertionMark', attrs: { author: 'claude', ts: 't' } }] }
        ]
      }]
    }
    const out = materializeCriticMarkupToJSON(fakeEditor(doc)) as typeof doc
    expect(out.content?.[0].content).toEqual([
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: '{++world++}' }
    ])
  })
})

describe('materializeCriticMarkupToJSON — deletion', () => {
  it('wraps text with deletionMark in {--…--}', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'remove me', marks: [{ type: 'deletionMark', attrs: { author: 'claude', ts: 't' } }] }
        ]
      }]
    }
    const out = materializeCriticMarkupToJSON(fakeEditor(doc)) as typeof doc
    expect(out.content?.[0].content).toEqual([
      { type: 'text', text: '{--remove me--}' }
    ])
  })
})

describe('materializeCriticMarkupToJSON — substitution fold', () => {
  it('folds adjacent delete + insert into {~~old~>new~~}', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'old text', marks: [{ type: 'deletionMark', attrs: {} }] },
          { type: 'text', text: 'new text', marks: [{ type: 'insertionMark', attrs: {} }] }
        ]
      }]
    }
    const out = materializeCriticMarkupToJSON(fakeEditor(doc)) as typeof doc
    expect(out.content?.[0].content).toEqual([
      { type: 'text', text: '{~~old text~>new text~~}' }
    ])
  })

  it('does NOT fold when separated by plain text', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'old', marks: [{ type: 'deletionMark', attrs: {} }] },
          { type: 'text', text: ' wait ' },
          { type: 'text', text: 'new', marks: [{ type: 'insertionMark', attrs: {} }] }
        ]
      }]
    }
    const out = materializeCriticMarkupToJSON(fakeEditor(doc)) as typeof doc
    expect(out.content?.[0].content).toEqual([
      { type: 'text', text: '{--old--}' },
      { type: 'text', text: ' wait ' },
      { type: 'text', text: '{++new++}' }
    ])
  })

  it('does NOT fold when insert comes BEFORE delete (order matters)', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'new', marks: [{ type: 'insertionMark', attrs: {} }] },
          { type: 'text', text: 'old', marks: [{ type: 'deletionMark', attrs: {} }] }
        ]
      }]
    }
    const out = materializeCriticMarkupToJSON(fakeEditor(doc)) as typeof doc
    expect(out.content?.[0].content).toEqual([
      { type: 'text', text: '{++new++}' },
      { type: 'text', text: '{--old--}' }
    ])
  })
})

describe('materializeCriticMarkupToJSON — highlight', () => {
  it('wraps text with highlightMark in {==…==}', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'important', marks: [{ type: 'highlightMark', attrs: {} }] }
        ]
      }]
    }
    const out = materializeCriticMarkupToJSON(fakeEditor(doc)) as typeof doc
    expect(out.content?.[0].content).toEqual([
      { type: 'text', text: '{==important==}' }
    ])
  })
})

describe('materializeCriticMarkupToJSON — comment', () => {
  it('wraps anchored comment as {==anchor==}{>>body<<} with metadata', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'anchor text', marks: [{
            type: 'commentMark',
            attrs: { commentId: 'c-01', author: 'dudgeon', ts: '2026-05-18T12:00:00Z', body: 'thought' }
          }] }
        ]
      }]
    }
    const out = materializeCriticMarkupToJSON(fakeEditor(doc)) as typeof doc
    expect(out.content?.[0].content).toEqual([
      { type: 'text', text: '{==anchor text==}{>>id:c-01|author:dudgeon|ts:2026-05-18T12:00:00Z|thought<<}' }
    ])
  })

  it('emits reply-to metadata in comment', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'anchor', marks: [{
            type: 'commentMark',
            attrs: { commentId: 'c-02', author: 'claude', ts: 't', body: 'reply', replyTo: 'c-01' }
          }] }
        ]
      }]
    }
    const out = materializeCriticMarkupToJSON(fakeEditor(doc)) as typeof doc
    expect(out.content?.[0].content?.[0].text).toContain('reply-to:c-01')
  })
})

describe('materializeCriticMarkupToJSON — passthrough', () => {
  it('returns doc unchanged when no CM marks present', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'plain markdown', marks: [{ type: 'bold' }] }
        ]
      }]
    }
    const out = materializeCriticMarkupToJSON(fakeEditor(doc)) as typeof doc
    expect(out.content?.[0].content).toEqual([
      { type: 'text', text: 'plain markdown', marks: [{ type: 'bold' }] }
    ])
  })

  it('preserves non-CM marks alongside CM marks', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'bold-and-inserted', marks: [
            { type: 'bold' },
            { type: 'insertionMark', attrs: {} }
          ] }
        ]
      }]
    }
    const out = materializeCriticMarkupToJSON(fakeEditor(doc)) as typeof doc
    expect(out.content?.[0].content).toEqual([
      { type: 'text', text: '{++bold-and-inserted++}', marks: [{ type: 'bold' }] }
    ])
  })

  it('recurses into nested blocks (e.g. blockquote → paragraph)', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'blockquote',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'quoted ' },
            { type: 'text', text: 'highlight', marks: [{ type: 'highlightMark', attrs: {} }] }
          ]
        }]
      }]
    }
    const out = materializeCriticMarkupToJSON(fakeEditor(doc)) as typeof doc
    const quoted = (out.content?.[0] as { content: { content: { text: string }[] }[] }).content[0].content
    expect(quoted).toEqual([
      { type: 'text', text: 'quoted ' },
      { type: 'text', text: '{==highlight==}' }
    ])
  })
})

describe('materializeCriticMarkupToJSON — mixed', () => {
  it('handles a paragraph with multiple ops', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'A ' },
          { type: 'text', text: 'added', marks: [{ type: 'insertionMark', attrs: {} }] },
          { type: 'text', text: ' B ' },
          { type: 'text', text: 'removed', marks: [{ type: 'deletionMark', attrs: {} }] },
          { type: 'text', text: ' C ' },
          { type: 'text', text: 'hl', marks: [{ type: 'highlightMark', attrs: {} }] },
          { type: 'text', text: ' D' }
        ]
      }]
    }
    const out = materializeCriticMarkupToJSON(fakeEditor(doc)) as typeof doc
    expect(out.content?.[0].content).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'text', text: '{++added++}' },
      { type: 'text', text: ' B ' },
      { type: 'text', text: '{--removed--}' },
      { type: 'text', text: ' C ' },
      { type: 'text', text: '{==hl==}' },
      { type: 'text', text: ' D' }
    ])
  })
})
