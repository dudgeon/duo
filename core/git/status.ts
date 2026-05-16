// ENH-152a — Navigator git status probe.
//
// Reads the git status for a directory and returns a structured
// snapshot the renderer can paint as a root-chip ("main · 2 ahead",
// "main · modified", "main · clean").
//
// Owner directive: **clean stays invisible**. Callers should not
// render a chip when isRepo === false or when dirty === false &&
// ahead === 0 && behind === 0. The probe still returns the full
// snapshot — display gating is the renderer's job, not the probe's.
//
// GitStatusSnapshot is shared with the renderer via shared/host-api.ts.
// formatGitStatusChip (the pure formatter the renderer reaches for)
// also lives there.

import { execGit } from './exec'
import type { GitStatusSnapshot } from '../../shared/host-api'

export type { GitStatusSnapshot } from '../../shared/host-api'
export { formatGitStatusChip } from '../../shared/host-api'

const NOT_REPO: GitStatusSnapshot = {
  isRepo: false,
  branch: '',
  head: '',
  dirty: false,
  changedCount: 0,
  ahead: 0,
  behind: 0,
  reason: 'not-a-repo'
}

/**
 * Probe git status for a directory. Returns NOT_REPO (with appropriate
 * `reason`) for non-repo folders, missing git, or any git error —
 * never throws. The caller treats `isRepo === false` as the
 * no-chip-to-render signal.
 */
export async function getGitStatus(cwd: string): Promise<GitStatusSnapshot> {
  // First gate — is this a repo at all? rev-parse --show-toplevel
  // exits 0 + prints the work-tree root when yes, exits 128 with a
  // "not a git repository" stderr when no.
  const rootRes = await execGit('git', ['rev-parse', '--show-toplevel'], { cwd })
  if (rootRes.notFound) return { ...NOT_REPO, reason: 'git-not-found' }
  if (!rootRes.ok) return NOT_REPO
  const workTreeRoot = rootRes.stdout.trim()
  if (!workTreeRoot) return NOT_REPO

  // Branch + short HEAD SHA. rev-parse --abbrev-ref HEAD prints
  // "HEAD" (literal) in detached state; we map that to empty string
  // so the renderer can fall back to the short SHA.
  const branchRes = await execGit('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
  const branchRaw = branchRes.ok ? branchRes.stdout.trim() : ''
  const branch = branchRaw === 'HEAD' ? '' : branchRaw

  const headRes = await execGit('git', ['rev-parse', '--short', 'HEAD'], { cwd })
  const head = headRes.ok ? headRes.stdout.trim() : ''

  // Dirty + changed-count. --porcelain outputs one line per changed
  // file (staged, unstaged, untracked).
  const statusRes = await execGit('git', ['status', '--porcelain'], { cwd })
  const lines = statusRes.ok
    ? statusRes.stdout.split('\n').filter((l) => l.length > 0)
    : []
  const dirty = lines.length > 0
  const changedCount = lines.length

  // Ahead/behind vs upstream tracking branch. rev-list --left-right
  // --count @{upstream}...HEAD prints "<behind> <ahead>" tab-
  // separated when an upstream is set; exits non-zero when no
  // upstream is configured (a fresh `main` with no remote tracker,
  // for example). Non-zero is fine — we just report 0/0.
  let ahead = 0
  let behind = 0
  const aheadBehindRes = await execGit(
    'git',
    ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
    { cwd }
  )
  if (aheadBehindRes.ok) {
    const parts = aheadBehindRes.stdout.trim().split(/\s+/)
    if (parts.length === 2) {
      behind = Number.parseInt(parts[0], 10) || 0
      ahead = Number.parseInt(parts[1], 10) || 0
    }
  }

  return {
    isRepo: true,
    workTreeRoot,
    branch,
    head,
    dirty,
    changedCount,
    ahead,
    behind
  }
}

