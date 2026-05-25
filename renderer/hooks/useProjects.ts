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
}

export interface UseProjectsResult {
  projects: Project[]
  /** Phase 2 — terminalId → projectRoot (or null when no project). */
  terminalMembership: Record<string, string | null>
  /** Phase 2 — tabId → projectRoot (or null when no project). */
  tabMembership: Record<string, string | null>
}

export function useProjects(args: UseProjectsArgs): UseProjectsResult {
  const { terminals, workingTabs, pinnedTabPaths } = args

  // Probe caches. Each map<dir, result> grows as the async probes
  // complete; setState merges are idempotent (the result for a given
  // dir is stable across the session), so re-renders that arrive
  // mid-probe don't lose entries.
  const [gitResults, setGitResults] = useState<Map<string, GitProbeResult>>(() => new Map())
  const [markerResults, setMarkerResults] = useState<Map<string, boolean>>(() => new Map())
  // Track which probes are in-flight per probe-kind to avoid double-probing.
  const gitInFlightRef = useRef<Set<string>>(new Set())
  const markerInFlightRef = useRef<Set<string>>(new Set())

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
  }, [terminals, workingTabs, pinnedTabPaths, gitResults, markerResults])

  // ── Pure derivation ────────────────────────────────────────────
  const result = useMemo<DeriveProjectsOutput>(() => {
    return deriveProjects({
      terminals,
      workingTabs,
      pinnedTabPaths,
      // Phase 1: persisted pins + overrides deferred. The rail
      // renders auto-tiles only; the right-click menu (D12) and the
      // settings UI (R2) for overrides come in Phase 3 + 4.
      pinnedProjects: new Set<string>(),
      colorOverrides: {},
      qualify: (dir: string) => {
        if (isExcludedFromQualification(dir, HOME_DIR)) {
          return { isGitRoot: false, hasMarker: false }
        }
        const git = gitResults.get(dir)
        const isGitRoot = !!(git?.isRepo && git.workTreeRoot === dir)
        const hasMarker = markerResults.get(dir) === true
        return { isGitRoot, hasMarker }
      }
    })
  }, [terminals, workingTabs, pinnedTabPaths, gitResults, markerResults])

  return result
}
