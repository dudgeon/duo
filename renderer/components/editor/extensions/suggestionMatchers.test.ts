// Sprint 11 walk-1 v3 — pin down the custom suggestion matcher
// contract. These were carved out of @tiptap/suggestion's default
// match-finder because the default couldn't express:
//   - `[[` two-char trigger (vs single-char)
//   - "no space anywhere in query" gating
//   - reject-mid-word `@` (email-address protection)

import { describe, it, expect } from 'vitest'
import { findWikilinkMatch, findAtMentionMatch } from './suggestionMatchers'

// Build a fake $position with a synthesized nodeBefore.
function fakePos(textBefore: string) {
  return {
    pos: textBefore.length,
    nodeBefore: {
      isText: true,
      text: textBefore
    }
  } as Parameters<typeof findWikilinkMatch>[0]['$position']
}

describe('findWikilinkMatch', () => {
  it('matches [[ at start of empty line', () => {
    const m = findWikilinkMatch({ $position: fakePos('[[') })
    expect(m).not.toBeNull()
    expect(m?.query).toBe('')
    expect(m?.range.from).toBe(0)
    expect(m?.range.to).toBe(2)
  })

  it('matches [[fo with partial query', () => {
    const m = findWikilinkMatch({ $position: fakePos('[[fo') })
    expect(m?.query).toBe('fo')
    expect(m?.range).toEqual({ from: 0, to: 4 })
  })

  it('does not match a single [', () => {
    expect(findWikilinkMatch({ $position: fakePos('[') })).toBeNull()
  })

  it('does not match closed [[Foo]]', () => {
    expect(findWikilinkMatch({ $position: fakePos('[[Foo]]') })).toBeNull()
  })

  it('does not match when query has whitespace', () => {
    expect(findWikilinkMatch({ $position: fakePos('[[Foo Bar') })).toBeNull()
  })

  it('does not match when caret is way past existing [[Foo]]', () => {
    // After `[[Foo]] some text`, caret in "text" — query would be
    // `Foo]] some text` which contains `]` and whitespace, so reject.
    expect(findWikilinkMatch({ $position: fakePos('[[Foo]] some text') })).toBeNull()
  })

  it('matches mid-line [[fo when typing right after a space', () => {
    const m = findWikilinkMatch({ $position: fakePos('Hello [[fo') })
    expect(m?.query).toBe('fo')
    expect(m?.range.from).toBe(6)
    expect(m?.range.to).toBe(10)
  })

  it('rejects extremely long queries (defensive)', () => {
    const longQuery = 'a'.repeat(200)
    expect(findWikilinkMatch({ $position: fakePos('[[' + longQuery) })).toBeNull()
  })

  it('returns null for non-text nodes', () => {
    const noText = { pos: 5, nodeBefore: null } as Parameters<typeof findWikilinkMatch>[0]['$position']
    expect(findWikilinkMatch({ $position: noText })).toBeNull()
  })
})

describe('findAtMentionMatch', () => {
  it('matches @ at start of line', () => {
    const m = findAtMentionMatch({ $position: fakePos('@') })
    expect(m?.query).toBe('')
    expect(m?.range).toEqual({ from: 0, to: 1 })
  })

  it('matches @fo with partial query', () => {
    const m = findAtMentionMatch({ $position: fakePos('@fo') })
    expect(m?.query).toBe('fo')
  })

  it('matches @ after a space (word boundary)', () => {
    const m = findAtMentionMatch({ $position: fakePos('Hi @fo') })
    expect(m?.query).toBe('fo')
    expect(m?.range.from).toBe(3)
  })

  it('does NOT match mid-word @ (email address case)', () => {
    // 'l' precedes '@' — alphanumeric, so reject.
    expect(findAtMentionMatch({ $position: fakePos('email@example') })).toBeNull()
  })

  it('does NOT match when query has whitespace', () => {
    expect(findAtMentionMatch({ $position: fakePos('@foo bar') })).toBeNull()
  })

  it('matches when @ is preceded by punctuation', () => {
    // Common case: list item starts with `- @foo`. The space after
    // `-` is the immediate predecessor, so the match works.
    const m = findAtMentionMatch({ $position: fakePos('- @foo') })
    expect(m?.query).toBe('foo')
  })

  it('takes the LAST @ when multiple in same text node', () => {
    // `@first @second` → caret at end. Last @ is at idx 7, preceded
    // by space (good). Query is "second".
    const m = findAtMentionMatch({ $position: fakePos('@first @second') })
    expect(m?.query).toBe('second')
    expect(m?.range.from).toBe(7)
  })

  it('rejects extremely long queries (defensive)', () => {
    const longQuery = 'a'.repeat(200)
    expect(findAtMentionMatch({ $position: fakePos('@' + longQuery) })).toBeNull()
  })
})
