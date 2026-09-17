import { describe, it, expect } from 'vitest'
import {
  adjudicateActiveSurfaceFocusSwitch,
  chooseNewTerminalCwd,
  effectiveProjectTerminals,
  mergeLiveCwdInfo,
  newTerminalMembershipsSince,
  planProjectClose,
  shouldReleaseFocus,
  shouldReleaseFocusForNewTerminals,
  shouldShowEmptyTerminalPlaceholder,
  type LiveCwdEntry,
  chooseKeepVisibleFileTab
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

// ── BUG-267/269 · adjudicateActiveSurfaceFocusSwitch ─────────────────────
describe('adjudicateActiveSurfaceFocusSwitch (BUG-267/269 rail-click flicker loop)', () => {
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

// ── BUG-269 · terminal placeholder + new-tab cwd ─────────────────────
describe('shouldShowEmptyTerminalPlaceholder (BUG-269 — auto-spawn replaced)', () => {
  it('shows the placeholder when a project is focused and its visible strip is empty', () => {
    expect(
      shouldShowEmptyTerminalPlaceholder({ focusedProject: '/proj/p', visibleTerminalCount: 0 })
    ).toBe(true)
  })

  it('never shows it in All mode, however empty the strip is', () => {
    expect(
      shouldShowEmptyTerminalPlaceholder({ focusedProject: null, visibleTerminalCount: 0 })
    ).toBe(false)
  })

  it('hides it as soon as the focused project has a member terminal', () => {
    expect(
      shouldShowEmptyTerminalPlaceholder({ focusedProject: '/proj/p', visibleTerminalCount: 1 })
    ).toBe(false)
  })

  it('keys on MEMBERSHIP, not on a launch cwd under the root (the old guard hole)', () => {
    // The deleted `hasTerminalUnderRoot` guard read each tab's frozen
    // launch cwd, so an exited / cd-ed-away shell still counted and the
    // spawn silently no-oped. The placeholder reads the same count the
    // strip filter renders, so the two can never disagree.
    expect(
      shouldShowEmptyTerminalPlaceholder({ focusedProject: '/proj/p', visibleTerminalCount: 0 })
    ).toBe(true)
  })
})

describe('chooseNewTerminalCwd (BUG-269 — ⌘T / + while focused and empty)', () => {
  it('opens at the focused root when the strip is empty (not the hidden foreign tab cwd)', () => {
    expect(
      chooseNewTerminalCwd({
        focusedProject: '/proj/p',
        visibleTerminalCount: 0,
        activeTerminalCwd: '/proj/q/src',
        pendingCwd: '/somewhere/else'
      })
    ).toBe('/proj/p')
  })

  it('keeps the ENH-187 inherit-the-active-terminal rule when the strip is NOT empty', () => {
    expect(
      chooseNewTerminalCwd({
        focusedProject: '/proj/p',
        visibleTerminalCount: 2,
        activeTerminalCwd: '/proj/p/src',
        pendingCwd: '/somewhere/else'
      })
    ).toBe('/proj/p/src')
  })

  it('falls back to pendingCwd with no active terminal, in All mode', () => {
    expect(
      chooseNewTerminalCwd({
        focusedProject: null,
        visibleTerminalCount: 0,
        activeTerminalCwd: null,
        pendingCwd: '/nav/cwd'
      })
    ).toBe('/nav/cwd')
  })

  it('does not hijack All mode even with zero terminals', () => {
    expect(
      chooseNewTerminalCwd({
        focusedProject: null,
        visibleTerminalCount: 0,
        activeTerminalCwd: '/proj/q/src',
        pendingCwd: '/nav/cwd'
      })
    ).toBe('/proj/q/src')
  })
})

// ── BUG-269 · the convergence contract ───────────────────────────────
// Models the two App.tsx effects as the pure functions they are. Both
// read the SAME committed state (they run in one passive-effect flush)
// and both queue a setState; the next commit applies both. That is
// exactly what made the un-gated pair a 2-cycle rather than a
// self-correcting pass.
describe('tile-click convergence contract (BUG-269)', () => {
  const membership: Record<string, string> = { 'f-p': '/proj/p', 'f-q': '/proj/q' }
  const firstVisibleFileOf: Record<string, string> = { '/proj/p': 'f-p', '/proj/q': 'f-q' }

  function run(opts: { gated: boolean; passes: number }): string[] {
    // Entry state: the user just clicked P's tile while the active
    // working tab is f-q, a file belonging to project Q.
    let focusedProject: string | null = '/proj/p'
    let activeSurface: string = 'f-q'
    let prevSurfaceKey: string | null = 'f-q'
    const states: string[] = []
    for (let pass = 0; pass < opts.passes; pass++) {
      // E-D11 — follow the active surface's project.
      const target: string | null = opts.gated
        ? adjudicateActiveSurfaceFocusSwitch({
            focusTransitionPending: false,
            prevSurfaceKey,
            surfaceKey: activeSurface,
            focusedProject,
            membership: membership[activeSurface]
          })
        : focusedProject !== null && membership[activeSurface] !== focusedProject
          ? membership[activeSurface]
          : null
      prevSurfaceKey = activeSurface
      // E9 keep-visible — move the active surface into the focused
      // project. Reads the SAME pre-commit focusedProject as E-D11 did.
      const moves: boolean =
        focusedProject !== null && membership[activeSurface] !== focusedProject
      const nextSurface: string = moves ? firstVisibleFileOf[focusedProject as string] : activeSurface
      if (moves && opts.gated) prevSurfaceKey = nextSurface // the pre-seed
      focusedProject = target ?? focusedProject
      activeSurface = nextSurface
      states.push(`${focusedProject}|${activeSurface}`)
    }
    return states
  }

  it('WITH the gate: reaches a fixpoint within 2 passes, on the project the user clicked', () => {
    const states = run({ gated: true, passes: 6 })
    expect(states[0]).toBe('/proj/p|f-p')
    expect(states[1]).toBe('/proj/p|f-p')
    // Fixpoint — every later pass repeats it, so nothing re-renders.
    expect(new Set(states).size).toBe(1)
  })

  it('WITHOUT the gate: the same click is a non-converging P↔Q 2-cycle (the shipped bug)', () => {
    const states = run({ gated: false, passes: 6 })
    expect(states[0]).toBe('/proj/q|f-p')
    expect(states[1]).toBe('/proj/p|f-q')
    // Period 2, forever — never two consecutive states alike.
    expect(states[2]).toBe(states[0])
    expect(states[3]).toBe(states[1])
    expect(states.every((s, i) => i === 0 || s !== states[i - 1])).toBe(true)
  })
})

describe('chooseKeepVisibleFileTab (BUG-269 — member-first keep-visible landing)', () => {
  const tabMembership = { pinned: '/proj/q', 'p-note': '/proj/p', 'p-two': '/proj/p' }
  it('prefers a TRUE member over a pinned cross-project tab that sorts first', () => {
    expect(
      chooseKeepVisibleFileTab({
        visibleFileTabs: [{ id: 'pinned' }, { id: 'p-note' }, { id: 'p-two' }],
        tabMembership,
        focusedProject: '/proj/p'
      })
    ).toBe('p-note')
  })
  it('falls back to the first visible (pinned reference) tab when the project has no member file tabs', () => {
    expect(
      chooseKeepVisibleFileTab({
        visibleFileTabs: [{ id: 'pinned' }],
        tabMembership,
        focusedProject: '/proj/p'
      })
    ).toBe('pinned')
  })
  it('returns null when nothing is visible (caller drops to the browser surface)', () => {
    expect(
      chooseKeepVisibleFileTab({ visibleFileTabs: [], tabMembership, focusedProject: '/proj/p' })
    ).toBeNull()
  })
})
