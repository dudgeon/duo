import { describe, it, expect } from 'vitest'
import {
  effectiveProjectTerminals,
  mergeLiveCwdInfo,
  planProjectClose,
  shouldReleaseFocus,
  type LiveCwdEntry
} from './project-lifecycle'

// ── BUG-194 · shouldReleaseFocus ─────────────────────────────────────
describe('shouldReleaseFocus (BUG-194 — focus follows a vanishing project)', () => {
  it('releases focus when the focused project is gone from the rail', () => {
    expect(shouldReleaseFocus('/p/a', ['/p/b', '/p/c'])).toBe(true)
  })
  it('keeps focus when the focused project is still present', () => {
    expect(shouldReleaseFocus('/p/a', ['/p/a', '/p/b'])).toBe(false)
  })
  it('is a no-op in All mode (null focus)', () => {
    expect(shouldReleaseFocus(null, ['/p/a'])).toBe(false)
  })
  it('releases when the rail is empty', () => {
    expect(shouldReleaseFocus('/p/a', [])).toBe(true)
  })
})

// ── BUG-191 · effectiveProjectTerminals ─────────────────────────────
describe('effectiveProjectTerminals (BUG-191 ghost-tile fix)', () => {
  const tabs = [
    { id: 't1', cwd: '/proj/a' },
    { id: 't2', cwd: '/proj/b' }
  ]

  it('falls back to launch cwd when there is no live info yet (no regression on first paint)', () => {
    expect(effectiveProjectTerminals(tabs, new Map())).toEqual([
      { id: 't1', cwd: '/proj/a' },
      { id: 't2', cwd: '/proj/b' }
    ])
  })

  it('uses the LIVE cwd when the shell cd-d elsewhere — the ghost-tile cause', () => {
    const live = new Map<string, LiveCwdEntry>([['t1', { alive: true, cwd: '/somewhere/else' }]])
    expect(effectiveProjectTerminals(tabs, live)).toEqual([
      { id: 't1', cwd: '/somewhere/else' }, // no longer qualifies /proj/a
      { id: 't2', cwd: '/proj/b' }
    ])
  })

  it('OMITS an exited shell entirely (dead terminal stops keeping a tile alive)', () => {
    const live = new Map<string, LiveCwdEntry>([['t1', { alive: false, cwd: null }]])
    expect(effectiveProjectTerminals(tabs, live)).toEqual([{ id: 't2', cwd: '/proj/b' }])
  })

  it('keeps the launch cwd when a live shell reports an unknown cwd (probe pending/failed)', () => {
    const live = new Map<string, LiveCwdEntry>([['t1', { alive: true, cwd: null }]])
    expect(effectiveProjectTerminals(tabs, live)).toEqual([
      { id: 't1', cwd: '/proj/a' },
      { id: 't2', cwd: '/proj/b' }
    ])
  })
})

// ── BUG-191 · mergeLiveCwdInfo (churn guard) ─────────────────────────
describe('mergeLiveCwdInfo (BUG-191 poll churn guard)', () => {
  it('returns the SAME map reference when nothing changed (no re-derive churn)', () => {
    const prev = new Map<string, LiveCwdEntry>([
      ['t1', { alive: true, cwd: '/x' }],
      ['t2', { alive: true, cwd: '/y' }]
    ])
    const merged = mergeLiveCwdInfo(prev, { t1: { alive: true, cwd: '/x' }, t2: { alive: true, cwd: '/y' } }, ['t1', 't2'])
    expect(merged).toBe(prev)
  })

  it('returns a new map when a cwd changes', () => {
    const prev = new Map<string, LiveCwdEntry>([['t1', { alive: true, cwd: '/x' }]])
    const merged = mergeLiveCwdInfo(prev, { t1: { alive: true, cwd: '/moved' } }, ['t1'])
    expect(merged).not.toBe(prev)
    expect(merged.get('t1')).toEqual({ alive: true, cwd: '/moved' })
  })

  it('returns a new map when a shell dies', () => {
    const prev = new Map<string, LiveCwdEntry>([['t1', { alive: true, cwd: '/x' }]])
    const merged = mergeLiveCwdInfo(prev, { t1: { alive: false, cwd: null } }, ['t1'])
    expect(merged).not.toBe(prev)
    expect(merged.get('t1')).toEqual({ alive: false, cwd: null })
  })

  it('returns a new map when the id set shrinks (a tab closed)', () => {
    const prev = new Map<string, LiveCwdEntry>([
      ['t1', { alive: true, cwd: '/x' }],
      ['t2', { alive: true, cwd: '/y' }]
    ])
    const merged = mergeLiveCwdInfo(prev, { t1: { alive: true, cwd: '/x' } }, ['t1'])
    expect(merged).not.toBe(prev)
    expect(merged.has('t2')).toBe(false)
  })

  it('defaults a missing reply to alive-with-unknown-cwd (never drops a tile on a dropped IPC)', () => {
    const merged = mergeLiveCwdInfo(new Map(), {}, ['t1'])
    expect(merged.get('t1')).toEqual({ alive: true, cwd: null })
  })
})

// ── BUG-192 · planProjectClose ───────────────────────────────────────
describe('planProjectClose (BUG-192 jitter-loop fix)', () => {
  const base = {
    tabs: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
    fileTabs: [{ id: 'f1' }, { id: 'f2' }],
    terminalMembership: { t1: '/proj/a', t2: '/proj/a', t3: '/proj/b' } as Record<string, string | null>,
    tabMembership: { f1: '/proj/a', f2: '/proj/b' } as Record<string, string | null>,
    activeTabId: 't3',
    activeWorkingFileId: null as string | null,
    root: '/proj/a'
  }

  it('identifies members and survivors for the closing root', () => {
    const plan = planProjectClose(base)
    expect(plan.memberTermIds).toEqual(['t1', 't2'])
    expect(plan.survivingTermIds).toEqual(['t3'])
    expect(plan.memberFileIds).toEqual(['f1'])
  })

  it('does not need a replacement shell when survivors remain', () => {
    expect(planProjectClose(base).needsReplacementShell).toBe(false)
  })

  it('needs a replacement shell when EVERY terminal is a member (floor-of-1)', () => {
    const plan = planProjectClose({
      ...base,
      tabs: [{ id: 't1' }, { id: 't2' }],
      terminalMembership: { t1: '/proj/a', t2: '/proj/a' },
      activeTabId: 't1'
    })
    expect(plan.needsReplacementShell).toBe(true)
    expect(plan.survivingTermIds).toEqual([])
  })

  it('flags the active terminal shift only when the active terminal was a member', () => {
    expect(planProjectClose({ ...base, activeTabId: 't1' }).activeTerminalBecameMember).toBe(true)
    expect(planProjectClose({ ...base, activeTabId: 't3' }).activeTerminalBecameMember).toBe(false)
  })

  it('flags the active working-file drop only when that file was a member', () => {
    expect(planProjectClose({ ...base, activeWorkingFileId: 'f1' }).activeWorkingFileBecameMember).toBe(true)
    expect(planProjectClose({ ...base, activeWorkingFileId: 'f2' }).activeWorkingFileBecameMember).toBe(false)
    expect(planProjectClose({ ...base, activeWorkingFileId: null }).activeWorkingFileBecameMember).toBe(false)
  })

  it('closing a root with no members yields empty plans (caller no-ops)', () => {
    const plan = planProjectClose({ ...base, root: '/proj/never' })
    expect(plan.memberTermIds).toEqual([])
    expect(plan.memberFileIds).toEqual([])
    expect(plan.needsReplacementShell).toBe(false)
  })
})
