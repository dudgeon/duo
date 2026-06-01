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
