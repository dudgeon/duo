// ENH-191 P3 (seam M4) — pins the owner-routing/dispose/list contract with the
// load-bearing negative controls: the cold-start FALLBACK (an unresolved owner
// must NOT drop the send), the no-focus routing (a backgrounded owner still
// gets its send), and owner-scoped dispose/list (a workspace swap can't nuke
// another window's terminals). Pure node-env — fake Maps, no node-pty/Electron.

import { describe, it, expect, vi } from 'vitest'
import { routeSend, disposeForWindow, listIdsByCwdOwned } from './pty-owner'

type Win = { tag: string }

describe('pty-owner — routeSend (ENH-191 P3 M4)', () => {
  it('routes a session\'s send to its OWNING window', () => {
    const winA: Win = { tag: 'A' }
    const sessions = new Map([['t1', { ownerWindowId: 1 }]])
    const resolveOwner = (id: number) => (id === 1 ? winA : undefined)
    const fallback = () => undefined
    expect(routeSend(sessions, 't1', resolveOwner, fallback)).toBe(winA)
  })

  // COLD-START FALLBACK (the #1 PTY correctness point): owner unresolved ⇒
  // routeSend returns the fallback window, NOT undefined — a send must never be
  // silently dropped. A no-fallback `resolveOwner(id)` would return undefined here.
  it('falls back to the sole window when the owner is unresolved (cold-start drop guard)', () => {
    const winSole: Win = { tag: 'sole' }
    const sessions = new Map([['t1', { ownerWindowId: 7 }]])
    const resolveOwner = (_id: number) => undefined // owner window not registered (yet/anymore)
    const fallback = () => winSole
    expect(routeSend(sessions, 't1', resolveOwner, fallback)).toBe(winSole)
    // contrast — the no-fallback shape this guards against:
    expect((sessions.get('t1')?.ownerWindowId != null ? resolveOwner(7) : undefined)).toBeUndefined()
  })

  it('falls back when a session has no ownerWindowId yet', () => {
    const winSole: Win = { tag: 'sole' }
    const sessions = new Map([['t1', {}]])
    expect(routeSend(sessions, 't1', () => ({ tag: 'X' }), () => winSole)).toBe(winSole)
  })

  // NO FOCUS: owner=2 routes to win2 even though win1 is the first map entry —
  // a getFocusedWindow/first-pick sink would mis-route to win1.
  it('routes to the owner even when it is not the first/focused window', () => {
    const win1: Win = { tag: '1' }
    const win2: Win = { tag: '2' }
    const sessions = new Map([
      ['a', { ownerWindowId: 1 }],
      ['b', { ownerWindowId: 2 }],
    ])
    const resolveOwner = (id: number) => (id === 1 ? win1 : id === 2 ? win2 : undefined)
    expect(routeSend(sessions, 'b', resolveOwner, () => win1)).toBe(win2)
  })
})

describe('pty-owner — disposeForWindow (ENH-191 P3 M4)', () => {
  function makeSessions() {
    return new Map([
      ['a', { ownerWindowId: 1, pty: { kill: vi.fn() } }],
      ['b', { ownerWindowId: 1, pty: { kill: vi.fn() } }],
      ['c', { ownerWindowId: 2, pty: { kill: vi.fn() } }],
    ])
  }

  it('kills + deletes exactly the target window\'s sessions, leaving the others', () => {
    const s = makeSessions()
    const killed = disposeForWindow(s, 1)
    expect(killed).toEqual(['a', 'b']) // insertion order
    expect(s.get('a')).toBeUndefined()
    expect(s.get('b')).toBeUndefined()
    expect(s.get('c')).toBeDefined() // owner-2 survives the workspace swap
    expect(s.size).toBe(1)
  })

  it('does NOT call kill on another window\'s pty (no cross-window teardown)', () => {
    const s = makeSessions()
    const c = s.get('c')!
    disposeForWindow(s, 1)
    expect(c.pty.kill).not.toHaveBeenCalled()
  })

  // single-owner parity: at N=1 every session shares the sole owner, so
  // disposeForWindow(soleId) kills the same set the old kill-all dispose() did.
  it('single-owner parity: disposeForWindow(soleId) kills the whole pool (= old dispose())', () => {
    const s = new Map([
      ['a', { ownerWindowId: 1, pty: { kill: vi.fn() } }],
      ['b', { ownerWindowId: 1, pty: { kill: vi.fn() } }],
    ])
    expect(disposeForWindow(s, 1)).toEqual(['a', 'b'])
    expect(s.size).toBe(0)
  })

  it('a no-such-owner dispose kills nothing', () => {
    const s = makeSessions()
    expect(disposeForWindow(s, 99)).toEqual([])
    expect(s.size).toBe(3)
  })
})

describe('pty-owner — listIdsByCwdOwned (ENH-191 P3 M4)', () => {
  const sessions = new Map([
    ['a', { cwd: '/x', ownerWindowId: 1 }],
    ['b', { cwd: '/x', ownerWindowId: 2 }],
    ['c', { cwd: '/x', ownerWindowId: 1 }],
    ['d', { cwd: '/y', ownerWindowId: 1 }],
  ])

  it('owner-filtered: only the owning window\'s same-cwd ids, in insertion order', () => {
    expect(listIdsByCwdOwned(sessions, '/x', 1)).toEqual(['a', 'c'])
  })

  it('unfiltered (no owner) === the byte-identical old listIdsByCwd', () => {
    expect(listIdsByCwdOwned(sessions, '/x')).toEqual(['a', 'b', 'c'])
  })

  // NEGATIVE CONTROL: the filter is load-bearing — the wrong owner yields a
  // different set, so an unfiltered call (the pre-fix shape) over-captures
  // window 2's 'b' for a window-1 consumer.
  it('the owner filter is load-bearing (wrong owner → different set)', () => {
    expect(listIdsByCwdOwned(sessions, '/x', 2)).toEqual(['b'])
    expect(listIdsByCwdOwned(sessions, '/x')).not.toEqual(listIdsByCwdOwned(sessions, '/x', 1))
  })
})
