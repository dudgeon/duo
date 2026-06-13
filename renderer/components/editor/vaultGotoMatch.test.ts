// ENH-208 Phase 2 (D22) — the palette→editor handoff contract. The module
// is a single parked slot; these lock the consume-once + path-keyed rules
// the MarkdownEditor handler depends on (a handler that receives the live
// event must ALSO consume the parked copy so it never replays).

import { describe, it, expect } from 'vitest'
import { parkGotoMatch, consumeGotoMatch } from './vaultGotoMatch'

const REQ = { path: '/v/notes/Foo.md', query: 'alpha', matchIndex: 1 }

describe('parkGotoMatch / consumeGotoMatch', () => {
  it('the matching path claims the parked request exactly once', () => {
    parkGotoMatch(REQ)
    expect(consumeGotoMatch('/v/notes/Foo.md')).toEqual(REQ)
    // Consumed — a later remount of the same path must NOT replay.
    expect(consumeGotoMatch('/v/notes/Foo.md')).toBeNull()
  })

  it('a different path leaves the parked request in place', () => {
    parkGotoMatch(REQ)
    expect(consumeGotoMatch('/v/notes/Bar.md')).toBeNull()
    expect(consumeGotoMatch('/v/notes/Foo.md')).toEqual(REQ)
  })

  it('a newer park replaces the older one', () => {
    parkGotoMatch(REQ)
    const newer = { path: '/v/notes/Foo.md', query: 'beta', matchIndex: 0 }
    parkGotoMatch(newer)
    expect(consumeGotoMatch('/v/notes/Foo.md')).toEqual(newer)
  })

  it('consume with nothing parked is a no-op', () => {
    expect(consumeGotoMatch('/v/notes/Foo.md')).toBeNull()
  })
})
