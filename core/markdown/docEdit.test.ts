// BUG-138 Phase 3 — tests for the pure docEdit operations.

import { describe, it, expect } from 'vitest'
import {
  insertAfter,
  insertBefore,
  insertAtLine,
  deleteText,
  substituteText,
  highlightText,
  addAnchoredComment,
  addCommentReply,
  acceptOp,
  rejectOp
} from './docEdit'

const ID_FIXED = 'c-test-1'
const TS_FIXED = '2026-05-18T12:00:00Z'

describe('insertAfter', () => {
  it('wraps new text as {++…++} after a literal anchor', () => {
    const result = insertAfter('The quick fox.', 'quick', ' brown')
    expect(result.changed).toBe(true)
    expect(result.body).toBe('The quick{++ brown++} fox.')
  })

  it('returns changed=false when anchor is missing', () => {
    const result = insertAfter('Some text.', 'missing', ' new')
    expect(result.changed).toBe(false)
    expect(result.reason).toContain('not found')
  })

  it('picks the Nth occurrence with opts.occurrence', () => {
    const result = insertAfter('foo bar foo bar', 'foo', '!', { occurrence: 2 })
    expect(result.changed).toBe(true)
    expect(result.body).toBe('foo bar foo{++!++} bar')
  })

  it('finds anchors that span an existing comment in stripped view', () => {
    // Stripped view: 'review final draft' — anchor 'final draft' should
    // hit even though the source has a comment wrapping 'final'.
    const body = 'review {==final==}{>>id:c-0|author:dudgeon|ts:t|note<<} draft'
    const result = insertAfter(body, 'final draft', '!')
    expect(result.changed).toBe(true)
    // Insertion lands after the source-tail position, which corresponds
    // to after the literal 'draft' in source — past the existing token.
    expect(result.body).toBe(
      'review {==final==}{>>id:c-0|author:dudgeon|ts:t|note<<} draft{++!++}'
    )
  })
})

describe('insertBefore', () => {
  it('wraps new text as {++…++} immediately before a literal anchor', () => {
    const result = insertBefore('foo bar', 'bar', 'baz ')
    expect(result.changed).toBe(true)
    expect(result.body).toBe('foo {++baz ++}bar')
  })
})

describe('insertAtLine', () => {
  it('inserts at line start (1-indexed)', () => {
    const body = 'line 1\nline 2\nline 3'
    const result = insertAtLine(body, 2, 'inserted ')
    expect(result.changed).toBe(true)
    expect(result.body).toBe('line 1\n{++inserted ++}line 2\nline 3')
  })

  it('insert at line 1 prepends', () => {
    const result = insertAtLine('line 1\nline 2', 1, 'pre ')
    expect(result.body).toBe('{++pre ++}line 1\nline 2')
  })

  it('past-EOF lines append with a newline separator', () => {
    const result = insertAtLine('only line', 5, 'appended')
    expect(result.changed).toBe(true)
    expect(result.body).toBe('only line\n{++appended++}')
  })
})

describe('deleteText', () => {
  it('wraps the target text as {--…--}', () => {
    const result = deleteText('Remove this word.', 'this ')
    expect(result.changed).toBe(true)
    expect(result.body).toBe('Remove {--this --}word.')
  })

  it('returns changed=false when target overlaps existing CM', () => {
    const body = 'a {++inserted++} word'
    const result = deleteText(body, 'inserted word')
    expect(result.changed).toBe(false)
    expect(result.reason).toContain('overlaps existing CriticMarkup')
  })

  it('picks the Nth occurrence', () => {
    const result = deleteText('foo foo foo', 'foo', { occurrence: 2 })
    expect(result.changed).toBe(true)
    expect(result.body).toBe('foo {--foo--} foo')
  })
})

describe('highlightText', () => {
  it('wraps the target text as {==…==}', () => {
    const result = highlightText('Mark this phrase please.', 'this phrase')
    expect(result.changed).toBe(true)
    expect(result.body).toBe('Mark {==this phrase==} please.')
  })

  it('returns changed=false when target is empty', () => {
    const result = highlightText('Some text.', '')
    expect(result.changed).toBe(false)
    expect(result.reason).toContain('empty')
  })

  it('returns changed=false when target text is not found', () => {
    const result = highlightText('Some text.', 'missing')
    expect(result.changed).toBe(false)
    expect(result.reason).toContain('not found')
  })

  it('returns changed=false when target overlaps existing CM', () => {
    const body = 'a {++inserted++} word'
    const result = highlightText(body, 'inserted word')
    expect(result.changed).toBe(false)
    expect(result.reason).toContain('overlaps existing CriticMarkup')
  })

  it('picks the Nth occurrence', () => {
    const result = highlightText('foo foo foo', 'foo', { occurrence: 2 })
    expect(result.changed).toBe(true)
    expect(result.body).toBe('foo {==foo==} foo')
  })

  it('finds anchors that span an existing CM token in stripped view', () => {
    // Stripped: 'review final draft' — 'final draft' anchor should hit
    // even though the source has an insertion mark on 'final'.
    const body = 'review {++final++} draft'
    const result = highlightText(body, 'final draft')
    expect(result.changed).toBe(false)
    // Overlap guard fires — splitting the highlight across an existing
    // insertion is correctly refused (consistent with deleteText).
    expect(result.reason).toContain('overlaps existing CriticMarkup')
  })
})

describe('substituteText', () => {
  it('wraps as {~~old~>new~~}', () => {
    const result = substituteText('use the wrong word', 'wrong', 'correct')
    expect(result.changed).toBe(true)
    expect(result.body).toBe('use the {~~wrong~>correct~~} word')
  })

  it('allows empty new text (effectively a delete)', () => {
    const result = substituteText('drop this', 'this', '')
    expect(result.changed).toBe(true)
    expect(result.body).toBe('drop {~~this~>~~}')
  })

  it('returns changed=false when target overlaps CM', () => {
    const body = 'a {++ins++} word'
    const result = substituteText(body, 'ins word', 'phrase')
    expect(result.changed).toBe(false)
  })
})

describe('addAnchoredComment', () => {
  it('wraps as {==anchor==}{>>id|author|ts|body<<}', () => {
    const result = addAnchoredComment('the target text exists', {
      anchorText: 'target text',
      commentBody: 'is this clear?',
      author: 'claude',
      ts: TS_FIXED,
      commentId: ID_FIXED
    })
    expect(result.changed).toBe(true)
    expect(result.body).toBe(
      'the {==target text==}{>>id:c-test-1|author:claude|ts:2026-05-18T12:00:00Z|is this clear?<<} exists'
    )
  })

  it('includes reply-to metadata when provided', () => {
    const result = addAnchoredComment('a phrase here', {
      anchorText: 'phrase',
      commentBody: 'follow-up',
      author: 'dudgeon',
      ts: TS_FIXED,
      commentId: ID_FIXED,
      replyTo: 'c-parent-99'
    })
    expect(result.body).toContain('reply-to:c-parent-99')
  })

  it('collapses blank lines in the comment body to soft breaks', () => {
    const result = addAnchoredComment('hello world', {
      anchorText: 'world',
      commentBody: 'line one\n\n\nline two',
      author: 'claude',
      ts: TS_FIXED,
      commentId: ID_FIXED
    })
    expect(result.body).not.toMatch(/\n\n/)
    expect(result.body).toContain('line one\nline two')
  })

  it('returns changed=false on missing anchor', () => {
    const result = addAnchoredComment('plain prose', {
      anchorText: 'absent',
      commentBody: 'note',
      author: 'claude',
      ts: TS_FIXED,
      commentId: ID_FIXED
    })
    expect(result.changed).toBe(false)
  })

  it('rejects anchors overlapping existing CM', () => {
    const body = 'already {++inserted++} text'
    const result = addAnchoredComment(body, {
      anchorText: 'inserted text',
      commentBody: 'check',
      author: 'claude',
      ts: TS_FIXED,
      commentId: ID_FIXED
    })
    expect(result.changed).toBe(false)
  })
})

describe('addCommentReply (BUG-143)', () => {
  const REPLY_TS = '2026-05-19T13:00:00Z'

  it('appends `↪ @author ts: body` to the parent comment body', () => {
    const body = 'Hello {==world==}{>>id:cmt_a|author:dudgeon|ts:2026-05-19T12:00:00Z|first thread<<}.'
    const result = addCommentReply(body, {
      replyTo: 'cmt_a',
      replyBody: 'agent reply',
      author: 'claude',
      ts: REPLY_TS
    })
    expect(result.changed).toBe(true)
    expect(result.body).toBe(
      'Hello {==world==}{>>id:cmt_a|author:dudgeon|ts:2026-05-19T12:00:00Z|first thread\n↪ @claude ' + REPLY_TS + ': agent reply<<}.'
    )
  })

  it('appends a reply to a standalone (unanchored) comment', () => {
    const body = 'note. {>>id:cmt_s|author:claude|ts:2026-05-19T12:00:00Z|standalone<<} continues.'
    const result = addCommentReply(body, {
      replyTo: 'cmt_s',
      replyBody: 'a reply',
      author: 'dudgeon',
      ts: REPLY_TS
    })
    expect(result.changed).toBe(true)
    expect(result.body).toContain('|standalone\n↪ @dudgeon ' + REPLY_TS + ': a reply<<}')
  })

  it('chains multiple replies (second reply finds parent body already grown)', () => {
    const start = 'X {==target==}{>>id:cmt_a|author:a|ts:t1|lead<<}.'
    const first = addCommentReply(start, {
      replyTo: 'cmt_a',
      replyBody: 'first reply',
      author: 'claude',
      ts: 't2'
    })
    expect(first.changed).toBe(true)
    const second = addCommentReply(first.body, {
      replyTo: 'cmt_a',
      replyBody: 'second reply',
      author: 'dudgeon',
      ts: 't3'
    })
    expect(second.changed).toBe(true)
    expect(second.body).toContain('lead\n↪ @claude t2: first reply\n↪ @dudgeon t3: second reply<<}')
  })

  it('returns changed=false with "not found" reason when reply-to id is missing', () => {
    const body = 'X {==target==}{>>id:cmt_a|author:a|ts:t|lead<<}.'
    const result = addCommentReply(body, {
      replyTo: 'cmt_does_not_exist',
      replyBody: 'reply',
      author: 'claude',
      ts: REPLY_TS
    })
    expect(result.changed).toBe(false)
    expect(result.reason).toContain('not found')
  })

  it('collapses multi-line reply bodies to a single line (paragraph guard)', () => {
    const body = 'X {==t==}{>>id:cmt_a|author:a|ts:t|lead<<}.'
    const result = addCommentReply(body, {
      replyTo: 'cmt_a',
      replyBody: 'line1\n\nline2\nline3',
      author: 'claude',
      ts: REPLY_TS
    })
    expect(result.changed).toBe(true)
    expect(result.body).toContain(': line1 line2 line3<<}')
    expect(result.body.split('\n').length).toBe(2) // lead\n↪ ...
  })

  it('rejects empty body / empty author / missing replyTo', () => {
    const body = 'X {==t==}{>>id:cmt_a|author:a|ts:t|lead<<}.'
    expect(addCommentReply(body, { replyTo: '', replyBody: 'x', author: 'a', ts: 't' }).changed).toBe(false)
    expect(addCommentReply(body, { replyTo: 'cmt_a', replyBody: '', author: 'a', ts: 't' }).changed).toBe(false)
    expect(addCommentReply(body, { replyTo: 'cmt_a', replyBody: 'x', author: '', ts: 't' }).changed).toBe(false)
    expect(addCommentReply(body, { replyTo: 'cmt_a', replyBody: 'x', author: 'a', ts: '' }).changed).toBe(false)
  })
})

describe('acceptOp', () => {
  it('keeps inserted text + strips insertion wrapping', () => {
    const result = acceptOp('Hello {++world++}.', { match: 'world' })
    expect(result.changed).toBe(true)
    expect(result.body).toBe('Hello world.')
  })

  it('drops deleted text', () => {
    const result = acceptOp('keep {--drop--} this', { match: 'drop' })
    expect(result.body).toBe('keep  this')
  })

  it('keeps newText for substitution', () => {
    const result = acceptOp('use {~~old~>new~~} word', { match: 'new' })
    expect(result.body).toBe('use new word')
  })

  it('keeps anchor + strips comment marker on anchored comments', () => {
    const body = 'prose {==here==}{>>id:c-1|author:dudgeon|ts:t|note<<} continues'
    const result = acceptOp(body, { id: 'c-1' })
    expect(result.body).toBe('prose here continues')
  })

  it('returns changed=false when ident does not match', () => {
    const result = acceptOp('no markup here', { match: 'anything' })
    expect(result.changed).toBe(false)
    expect(result.reason).toContain('not found')
  })
})

describe('rejectOp', () => {
  it('drops inserted text', () => {
    const result = rejectOp('Hello {++world++}.', { match: 'world' })
    expect(result.body).toBe('Hello .')
  })

  it('keeps deleted text', () => {
    const result = rejectOp('keep {--drop--} this', { match: 'drop' })
    expect(result.body).toBe('keep drop this')
  })

  it('keeps oldText for substitution', () => {
    const result = rejectOp('use {~~old~>new~~} word', { match: 'old' })
    expect(result.body).toBe('use old word')
  })

  it('keeps anchor + strips comment marker on anchored comments', () => {
    const body = 'prose {==here==}{>>id:c-1|author:dudgeon|ts:t|note<<} continues'
    const result = rejectOp(body, { id: 'c-1' })
    expect(result.body).toBe('prose here continues')
  })
})

describe('round-trip composition', () => {
  it('insert then accept = no-op idempotent on stripped form', () => {
    const start = 'hello fox'
    const inserted = insertAfter(start, 'hello', ' quick brown')
    expect(inserted.body).toBe('hello{++ quick brown++} fox')
    const accepted = acceptOp(inserted.body, { match: ' quick brown' })
    expect(accepted.body).toBe('hello quick brown fox')
  })

  it('substitute then reject restores original', () => {
    const start = 'the quick fox'
    const sub = substituteText(start, 'quick', 'slow')
    expect(sub.body).toBe('the {~~quick~>slow~~} fox')
    const rej = rejectOp(sub.body, { match: 'slow' })
    expect(rej.body).toBe('the quick fox')
  })

  it('two non-overlapping deletes chain cleanly', () => {
    const start = 'one two three four'
    const a = deleteText(start, 'two ')
    expect(a.body).toBe('one {--two --}three four')
    const b = deleteText(a.body, 'four')
    expect(b.body).toBe('one {--two --}three {--four--}')
  })
})
