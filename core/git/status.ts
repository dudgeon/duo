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
import { resolveWorktreeIdentity } from './worktree'
import type { GitStatusSnapshot } from '../../shared/host-api'

export type { GitStatusSnapshot } from '../../shared/host-api'
export { formatGitStatusChip } from '../../shared/host-api'

// ---------------------------------------------------------------------------
// Shared probe helpers (ENH-253 review) — pull.ts reuses these so there is
// exactly ONE porcelain parser / ahead-behind reader in the codebase. Unlike
// getGitStatus (a display probe that deliberately fails OPEN to "no chip"),
// these report failure explicitly so mutating callers can fail CLOSED.
// ---------------------------------------------------------------------------

export interface PorcelainCounts {
  /** Every changed line — staged, unstaged, AND untracked ('??'). */
  total: number
  /** Tracked modifications only — what `git reset --hard` would discard.
   *  Untracked ('??') files survive a hard reset, so destructive-pull
   *  messaging must count only these. */
  tracked: number
}

/** The one porcelain parser. Pure. */
export function parsePorcelainCounts(stdout: string): PorcelainCounts {
  const lines = stdout.split('\n').filter((l) => l.length > 0)
  return {
    total: lines.length,
    tracked: lines.filter((l) => !l.startsWith('??')).length
  }
}

export type ProbeResult<T> = ({ ok: true } & T) | { ok: false; error: string }

/** `git status --porcelain` → counts. Failure is reported, never masked as
 *  "clean" — callers decide whether to fail open (chip) or closed (pull). */
export async function probeWorkingTree(cwd: string): Promise<ProbeResult<{ counts: PorcelainCounts }>> {
  const res = await execGit('git', ['status', '--porcelain'], { cwd })
  if (!res.ok) return { ok: false, error: res.stderr.trim() || 'git status failed' }
  return { ok: true, counts: parsePorcelainCounts(res.stdout) }
}

/** `git rev-list --left-right --count @{upstream}...HEAD` → { ahead, behind }.
 *  Failure (including "no upstream configured") is reported, never masked as
 *  0/0 — callers decide whether to fail open (chip) or closed (pull). */
export async function probeAheadBehind(cwd: string): Promise<ProbeResult<{ ahead: number; behind: number }>> {
  const res = await execGit('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd })
  if (!res.ok) return { ok: false, error: res.stderr.trim() || 'git rev-list failed' }
  const parts = res.stdout.trim().split(/\s+/)
  if (parts.length !== 2) return { ok: false, error: `unexpected rev-list output: ${res.stdout.trim()}` }
  return {
    ok: true,
    behind: Number.parseInt(parts[0], 10) || 0,
    ahead: Number.parseInt(parts[1], 10) || 0
  }
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
  // file (staged, unstaged, untracked). Display probe → fail OPEN
  // (a status failure paints "clean", i.e. no chip).
  const treeProbe = await probeWorkingTree(cwd)
  const changedCount = treeProbe.ok ? treeProbe.counts.total : 0
  const dirty = changedCount > 0

  // Ahead/behind vs upstream tracking branch. probeAheadBehind exits
  // non-ok when no upstream is configured (a fresh `main` with no
  // remote tracker, for example). Fail OPEN here too — we just
  // report 0/0.
  const ab = await probeAheadBehind(cwd)
  const ahead = ab.ok ? ab.ahead : 0
  const behind = ab.ok ? ab.behind : 0

  // ENH-210 — worktree identity. One extra rev-parse; classifies this
  // checkout as the main worktree vs. a linked one and resolves the
  // repo's main-worktree root + name (the terminal-tab chip identity).
  const wt = await resolveWorktreeIdentity(cwd)

  return {
    isRepo: true,
    workTreeRoot,
    branch,
    head,
    dirty,
    changedCount,
    ahead,
    behind,
    isLinkedWorktree: wt.isLinkedWorktree,
    mainWorktreeRoot: wt.mainWorktreeRoot || workTreeRoot,
    repoName: wt.repoName || undefined
  }
}

