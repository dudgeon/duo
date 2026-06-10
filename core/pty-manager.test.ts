// ENH-191 P3-S4 — pins the DORMANT DUO_WINDOW env stamp: every PTY Duo spawns
// carries DUO_WINDOW=<owner window id> (set, not yet consumed) alongside the
// existing DUO_SESSION='1'. node-pty is a native module (built for Electron via
// electron-rebuild) that can't load in node-env, so we mock it — which also lets
// us capture the spawn env. Pure node-env.

import { describe, it, expect, vi } from 'vitest'

// vi.hoisted so the (hoisted) mock factory shares the capture array with tests.
const h = vi.hoisted(() => ({
  calls: [] as Array<{ shell: string; opts: { env: Record<string, string> } }>,
  resizes: [] as Array<{ cols: number; rows: number }>,
}))
vi.mock('node-pty', () => ({
  spawn: (shell: string, _args: string[], opts: { env: Record<string, string> }) => {
    h.calls.push({ shell, opts })
    return {
      onData: () => {},
      onExit: () => {},
      write: () => {},
      resize: (cols: number, rows: number) => { h.resizes.push({ cols, rows }) },
      kill: () => {},
      pid: 4242,
    }
  },
}))

import { PtyManager } from './pty-manager'
import { TERMINAL_MIN_COLS } from './constants'

describe('PtyManager — dormant DUO_WINDOW env stamp (ENH-191 P3-S4)', () => {
  it('stamps DUO_WINDOW with the owner window id (+ keeps DUO_SESSION)', () => {
    h.calls.length = 0
    const mgr = new PtyManager('9.9.9')
    mgr.create('t1', '/bin/zsh', '/tmp', 7)
    expect(h.calls).toHaveLength(1)
    const env = h.calls[0].opts.env
    expect(env.DUO_WINDOW).toBe('7')
    expect(env.DUO_SESSION).toBe('1') // dormant stamp rides alongside the existing one
  })

  // NEGATIVE CONTROL: the stamp is the OWNER, not a constant — a second window's
  // PTY carries that window's id, so a hardcoded stamp would fail here.
  it('stamps a DIFFERENT owner for a second window (not hardcoded)', () => {
    h.calls.length = 0
    const mgr = new PtyManager('9.9.9')
    mgr.create('t2', '/bin/zsh', '/tmp', 13)
    expect(h.calls[0].opts.env.DUO_WINDOW).toBe('13')
  })
})

describe('PtyManager.resize — size guards (BUG-156 + BUG-200)', () => {
  it('forwards a normal resize to the PTY', () => {
    h.resizes.length = 0
    const mgr = new PtyManager('9.9.9')
    mgr.create('r1', '/bin/zsh', '/tmp')
    mgr.resize('r1', 80, 24)
    expect(h.resizes).toEqual([{ cols: 80, rows: 24 }])
  })

  it('drops a 0×0 / negative resize (BUG-156 SIGHUP guard)', () => {
    h.resizes.length = 0
    const mgr = new PtyManager('9.9.9')
    mgr.create('r2', '/bin/zsh', '/tmp')
    mgr.resize('r2', 0, 0)
    mgr.resize('r2', 80, 0)
    mgr.resize('r2', -5, 24)
    expect(h.resizes).toEqual([])
  })

  it('drops a sub-floor cols resize so a clipped/collapsed host cannot reflow the live PTY (BUG-200)', () => {
    h.resizes.length = 0
    const mgr = new PtyManager('9.9.9')
    mgr.create('r3', '/bin/zsh', '/tmp')
    // ~4-col fit produced by a 36px rail-clipped host — must NOT reach the PTY.
    mgr.resize('r3', 4, 30)
    mgr.resize('r3', TERMINAL_MIN_COLS - 1, 30)
    expect(h.resizes).toEqual([])
    // At/above the floor a real resize still goes through.
    mgr.resize('r3', TERMINAL_MIN_COLS, 30)
    expect(h.resizes).toEqual([{ cols: TERMINAL_MIN_COLS, rows: 30 }])
  })
})
