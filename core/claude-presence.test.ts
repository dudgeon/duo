// ENH-191 P3-S8 — pins the per-window ClaudePresenceProbe isolation: two probes
// hold independent state + listeners, so one window going live can NEVER flip
// another window's pill. The negative control is a SINGLE shared probe (the
// pre-P3 module-global shape) delivering one change to BOTH listeners — exactly
// the cross-window leak the per-window probe eliminates.
//
// hasClaudeDescendant (claude-presence.ts) shells out to `ps` via
// child_process.spawn; we mock it so the verdict is deterministic. Pure node-env.

import { describe, it, expect, vi } from 'vitest'

// vi.hoisted so the mock factory (hoisted above imports) can share mutable state
// with the tests — set h.psTable before driving a probe.
const h = vi.hoisted(() => ({ psTable: 'PID PPID COMM\n' }))
vi.mock('child_process', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    spawn: () => {
      const stdout = new EventEmitter()
      const child = Object.assign(new EventEmitter(), { stdout })
      setTimeout(() => {
        stdout.emit('data', Buffer.from(h.psTable))
        child.emit('close')
      }, 0)
      return child
    },
  }
})

import { ClaudePresenceProbe } from './claude-presence'

// A `ps -ax -o pid,ppid,comm` table where pid 100's tree contains `claude`.
const HOSTS_CLAUDE = 'PID PPID COMM\n100 1 zsh\n200 100 claude\n'

describe('ClaudePresenceProbe — per-window isolation (ENH-191 P3-S8)', () => {
  it('two probes hold independent state — one going live does NOT flip the other', async () => {
    h.psTable = HOSTS_CLAUDE
    const p1 = new ClaudePresenceProbe()
    const p2 = new ClaudePresenceProbe()
    p1.setTarget({ pid: 100, kind: 'claude' }) // p1 watches the claude-hosting tree
    // p2 has no target → stays 'no-pty'
    await vi.waitFor(() => expect(p1.getState()).toBe('claude'))
    expect(p2.getState()).toBe('no-pty') // isolated — a shared singleton couldn't do this
  })

  it('onChange listeners are per-instance — a p1 change never reaches p2\'s listener', async () => {
    h.psTable = HOSTS_CLAUDE
    const p1 = new ClaudePresenceProbe()
    const p2 = new ClaudePresenceProbe()
    const spy1 = vi.fn()
    const spy2 = vi.fn()
    p1.onChange(spy1) // immediate fire with 'no-pty'
    p2.onChange(spy2)
    spy1.mockClear()
    spy2.mockClear()
    p1.setTarget({ pid: 100, kind: 'claude' })
    await vi.waitFor(() => expect(spy1).toHaveBeenCalledWith('claude'))
    expect(spy2).not.toHaveBeenCalled() // p2's window never hears p1's change
  })

  // NEGATIVE CONTROL: the pre-fix shape (one shared probe, N listeners) delivers
  // a single change to BOTH listeners — the cross-window leak. Asserting this
  // proves the two-probe arrangement above is load-bearing, not incidental.
  it('a SINGLE shared probe delivers one change to BOTH listeners (pre-fix leak)', async () => {
    h.psTable = HOSTS_CLAUDE
    const shared = new ClaudePresenceProbe()
    const spyA = vi.fn()
    const spyB = vi.fn()
    shared.onChange(spyA)
    shared.onChange(spyB)
    spyA.mockClear()
    spyB.mockClear()
    shared.setTarget({ pid: 100, kind: 'claude' })
    await vi.waitFor(() => expect(spyA).toHaveBeenCalledWith('claude'))
    expect(spyB).toHaveBeenCalledWith('claude') // both fire — the leak the per-window split removes
  })

  it('setTarget(pid:null) resolves to no-pty with no ps dependency', async () => {
    const p = new ClaudePresenceProbe()
    p.setTarget({ pid: null, kind: null })
    await vi.waitFor(() => expect(p.getState()).toBe('no-pty'))
  })
})

// ENH-191 P3-S8d (NFR-1.3) — the poll loop parks when there's no hosting target
// (a pid:null probe can only compute 'no-pty', so the 500ms ps spawn is idle
// waste). State is unchanged across the park; only the ps cadence drops.
describe('ClaudePresenceProbe — idle park (ENH-191 P3-S8d)', () => {
  it('does NOT arm the poll loop when started with no hosting target', () => {
    const p = new ClaudePresenceProbe()
    p.start()
    expect(p.isPolling()).toBe(false) // parked — the pre-fix unconditional interval would be armed
    expect(p.getState()).toBe('no-pty')
    p.stop()
  })

  it('arms on a hosting target, parks again on pid:null (state stays no-pty)', async () => {
    h.psTable = HOSTS_CLAUDE
    const p = new ClaudePresenceProbe()
    p.start()
    expect(p.isPolling()).toBe(false)
    p.setTarget({ pid: 100, kind: 'claude' })
    expect(p.isPolling()).toBe(true) // armed — there's a target to poll
    p.setTarget({ pid: null, kind: null })
    expect(p.isPolling()).toBe(false) // parked again (NEGATIVE CONTROL: pre-fix stays armed)
    await vi.waitFor(() => expect(p.getState()).toBe('no-pty'))
    p.stop()
  })

  it('stop() disarms and a later setTarget does not resurrect the loop', () => {
    const p = new ClaudePresenceProbe()
    p.start()
    p.setTarget({ pid: 100, kind: 'claude' })
    expect(p.isPolling()).toBe(true)
    p.stop()
    expect(p.isPolling()).toBe(false)
    p.setTarget({ pid: 100, kind: 'claude' }) // after teardown
    expect(p.isPolling()).toBe(false) // running=false → no resurrection
  })
})

// ENH-212 — probeAllTabs: ONE ps parse → BFS descendant walk per root pid,
// returns the per-root claude verdict + the set of live claude pids NOT owned
// by any supplied root (the live-but-idle guard input). Reuses the same
// child_process.spawn mock above (h.psTable drives the canned ps output).
describe('probeAllTabs — ENH-212 multi-root BFS', () => {
  it('returns a per-root verdict (claude-hosting vs not) from one ps parse', async () => {
    // pid 100's tree hosts claude (100 → 110 zsh → 120 claude);
    // pid 200's tree is shell-only (200 → 210 zsh).
    h.psTable = 'PID PPID COMM\n100 1 login\n110 100 zsh\n120 110 claude\n200 1 login\n210 200 zsh\n'
    const { probeAllTabs } = await import('./claude-presence')
    const res = await probeAllTabs([100, 200])
    expect(res.claudeByRoot.get(100)).toBe(true)
    expect(res.claudeByRoot.get(200)).toBe(false)
  })

  it('surfaces an UNATTRIBUTED live claude (outside every supplied root tree)', async () => {
    // pid 100's tree hosts claude (owned). pid 900 is a detached external
    // claude under no supplied root → unattributed.
    h.psTable = 'PID PPID COMM\n100 1 zsh\n120 100 claude\n900 1 claude\n'
    const { probeAllTabs } = await import('./claude-presence')
    const res = await probeAllTabs([100])
    expect(res.claudeByRoot.get(100)).toBe(true)
    expect(res.unattributedClaudePids).toEqual([900]) // 120 is owned by root 100
  })

  it('no roots → every live claude is unattributed', async () => {
    h.psTable = 'PID PPID COMM\n100 1 zsh\n120 100 claude\n900 1 claude\n'
    const { probeAllTabs } = await import('./claude-presence')
    const res = await probeAllTabs([])
    expect(res.unattributedClaudePids.sort((a, b) => a - b)).toEqual([120, 900])
  })

  it('handles a deep descendant chain (BFS past intermediate shells)', async () => {
    // 100 → 101 → 102 → 103 claude — claude is 3 levels down.
    h.psTable = 'PID PPID COMM\n100 1 zsh\n101 100 sh\n102 101 node\n103 102 claude\n'
    const { probeAllTabs } = await import('./claude-presence')
    const res = await probeAllTabs([100])
    expect(res.claudeByRoot.get(100)).toBe(true)
    expect(res.unattributedClaudePids).toEqual([]) // 103 is inside root 100's tree
  })
})
