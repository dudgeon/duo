// ENH-210 — per-surface worktree badge.
//
// Surfaces a badge ONLY when a directory resolves into a LINKED worktree
// (not the repo's main checkout — main stays unbadged, per the D3-B
// decision: color is the worktree differentiator, main is the unmarked
// baseline). All git work happens in the main process via the existing
// `git.status` IPC — the renderer just consumes the snapshot. Probes the
// unique dir set, refresh on window focus + whenever the set changes.
//
// Two consumers with DIFFERENT keys share the core:
//   - terminal tabs (TabBar) key by tab.cwd        → useWorktreeBadges(tabs)
//   - working-pane file tabs key by dirname(path)  → useWorktreeBadgesForDirs(dirs)
// The dir-keyed core is the single git-probe/dedup/focus-refresh impl; the
// tabs form is a thin wrapper so the terminal call site stays unchanged.

import { useEffect, useState } from 'react'
import type { TabSession } from '@shared/types'
import { hashColorIndex } from '@shared/projects'

export interface WorktreeBadge {
  /** Always true for entries that exist (main checkouts are absent). */
  isLinkedWorktree: true
  /** Repo display name (basename of the main worktree), e.g. 'duo'. */
  repoName: string
  /** Branch name (may itself be a codename for agent worktrees). */
  branch: string
  /** Hash-stable hue index (shared/projects palette) for this checkout. */
  colorIndex: number
}

/**
 * Core: a badge per directory. Probes `git.status(dir)` for each unique
 * dir and keeps only LINKED-worktree results. Returns a Map keyed by the
 * dir string. Re-probes when the (sorted, deduped) dir set changes or the
 * window regains focus.
 */
export function useWorktreeBadgesForDirs(dirs: string[]): Map<string, WorktreeBadge> {
  const [badges, setBadges] = useState<Map<string, WorktreeBadge>>(new Map())

  // Stable, content-derived key — callers pass a fresh array each render,
  // so we depend on the joined string, not the array identity.
  const key = [...new Set(dirs.filter(Boolean))].sort().join('\n')

  useEffect(() => {
    let cancelled = false
    const probe = async () => {
      const uniqueDirs = key ? key.split('\n') : []
      const next = new Map<string, WorktreeBadge>()
      await Promise.all(
        uniqueDirs.map(async (dir) => {
          try {
            const snap = await window.electron.git.status(dir)
            if (snap.isRepo && snap.isLinkedWorktree && snap.workTreeRoot) {
              next.set(dir, {
                isLinkedWorktree: true,
                repoName: snap.repoName ?? '',
                branch: snap.branch ?? '',
                colorIndex: hashColorIndex(snap.workTreeRoot)
              })
            }
          } catch {
            /* non-repo / git error → no badge */
          }
        })
      )
      if (!cancelled) setBadges(next)
    }
    void probe()
    const onFocus = () => { void probe() }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [key])

  return badges
}

/** Terminal-tab form: keyed by `tab.cwd`. Thin wrapper over the dir-keyed
 *  core so the TabBar call site (`badges.get(tab.cwd)`) is unchanged. */
export function useWorktreeBadges(tabs: TabSession[]): Map<string, WorktreeBadge> {
  return useWorktreeBadgesForDirs(tabs.map((t) => t.cwd))
}
