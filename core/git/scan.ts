// ENH-152a v2 (peer-repos) + ENH-152b (per-file dirty status).
//
// scanReposIn: for a parent directory and a list of child names,
// returns a Map of {childName → GitStatusSnapshot} for the children
// that ARE themselves git repo roots. Used by the Navigator to render
// inline chips on peer-repo folder rows (the playground's § 1A "root
// visible" case — when `~/repos/` contains `duo/` + `other-repo/`,
// both are separate git roots and each gets its own inline chip).
//
// getDirtyFilesFor: returns a Map<absPath, FileDirtyStatus> for every
// dirty file in a given repo work-tree. Powers ENH-152b's per-file
// dirty dots with their STATUS-DIFF tooltips ("Modified · +24 / −7").
//
// Both functions defensively never throw — git failures + missing
// binary return empty maps, and callers treat empty as "nothing to
// render."

import * as fs from 'fs/promises'
import * as path from 'path'
import { execGit } from './exec'
import { getGitStatus } from './status'
import type { GitStatusSnapshot } from '../../shared/host-api'

export interface FileDirtyStatus {
  /** Single-char git status: M (modified), A (added/staged-new),
   *  D (deleted), R (renamed), C (copied), U (unmerged), ? (untracked). */
  status: string
  /** Lines added (from git diff --numstat). 0 for untracked / deleted. */
  plus: number
  /** Lines removed (from git diff --numstat). 0 for untracked / new. */
  minus: number
}

/**
 * Probe each child directory of `parentDir` for being a git repo
 * root. Returns a Map keyed by child name; entries exist only for
 * children whose `.git/` directory exists.
 *
 * Cheap-first: we fs.access the .git path before invoking git. Only
 * confirmed repos get the full getGitStatus call.
 */
export async function scanReposIn(
  parentDir: string,
  childNames: string[]
): Promise<Map<string, GitStatusSnapshot>> {
  const out = new Map<string, GitStatusSnapshot>()
  if (!parentDir || childNames.length === 0) return out

  // Two-pass: first identify candidates via .git existence (cheap),
  // then run getGitStatus in parallel for the survivors.
  const candidates: Array<{ name: string; absPath: string }> = []
  await Promise.all(
    childNames.map(async (name) => {
      const childPath = path.join(parentDir, name)
      const gitPath = path.join(childPath, '.git')
      try {
        const stat = await fs.stat(gitPath)
        // .git can be either a directory (normal repo) or a file
        // (worktree / submodule). Both qualify.
        if (stat.isDirectory() || stat.isFile()) {
          candidates.push({ name, absPath: childPath })
        }
      } catch {
        // ENOENT or permission — not a repo. Silent.
      }
    })
  )

  // Parallel git status for all candidates. Each call is independent;
  // execGit has its own timeout so a hung git won't lock the others.
  await Promise.all(
    candidates.map(async (c) => {
      const snap = await getGitStatus(c.absPath)
      if (snap.isRepo) out.set(c.name, snap)
    })
  )

  return out
}

/**
 * Build the per-file dirty-status map for a repo work-tree. Returns
 * absolute paths → {status, plus, minus}. Includes staged, unstaged,
 * AND untracked files (per owner Q6 ANY-CHANGE pick — single dot
 * regardless of status).
 *
 * Two git invocations: `status --porcelain` gives the status + list,
 * `diff --numstat HEAD` gives the line-diff numbers for tracked-
 * modified files. Untracked files report plus=lineCount minus=0
 * (read the file to count lines).
 */
export async function getDirtyFilesFor(
  workTreeRoot: string
): Promise<Map<string, FileDirtyStatus>> {
  const out = new Map<string, FileDirtyStatus>()
  if (!workTreeRoot) return out

  // Status — porcelain v1 format: "XY <path>" per line. X is the
  // staging-index status, Y is the worktree status. We collapse both
  // into a single representative char: prefer the staged status (X)
  // when set, else use Y. "??" is untracked.
  const statusRes = await execGit('git', ['status', '--porcelain'], { cwd: workTreeRoot })
  if (!statusRes.ok) return out

  const statusLines = statusRes.stdout.split('\n').filter((l) => l.length > 0)
  const fileMeta = new Map<string, string>() // relPath → status char

  for (const line of statusLines) {
    if (line.length < 3) continue
    const xy = line.slice(0, 2)
    const relPath = line.slice(3).trim()
    // Rename lines look like "R  old -> new". Pick the new path.
    const finalPath = relPath.includes(' -> ')
      ? relPath.slice(relPath.indexOf(' -> ') + 4)
      : relPath
    if (xy === '??') {
      fileMeta.set(finalPath, '?')
    } else {
      // Prefer X (staged) over Y (unstaged) for the single-char status.
      const x = xy[0] !== ' ' ? xy[0] : xy[1]
      fileMeta.set(finalPath, x)
    }
  }

  // Numstat for tracked-modified files (those NOT marked ??). Single
  // call returns lines like "12\t3\tpath" or "-\t-\tpath" for binary.
  const numstatRes = await execGit('git', ['diff', '--numstat', 'HEAD'], { cwd: workTreeRoot })
  const numstat = new Map<string, { plus: number; minus: number }>()
  if (numstatRes.ok) {
    for (const line of numstatRes.stdout.split('\n')) {
      if (!line) continue
      const parts = line.split('\t')
      if (parts.length < 3) continue
      const plus = parts[0] === '-' ? 0 : (Number.parseInt(parts[0], 10) || 0)
      const minus = parts[1] === '-' ? 0 : (Number.parseInt(parts[1], 10) || 0)
      numstat.set(parts[2], { plus, minus })
    }
  }

  // Build final map. For untracked files, count their line count by
  // reading the file (cheap for small files; capped at 64KB to avoid
  // pathological binary-paste cases).
  for (const [relPath, status] of fileMeta) {
    const absPath = path.join(workTreeRoot, relPath)
    if (status === '?') {
      let lineCount = 0
      try {
        const buf = await fs.readFile(absPath, { encoding: 'utf8' })
        const truncated = buf.length > 65536 ? buf.slice(0, 65536) : buf
        lineCount = truncated.split('\n').length
      } catch {
        // Binary / unreadable — leave at 0.
      }
      out.set(absPath, { status, plus: lineCount, minus: 0 })
    } else {
      const diff = numstat.get(relPath)
      out.set(absPath, {
        status,
        plus: diff?.plus ?? 0,
        minus: diff?.minus ?? 0
      })
    }
  }

  return out
}
