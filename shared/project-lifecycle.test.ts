import { describe, it, expect } from 'vitest'
import {
  adjudicateActiveSurfaceFocusSwitch,
  effectiveProjectTerminals,
  mergeLiveCwdInfo,
  newTerminalMembershipsSince,
  planProjectClose,
  shouldReleaseFocus,
  shouldReleaseFocusForNewTerminals,
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

// ── ENH-204 · newTerminalMembershipsSince ───────────────────────────
describe('newTerminalMembershipsSince (ENH-204 — id-diff + first-run baseline)', () => {
  const membership: Record<string, string | null> = {
    t1: '/proj/a',
    t2: '/proj/b',
    t3: null // no project
  }

  it('FIRST run (prevIds undefined) returns [] — nothing is "new", the effect is only seeding', () => {
    expect(newTerminalMembershipsSince(undefined, [{ id: 't1' }, { id: 't2' }], membership)).toEqual([])
  })

  it('boot-quiet: first run returns [] even if a (future) non-null focus is set — release can never fire', () => {
    // Pins the boot-quiet contract against a future change that rehydrates
    // focusedProject per window: the FIRST tick produces no new memberships,
    // so shouldReleaseFocusForNewTerminals short-circuits to false.
    const firstTick = newTerminalMembershipsSince(undefined, [{ id: 't1' }, { id: 't2' }], membership)
    expect(shouldReleaseFocusForNewTerminals('/proj/somewhere', firstTick)).toBe(false)
  })

  it('returns [] when no ids are new (same id-set across renders)', () => {
    const prev = new Set(['t1', 't2'])
    expect(newTerminalMembershipsSince(prev, [{ id: 't1' }, { id: 't2' }], membership)).toEqual([])
  })

  it('returns only the NEW tab’s membership (existing ids excluded)', () => {
    const prev = new Set(['t1'])
    expect(newTerminalMembershipsSince(prev, [{ id: 't1' }, { id: 't2' }], membership)).toEqual(['/proj/b'])
  })

  it('maps a new tab with no project to null', () => {
    const prev = new Set(['t1'])
    expect(newTerminalMembershipsSince(prev, [{ id: 't1' }, { id: 't3' }], membership)).toEqual([null])
  })

  it('falls back to null for a new tab missing from the membership record (matches the filter)', () => {
    const prev = new Set(['t1'])
    expect(newTerminalMembershipsSince(prev, [{ id: 't1' }, { id: 'tNew' }], membership)).toEqual([null])
  })

  it('returns memberships for several new tabs in one batch', () => {
    const prev = new Set(['t1'])
    expect(newTerminalMembershipsSince(prev, [{ id: 't1' }, { id: 't2' }, { id: 't3' }], membership)).toEqual([
      '/proj/b',
      null
    ])
  })
})

// ── ENH-204 · shouldReleaseFocusForNewTerminals ─────────────────────
describe('shouldReleaseFocusForNewTerminals (ENH-204 — a new terminal the filter would hide drops focus)', () => {
  it('releases when a new terminal belongs to a different project', () => {
    expect(shouldReleaseFocusForNewTerminals('/proj/a', ['/proj/b'])).toBe(true)
  })
  it('releases when a new terminal has no project (null membership — e.g. the home dir)', () => {
    expect(shouldReleaseFocusForNewTerminals('/proj/a', [null])).toBe(true)
  })
  it('releases for a NESTED sub-project terminal (the reviewed bug: membership is the sub-root, not the focused parent)', () => {
    // A terminal in /proj/a/packages/sub where `sub` is its own git root has
    // membership `/proj/a/packages/sub` ≠ `/proj/a`, so the visibility filter
    // hides it — driving the release off membership (not physical cwd
    // containment) is what makes this case revert correctly.
    expect(shouldReleaseFocusForNewTerminals('/proj/a', ['/proj/a/packages/sub'])).toBe(true)
  })
  it('keeps focus when the new terminal is a member of the focused project', () => {
    expect(shouldReleaseFocusForNewTerminals('/proj/a', ['/proj/a'])).toBe(false)
  })
  it('is a no-op in All mode (null focus), whatever the new memberships', () => {
    expect(shouldReleaseFocusForNewTerminals(null, [null])).toBe(false)
    expect(shouldReleaseFocusForNewTerminals(null, ['/proj/b'])).toBe(false)
  })
  it('releases if ANY of several new terminals is a non-member (batch open)', () => {
    expect(shouldReleaseFocusForNewTerminals('/proj/a', ['/proj/a', '/proj/b'])).toBe(true)
  })
  it('keeps focus when EVERY new terminal is a member', () => {
    expect(shouldReleaseFocusForNewTerminals('/proj/a', ['/proj/a', '/proj/a'])).toBe(false)
  })
  it('is a no-op when there are no new terminals (a close or title change)', () => {
    expect(shouldReleaseFocusForNewTerminals('/proj/a', [])).toBe(false)
  })
  it('is the exact negation of the visibility filter (keep ⟺ membership === focusedProject)', () => {
    // visibleTerminals keeps a tab iff terminalMembership[id] === focusedProject;
    // this helper must release iff that equality is false for a new terminal.
    expect(shouldReleaseFocusForNewTerminals('/proj/a', ['/proj/a'])).toBe(false) // member → visible → keep
    expect(shouldReleaseFocusForNewTerminals('/proj/a', ['/proj/a/sub'])).toBe(true) // sub-project → hidden → release
    expect(shouldReleaseFocusForNewTerminals('/proj/a', [null])).toBe(true) // no project → hidden → release
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

// ── BUG-267 · adjudicateActiveSurfaceFocusSwitch ─────────────────────
describe('adjudicateActiveSurfaceFocusSwitch (BUG-267 rail-click flicker loop)', () => {
  const base = {
    focusTransitionPending: false,
    prevSurfaceKey: 'f-old' as string | number | null,
    surfaceKey: 'f-new' as string | number | null,
    focusedProject: '/proj/p' as string | null,
    membership: '/proj/q' as string | null | undefined
  }

  it('switches focus when a genuinely-new surface belongs to another project (the D11 contract)', () => {
    expect(adjudicateActiveSurfaceFocusSwitch(base)).toBe('/proj/q')
  })

  it('NEVER switches on an unchanged surface — a focus change alone must not re-adjudicate (the loop-breaker)', () => {
    expect(
      adjudicateActiveSurfaceFocusSwitch({ ...base, prevSurfaceKey: 'f-new' })
    ).toBeNull()
  })

  it('never switches while the focus-entry convergence window is open (programmatic keep-visible moves)', () => {
    expect(
      adjudicateActiveSurfaceFocusSwitch({ ...base, focusTransitionPending: true })
    ).toBeNull()
  })

  it('no-ops in All mode', () => {
    expect(
      adjudicateActiveSurfaceFocusSwitch({ ...base, focusedProject: null })
    ).toBeNull()
  })

  it('no-ops when there is no adjudicable surface', () => {
    expect(adjudicateActiveSurfaceFocusSwitch({ ...base, surfaceKey: null })).toBeNull()
  })

  it('stays put for a member of the focused project, and for null/undefined membership', () => {
    expect(
      adjudicateActiveSurfaceFocusSwitch({ ...base, membership: '/proj/p' })
    ).toBeNull()
    expect(adjudicateActiveSurfaceFocusSwitch({ ...base, membership: null })).toBeNull()
    expect(
      adjudicateActiveSurfaceFocusSwitch({ ...base, membership: undefined })
    ).toBeNull()
  })

  it('accepts numeric surface keys (browser-tab ids) with the same gates', () => {
    expect(
      adjudicateActiveSurfaceFocusSwitch({
        ...base,
        prevSurfaceKey: 7,
        surfaceKey: 7
      })
    ).toBeNull()
    expect(
      adjudicateActiveSurfaceFocusSwitch({ ...base, prevSurfaceKey: 7, surfaceKey: 9 })
    ).toBe('/proj/q')
  })

  it('REGRESSION: the tile-click 2-cycle never fires a switch', () => {
    // Entry state: focused P via a tile click, active file f-q (member of
    // Q) unchanged from the previous run. Pass 1 — D11 observes the
    // unchanged surface: must stay quiet while E9 converges.
    expect(
      adjudicateActiveSurfaceFocusSwitch({
        focusTransitionPending: false,
        prevSurfaceKey: 'f-q',
        surfaceKey: 'f-q',
        focusedProject: '/proj/p',
        membership: '/proj/q'
      })
    ).toBeNull()
    // Pass 2 — E9 moved the active file to P's member f-p (an activation
    // change, but a member): still no switch. The pair quiesces in ≤2
    // passes instead of flipping focus P↔Q forever.
    expect(
      adjudicateActiveSurfaceFocusSwitch({
        focusTransitionPending: false,
        prevSurfaceKey: 'f-q',
        surfaceKey: 'f-p',
        focusedProject: '/proj/p',
        membership: '/proj/p'
      })
    ).toBeNull()
  })
})
