import { describe, it, expect } from 'vitest'
import {
  parseCriticMarkup,
  parseCommentBody,
  serializeCommentBody,
  serializeOp,
  stripCriticMarkup
} from './criticmarkup'

describe('parseCriticMarkup — insertion', () => {
  it('parses a simple insertion', () => {
    const ops = parseCriticMarkup('hello {++world++}')
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: 'insert', text: 'world' })
  })

  it('parses insertions with surrounding text', () => {
    const ops = parseCriticMarkup('foo {++bar++} baz')
    expect(ops[0]).toMatchObject({ kind: 'insert', text: 'bar', start: 4, end: 13 })
  })

  it('parses multi-word insertions including punctuation', () => {
    const ops = parseCriticMarkup('{++Hello, World!++}')
    expect(ops[0]).toMatchObject({ kind: 'insert', text: 'Hello, World!' })
  })
})

describe('parseCriticMarkup — deletion', () => {
  it('parses a simple deletion', () => {
    const ops = parseCriticMarkup('keep {--remove me--} keep')
    expect(ops[0]).toMatchObject({ kind: 'delete', text: 'remove me' })
  })
})

describe('parseCriticMarkup — substitution', () => {
  it('parses old~>new substitution', () => {
    const ops = parseCriticMarkup('{~~old text~>new text~~}')
    expect(ops[0]).toMatchObject({
      kind: 'substitute',
      oldText: 'old text',
      newText: 'new text'
    })
  })

  it('handles empty old (insertion-equivalent)', () => {
    const ops = parseCriticMarkup('{~~~>added~~}')
    expect(ops[0]).toMatchObject({ kind: 'substitute', oldText: '', newText: 'added' })
  })

  it('handles empty new (deletion-equivalent)', () => {
    const ops = parseCriticMarkup('{~~gone~>~~}')
    expect(ops[0]).toMatchObject({ kind: 'substitute', oldText: 'gone', newText: '' })
  })

  it('skips malformed substitution without ~>', () => {
    const ops = parseCriticMarkup('{~~just text~~}')
    expect(ops).toHaveLength(0)
  })
})

describe('parseCriticMarkup — highlight', () => {
  it('parses a standalone highlight', () => {
    const ops = parseCriticMarkup('{==important text==}')
    expect(ops[0]).toMatchObject({ kind: 'highlight', text: 'important text' })
  })
})

describe('parseCriticMarkup — comment', () => {
  it('parses a standalone comment with body only', () => {
    const ops = parseCriticMarkup('{>>just a comment<<}')
    expect(ops[0]).toMatchObject({
      kind: 'comment',
      body: 'just a comment',
      meta: {}
    })
    expect((ops[0] as { anchor?: string }).anchor).toBeUndefined()
  })

  it('parses a comment with full metadata prefix', () => {
    const ops = parseCriticMarkup('{>>id:c-01|author:claude|ts:2026-05-18T12:00:00Z|hello<<}')
    expect(ops[0]).toMatchObject({
      kind: 'comment',
      body: 'hello',
      meta: {
        id: 'c-01',
        author: 'claude',
        ts: '2026-05-18T12:00:00Z'
      }
    })
  })

  it('parses a reply (reply-to metadata)', () => {
    const ops = parseCriticMarkup('{>>id:c-02|author:dudgeon|ts:2026-05-18T12:01:00Z|reply-to:c-01|sounds good<<}')
    expect(ops[0]).toMatchObject({
      kind: 'comment',
      body: 'sounds good',
      meta: {
        id: 'c-02',
        author: 'dudgeon',
        ts: '2026-05-18T12:01:00Z',
        replyTo: 'c-01'
      }
    })
  })

  it('preserves | inside the body when prefix metadata ends', () => {
    const ops = parseCriticMarkup('{>>id:c-01|author:claude|body with | a pipe<<}')
    expect(ops[0]).toMatchObject({
      kind: 'comment',
      body: 'body with | a pipe',
      meta: { id: 'c-01', author: 'claude' }
    })
  })

  it('handles partial metadata (only id)', () => {
    const ops = parseCriticMarkup('{>>id:c-99|comment body<<}')
    expect(ops[0]).toMatchObject({
      kind: 'comment',
      body: 'comment body',
      meta: { id: 'c-99' }
    })
  })

  it('handles legacy comments without any metadata prefix', () => {
    const ops = parseCriticMarkup('{>>just a hand-typed comment with no prefix<<}')
    expect(ops[0]).toMatchObject({
      kind: 'comment',
      body: 'just a hand-typed comment with no prefix',
      meta: {}
    })
  })
})

describe('parseCriticMarkup — anchored comments', () => {
  it('folds adjacent highlight+comment into an anchored comment', () => {
    const ops = parseCriticMarkup('{==selected text==}{>>id:c-01|author:dudgeon|good point<<}')
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({
      kind: 'comment',
      body: 'good point',
      anchor: 'selected text',
      meta: { id: 'c-01', author: 'dudgeon' }
    })
  })

  it('does NOT fold when highlight is followed by something else', () => {
    const ops = parseCriticMarkup('{==hl==} unrelated text {>>just a comment<<}')
    expect(ops).toHaveLength(2)
    expect(ops[0].kind).toBe('highlight')
    expect(ops[1].kind).toBe('comment')
    // The standalone comment has no anchor.
    expect((ops[1] as { anchor?: string }).anchor).toBeUndefined()
  })

  it('end position covers both highlight and comment for anchored case', () => {
    const src = '{==anchor text==}{>>body<<}'
    const ops = parseCriticMarkup(src)
    expect(ops).toHaveLength(1)
    expect(ops[0].start).toBe(0)
    expect(ops[0].end).toBe(src.length)
  })
})

describe('parseCriticMarkup — multiple ops', () => {
  it('parses several ops in one document', () => {
    const src = 'A {++added++} B {--removed--} C {==highlighted==} D {>>commented<<} E'
    const ops = parseCriticMarkup(src)
    expect(ops.map(o => o.kind)).toEqual(['insert', 'delete', 'highlight', 'comment'])
  })

  it('preserves order of ops by position', () => {
    const src = '{++a++} {++b++} {++c++}'
    const ops = parseCriticMarkup(src)
    expect(ops.map(o => (o as { text: string }).text)).toEqual(['a', 'b', 'c'])
  })
})

describe('parseCommentBody', () => {
  it('parses full metadata prefix', () => {
    const { meta, body } = parseCommentBody('id:c-01|author:claude|ts:2026-05-18T12:00:00Z|hello world')
    expect(meta).toEqual({
      id: 'c-01',
      author: 'claude',
      ts: '2026-05-18T12:00:00Z'
    })
    expect(body).toBe('hello world')
  })

  it('returns empty meta + full body when no metadata prefix', () => {
    const { meta, body } = parseCommentBody('just text')
    expect(meta).toEqual({})
    expect(body).toBe('just text')
  })

  it('stops at first non-key segment', () => {
    const { meta, body } = parseCommentBody('id:c-01|not-a-key:foo|body')
    expect(meta).toEqual({ id: 'c-01' })
    expect(body).toBe('not-a-key:foo|body')
  })

  it('handles trailing | with empty body', () => {
    const { meta, body } = parseCommentBody('id:c-01|author:claude|')
    expect(meta).toEqual({ id: 'c-01', author: 'claude' })
    expect(body).toBe('')
  })

  it('handles all-metadata input (no body)', () => {
    const { meta, body } = parseCommentBody('id:c-01|author:claude|ts:2026-05-18T12:00:00Z')
    expect(meta.id).toBe('c-01')
    expect(meta.author).toBe('claude')
    expect(meta.ts).toBe('2026-05-18T12:00:00Z')
    expect(body).toBe('')
  })
})

describe('serializeCommentBody', () => {
  it('serializes full metadata', () => {
    const out = serializeCommentBody(
      { id: 'c-01', author: 'claude', ts: '2026-05-18T12:00:00Z' },
      'hello world'
    )
    expect(out).toBe('id:c-01|author:claude|ts:2026-05-18T12:00:00Z|hello world')
  })

  it('omits absent metadata keys', () => {
    const out = serializeCommentBody({ id: 'c-01' }, 'hello')
    expect(out).toBe('id:c-01|hello')
  })

  it('emits just body when no metadata', () => {
    const out = serializeCommentBody({}, 'just text')
    expect(out).toBe('just text')
  })

  it('handles reply-to', () => {
    const out = serializeCommentBody(
      { id: 'c-02', author: 'claude', replyTo: 'c-01' },
      'sounds good'
    )
    expect(out).toBe('id:c-02|author:claude|reply-to:c-01|sounds good')
  })

  it('round-trips through parseCommentBody', () => {
    const meta = { id: 'c-99', author: 'dudgeon', ts: '2026-05-18T13:00:00Z', replyTo: 'c-50' }
    const body = 'a body with | a pipe in it'
    const serialized = serializeCommentBody(meta, body)
    const parsed = parseCommentBody(serialized)
    expect(parsed.meta).toEqual(meta)
    expect(parsed.body).toBe(body)
  })
})

describe('serializeOp', () => {
  it('serializes insertion', () => {
    expect(serializeOp({ kind: 'insert', start: 0, end: 0, text: 'hi' })).toBe('{++hi++}')
  })

  it('serializes deletion', () => {
    expect(serializeOp({ kind: 'delete', start: 0, end: 0, text: 'bye' })).toBe('{--bye--}')
  })

  it('serializes substitution', () => {
    expect(serializeOp({
      kind: 'substitute', start: 0, end: 0, oldText: 'old', newText: 'new'
    })).toBe('{~~old~>new~~}')
  })

  it('serializes highlight', () => {
    expect(serializeOp({ kind: 'highlight', start: 0, end: 0, text: 'hl' })).toBe('{==hl==}')
  })

  it('serializes standalone comment', () => {
    expect(serializeOp({
      kind: 'comment', start: 0, end: 0,
      meta: { id: 'c-01', author: 'claude' },
      body: 'hello'
    })).toBe('{>>id:c-01|author:claude|hello<<}')
  })

  it('serializes anchored comment', () => {
    expect(serializeOp({
      kind: 'comment', start: 0, end: 0,
      meta: { id: 'c-01' },
      body: 'note',
      anchor: 'text',
      anchorStart: 0
    })).toBe('{==text==}{>>id:c-01|note<<}')
  })
})

describe('parseCriticMarkup → serializeOp round-trip', () => {
  const cases = [
    'no markup at all',
    '{++inserted++}',
    '{--deleted--}',
    '{~~old~>new~~}',
    '{==highlighted==}',
    '{>>simple comment<<}',
    '{>>id:c-01|author:claude|ts:2026-05-18T12:00:00Z|hello<<}',
    '{==anchor==}{>>id:c-01|author:dudgeon|good point<<}',
    'mixed: A {++added++} B {--removed--} C {==hl==} D {>>id:c-01|note<<} E'
  ]
  for (const src of cases) {
    it(`round-trips: ${src.slice(0, 50)}${src.length > 50 ? '…' : ''}`, () => {
      const ops = parseCriticMarkup(src)
      // Splice the ops back into the source verbatim and expect equality.
      let rebuilt = ''
      let cursor = 0
      for (const op of ops) {
        const opStart = op.kind === 'comment' && op.anchorStart !== undefined ? op.anchorStart : op.start
        rebuilt += src.slice(cursor, opStart)
        rebuilt += serializeOp(op)
        cursor = op.end
      }
      rebuilt += src.slice(cursor)
      expect(rebuilt).toBe(src)
    })
  }
})

describe('stripCriticMarkup', () => {
  it('returns source unchanged when no markup', () => {
    expect(stripCriticMarkup('plain markdown')).toBe('plain markdown')
  })

  it('keeps insertions', () => {
    expect(stripCriticMarkup('foo {++bar++} baz')).toBe('foo bar baz')
  })

  it('drops deletions', () => {
    expect(stripCriticMarkup('foo {--remove--} baz')).toBe('foo  baz')
  })

  it('substitutes new for old', () => {
    expect(stripCriticMarkup('{~~old~>new~~}')).toBe('new')
  })

  it('keeps highlight text (drops the markers)', () => {
    expect(stripCriticMarkup('{==important==}')).toBe('important')
  })

  it('drops standalone comments entirely', () => {
    expect(stripCriticMarkup('foo {>>side note<<} bar')).toBe('foo  bar')
  })

  it('keeps anchored comments\' anchor text', () => {
    expect(stripCriticMarkup('see {==this part==}{>>id:c-01|note<<} ok')).toBe('see this part ok')
  })

  it('handles a mixed document', () => {
    const src = 'A {++a++} B {--b--} C {~~c~>C~~} D {==d==} E {>>id:c-01|e<<} F'
    expect(stripCriticMarkup(src)).toBe('A a B  C C D d E  F')
  })
})
