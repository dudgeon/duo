// ENH-210 — git worktree awareness.
//
// Two reads, both live (no cache, per CLAUDE.md rule 12 — worktree
// state is git's, not Duo's):
//
//   - resolveWorktreeIdentity(cwd): is this cwd a LINKED worktree or
//     the repo's main checkout? Returns the main-worktree root + repo
//     name so the terminal tab can show "duo ⎇ branch" instead of the
//     codename folder basename. Folded into getGitStatus (one extra
//     rev-parse, batched into the existing first-gate call).
//
//   - listWorktrees(cwd): the full sibling map (`git worktree list
//     --porcelain`), one WorktreeInfo per row, main first, current
//     flagged. Powers the navigator Worktrees section + `duo worktree
//     list`. Called on demand, NOT on every nav probe.
//
// Pure parsing + git shell-outs; never throws (mirrors getGitStatus).

import * as path from 'path'
import { execGit } from './exec'
import { hashColorIndex } from '../../shared/projects'
import type { WorktreeInfo } from '../../shared/host-api'

export type { WorktreeInfo } from '../../shared/host-api'

export interface WorktreeIdentity {
  /** True when `cwd` resolves into a linked (non-main) worktree. */
  isLinkedWorktree: boolean
  /** Absolute path of the repo's main worktree (dirname of the common
   *  gitdir). Empty string when the rev-parse failed. */
  mainWorktreeRoot: string
  /** Basename of `mainWorktreeRoot` — the repo's display name. */
  repoName: string
}

const EMPTY_IDENTITY: WorktreeIdentity = {
  isLinkedWorktree: false,
  mainWorktreeRoot: '',
  repoName: ''
}

/**
 * Derive `mainWorktreeRoot` from the common gitdir. A repo's common
 * gitdir is `<main>/.git` for the standard layout (so the main
 * worktree is its dirname), or a bare repo path (no `.git` suffix) for
 * a bare-repo layout (where there is no "main worktree" — we return
 * the bare dir itself so callers still get a stable repo anchor).
 */
function mainRootFromCommonDir(commonDir: string): string {
  const trimmed = commonDir.replace(/\/+$/, '')
  if (path.basename(trimmed) === '.git') return path.dirname(trimmed)
  return trimmed
}

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

/**
 * Classify `cwd` as a linked worktree vs. the main checkout, and
 * resolve the repo's main-worktree root + name. One git call:
 * `rev-parse --git-dir --git-common-dir`. A linked worktree's gitdir
 * is `<common>/worktrees/<id>`, which differs from the common gitdir;
 * the main worktree's gitdir IS the common gitdir.
 *
 * Never throws — returns EMPTY_IDENTITY on any non-repo / git error.
 */
export async function resolveWorktreeIdentity(cwd: string): Promise<WorktreeIdentity> {
  const res = await execGit(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'],
    { cwd }
  )
  if (!res.ok) return EMPTY_IDENTITY
  const lines = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return EMPTY_IDENTITY
  const gitDir = lines[0]
  const commonDir = lines[1]
  const mainWorktreeRoot = mainRootFromCommonDir(commonDir)
  return {
    isLinkedWorktree: gitDir !== commonDir,
    mainWorktreeRoot,
    repoName: basename(mainWorktreeRoot)
  }
}

/**
 * Parse `git worktree list --porcelain`. Each record is a blank-line-
 * separated block:
 *
 *   worktree /abs/path
 *   HEAD <sha>
 *   branch refs/heads/<name>      (absent when detached → `detached`)
 *   detached                      (present instead of `branch`)
 *   prunable <reason>             (present for stale entries)
 *
 * The FIRST record is always the repo's main worktree. `currentRoot`
 * (the queried cwd's resolved worktree root) flags `isCurrent`.
 */
export function parseWorktreePorcelain(stdout: string, currentRoot: string): WorktreeInfo[] {
  const blocks = stdout.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  const out: WorktreeInfo[] = []
  blocks.forEach((block, blockIdx) => {
    let wtPath = ''
    let head = ''
    let branch = ''
    let detached = false
    let prunable = false
    for (const line of block.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('worktree ')) wtPath = trimmed.slice('worktree '.length).trim()
      else if (trimmed.startsWith('HEAD ')) head = trimmed.slice('HEAD '.length).trim().slice(0, 7)
      else if (trimmed.startsWith('branch ')) {
        branch = trimmed.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
      } else if (trimmed === 'detached') detached = true
      else if (trimmed === 'prunable' || trimmed.startsWith('prunable ')) prunable = true
    }
    if (!wtPath) return
    const normalized = wtPath.replace(/\/+$/, '')
    out.push({
      path: normalized,
      branch,
      head,
      isMain: blockIdx === 0,
      isCurrent: normalized === currentRoot.replace(/\/+$/, ''),
      detached: detached || undefined,
      prunable: prunable || undefined,
      colorIndex: hashColorIndex(normalized)
    })
  })
  return out
}

/**
 * Per-worktree dirty + ahead/behind. Inlined here (rather than calling
 * getGitStatus) to avoid a circular import — status.ts already imports
 * resolveWorktreeIdentity from this module. Mirrors status.ts's two
 * probes. Never throws; returns zeros on error.
 */
async function worktreeStatus(wtPath: string): Promise<Pick<WorktreeInfo, 'dirty' | 'changedCount' | 'ahead' | 'behind'>> {
  const statusRes = await execGit('git', ['status', '--porcelain'], { cwd: wtPath })
  const lines = statusRes.ok ? statusRes.stdout.split('\n').filter((l) => l.length > 0) : []
  let ahead = 0
  let behind = 0
  const ab = await execGit('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd: wtPath })
  if (ab.ok) {
    const parts = ab.stdout.trim().split(/\s+/)
    if (parts.length === 2) {
      behind = Number.parseInt(parts[0], 10) || 0
      ahead = Number.parseInt(parts[1], 10) || 0
    }
  }
  return { dirty: lines.length > 0, changedCount: lines.length, ahead, behind }
}

/**
 * List every worktree of the repo `cwd` belongs to. Returns [] for
 * non-repos / git errors (never throws). Main worktree first; the
 * worktree containing `cwd` is flagged `isCurrent`.
 *
 * `opts.withStatus` (the navigator dropdown, D4) additionally probes
 * each worktree's dirty + ahead/behind — two extra git calls per
 * worktree, so it's opt-in: the CLI `duo worktree` stays a single
 * porcelain read.
 */
export async function listWorktrees(
  cwd: string,
  opts: { withStatus?: boolean } = {}
): Promise<WorktreeInfo[]> {
  const listRes = await execGit('git', ['worktree', 'list', '--porcelain'], { cwd })
  if (!listRes.ok) return []
  // Resolve which worktree the cwd is in so we can flag isCurrent.
  const topRes = await execGit('git', ['rev-parse', '--show-toplevel'], { cwd })
  const currentRoot = topRes.ok ? topRes.stdout.trim() : ''
  const worktrees = parseWorktreePorcelain(listRes.stdout, currentRoot)
  if (!opts.withStatus) return worktrees
  return Promise.all(
    worktrees.map(async (wt) => (wt.prunable ? wt : { ...wt, ...(await worktreeStatus(wt.path)) }))
  )
}
