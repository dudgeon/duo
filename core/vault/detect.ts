// ENH-208 Vault — detection (PR1). Mirrors the shipped renderer-side
// `vaultIndex.ts` walk-up (a vault = the nearest ancestor containing
// `.obsidian/`) but in a node/fs context for the CLI. Phase 3 converges
// the two onto one shared module.

import fs from 'node:fs'
import path from 'node:path'
import type { VaultInfo } from './types'

/** True when `dir` is a vault root (contains an `.obsidian/` directory). */
export function isVaultRoot(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, '.obsidian')).isDirectory()
  } catch {
    return false
  }
}

/** Walk up from `startPath` (a file or directory) to the nearest enclosing
 *  vault root, or null if none. Stops at the filesystem root. */
export function findVaultRoot(startPath: string): string | null {
  let dir = path.resolve(startPath)
  try {
    if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir)
  } catch {
    dir = path.dirname(dir)
  }
  for (;;) {
    if (isVaultRoot(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const SCAN_SKIP = new Set(['node_modules', '.git', '.obsidian', '.trash', 'out'])

/** Count markdown notes under a vault root (cheap size signal). */
function countNotes(root: string): number {
  let n = 0
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SCAN_SKIP.has(e.name) && !e.name.startsWith('.')) stack.push(path.join(dir, e.name))
      } else if (e.name.endsWith('.md')) {
        n++
      }
    }
  }
  return n
}

/** Enumerate vaults detected from `cwd` (`duo vault list`): the enclosing
 *  vault (walk-up) plus any vaults nested under `cwd` (bounded downward
 *  BFS). Deduped by root, sorted by path. `maxDepth` bounds the descent so
 *  a large tree can't stall the CLI. */
export function listVaults(cwd: string, maxDepth = 4): VaultInfo[] {
  const roots = new Set<string>()

  const enclosing = findVaultRoot(cwd)
  if (enclosing) roots.add(enclosing)

  // Downward BFS — a vault root is terminal (don't descend into a vault's
  // own subfolders looking for nested vaults; Obsidian vaults don't nest).
  const queue: { dir: string; depth: number }[] = [{ dir: path.resolve(cwd), depth: 0 }]
  while (queue.length) {
    const { dir, depth } = queue.shift()!
    if (isVaultRoot(dir)) {
      roots.add(dir)
      continue
    }
    if (depth >= maxDepth) continue
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory() && !SCAN_SKIP.has(e.name) && !e.name.startsWith('.')) {
        queue.push({ dir: path.join(dir, e.name), depth: depth + 1 })
      }
    }
  }

  return [...roots]
    .sort()
    .map((root) => ({ root, name: path.basename(root), noteCount: countNotes(root) }))
}

/** Resolve the vault root for a verb: an explicit `--vault` flag wins,
 *  else walk up from `cwd`. Throws a clear error when neither resolves. */
export function resolveVault(cwd: string, explicit?: string | null): string {
  if (explicit) {
    const abs = path.resolve(cwd, explicit)
    if (!isVaultRoot(abs)) {
      throw new Error(`not a vault (no .obsidian/): ${abs}`)
    }
    return abs
  }
  const root = findVaultRoot(cwd)
  if (!root) {
    throw new Error(
      `no vault found from ${cwd} (walked up looking for .obsidian/). ` +
        `Pass --vault <path>, or run \`duo vault init <folder>\`.`,
    )
  }
  return root
}
