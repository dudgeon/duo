// ENH-210 — per-terminal-tab worktree badge.
//
// For each terminal tab, probe git status of its cwd and surface a
// badge ONLY when the cwd resolves into a LINKED worktree (not the
// repo's main checkout — main stays unbadged, per the D3-B decision:
// color is the worktree differentiator, main is the unmarked baseline).
//
// Keyed by cwd (tabs sharing a cwd share a badge). Probes run on the
// unique cwd set, refresh on window focus + whenever the cwd set
// changes. All git work happens in the main process via the existing
// `git.status` IPC — the renderer just consumes the snapshot.

import { useEffect, useMemo, useState } from 'react'
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

export function useWorktreeBadges(tabs: TabSession[]): Map<string, WorktreeBadge> {
  const [badges, setBadges] = useState<Map<string, WorktreeBadge>>(new Map())

  // Stable dependency: the sorted unique cwd set. Reorders / title
  // changes / active-tab flips don't re-probe; only a new/removed cwd
  // does.
  const cwdKey = useMemo(
    () => [...new Set(tabs.map((t) => t.cwd))].sort().join('\n'),
    [tabs]
  )

  useEffect(() => {
    let cancelled = false
    const probe = async () => {
      const uniqueCwds = cwdKey ? cwdKey.split('\n') : []
      const next = new Map<string, WorktreeBadge>()
      await Promise.all(
        uniqueCwds.map(async (cwd) => {
          try {
            const snap = await window.electron.git.status(cwd)
            if (snap.isRepo && snap.isLinkedWorktree && snap.workTreeRoot) {
              next.set(cwd, {
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
  }, [cwdKey])

  return badges
}
