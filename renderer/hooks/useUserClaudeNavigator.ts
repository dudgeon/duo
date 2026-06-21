// Stage 22 — "Your Claude settings" navigator (top pane).
//
// Parallel to `useNavigator` but specialized for `~/.claude/`:
//
//   - Root is fixed at `~/.claude/`. No `cwd`, no follow-mode, no
//     pinning — the user's settings tree never moves.
//   - Curated mode: shows only the three things PMs actually edit
//     (`CLAUDE.md`, `skills/`, `agents/`) plus a small set of files
//     under each that the agent reads (so e.g. clicking `skills/`
//     reveals the user's individual skill folders inline).
//   - Show-all mode: lists every entry in `~/.claude/` (mcp/, hooks/,
//     plans/, projects/, bin/, duo/, etc.) for power users.
//   - Persists `showAll` + `expanded` to localStorage with keys
//     namespaced separately from the project navigator.
//
// The state shape is compatible with `<TreeNodes>` from FileTree.tsx
// so both panes share the recursive tree rendering. The "curated"
// root entries are synthesized (not pulled from the listings cache)
// so the tree can present a small hand-picked top level on top of
// otherwise-normal expand-on-click behavior.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DirEntry, FileChangeEvent } from '@shared/types'
import type { NavigatorState, NavigatorActions } from './useNavigator'
import { findDeadExpandedPaths } from './pruneDeadPaths'

const LS_KEY_SHOW_ALL = 'duo.userClaude.showAll'
const LS_KEY_EXPANDED = 'duo.userClaude.expanded'

function loadShowAll(): boolean {
  try { return localStorage.getItem(LS_KEY_SHOW_ALL) === '1' } catch { return false }
}

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY_EXPANDED)
    return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>()
  } catch { return new Set<string>() }
}

export interface UserClaudeNavigatorApi {
  /** True when "Show all of ~/.claude/" is on; false in curated mode. */
  showAll: boolean
  setShowAll: (v: boolean) => void
  /** Tree state shaped for `<TreeNodes>` (compatible with the project
   *  navigator's NavigatorState). `cwd` is fixed at the user-claude
   *  root. */
  state: NavigatorState
  /** Tree actions shaped for `<TreeNodes>`. */
  actions: NavigatorActions
  /** When in curated mode, this is the root list to render INSTEAD
   *  of `state.listings.get(state.cwd)`. The component passes it
   *  directly to `<TreeNodes entries={...}>`. */
  curatedRootEntries: DirEntry[] | null
}

export function useUserClaudeNavigator(home: string): UserClaudeNavigatorApi {
  const userClaudeRoot = `${home}/.claude`

  const [showAll, setShowAllState] = useState<boolean>(loadShowAll)
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded)
  // ENH-147 — mirror useNavigator's multi-select model (singular
  // selected derived below for back-compat). User-claude pane is also
  // a file tree; multi-select applies the same way.
  const [selectedItems, setSelectedItems] = useState<Map<string, 'file' | 'folder'>>(() => new Map())
  const [primaryPath, setPrimaryPath] = useState<string | null>(null)
  const [listings, setListings] = useState<Map<string, DirEntry[] | null>>(() => new Map())
  const [curatedRootEntries, setCuratedRootEntries] = useState<DirEntry[] | null>(null)

  // ENH-211 D2 — renderer-side coalesce of file events. The watch effect
  // (and thus `handleEvent`) is recreated on every expanded change, so the
  // pending-dir set + debounce timer MUST live in a ref that survives that
  // recreation. Mirrors useNavigator.ts.
  const pendingRefetchRef = useRef<{ dirs: Set<string>; timer: ReturnType<typeof setTimeout> | null }>({
    dirs: new Set(),
    timer: null
  })

  useEffect(() => {
    try { localStorage.setItem(LS_KEY_SHOW_ALL, showAll ? '1' : '0') } catch { /* ignore */ }
  }, [showAll])
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_EXPANDED, JSON.stringify([...expanded])) } catch { /* ignore */ }
  }, [expanded])

  // ENH-211 D1 — stale-while-revalidate: only seed the `null` loading
  // sentinel on the FIRST-EVER load of a path; when an entry already
  // exists, keep the prior DirEntry[] and OVERWRITE only when the new list
  // resolves, so a refetch never blanks already-painted rows. Mirrors
  // useNavigator.ts.
  const ensureListing = useCallback((path: string) => {
    setListings(prev => {
      if (prev.has(path)) return prev // keep stale entries; refetch overwrites on resolve
      const next = new Map(prev)
      next.set(path, null) // sentinel: loading (first-ever load only)
      return next
    })
    window.electron.files.list(path).then(
      entries => {
        setListings(prev => {
          const next = new Map(prev)
          next.set(path, entries)
          return next
        })
      },
      err => {
        console.warn('[user-claude-nav] list failed for', path, err instanceof Error ? err.message : err)
        setListings(prev => {
          const next = new Map(prev)
          next.set(path, [])
          return next
        })
      }
    )
  }, [])

  // BUG-167 (folded into ENH-182) — mount-time prune of persisted
  // `expanded` paths. Root is fixed at ~/.claude so there's no cwd to
  // recover, but a persisted entry like `skills/<gone>` /
  // `agents/<gone>` (workspace deleted between sessions) still gets
  // re-listed on every re-subscribe and floods the console with ENOENT
  // until the user happens to collapse it. One-shot probe at startup
  // drops the dead ones; a probe failure leaves entries intact.
  const prunedRef = useRef(false)
  useEffect(() => {
    if (prunedRef.current) return
    prunedRef.current = true
    let cancelled = false
    const probe = window.electron?.files?.dirExists
    if (!probe || expanded.size === 0) return
    void (async () => {
      const dead = await findDeadExpandedPaths(expanded, probe)
      if (cancelled || dead.length === 0) return
      setExpanded(prev => {
        const next = new Set(prev)
        for (const p of dead) next.delete(p)
        return next
      })
      setListings(prev => {
        const next = new Map(prev)
        for (const p of dead) next.delete(p)
        return next
      })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Always load the user-claude root + any expanded children.
  useEffect(() => { ensureListing(userClaudeRoot) }, [userClaudeRoot, ensureListing])
  useEffect(() => {
    for (const p of expanded) ensureListing(p)
  }, [expanded, ensureListing])

  // Curated entries: the three items the spec lists (CLAUDE.md,
  // skills/, agents/), constructed from the live root listing so we
  // don't need separate `fs.access` calls. Any of them that don't
  // exist on disk are simply omitted.
  useEffect(() => {
    const root = listings.get(userClaudeRoot)
    if (!root) {
      setCuratedRootEntries(null)
      return
    }
    const wanted = ['CLAUDE.md', 'skills', 'agents', 'duo']
    const entries: DirEntry[] = []
    for (const name of wanted) {
      const found = root.find(e => e.name === name)
      if (found) entries.push(found)
    }
    setCuratedRootEntries(entries)
  }, [listings, userClaudeRoot])

  // BUG-007-style watcher: re-fetch a directory's listing whenever
  // chokidar reports a change in it. We watch the user-claude root
  // + all expanded descendants.
  useEffect(() => {
    const paths = [userClaudeRoot, ...Array.from(expanded)]
    if (paths.length === 0) return
    let unwatch: (() => Promise<void>) | null = null
    let cancelled = false

    const handleEvent = (event: FileChangeEvent) => {
      const parent = event.path.slice(0, event.path.lastIndexOf('/')) || userClaudeRoot
      // ENH-211 D1 — do NOT delete/null the parent listing before refetch.
      // ENH-211 D2 — coalesce the refetch on a trailing-edge debounce so a
      // burst yields ONE re-list per dir. Mirrors useNavigator.ts.
      const pending = pendingRefetchRef.current
      pending.dirs.add(parent)
      if (pending.timer) clearTimeout(pending.timer)
      pending.timer = setTimeout(() => {
        pending.timer = null
        if (cancelled) return // watcher torn down — don't refetch after teardown
        const dirs = Array.from(pending.dirs)
        pending.dirs.clear()
        for (const dir of dirs) ensureListing(dir)
      }, 100)
    }

    void window.electron.files.watch(paths, handleEvent).then(stop => {
      if (cancelled) { void stop() } else { unwatch = stop }
    }).catch(err => {
      console.warn('[user-claude-nav] watch failed:', err instanceof Error ? err.message : err)
    })

    return () => {
      cancelled = true
      if (unwatch) void unwatch()
      // ENH-211 D2 — clear any pending debounced refetch so no setState
      // fires after teardown.
      const pending = pendingRefetchRef.current
      if (pending.timer) { clearTimeout(pending.timer); pending.timer = null }
      pending.dirs.clear()
    }
  }, [userClaudeRoot, expanded, ensureListing])

  // Tree-node action contract — same shape as useNavigator so
  // <TreeNodes> can drive both panes.
  const toggleExpand = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const selectItem = useCallback((path: string, kind: 'file' | 'folder') => {
    setSelectedItems(new Map([[path, kind]]))
    setPrimaryPath(path)
  }, [])

  const toggleSelection = useCallback((path: string, kind: 'file' | 'folder') => {
    setSelectedItems(prev => {
      const next = new Map(prev)
      if (next.has(path)) next.delete(path)
      else next.set(path, kind)
      return next
    })
    setPrimaryPath(prev => {
      if (selectedItems.has(path)) return prev === path ? null : prev
      return path
    })
  }, [selectedItems])

  // ENH-148 — range/select-all parity with the project pane. The
  // user-claude pane uses the same TreeNodes renderer, so it must
  // satisfy the same NavigatorActions contract. Implementations
  // mirror useNavigator.ts.
  const selectRange = useCallback((paths: string[], kinds: Array<'file' | 'folder'>, newPrimary: string) => {
    if (paths.length === 0) return
    const map = new Map<string, 'file' | 'folder'>()
    for (let i = 0; i < paths.length; i++) map.set(paths[i], kinds[i] ?? 'file')
    setSelectedItems(map)
    setPrimaryPath(newPrimary)
  }, [])

  const selectAllVisible = useCallback((paths: string[], kinds: Array<'file' | 'folder'>) => {
    if (paths.length === 0) return
    const map = new Map<string, 'file' | 'folder'>()
    for (let i = 0; i < paths.length; i++) map.set(paths[i], kinds[i] ?? 'file')
    setSelectedItems(map)
    setPrimaryPath(paths[0])
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedItems(new Map())
    setPrimaryPath(null)
  }, [])

  const refresh = useCallback((path: string) => {
    // ENH-211 D1 — refetch in place; keep the stale listing until the new
    // one resolves instead of deleting first and flashing "Loading…".
    ensureListing(path)
  }, [ensureListing])

  // Pinning + dotfiles + navigateTo aren't meaningful for the user-
  // claude pane. We satisfy the NavigatorActions contract with
  // no-ops so <TreeNodes> can still call into them safely.
  const navigateTo = useCallback((_path: string) => { /* fixed root */ }, [])
  // BUG-053 — revealAndSelect on the user-claude pane is also a no-op
  // for the navigation half (this pane has a fixed root); we still
  // honor the selection part so the row highlights if `nav:reveal`
  // ever points into ~/.claude (cross-pane reveal isn't supported in
  // v1 — file would be rendered in the project pane only).
  const revealAndSelect = useCallback((filePath: string) => {
    setSelectedItems(new Map([[filePath, 'file']]))
    setPrimaryPath(filePath)
  }, [])
  const togglePinned = useCallback(() => { /* always pinned */ }, [])
  const toggleShowDotfiles = useCallback(() => { /* always visible */ }, [])

  // ENH-147 — derive singular `selected` from the multi-select map for
  // back-compat (computePendingCwd, CLI nav-state, single-target callers).
  const selected: NavigatorState['selected'] = (() => {
    if (selectedItems.size === 0) return null
    const primaryKind = primaryPath !== null ? selectedItems.get(primaryPath) : undefined
    if (primaryPath !== null && primaryKind !== undefined) {
      return { path: primaryPath, kind: primaryKind }
    }
    const [firstPath, firstKind] = selectedItems.entries().next().value as [string, 'file' | 'folder']
    return { path: firstPath, kind: firstKind }
  })()

  const state: NavigatorState = {
    cwd: userClaudeRoot,
    selectedItems,
    selected,
    expanded,
    pinned: true,
    showDotfiles: true, // .claude itself is a dotdir; its contents may be too
    listings,
    // ENH-222 — this fixed-root pane never roots in a worktree, so the
    // worktree-removal recovery banner state is permanently inert here.
    removedWorktree: null
  }
  const actions: NavigatorActions = {
    navigateTo,
    selectItem,
    toggleSelection,
    selectRange,
    selectAllVisible,
    revealAndSelect,
    clearSelection,
    toggleExpand,
    togglePinned,
    toggleShowDotfiles,
    refresh,
    // ENH-222 — no worktree to revert to / dismiss in the fixed-root pane.
    setWorktreeRevertTarget: () => {},
    dismissRemovedWorktree: () => {}
  }

  const setShowAll = useCallback((v: boolean) => { setShowAllState(v) }, [])

  return { showAll, setShowAll, state, actions, curatedRootEntries }
}
