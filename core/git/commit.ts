// ENH-224 Phase 2 — stage + commit the diverged file(s) (P6).
//
// Relies on the user's git identity (global config / the gh setup — D9). When
// identity is unset, git's own error surfaces (committed:false, ok:false).

import { execGit } from './exec'

export interface CommitResult {
  ok: boolean
  /** False (with ok:true) when there was nothing to commit — a clean no-op, not
   *  a failure. */
  committed: boolean
  error?: string
}

/**
 * Stage `paths` (repo-relative) — or everything when omitted — then commit with
 * `message`. "nothing to commit" is treated as a successful no-op.
 */
export async function runStageAndCommit(
  cwd: string,
  opts: { message: string; paths?: string[] }
): Promise<CommitResult> {
  const add = opts.paths && opts.paths.length
    ? await execGit('git', ['add', '--', ...opts.paths], { cwd })
    : await execGit('git', ['add', '-A'], { cwd })
  if (!add.ok) return { ok: false, committed: false, error: add.stderr.trim() || 'git add failed' }

  const commit = await execGit('git', ['commit', '-m', opts.message], { cwd })
  if (commit.ok) return { ok: true, committed: true }

  if (/nothing to commit/i.test(commit.stdout + '\n' + commit.stderr)) {
    return { ok: true, committed: false }
  }
  return {
    ok: false,
    committed: false,
    error: commit.stderr.trim() || commit.stdout.trim() || 'git commit failed',
  }
}
