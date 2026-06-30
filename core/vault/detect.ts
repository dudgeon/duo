// ENH-208 Vault — detection (PR1). Mirrors the shipped renderer-side
// `vaultIndex.ts` walk-up (a vault = the nearest ancestor containing
// `.obsidian/`) but in a node/fs context for the CLI. Phase 3 converges
// the two onto one shared module.
//
// ENH-216 OKF mode — a vault now detects in one of TWO modes (D4). The
// IN-VAULT marker is the source of truth (never a registry/prefs key):
//   okf       — root `index.md` carries an `okf_version` frontmatter field.
//   obsidian  — the legacy default: a `.obsidian/` directory at the root.
// `okf_version` WINS if both markers are present (D4 tie-break).

import fs from 'node:fs'
import path from 'node:path'
import type { VaultInfo, VaultMode } from './types'
import { splitFrontmatter } from './parse'

/** Read the `okf_version` field from a vault root's `index.md` frontmatter
 *  (the OKF marker, D4 — the ROOT `index.md` ONLY). Returns the version
 *  string, or null when the file is absent / has no `okf_version`. */
export function readOkfVersion(dir: string): string | null {
  let raw: string
  try {
    raw = fs.readFileSync(path.join(dir, 'index.md'), 'utf8')
  } catch {
    return null
  }
  const { frontmatter } = splitFrontmatter(raw)
  const v = frontmatter.okf_version
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return null
}

/** Detect a vault's at-rest mode from its in-vault marker (D4). Returns:
 *   - `'okf'`      when the root `index.md` has `okf_version` (WINS over
 *     `.obsidian/` if both are present);
 *   - `'obsidian'` when an `.obsidian/` directory is present;
 *   - `null`       when `dir` is not a vault root at all. */
export function detectVaultMode(dir: string): VaultMode | null {
  if (readOkfVersion(dir) !== null) return 'okf'
  try {
    if (fs.statSync(path.join(dir, '.obsidian')).isDirectory()) return 'obsidian'
  } catch {
    /* not an obsidian vault */
  }
  return null
}

/** True when `dir` is a vault root in EITHER mode (ENH-216 widening — was
 *  an `.obsidian/`-only probe). */
export function isVaultRoot(dir: string): boolean {
  return detectVaultMode(dir) !== null
}

/** D5 (ENH-216 follow-up) — provenance heuristic: should Duo treat this vault
 *  as FOREIGN (not its own to auto-mutate)?
 *
 *  A vault carrying a root `loop.manifest.json` belongs to a loopkit-family
 *  kit (e.g. brainkit) — Duo did NOT create it. A brainkit vault is
 *  byte-compatible OKF (same `okf_version` marker), so without this check Duo
 *  would auto-rewrite its links on open. Returns true when the marker file is
 *  present at the vault root.
 *
 *  DELIBERATE LIMITATION (owner decision "a"): this detects loopkit/brainkit-
 *  family vaults only. A GENERIC third-party OKF bundle (no `loop.manifest.json`)
 *  reads as native and is NOT protected — accepted to avoid stamping/migrating
 *  Duo's own vaults. This gates the AUTO-relink-on-open path only; the explicit
 *  `duo vault relink` verb is unaffected. */
export function isForeignVault(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, 'loop.manifest.json')).isFile()
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

/** Walk up from `startPath` to the nearest enclosing vault, returning both
 *  its root AND its live-detected mode (ENH-216, D4), or null if none. The
 *  mode companion to {@link findVaultRoot}. */
export function findVaultWithMode(startPath: string): { root: string; mode: VaultMode } | null {
  const root = findVaultRoot(startPath)
  if (!root) return null
  // A walk-up hit is a vault root, so detectVaultMode is non-null here.
  return { root, mode: detectVaultMode(root)! }
}

// `templates` is excluded so `vault list`'s noteCount matches what the
// corpus / search / graph count as entities (D5 query-exclusion) — the
// PR1 review flagged the prior inconsistency.
const SCAN_SKIP = new Set(['node_modules', '.git', '.obsidian', '.trash', 'out', 'templates'])

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
    // A root in `roots` passed isVaultRoot, so detectVaultMode is non-null.
    .map((root) => ({
      root,
      name: path.basename(root),
      noteCount: countNotes(root),
      mode: detectVaultMode(root)!,
    }))
}

/** Resolve the vault root for a verb: an explicit `--vault` flag wins,
 *  else walk up from `cwd`. Throws a clear error when neither resolves. */
export function resolveVault(cwd: string, explicit?: string | null): string {
  if (explicit) {
    const abs = path.resolve(cwd, explicit)
    if (!isVaultRoot(abs)) {
      throw new Error(`not a vault (no okf_version index.md or .obsidian/): ${abs}`)
    }
    return abs
  }
  const root = findVaultRoot(cwd)
  if (!root) {
    throw new Error(
      `no vault found from ${cwd} (walked up looking for an okf_version index.md or .obsidian/). ` +
        `Pass --vault <path>, or run \`duo vault init <folder>\`.`,
    )
  }
  return root
}
