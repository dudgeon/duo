// ENH-224 Phase 2 — divergence tracking (P5).
//
// "Save = local; Propose changes appears when the working file diverges from
// the fetched baseline" (D2). The managed checkout is a real git repo, so the
// divergence signal is just its working-tree status — computed LIVE, never
// mirrored (§12). Uncommitted edits vs HEAD (== the baseline right after a
// fresh clone) ARE the divergence; the post-PR "Update PR" state (D13) is
// driven separately by the live PR query, not by this.

import { execGit } from './exec'
import type { DivergenceState } from '../../shared/types'

/**
 * Parse `git status --porcelain` output → the repo-relative paths that changed
 * (staged or unstaged). Pure. Handles rename arrows (`old -> new` → new) and
 * core.quotepath-quoted paths. Unit-testable without a repo.
 */
export function parsePorcelain(stdout: string): string[] {
  const files: string[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    // Porcelain v1: cols 0-1 are the XY status, col 2 a space, col 3+ the path.
    let p = line.length > 3 ? line.slice(3) : line.trim()
    const arrow = p.indexOf(' -> ')
    if (arrow >= 0) p = p.slice(arrow + 4) // a rename reports old -> new; take new
    p = p.trim().replace(/^"(.*)"$/, '$1') // unquote quotepath output
    if (p) files.push(p)
  }
  return files
}

/**
 * Probe the checkout's working-tree divergence from the baseline. Thin wrapper
 * over `git status --porcelain`; any git error (not a repo, etc.) reports
 * not-diverged rather than throwing — the affordance must never crash an open.
 */
export async function probeDivergence(checkoutDir: string): Promise<DivergenceState> {
  const res = await execGit('git', ['status', '--porcelain'], { cwd: checkoutDir })
  if (!res.ok) return { diverged: false, changedFiles: [] }
  const changedFiles = parsePorcelain(res.stdout)
  return { diverged: changedFiles.length > 0, changedFiles }
}
