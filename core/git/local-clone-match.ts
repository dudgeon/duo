// ENH-224 Phase 3 — already-local detection (D6).
//
// Before pulling a github-file into an opaque managed checkout, see if the user
// already has the repo cloned locally (a navigator project root). If so, we
// OFFER to open the file from THEIR clone (modality 1 — focus the folder)
// instead of making a redundant checkout. We only ever OFFER — never silently
// reuse — so we don't surprise-edit the user's real working tree / branch (D6).

import * as path from 'path'
import * as fssync from 'fs'
import { execGit } from './exec'
import { parseRemoteUrl } from './remote-url'
import type { LocalCloneMatch } from '../../shared/types'

// Canonical type home is shared/types.ts (renderer + preload share the IPC
// contract). Re-exported for core importers.
export type { LocalCloneMatch }

/** Does a `git remote get-url` value point at owner/repo? Pure. Case-insensitive
 *  on owner/repo (GitHub is); tolerant of https / ssh / git@ / .git-suffixed. */
export function remoteMatchesRepo(remoteUrl: string, owner: string, repo: string): boolean {
  const parsed = parseRemoteUrl(remoteUrl)
  if (!parsed) return false
  return (
    parsed.owner.toLowerCase() === owner.toLowerCase() &&
    parsed.repo.toLowerCase() === repo.toLowerCase()
  )
}

export interface MatchLocalCloneOpts {
  owner: string
  repo: string
  /** Repo-relative path of the file we want to open. */
  filePath: string
  /** Candidate work-tree roots (navigator project roots + local recents' dirs). */
  candidateRoots: string[]
}

/**
 * Find the first candidate root that is a clone of owner/repo AND actually
 * contains `filePath`. Reads each root's `origin` remote (git).
 *
 * NOTE (D6, by design): the URL's `ref` is intentionally NOT matched — we open
 * WHATEVER the user has at that path on their CURRENT branch (modality 1: their
 * tree, their git), which may differ from the URL's ref. The UI surfaces the
 * clone's branch (`branch` below) so the offer is informed; the share-back
 * footer is gated to managed checkouts, so opening here never proposes a PR.
 * The file-exists check only ensures the path is present (so we never open a
 * missing file) — when it's absent we fall back to the managed checkout.
 * Returns null when nothing matches.
 */
export async function matchLocalClone(opts: MatchLocalCloneOpts): Promise<LocalCloneMatch | null> {
  const { owner, repo, filePath, candidateRoots } = opts
  const seen = new Set<string>()
  for (const root of candidateRoots) {
    if (!root || seen.has(root)) continue
    seen.add(root)
    const remote = await execGit('git', ['remote', 'get-url', 'origin'], { cwd: root })
    if (!remote.ok || !remoteMatchesRepo(remote.stdout.trim(), owner, repo)) continue
    const fileAbsPath = path.join(root, filePath)
    if (!fssync.existsSync(fileAbsPath)) continue
    const cur = await execGit('git', ['branch', '--show-current'], { cwd: root })
    return { root, fileAbsPath, branch: cur.ok ? cur.stdout.trim() : '' }
  }
  return null
}
