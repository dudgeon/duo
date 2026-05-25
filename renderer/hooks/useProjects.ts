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
  type DeriveProjectsOutput
} from '@shared/projects'
import type { Project } from '@shared/types'

/** Paths that must NEVER qualify as projects, even when they have a
 *  `.claude/` directory or `CLAUDE.md` file. The user's home dir
 *  holds the global Claude Code config (`~/.claude/`), which is NOT
 *  a project marker — qualifying it would make every random tmp/...
 *  cwd render as "geoffreydudgeon" in the rail. Root is excluded
 *  defensively; tmp dirs are a v2 concern. */
function isExcludedFromQualification(dir: string): boolean {
  if (dir === '/') return true
  // Home dir — match against the env-derived path (works under any
  // username). HOME is set in all Electron contexts.
  const home = typeof process !== 'undefined' ? process.env?.HOME : undefined
  if (home && dir === home) return true
  // Fallback for renderer (no process.env). The user's home pattern
  // on macOS is /Users/<name> — exclude the two-segment path to
  // catch the case where process.env.HOME isn't injected.
  if (/^\/Users\/[^/]+\/?$/.test(dir)) return true
  return false
}

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
  /** Navigator listings keyed by absolute folder path. Used to detect
   *  `hasMarker` (CLAUDE.md / .claude/) without a new IPC — the same
   *  data the navigator already has. Folders the navigator hasn't
   *  scanned won't surface their markers; tabs/terminals in those
   *  folders will still qualify if they're git roots.
   *
   *  Accepts both `Map<string, DirEntry[]|null>` (the navigator's
   *  native shape) and the equivalent `Record<>` form for tests. */
  navListings:
    | ReadonlyMap<string, ReadonlyArray<{ name: string; kind: 'file' | 'directory' }> | null>
    | Record<string, ReadonlyArray<{ name: string; kind: 'file' | 'directory' }>>
}

export interface UseProjectsResult {
  projects: Project[]
  /** Phase 2 — terminalId → projectRoot (or null when no project). */
  terminalMembership: Record<string, string | null>
  /** Phase 2 — tabId → projectRoot (or null when no project). */
  tabMembership: Record<string, string | null>
}

export function useProjects(args: UseProjectsArgs): UseProjectsResult {
  const { terminals, workingTabs, pinnedTabPaths, navListings } = args

  // Probe cache. Map<dir, isGit-result>; entries are added as the
  // background probe completes. Lives in useRef so the dependency
  // array of the useMemo doesn't churn on every keystroke.
  const [gitResults, setGitResults] = useState<Map<string, GitProbeResult>>(() => new Map())
  // Track which probes are in-flight to avoid double-probing.
  const inFlightRef = useRef<Set<string>>(new Set())

  // ── Async probe phase ──────────────────────────────────────────
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

    const unprobed = [...candidates].filter(
      (d) => !gitResults.has(d) && !inFlightRef.current.has(d)
    )
    if (unprobed.length === 0) return

    for (const d of unprobed) inFlightRef.current.add(d)
    // No cancel-on-cleanup: the `setGitResults` merge is idempotent
    // (each key writes the same result on retry; git-status of a dir
    // is stable), so a stale-closure resolution after re-render still
    // produces a correct state — it just adds the entries that
    // would've been added anyway. Cancelling on re-render bit us
    // before: every render dropped the in-flight probe and the cache
    // stayed empty forever.
    void Promise.all(
      unprobed.map(async (dir) => {
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
          inFlightRef.current.delete(k)
        }
        return next
      })
    })
  }, [terminals, workingTabs, pinnedTabPaths, gitResults])

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
        if (isExcludedFromQualification(dir)) {
          return { isGitRoot: false, hasMarker: false }
        }
        const git = gitResults.get(dir)
        const isGitRoot = !!(git?.isRepo && git.workTreeRoot === dir)
        type Entry = { name: string; kind: 'file' | 'directory' }
        const listing: ReadonlyArray<Entry> | null | undefined =
          navListings instanceof Map
            ? (navListings.get(dir) as ReadonlyArray<Entry> | null | undefined)
            : (navListings as Record<string, ReadonlyArray<Entry>>)[dir]
        const hasMarker = !!(
          listing &&
          listing.some(
            (e: Entry) =>
              (e.name === 'CLAUDE.md' && e.kind === 'file') ||
              (e.name === '.claude' && e.kind === 'directory')
          )
        )
        return { isGitRoot, hasMarker }
      }
    })
  }, [terminals, workingTabs, pinnedTabPaths, gitResults, navListings])

  return result
}
