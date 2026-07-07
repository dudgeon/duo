// ENH-253 — `duo pull` / the navigator "Pull latest changes" context-menu
// item on any git repo root.
//
// Fetches the remote, then applies the safest update it can without ever
// silently discarding anything:
//   - clean tree, nothing local ahead of the remote → fast-forward.
//   - clean tree, local commits not yet on the remote → merge (auto-merge
//     only; a real conflict aborts immediately and reports back — no
//     partial/conflicted state is ever left on disk).
//   - uncommitted local changes (TRACKED modifications only — untracked
//     files survive a `git reset --hard`, so they don't count) → refuses
//     and reports what's at risk (errorKind: 'needs-confirmation'); the
//     caller re-runs with `force: true` to discard them and take the
//     remote's version instead. This is the one destructive path in the
//     module — everything else is conflict-free by construction. A forced
//     call can pass `expected` (the counts the user consented to); if the
//     tree grew riskier in the meantime, the force is refused with a fresh
//     'needs-confirmation' instead of discarding more than was shown.
//
// Probe failures fail CLOSED: a failed `git status` / `git rev-list` is a
// 'pull-failed' error, never treated as "clean" / "up to date".
//
// Never throws; mirrors core/git/push.ts's structured-result convention.

import { execGit } from './exec'
import { looksLikeAuthFailure } from './failure-sniff'
import { probeWorkingTree, probeAheadBehind } from './status'

// Mutating git ops (merge / reset) can legitimately take a while on big
// repos or slow disks — give them a generous ceiling. Network fetch keeps
// a tighter one.
const FETCH_TIMEOUT_MS = 60_000
const MUTATE_TIMEOUT_MS = 300_000

export interface PullOptions {
  /** Discard uncommitted changes and any local commits not yet on the
   *  remote, hard-resetting to match it exactly. Only meaningful as a
   *  follow-up call after a prior `runPull` returned errorKind
   *  'needs-confirmation' — the caller is expected to have shown the user
   *  what's at risk (via `changedCount` / `aheadCount`) and gotten explicit
   *  confirmation before setting this. */
  force?: boolean
  /** With `force: true` — the counts the user actually consented to (from
   *  the prior 'needs-confirmation' result). If the freshly re-derived
   *  counts are HIGHER (more would be discarded than was shown), the force
   *  is refused and a fresh 'needs-confirmation' is returned instead. */
  expected?: { changedCount: number; aheadCount: number }
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
  changedCount?: number
  aheadCount?: number
  behindCount?: number
}

/** A real content conflict (vs. index.lock, hooks, untracked-would-be-
 *  overwritten, …) — git prints these markers on genuine merge conflicts. */
function looksLikeMergeConflict(output: string): boolean {
  return /CONFLICT|Automatic merge failed/i.test(output)
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

  const fetchRes = await execGit('git', ['fetch'], { cwd, timeoutMs: FETCH_TIMEOUT_MS })
  if (!fetchRes.ok) {
    if (looksLikeAuthFailure(fetchRes.stderr)) {
      return { ok: false, errorKind: 'auth-missing', error: fetchRes.stderr.trim() || 'Authentication required.', branch }
    }
    return { ok: false, errorKind: 'pull-failed', error: fetchRes.stderr.trim() || 'git fetch failed', branch }
  }

  // Common-path fast exit: check ahead/behind FIRST — when we're not behind
  // there is nothing to pull and no reason to pay for `git status`. A probe
  // failure fails CLOSED (never silently reported as up-to-date).
  const ab = await probeAheadBehind(cwd)
  if (!ab.ok) {
    return { ok: false, errorKind: 'pull-failed', error: ab.error, branch }
  }
  const { ahead, behind } = ab

  if (behind === 0) {
    return { ok: true, result: 'up-to-date', commitsApplied: 0, branch }
  }

  const tree = await probeWorkingTree(cwd)
  if (!tree.ok) {
    return { ok: false, errorKind: 'pull-failed', error: tree.error, branch }
  }
  // Only TRACKED modifications count — `git reset --hard` leaves untracked
  // files alone, so "pulling will discard them" would be false for '??'.
  const changedCount = tree.counts.tracked
  const dirty = changedCount > 0

  if (dirty) {
    const needsConfirmation: PullResult = {
      ok: false,
      errorKind: 'needs-confirmation',
      changedCount,
      aheadCount: ahead,
      behindCount: behind,
      branch
    }
    if (!opts.force) return needsConfirmation
    // TOCTOU guard — a forced call re-derives the counts; if MORE is now
    // at risk than the user was shown, refuse and re-confirm.
    if (opts.expected &&
      (changedCount > opts.expected.changedCount || ahead > opts.expected.aheadCount)) {
      return needsConfirmation
    }
    const resetRes = await execGit('git', ['reset', '--hard', '@{upstream}'], { cwd, timeoutMs: MUTATE_TIMEOUT_MS })
    if (!resetRes.ok) {
      return { ok: false, errorKind: 'pull-failed', error: resetRes.stderr.trim() || 'git reset --hard failed', branch }
    }
    return { ok: true, result: 'discarded-and-pulled', commitsApplied: behind, branch }
  }

  if (ahead === 0) {
    const ffRes = await execGit('git', ['merge', '--ff-only', '@{upstream}'], { cwd, timeoutMs: MUTATE_TIMEOUT_MS })
    if (!ffRes.ok) {
      return { ok: false, errorKind: 'pull-failed', error: ffRes.stderr.trim() || 'git merge --ff-only failed', branch }
    }
    return { ok: true, result: 'fast-forwarded', commitsApplied: behind, branch }
  }

  // Clean tree, diverged history (local commits not on the remote yet) —
  // try a real merge. A genuine content conflict aborts immediately rather
  // than leaving conflict markers for a non-technical user to find. Other
  // merge failures (index.lock, hooks, untracked-would-be-overwritten, …)
  // are NOT conflicts — report them as 'pull-failed' with git's own words.
  const mergeRes = await execGit('git', ['merge', '--no-edit', '@{upstream}'], { cwd, timeoutMs: MUTATE_TIMEOUT_MS })
  if (!mergeRes.ok) {
    const mergeOutput = `${mergeRes.stderr}\n${mergeRes.stdout}`.trim()
    // Best-effort cleanup. Many non-conflict failures never start a merge,
    // so "no merge to abort" is an expected (fine) abort outcome.
    const abortRes = await execGit('git', ['merge', '--abort'], { cwd })
    const abortOk = abortRes.ok || /no merge to abort/i.test(abortRes.stderr)
    const abortNote = abortOk
      ? ' Nothing was changed.'
      : ` Warning: cleaning up the aborted merge also failed (${abortRes.stderr.trim() || 'unknown error'}) — the repo may be left mid-merge.`
    if (looksLikeMergeConflict(mergeOutput)) {
      return {
        ok: false,
        errorKind: 'merge-conflict',
        error: `Pulling would create conflicting changes that need manual resolution.${abortNote}`,
        branch
      }
    }
    return {
      ok: false,
      errorKind: 'pull-failed',
      error: `${mergeOutput || 'git merge failed'}${abortOk ? '' : abortNote}`,
      branch
    }
  }
  return { ok: true, result: 'merged', commitsApplied: behind, branch }
}
