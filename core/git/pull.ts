// ENH-253 — `duo pull` / the navigator "Pull latest changes" context-menu
// item on any git repo root.
//
// Fetches the remote, then applies the safest update it can without ever
// silently discarding anything:
//   - clean tree, nothing local ahead of the remote → fast-forward.
//   - clean tree, local commits not yet on the remote → merge (auto-merge
//     only; a real conflict aborts immediately and reports back — no
//     partial/conflicted state is ever left on disk).
//   - uncommitted local changes → refuses and reports what's at risk
//     (errorKind: 'needs-confirmation'); the caller re-runs with
//     `force: true` to discard them (`git reset --hard`) and take the
//     remote's version instead. This is the one destructive path in the
//     module — everything else is conflict-free by construction.
//
// Never throws; mirrors core/git/push.ts's structured-result convention.

import { execGit } from './exec'
import { looksLikeAuthFailure } from './failure-sniff'

export interface PullOptions {
  /** Discard uncommitted changes and any local commits not yet on the
   *  remote, hard-resetting to match it exactly. Only meaningful as a
   *  follow-up call after a prior `runPull` returned errorKind
   *  'needs-confirmation' — the caller is expected to have shown the user
   *  what's at risk (via `changedCount` / `aheadCount`) and gotten explicit
   *  confirmation before setting this. */
  force?: boolean
}

export interface PullResult {
  ok: boolean
  result?: 'up-to-date' | 'fast-forwarded' | 'merged' | 'discarded-and-pulled'
  /** New commits now on the branch (0 for 'up-to-date'). */
  commitsApplied?: number
  branch?: string
  errorKind?: 'not-a-repo' | 'no-upstream' | 'auth-missing' | 'needs-confirmation' | 'merge-conflict' | 'pull-failed'
  error?: string
  /** Present on errorKind 'needs-confirmation' — what `force: true` would discard. */
  dirty?: boolean
  changedCount?: number
  aheadCount?: number
  behindCount?: number
}

async function workingTreeStatus(cwd: string): Promise<{ dirty: boolean; changedCount: number }> {
  const res = await execGit('git', ['status', '--porcelain'], { cwd })
  const lines = res.ok ? res.stdout.split('\n').filter((l) => l.length > 0) : []
  return { dirty: lines.length > 0, changedCount: lines.length }
}

async function aheadBehindUpstream(cwd: string): Promise<{ ahead: number; behind: number }> {
  const res = await execGit('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd })
  if (!res.ok) return { ahead: 0, behind: 0 }
  const parts = res.stdout.trim().split(/\s+/)
  if (parts.length !== 2) return { ahead: 0, behind: 0 }
  return { behind: Number.parseInt(parts[0], 10) || 0, ahead: Number.parseInt(parts[1], 10) || 0 }
}

/**
 * Pull the latest changes for the repo rooted at (or containing) `cwd`.
 * See the module doc comment for the outcome/decision table. Never throws.
 */
export async function runPull(cwd: string, opts: PullOptions = {}): Promise<PullResult> {
  const rootRes = await execGit('git', ['rev-parse', '--show-toplevel'], { cwd })
  if (!rootRes.ok) {
    return { ok: false, errorKind: 'not-a-repo', error: 'Not inside a git repository.' }
  }

  const branchRes = await execGit('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
  const branch = branchRes.ok ? branchRes.stdout.trim() : ''

  const upstreamRes = await execGit('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], { cwd })
  if (!upstreamRes.ok) {
    return {
      ok: false,
      errorKind: 'no-upstream',
      error: `"${branch || 'HEAD'}" isn't tracking a remote branch, so there's nothing to pull from.`,
      branch
    }
  }

  const fetchRes = await execGit('git', ['fetch'], { cwd, timeoutMs: 60_000 })
  if (!fetchRes.ok) {
    if (looksLikeAuthFailure(fetchRes.stderr)) {
      return { ok: false, errorKind: 'auth-missing', error: fetchRes.stderr.trim() || 'Authentication required.', branch }
    }
    return { ok: false, errorKind: 'pull-failed', error: fetchRes.stderr.trim() || 'git fetch failed', branch }
  }

  const { dirty, changedCount } = await workingTreeStatus(cwd)
  const { ahead, behind } = await aheadBehindUpstream(cwd)

  if (behind === 0) {
    return { ok: true, result: 'up-to-date', commitsApplied: 0, branch }
  }

  if (dirty) {
    if (!opts.force) {
      return {
        ok: false,
        errorKind: 'needs-confirmation',
        dirty: true,
        changedCount,
        aheadCount: ahead,
        behindCount: behind,
        branch
      }
    }
    const resetRes = await execGit('git', ['reset', '--hard', '@{upstream}'], { cwd, timeoutMs: 30_000 })
    if (!resetRes.ok) {
      return { ok: false, errorKind: 'pull-failed', error: resetRes.stderr.trim() || 'git reset --hard failed', branch }
    }
    return { ok: true, result: 'discarded-and-pulled', commitsApplied: behind, branch }
  }

  if (ahead === 0) {
    const ffRes = await execGit('git', ['merge', '--ff-only', '@{upstream}'], { cwd, timeoutMs: 30_000 })
    if (!ffRes.ok) {
      return { ok: false, errorKind: 'pull-failed', error: ffRes.stderr.trim() || 'git merge --ff-only failed', branch }
    }
    return { ok: true, result: 'fast-forwarded', commitsApplied: behind, branch }
  }

  // Clean tree, diverged history (local commits not on the remote yet) —
  // try a real merge. A genuine content conflict aborts immediately rather
  // than leaving conflict markers for a non-technical user to find.
  const mergeRes = await execGit('git', ['merge', '--no-edit', '@{upstream}'], { cwd, timeoutMs: 30_000 })
  if (!mergeRes.ok) {
    await execGit('git', ['merge', '--abort'], { cwd })
    return {
      ok: false,
      errorKind: 'merge-conflict',
      error: 'Pulling would create conflicting changes that need manual resolution. Nothing was changed.',
      branch
    }
  }
  return { ok: true, result: 'merged', commitsApplied: behind, branch }
}
