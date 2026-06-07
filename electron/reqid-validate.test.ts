// ENH-191 P3 (seam M2) — pins the sender-validated reqId contract with the
// load-bearing negative control: a reply from a FOREIGN window must NOT resolve
// a request dispatched to another window (the current reqId-only match would).
// Pure node-env. The describe.each over the 12 REQID_FAMILIES (mechanical
// completeness) is consolidated in P3-S9-harness; this file pins the primitive.

import { describe, it, expect, vi } from 'vitest'
import { PendingRegistry } from './reqid-validate'

type Result = { reqId: string; ok: boolean }

describe('reqid-validate — PendingRegistry<R> (ENH-191 P3 M2)', () => {
  // ---- byte-identity-at-N=1 happy path: target resolves --------------------
  it('a reply from the recorded target resolves once + removes the entry', () => {
    const reg = new PendingRegistry<Result>()
    const cb = vi.fn()
    reg.set('dw_x', 1, cb)
    const res = { reqId: 'dw_x', ok: true }
    expect(reg.deliver('dw_x', 1, res)).toBe(true)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(res)
    expect(reg.has('dw_x')).toBe(false)
    expect(reg.size()).toBe(0)
  })

  // ---- NEGATIVE CONTROL: foreign sender (the foot-gun) ---------------------
  // A reqId-only resolver (today's `_event`-discarding shape) would call cb here.
  // Sender validation drops it AND leaves the entry pending so the real window's
  // reply can still arrive.
  it('a reply from a FOREIGN window is dropped; cb uncalled; entry left pending', () => {
    const reg = new PendingRegistry<Result>()
    const cb = vi.fn()
    reg.set('dw_x', 1, cb)
    expect(reg.deliver('dw_x', 2, { reqId: 'dw_x', ok: true })).toBe(false)
    expect(cb).not.toHaveBeenCalled()
    expect(reg.has('dw_x')).toBe(true) // STILL pending — the real reply can arrive
    // …and the legitimate reply from window 1 still resolves it afterwards:
    expect(reg.deliver('dw_x', 1, { reqId: 'dw_x', ok: true })).toBe(true)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('an undefined sender (destroyed/unresolvable WebContents) is never a wildcard', () => {
    const reg = new PendingRegistry<Result>()
    const cb = vi.fn()
    reg.set('dw_x', 1, cb)
    expect(reg.deliver('dw_x', undefined, { reqId: 'dw_x', ok: true })).toBe(false)
    expect(cb).not.toHaveBeenCalled()
    expect(reg.has('dw_x')).toBe(true)
  })

  it('an unknown reqId delivers false (never dispatched / already resolved)', () => {
    const reg = new PendingRegistry<Result>()
    expect(reg.deliver('nope', 1, { reqId: 'nope', ok: true })).toBe(false)
  })

  it('double-deliver: the second delivery after a successful one is a no-op', () => {
    const reg = new PendingRegistry<Result>()
    const cb = vi.fn()
    reg.set('dw_x', 1, cb)
    expect(reg.deliver('dw_x', 1, { reqId: 'dw_x', ok: true })).toBe(true)
    expect(reg.deliver('dw_x', 1, { reqId: 'dw_x', ok: true })).toBe(false)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('delete (the timeout path) drops the entry — a later valid reply no-ops', () => {
    const reg = new PendingRegistry<Result>()
    const cb = vi.fn()
    reg.set('dw_x', 1, cb)
    reg.delete('dw_x')
    expect(reg.has('dw_x')).toBe(false)
    expect(reg.deliver('dw_x', 1, { reqId: 'dw_x', ok: true })).toBe(false)
    expect(cb).not.toHaveBeenCalled()
  })

  // Demonstrates the negative control is load-bearing: a blind reqId-only
  // resolver (the shape P3-S3 replaces) WOULD have resolved the foreign reply.
  it('a blind reqId-only resolver WOULD mis-resolve the foreign reply (contrast)', () => {
    const blind = new Map<string, (res: Result) => void>()
    const cb = vi.fn()
    blind.set('dw_x', cb)
    // sender-blind delivery — the current main.ts shape — resolves regardless of window:
    const r = blind.get('dw_x')
    if (r) { blind.delete('dw_x'); r({ reqId: 'dw_x', ok: true }) }
    expect(cb).toHaveBeenCalledTimes(1) // ← exactly the mis-route PendingRegistry prevents
  })
})

// ENH-191 P3-S9 — mechanical completeness over the 12 reqId families (main.ts).
// The LITERAL array is the completeness check — INCLUDING docEditPlainPending +
// jsonOpPending, which the PRD-era "10 families" list omitted (both verified in
// main.ts). SESSION_STATE_SNAPSHOT_RESULT is the sessionSnapshotPending family's
// reply channel (the ONE name that also appears in cache-key's PUSH_FAMILIES).
const REQID_FAMILIES = [
  'docWritePending',
  'docReadPending',
  'docGotoPending',
  'docFindPending',
  'htmlOpPending',
  'docEditPlainPending',
  'jsonOpPending',
  'imageInsertPending',
  'htmlCommentPending',
  'htmlCommentsListPending',
  'sessionSnapshotPending',
  'newTabPending',
]

describe('reqid-validate — reqId family sender-validation completeness (ENH-191 P3-S9)', () => {
  it('the literal list covers all 12 reqId families (incl. docEditPlain + jsonOp)', () => {
    expect(REQID_FAMILIES).toHaveLength(12)
    expect(new Set(REQID_FAMILIES).size).toBe(12) // no dupes
  })

  describe.each(REQID_FAMILIES)('%s', (family) => {
    it('a foreign sender is dropped (entry left pending); the recorded target resolves', () => {
      const reg = new PendingRegistry<{ family: string }>()
      const cb = vi.fn()
      const reqId = `${family}_r1`
      reg.set(reqId, 1, cb)
      expect(reg.deliver(reqId, 2, { family })).toBe(false) // foreign window → dropped
      expect(cb).not.toHaveBeenCalled()
      expect(reg.has(reqId)).toBe(true) // still pending — the real reply can arrive
      expect(reg.deliver(reqId, 1, { family })).toBe(true) // recorded target resolves
      expect(cb).toHaveBeenCalledTimes(1)
    })
  })
})
