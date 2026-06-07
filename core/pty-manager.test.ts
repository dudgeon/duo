// ENH-191 P3-S4 — pins the DORMANT DUO_WINDOW env stamp: every PTY Duo spawns
// carries DUO_WINDOW=<owner window id> (set, not yet consumed) alongside the
// existing DUO_SESSION='1'. node-pty is a native module (built for Electron via
// electron-rebuild) that can't load in node-env, so we mock it — which also lets
// us capture the spawn env. Pure node-env.

import { describe, it, expect, vi } from 'vitest'

// vi.hoisted so the (hoisted) mock factory shares the capture array with tests.
const h = vi.hoisted(() => ({
  calls: [] as Array<{ shell: string; opts: { env: Record<string, string> } }>,
}))
vi.mock('node-pty', () => ({
  spawn: (shell: string, _args: string[], opts: { env: Record<string, string> }) => {
    h.calls.push({ shell, opts })
    return {
      onData: () => {},
      onExit: () => {},
      write: () => {},
      resize: () => {},
      kill: () => {},
      pid: 4242,
    }
  },
}))

import { PtyManager } from './pty-manager'

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
