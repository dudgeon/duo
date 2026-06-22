// ENH-224 Phase 2 — create/switch the share-back branch (P6).
//
// Thin wrapper over `git checkout -b`. Idempotent: if the branch already
// exists (a re-proposal from the same checkout — the "Update PR" path, D13),
// switch to it instead of erroring.

import { execGit } from './exec'

export interface BranchResult {
  ok: boolean
  /** True when a NEW branch was created; false when we switched to an existing
   *  one (or were already on it). */
  created?: boolean
  error?: string
}

export async function runCreateBranch(cwd: string, name: string): Promise<BranchResult> {
  if (!name.trim()) return { ok: false, error: 'branch name is required' }
  // ENH-224 security — opts.branch is agent-supplied; reject a name that could be
  // read as a git flag, or isn't a valid ref shape (no leading '-').
  if (name.startsWith('-') || !/^[\w][\w./+-]*$/.test(name)) {
    return { ok: false, error: `invalid branch name: ${name}` }
  }

  // Already on the target branch? (re-proposal, same session)
  const cur = await execGit('git', ['branch', '--show-current'], { cwd })
  if (cur.ok && cur.stdout.trim() === name) return { ok: true, created: false }

  // Try to create it.
  const create = await execGit('git', ['checkout', '-b', name], { cwd })
  if (create.ok) return { ok: true, created: true }

  // Exists already → switch to it (idempotent re-proposal).
  const switchTo = await execGit('git', ['checkout', name], { cwd })
  if (switchTo.ok) return { ok: true, created: false }

  return {
    ok: false,
    error: (create.stderr || switchTo.stderr).trim() || 'could not create or switch to branch',
  }
}
