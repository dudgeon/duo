// ENH-182 Phase 1 — renderer-side projects derivation hook.
//
// Subscribes to the app-state shape (terminals + working tabs + pinned
// tab paths + navigator listings) and produces the derived project
// rail input via `deriveProjects` from `shared/projects.ts`. The
// fs/git probes that feed `qualify()` run async:
//
//   • isGitRoot — via existing `window.electron.git.status(dir)` IPC.
//   • hasMarker — read from `nav.state.listings` (renderer-side).
//
// Caches probe results in component state so we don't re-shell `git
// rev-parse` on every render. New candidate dirs get probed as they
// appear; we never invalidate (a `cwd` that became a git repo while
// Duo was running is the rare case — owner can restart).
//
// Phase 1 returns just `projects[]`. Phase 2 will expose
// `terminalMembership` + `tabMembership` for the focus filter.

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  deriveProjects,
  ancestors,
  isExcludedFromQualification,
  type DeriveProjectsOutput
} from '@shared/projects'
import type { Project } from '@shared/types'

// Resolved at module load; safe-undef for renderer contexts that don't
// inject process.env (the helper's regex fallback covers that case).
const HOME_DIR: string | undefined =
  typeof process !== 'undefined' ? process.env?.HOME : undefined

interface GitProbeResult {
  isRepo: boolean
  workTreeRoot?: string
}

export interface UseProjectsArgs {
  /** Open terminals — only `id` and `cwd` are read. */
  terminals: ReadonlyArray<{ id: string; cwd: string }>
  /** Open working tabs (file kind only). Only `id` and `path` are read. */
  workingTabs: ReadonlyArray<{ id: string; path: string }>
  /** Set of working-tab paths that are pinned (Stage 24 pins.json).
   *  Per D2, pinned tabs do NOT count toward "working in" for
   *  qualification — pin a reference doc and it shouldn't qualify the
   *  parent folder as a project. */
  pinnedTabPaths: ReadonlySet<string>
  /** Phase 3a (D12) — set of project roots pinned via the rail
   *  right-click menu. Pinned projects persist in the rail even
   *  with zero open member tabs/terminals. */
  pinnedProjects?: ReadonlySet<string>
  /** Phase 3a (R2) — explicit color-index override map. Wins over
   *  the `hashColorIndex(root)` default. */
  colorOverrides?: Readonly<Record<string, number>>
}

export interface UseProjectsResult {
  projects: Project[]
  /** Phase 2 — terminalId → projectRoot (or null when no project). */
  terminalMembership: Record<string, string | null>
  /** Phase 2 — tabId → projectRoot (or null when no project). */
  tabMembership: Record<string, string | null>
}

// Stable empty fallbacks so callers that omit `pinnedProjects` /
// `colorOverrides` don't churn the `deriveProjects` memo identity
// on every render.
const EMPTY_PROJECT_SET: ReadonlySet<string> = new Set<string>()
const EMPTY_COLOR_OVERRIDES: Readonly<Record<string, number>> = Object.freeze({})

export function useProjects(args: UseProjectsArgs): UseProjectsResult {
  const {
    terminals,
    workingTabs,
    pinnedTabPaths,
    pinnedProjects = EMPTY_PROJECT_SET,
    colorOverrides = EMPTY_COLOR_OVERRIDES
  } = args

  // Probe caches. Each map<dir, result> grows as the async probes
  // complete; setState merges are idempotent (the result for a given
  // dir is stable across the session), so re-renders that arrive
  // mid-probe don't lose entries.
  const [gitResults, setGitResults] = useState<Map<string, GitProbeResult>>(() => new Map())
  const [markerResults, setMarkerResults] = useState<Map<string, boolean>>(() => new Map())
  // Ghost-pin fix — existence probe results for pinned roots only.
  // `deriveProjects` drops a pinned root whose folder was deleted
  // (exists === false); a markerless-but-existing pin still renders
  // (D12 "pin alone qualifies").
  const [pinnedExists, setPinnedExists] = useState<Map<string, boolean>>(() => new Map())
  // Track which probes are in-flight per probe-kind to avoid double-probing.
  const gitInFlightRef = useRef<Set<string>>(new Set())
  const markerInFlightRef = useRef<Set<string>>(new Set())
  const pinnedExistsInFlightRef = useRef<Set<string>>(new Set())

  // ── Async probe phase ──────────────────────────────────────────
  //
  // No cancel-on-cleanup: the setState merges are idempotent (each
  // key writes the same result on retry; both git-status and marker
  // results are stable for a given dir), so stale-closure resolutions
  // after re-render still produce a correct state. Cancelling on
  // every re-render dropped probes entirely and left the cache empty.
  useEffect(() => {
    const candidates = new Set<string>()
    for (const t of terminals) {
      if (t.cwd) for (const d of ancestors(t.cwd)) candidates.add(d)
    }
    for (const tab of workingTabs) {
      if (pinnedTabPaths.has(tab.path)) continue
      if (!tab.path) continue
      const lastSlash = tab.path.lastIndexOf('/')
      const dir = lastSlash > 0 ? tab.path.slice(0, lastSlash) : '/'
      for (const d of ancestors(dir)) candidates.add(d)
    }
    // Pinned project roots themselves need a probe: pinned tiles
    // survive zero open members, but they still need to be valid
    // projects (git root OR marker). Probing means a pin to a folder
    // that lost its marker since pin time silently drops from the
    // rail rather than rendering as a ghost.
    for (const root of pinnedProjects) candidates.add(root)

    const unprobedGit = [...candidates].filter(
      (d) => !gitResults.has(d) && !gitInFlightRef.current.has(d)
    )
    if (unprobedGit.length > 0) {
      for (const d of unprobedGit) gitInFlightRef.current.add(d)
      void Promise.all(
        unprobedGit.map(async (dir) => {
          try {
            const snap = await window.electron.git.status(dir)
            return [dir, { isRepo: snap.isRepo, workTreeRoot: snap.workTreeRoot }] as const
          } catch {
            return [dir, { isRepo: false }] as const
          }
        })
      ).then((entries) => {
        setGitResults((prev) => {
          const next = new Map(prev)
          for (const [k, v] of entries) {
            next.set(k, v)
            gitInFlightRef.current.delete(k)
          }
          return next
        })
      })
    }

    const unprobedMarker = [...candidates].filter(
      (d) => !markerResults.has(d) && !markerInFlightRef.current.has(d)
    )
    if (unprobedMarker.length > 0) {
      for (const d of unprobedMarker) markerInFlightRef.current.add(d)
      void Promise.all(
        unprobedMarker.map(async (dir) => {
          try {
            const result = await window.electron.projects.hasMarker(dir)
            return [dir, result] as const
          } catch {
            return [dir, false] as const
          }
        })
      ).then((entries) => {
        setMarkerResults((prev) => {
          const next = new Map(prev)
          for (const [k, v] of entries) {
            next.set(k, v)
            markerInFlightRef.current.delete(k)
          }
          return next
        })
      })
    }
  }, [terminals, workingTabs, pinnedTabPaths, pinnedProjects, gitResults, markerResults])

  // ── Pinned-root existence probe (ghost-pin fix) ─────────────────
  //
  // Only pinned roots can be ghosts: every non-pinned project has a
  // live terminal/tab cwd under it, so the folder provably exists.
  // Like the git/marker caches above, we never invalidate — a pin
  // deleted mid-session drops on the next relaunch (matches this
  // hook's documented caching contract; the owner can restart).
  useEffect(() => {
    const unprobed = [...pinnedProjects].filter(
      (d) => !pinnedExists.has(d) && !pinnedExistsInFlightRef.current.has(d)
    )
    if (unprobed.length === 0) return
    for (const d of unprobed) pinnedExistsInFlightRef.current.add(d)
    void Promise.all(
      unprobed.map(async (dir) => {
        try {
          return [dir, await window.electron.files.dirExists(dir)] as const
        } catch {
          // Probe unreachable — assume the folder exists so a transient
          // IPC error never drops a pin.
          return [dir, true] as const
        }
      })
    ).then((entries) => {
      setPinnedExists((prev) => {
        const next = new Map(prev)
        for (const [k, v] of entries) {
          next.set(k, v)
          pinnedExistsInFlightRef.current.delete(k)
        }
        return next
      })
    })
  }, [pinnedProjects, pinnedExists])

  // ── Pure derivation ────────────────────────────────────────────
  const result = useMemo<DeriveProjectsOutput>(() => {
    return deriveProjects({
      terminals,
      workingTabs,
      pinnedTabPaths,
      pinnedProjects,
      colorOverrides,
      qualify: (dir: string) => {
        if (isExcludedFromQualification(dir, HOME_DIR)) {
          return { isGitRoot: false, hasMarker: false }
        }
        const git = gitResults.get(dir)
        const isGitRoot = !!(git?.isRepo && git.workTreeRoot === dir)
        const hasMarker = markerResults.get(dir) === true
        // `exists` is only meaningful for pinned roots; undefined for
        // everything else (deriveProjects only consults it for pins).
        const exists = pinnedExists.has(dir) ? pinnedExists.get(dir) : undefined
        return { isGitRoot, hasMarker, exists }
      }
    })
  }, [terminals, workingTabs, pinnedTabPaths, pinnedProjects, colorOverrides, gitResults, markerResults, pinnedExists])

  return result
}
