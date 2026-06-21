// ENH-224 Phase 2 — push-access probe + auto-fork (D3).
//
// "Auto-fork, then cross-fork PR" when the user lacks push access; branch on
// origin when they have it. Fully opaque to the user.

import { execGit } from './exec'

export interface PushAccess {
  canPush: boolean
  /** The raw `viewerPermission` (READ / TRIAGE / WRITE / MAINTAIN / ADMIN). */
  viewerPermission?: string
}

/** WRITE / MAINTAIN / ADMIN ⇒ the user can push to origin (no fork needed).
 *  READ / TRIAGE (or unknown) ⇒ fork. Pure. */
export function permissionAllowsPush(perm: string | undefined | null): boolean {
  if (!perm) return false
  return ['WRITE', 'MAINTAIN', 'ADMIN'].includes(perm.toUpperCase())
}

/** Probe whether the user can push to `owner/repo` via
 *  `gh repo view --json viewerPermission`. Thin. */
export async function probePushAccess(owner: string, repo: string, cwd?: string): Promise<PushAccess> {
  const res = await execGit('gh', ['repo', 'view', `${owner}/${repo}`, '--json', 'viewerPermission'], { cwd })
  if (!res.ok) return { canPush: false }
  try {
    const json = JSON.parse(res.stdout) as { viewerPermission?: string }
    return { canPush: permissionAllowsPush(json.viewerPermission), viewerPermission: json.viewerPermission }
  } catch {
    return { canPush: false }
  }
}

export interface ForkResult {
  ok: boolean
  /** The fork owner (the gh user's login) — used to build the push URL + the
   *  cross-fork PR head (`<forkOwner>:<branch>`). */
  forkOwner?: string
  error?: string
}

/**
 * Auto-fork `owner/repo` to the user's account WITHOUT cloning or touching the
 * checkout's origin remote (D3). `gh repo fork` is idempotent — re-running when
 * the fork already exists succeeds. Returns the fork owner (= gh login).
 */
export async function runFork(owner: string, repo: string, cwd: string): Promise<ForkResult> {
  const fork = await execGit(
    'gh',
    ['repo', 'fork', `${owner}/${repo}`, '--clone=false', '--remote=false'],
    { cwd, timeoutMs: 60_000 }
  )
  if (!fork.ok) {
    return { ok: false, error: fork.stderr.trim() || 'gh repo fork failed' }
  }
  // The fork owner is the gh user's login.
  const who = await execGit('gh', ['api', 'user', '--jq', '.login'], { cwd })
  const forkOwner = who.ok ? who.stdout.trim() : ''
  if (!forkOwner) return { ok: false, error: 'could not resolve fork owner (gh api user)' }
  return { ok: true, forkOwner }
}
