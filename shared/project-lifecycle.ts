// BUG-191 + BUG-192 — pure project-lifecycle helpers.
//
// The project rail derives tiles from open terminals + working tabs
// (see `deriveProjects` in ./projects.ts). Two defects lived in how the
// renderer FED that derivation and how it MUTATED tab state on close:
//
//   • BUG-191 — a terminal's `cwd` is frozen at launch and never tracks
//     where the shell actually `cd`'d to (or whether it exited), so a
//     tile lingers as a "ghost" after its members are effectively gone.
//     `effectiveProjectTerminals` folds live shell-cwd info into the
//     membership inputs; `mergeLiveCwdInfo` keeps the poll churn-free.
//   • BUG-192 — `handleCloseProject` ran a multi-store setState burst
//     with a nested `setActiveTabId` and no re-entrancy guard, which
//     could drive a non-converging render loop. `planProjectClose`
//     isolates the pure member/survivor/active-shift computation so the
//     React handler just applies it (no setState nesting, fully tested).
//
// All three functions are side-effect-free so they unit-test without
// Electron / a renderer.

/** Live shell state for one terminal tab, resolved in the main process
 *  via `lsof` + the PtyManager session map (BUG-191). `alive: false`
 *  means the shell process has EXITED — the tab contributes no project
 *  membership. `cwd: null` on a live tab means "not yet known" (probe
 *  pending or failed) — fall back to the launch cwd, never drop a tile
 *  speculatively. */
export interface LiveCwdEntry {
  alive: boolean
  cwd: string | null
}

/**
 * BUG-191 — the effective `{id, cwd}` membership inputs for the project
 * derivation, given the latest live-cwd info.
 *
 *   • Exited shell (`alive === false`)  → omitted (no membership).
 *   • Live shell with a known live cwd  → uses the LIVE cwd (so a tab
 *     that `cd`'d out of project A stops qualifying A and starts
 *     qualifying wherever it landed).
 *   • Live shell, cwd unknown / probe pending → falls back to the tab's
 *     launch cwd (current behaviour; never a regression on first paint).
 */
export function effectiveProjectTerminals(
  tabs: ReadonlyArray<{ id: string; cwd: string }>,
  liveInfo: ReadonlyMap<string, LiveCwdEntry>
): Array<{ id: string; cwd: string }> {
  const out: Array<{ id: string; cwd: string }> = []
  for (const t of tabs) {
    const info = liveInfo.get(t.id)
    if (info && !info.alive) continue // exited shell → not "working in" anything
    out.push({ id: t.id, cwd: info && info.cwd ? info.cwd : t.cwd })
  }
  return out
}

/**
 * BUG-191 — merge a fresh batch of live-cwd results into the prior map,
 * returning the SAME map reference when nothing changed.
 *
 * The rail polls live cwds on an interval; without identity stability a
 * steady poll would hand `deriveProjects` a new input every tick and
 * re-fire every membership-keyed effect. We only allocate a new map when
 * an entry's `{alive, cwd}` actually differs (or the id set changed).
 *
 * A missing entry in `next` (id we asked about but main didn't answer
 * for) defaults to `{alive: true, cwd: null}` — assume alive with an
 * unknown cwd so a dropped IPC reply never drops a tile.
 */
export function mergeLiveCwdInfo(
  prev: ReadonlyMap<string, LiveCwdEntry>,
  next: Readonly<Record<string, LiveCwdEntry>>,
  ids: ReadonlyArray<string>
): Map<string, LiveCwdEntry> {
  const out = new Map<string, LiveCwdEntry>()
  let changed = ids.length !== prev.size
  for (const id of ids) {
    const n = next[id] ?? { alive: true, cwd: null }
    out.set(id, n)
    const p = prev.get(id)
    if (!p || p.alive !== n.alive || p.cwd !== n.cwd) changed = true
  }
  // `prev` is typed readonly here but is a plain Map at the call site;
  // returning it unchanged preserves referential identity (the whole
  // point — no churn).
  return changed ? out : (prev as Map<string, LiveCwdEntry>)
}

/**
 * BUG-194 — whether the focus chip points at a project that no longer
 * exists. A consequence of BUG-191's live-cwd tracking: when the focused
 * project's last terminal `cd`s OUT of it, that terminal's membership goes
 * null and the project drops from the rail — but `focusedProject` still
 * points at it, so the visibility filter (`membership === focusedProject`)
 * hides the now-orphaned terminals/tabs. The active terminal "disappears"
 * and ⌘T / ⌃Tab lose their target. When this returns true the host
 * releases focus to "All" so those tabs become visible again. Pinned
 * projects persist in `projectRoots` even with zero members, so focusing a
 * pinned-but-empty project correctly does NOT release.
 */
export function shouldReleaseFocus(
  focusedProject: string | null,
  projectRoots: ReadonlyArray<string>
): boolean {
  return focusedProject !== null && !projectRoots.includes(focusedProject)
}

/**
 * ENH-204 — the membership values of the terminals that are NEW since the
 * previous render's id-set (`prevIds`), feeding
 * `shouldReleaseFocusForNewTerminals`. Splitting this out of the App.tsx
 * effect makes its subtle parts — the id-diff, the first-run baseline, and
 * the boot-quiet guarantee — unit-testable rather than read-verified.
 *
 *   • `prevIds === undefined` is the FIRST run: the effect is only seeding
 *     its id-set, so nothing is "new" yet and this returns `[]` (the release
 *     then no-ops). This is the boot-quiet contract — even with restored
 *     tabs AND a (hypothetical future) non-null focus rehydrated at boot,
 *     the first tick can never release.
 *   • Otherwise: the memberships of tabs whose id is absent from `prevIds`.
 *     A tab missing from `membership` falls back to `null` ("no project"),
 *     matching how the visibility filter treats it.
 */
export function newTerminalMembershipsSince(
  prevIds: ReadonlySet<string> | undefined,
  tabs: ReadonlyArray<{ id: string }>,
  membership: Readonly<Record<string, string | null>>
): Array<string | null> {
  if (prevIds === undefined) return []
  return tabs.filter((t) => !prevIds.has(t.id)).map((t) => membership[t.id] ?? null)
}

/**
 * ENH-204 — whether opening NEW terminal(s) should drop the focus filter
 * back to "All". The rail's visibility filter HIDES a terminal when its
 * membership (deepest enclosing project) `!== focusedProject`
 * (`visibleTerminals` in App.tsx). So the instant you open a new terminal
 * that is NOT a member of the focused project — a different project, a
 * nested sub-project, or no project at all — it is hidden the moment it is
 * created; and since every open path makes the new tab the ACTIVE one, the
 * terminal you just asked for vanishes and ⌘T / ⌃Tab lose their target.
 * Releasing focus to "All" restores its visibility.
 *
 * This predicate is the EXACT negation of the visibility filter
 * (`membership === focusedProject` ⇒ visible), so "should release" means
 * precisely "at least one new terminal would be hidden." Keying it on
 * membership rather than raw cwd-containment is what makes the nested
 * sub-project case revert correctly: a terminal in `repo/packages/sub`
 * (where `sub` is its own git root) has membership `sub`, not `repo`, so it
 * releases even though its path is physically inside `repo`. (Containment
 * and membership diverge exactly there — driving off membership keeps this
 * in lockstep with the filter it compensates for.)
 *
 * Sibling to BUG-194's `shouldReleaseFocus`, but the trigger is a new
 * non-member terminal rather than a vanishing project. No-op in All mode
 * (`focusedProject === null` — nothing to release). `newTerminalMemberships`
 * are the membership values (a project root, or `null` for "no project") of
 * only the genuinely-new terminals; one non-member is enough to release.
 */
export function shouldReleaseFocusForNewTerminals(
  focusedProject: string | null,
  newTerminalMemberships: ReadonlyArray<string | null>
): boolean {
  if (focusedProject === null) return false
  return newTerminalMemberships.some((membership) => membership !== focusedProject)
}

/**
 * BUG-267 — the single decision point for the two "follow the active
 * surface" effects (ENH-182 Phase 3c file + Phase 3c-browser): should
 * activating this surface switch focus to its project?
 *
 * The flicker loop this kills: D11 used to re-adjudicate the
 * PRE-EXISTING active surface whenever `focusedProject` changed, while
 * the keep-visible effect (E9) simultaneously moved the active surface
 * into the new focus — two effects correcting the same discrepancy in
 * opposite directions, a perfect 2-cycle (focus P ↔ Q) that re-fired on
 * every commit and made the app unusable until an "All" click landed.
 *
 * Invariants, in gate order:
 *   • No surface (`surfaceKey === null`) → never switch.
 *   • Unchanged surface (`surfaceKey === prevSurfaceKey`) → never
 *     switch. A focus change or a late membership-probe settle is NOT a
 *     user activation; only a genuine activation change adjudicates.
 *     This is the loop-breaker: on tile-click entry the active surface
 *     is unchanged, so D11 stays quiet while E9 converges.
 *   • `focusTransitionPending` → never switch. E9's own convergence
 *     moves (switching the active file / dropping to the browser
 *     surface) DO change the surface, and may legitimately land on a
 *     visible-but-foreign tab (pinned reference, non-member browser
 *     tab). Those programmatic moves happen inside the focus-entry
 *     settling window (the pendingBrowserRedirect machine's lifetime);
 *     adjudicating them re-opens the loop through the redirect IPC.
 *   • All mode (`focusedProject === null`) → nothing to switch from.
 *   • No / same-project membership → stay put.
 *   • Otherwise → switch to the surface's project (the D11 contract:
 *     `duo edit` / `duo open` / a user tab-click onto a foreign-project
 *     surface follows that project).
 */
export function adjudicateActiveSurfaceFocusSwitch(input: {
  /** True while the focus-entry convergence window is open (a focus
   *  change whose redirect/keep-visible moves haven't settled). */
  focusTransitionPending: boolean
  /** The surface key observed on the previous effect run (file-tab id
   *  or browser-tab id), or null when none was adjudicable. */
  prevSurfaceKey: string | number | null
  /** The currently-active adjudicable surface key, or null. */
  surfaceKey: string | number | null
  focusedProject: string | null
  /** The active surface's project membership (root, or null/undefined
   *  for "no project" / "not yet probed"). */
  membership: string | null | undefined
}): string | null {
  const { focusTransitionPending, prevSurfaceKey, surfaceKey, focusedProject, membership } = input
  if (surfaceKey === null) return null
  if (surfaceKey === prevSurfaceKey) return null
  if (focusTransitionPending) return null
  if (focusedProject === null) return null
  if (!membership || membership === focusedProject) return null
  return membership
}

/** BUG-192 — the pure plan for closing every member of a project. The
 *  React handler applies this with a single, un-nested setState burst. */
export interface ProjectClosePlan {
  /** Terminal tab ids that belong to the closing project. */
  memberTermIds: string[]
  /** Working (file) tab ids that belong to the closing project. */
  memberFileIds: string[]
  /** Terminal tab ids that survive the close, in input order. */
  survivingTermIds: string[]
  /** True when EVERY terminal was a member — the caller must append a
   *  fresh shell so the terminal strip keeps its floor-of-1. */
  needsReplacementShell: boolean
  /** The active terminal was a member → caller shifts the active id to
   *  the first survivor (or the replacement shell). */
  activeTerminalBecameMember: boolean
  /** The active working tab was a member file → caller drops to the
   *  browser surface. */
  activeWorkingFileBecameMember: boolean
}

/**
 * BUG-192 — compute, with no side effects, what closing `root` does to
 * the terminal + working-tab sets. Keeping this pure means the member /
 * survivor / active-shift logic is unit-tested independently of React,
 * and the handler that consumes it never nests one setState inside
 * another's updater (the anti-pattern implicated in the jitter loop).
 */
export function planProjectClose(input: {
  tabs: ReadonlyArray<{ id: string }>
  fileTabs: ReadonlyArray<{ id: string }>
  terminalMembership: Readonly<Record<string, string | null>>
  tabMembership: Readonly<Record<string, string | null>>
  activeTabId: string
  /** id of the active working tab IFF it is a file tab, else null. */
  activeWorkingFileId: string | null
  root: string
}): ProjectClosePlan {
  const {
    tabs,
    fileTabs,
    terminalMembership,
    tabMembership,
    activeTabId,
    activeWorkingFileId,
    root
  } = input

  const memberTermIds: string[] = []
  const survivingTermIds: string[] = []
  for (const t of tabs) {
    if (terminalMembership[t.id] === root) memberTermIds.push(t.id)
    else survivingTermIds.push(t.id)
  }

  const memberFileIds: string[] = []
  for (const ft of fileTabs) {
    if (tabMembership[ft.id] === root) memberFileIds.push(ft.id)
  }

  return {
    memberTermIds,
    memberFileIds,
    survivingTermIds,
    needsReplacementShell: survivingTermIds.length === 0 && memberTermIds.length > 0,
    activeTerminalBecameMember: memberTermIds.includes(activeTabId),
    activeWorkingFileBecameMember:
      activeWorkingFileId != null && memberFileIds.includes(activeWorkingFileId)
  }
}
