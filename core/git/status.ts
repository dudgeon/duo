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

import { execGit } from './exec'

export interface GitStatusSnapshot {
  /** True if `cwd` (or any parent) is inside a git work tree. */
  isRepo: boolean
  /** Absolute path to the repo's work-tree root, when isRepo. */
  workTreeRoot?: string
  /** Current branch name (e.g. "main"). Empty string in detached-HEAD
   *  state — the renderer can show the short SHA instead via `head`. */
  branch: string
  /** Short SHA of HEAD. Always present when isRepo, including detached. */
  head: string
  /** True if `git status --porcelain` returned ANY lines (staged or
   *  unstaged, including untracked). Untracked-only counts as dirty
   *  per the chip's semantics: the renderer's "are there changes
   *  worth flagging?" signal. */
  dirty: boolean
  /** Number of files with staged/unstaged/untracked changes. Useful
   *  for the tooltip; the chip itself just shows `*` or "modified". */
  changedCount: number
  /** Number of commits HEAD is ahead of its upstream tracking branch.
   *  0 when no upstream is set or there's nothing to push. */
  ahead: number
  /** Number of commits HEAD is behind its upstream tracking branch.
   *  0 when no upstream is set or there's nothing to pull. */
  behind: number
  /** When isRepo === false: short reason ("not-a-repo", "git-not-
   *  found", "git-error"). Lets the caller distinguish "no git
   *  installed at all" from "this folder isn't a repo." */
  reason?: 'not-a-repo' | 'git-not-found' | 'git-error'
}

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

/**
 * Compose the chip's display string per owner directive: clean stays
 * invisible. Returns empty string when nothing's worth flagging;
 * caller renders the chip iff the result is non-empty.
 *
 * Examples (visible cases):
 *   "main · modified"            (dirty, no upstream divergence)
 *   "main · 2 ahead"             (clean, 2 commits unpushed)
 *   "main · 2 ahead, 3 behind"   (clean, divergent)
 *   "main · modified, 2 ahead"   (dirty + divergent)
 *   "abc1234 · modified"         (detached HEAD, dirty)
 */
export function formatGitStatusChip(snap: GitStatusSnapshot): string {
  if (!snap.isRepo) return ''
  if (!snap.dirty && snap.ahead === 0 && snap.behind === 0) return ''
  const ref = snap.branch || snap.head
  const parts: string[] = []
  if (snap.dirty) parts.push('modified')
  if (snap.ahead > 0) parts.push(`${snap.ahead} ahead`)
  if (snap.behind > 0) parts.push(`${snap.behind} behind`)
  return `${ref} · ${parts.join(', ')}`
}
