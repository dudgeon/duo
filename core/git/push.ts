// ENH-224 Phase 2 — push the share-back branch (P6).
//
// `remote` is either 'origin' (the user has push access) or a raw fork URL
// (cross-fork, D3 — pushing to a URL needs no named remote and rides gh's
// git credential helper). No upstream tracking is set: PR state is queried
// LIVE (§12), never via @{u}.

import { execGit } from './exec'
import { looksLikeAuthFailure } from './failure-sniff'

export interface PushOpts {
  /** 'origin', or a full https://github.com/<forkOwner>/<repo>.git URL. */
  remote: string
  branch: string
  /** Allow non-fast-forward (re-push after rebase). Uses --force-with-lease. */
  force?: boolean
}

export interface PushResult {
  ok: boolean
  error?: string
  errorKind?: 'auth-missing' | 'push-failed'
}

/** The `git push` args. Pure + exported for unit testing without spawning. */
export function pushArgs(opts: PushOpts): string[] {
  const args = ['push']
  if (opts.force) args.push('--force-with-lease')
  args.push(opts.remote, opts.branch)
  return args
}

export async function runPush(cwd: string, opts: PushOpts): Promise<PushResult> {
  const res = await execGit('git', pushArgs(opts), { cwd, timeoutMs: 120_000 })
  if (res.ok) return { ok: true }
  if (looksLikeAuthFailure(res.stderr)) {
    return { ok: false, errorKind: 'auth-missing', error: res.stderr.trim() }
  }
  return { ok: false, errorKind: 'push-failed', error: res.stderr.trim() || 'git push failed' }
}
