// Sprint 11 — vault index + fuzzy match utilities shared by:
//   - WikilinkSuggestion extension (`[[` → popover)
//   - AtMention extension (`@` → popover)
//   - VaultQuickSwitcher overlay (`⌘O`)
//
// All three keys off the same in-memory list of vault files, computed
// once per (path, vaultRoot) pair and cached for the lifetime of the
// editor instance / overlay open. v1 is manual-refresh only — the
// index doesn't auto-rebuild on watcher events. Refresh on demand via
// the returned `refresh` callback when the user adds/removes files.

import { useCallback, useEffect, useRef, useState } from 'react'
import { findVaultRootAndMode, walkVaultFiles, type VaultFile } from './wikilinkResolver'
import type { VaultMode } from '../../../core/markdown/vaultLinks'

export interface VaultIndex {
  /** The detected vault root (path of the directory containing the OKF
   *  marker `index.md` or a `.obsidian/`), or null if no vault was found
   *  from the active file's location. */
  vaultRoot: string | null
  /** ENH-216 — the vault's at-rest link mode (D4). Resolved alongside the
   *  root via `findVaultRootAndMode`; defaults to 'obsidian' (the existing
   *  wikilink behaviour) when no vault is found. The [[ ]] gesture branches
   *  on this to write the right serializer's output on resolve (D3). */
  mode: VaultMode
  /** All visible text-y files inside the vault, BFS-walked. Empty
   *  while loading or when no vault was found. */
  files: VaultFile[]
  /** True while the BFS walk is in flight after a path/vaultRoot
   *  change. Suggestion popovers can render a "Searching vault…"
   *  hint while this is true. */
  loading: boolean
  /** Force-rebuild the index — call after the user creates / deletes
   *  files outside Duo. v1 manual; v2 will subscribe to watcher
   *  events and self-invalidate. */
  refresh: () => void
}

/**
 * Hook — build a VaultIndex from the active file's path. Recomputes
 * when the path moves to a different vault root, NOT when the path
 * changes within the same vault (we'd rebuild the same list).
 *
 * Caller pattern:
 *
 *   const { vaultRoot, files, loading } = useVaultIndex(activePath)
 *
 * Returns `{ vaultRoot: null, files: [], loading: false }` when the
 * active path isn't inside an Obsidian vault.
 */
export function useVaultIndex(activePath: string | null): VaultIndex {
  const [vaultRoot, setVaultRoot] = useState<string | null>(null)
  // ENH-216 — the resolved vault's at-rest link mode (D4). Defaults to
  // 'obsidian' (the existing wikilink behaviour) until a vault resolves.
  const [mode, setMode] = useState<VaultMode>('obsidian')
  const [files, setFiles] = useState<VaultFile[]>([])
  const [loading, setLoading] = useState(false)
  // Bumped by `refresh()` to force the rebuild effect to re-run even
  // when the deps haven't changed.
  const [refreshTick, setRefreshTick] = useState(0)
  const cancelledRef = useRef(false)

  // Effect 1: resolve the vault root + mode for the active path (D4).
  useEffect(() => {
    cancelledRef.current = false
    let cancelled = false
    void findVaultRootAndMode(activePath).then((result) => {
      if (cancelled) return
      const root = result?.root ?? null
      // Only update when the root actually changes — avoids triggering
      // the walk effect when the path moved within the same vault.
      setVaultRoot((prev) => (prev === root ? prev : root))
      // Mode follows the resolved vault; falls back to 'obsidian' when no
      // vault is found so the gesture's default stays wikilinks.
      setMode(result?.mode ?? 'obsidian')
    })
    return () => { cancelled = true }
  }, [activePath])

  // Effect 2: walk the vault root.
  useEffect(() => {
    if (!vaultRoot) {
      setFiles([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void walkVaultFiles(vaultRoot).then((list) => {
      if (cancelled) return
      setFiles(list)
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setFiles([])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [vaultRoot, refreshTick])

  const refresh = useCallback(() => {
    setRefreshTick((n) => n + 1)
  }, [])

  return { vaultRoot, mode, files, loading, refresh }
}

/**
 * Score a vault file against a query. Higher score = better match.
 * Returns -1 when no match (caller filters those out).
 *
 * Mirrors `TabSearchPalette.scoreEntry`'s shape (substring + prefix)
 * because Sprint 4 owner pull was "fuzzy is overkill — substring is
 * enough for the open-tabs case." Same pull-through to vaults.
 *
 * Scoring (in priority order, all case-insensitive):
 *   - Basename === query: 1000
 *   - Basename starts-with query: 500
 *   - Basename contains query (earlier = higher): 200 - position
 *   - Relative path contains query: 50 - position
 *
 * Empty query returns 0 — caller should display the full list
 * sorted by basename when the input is empty (matches Obsidian's
 * `[[`-popover behavior on first character).
 */
export function scoreVaultFile(file: VaultFile, q: string): number {
  if (!q) return 0
  const needle = q.toLowerCase()
  const base = file.basename.toLowerCase()
  if (base === needle) return 1000
  if (base.startsWith(needle)) return 500
  const baseIdx = base.indexOf(needle)
  if (baseIdx >= 0) return 200 - baseIdx
  const relIdx = file.relPath.toLowerCase().indexOf(needle)
  if (relIdx >= 0) return 50 - relIdx
  return -1
}

/**
 * Filter + rank a vault file list against a query. Used by all three
 * Sprint 11 features. Empty query returns the list sorted by
 * basename (alphabetical) so the popover always has something to
 * show — matches Obsidian's `[[`-popover behavior on first character.
 */
export function rankVaultFiles(files: VaultFile[], query: string, limit = 50): VaultFile[] {
  if (!query) {
    return [...files]
      .sort((a, b) => a.basename.localeCompare(b.basename))
      .slice(0, limit)
  }
  const scored = files
    .map((f) => ({ file: f, score: scoreVaultFile(f, query) }))
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.file)
}
