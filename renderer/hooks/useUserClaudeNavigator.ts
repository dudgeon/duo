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

import { useCallback, useEffect, useState } from 'react'
import type { DirEntry, FileChangeEvent } from '@shared/types'
import type { NavigatorState, NavigatorActions } from './useNavigator'

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
  const [selected, setSelected] = useState<NavigatorState['selected']>(null)
  const [listings, setListings] = useState<Map<string, DirEntry[] | null>>(() => new Map())
  const [curatedRootEntries, setCuratedRootEntries] = useState<DirEntry[] | null>(null)

  useEffect(() => {
    try { localStorage.setItem(LS_KEY_SHOW_ALL, showAll ? '1' : '0') } catch { /* ignore */ }
  }, [showAll])
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_EXPANDED, JSON.stringify([...expanded])) } catch { /* ignore */ }
  }, [expanded])

  const ensureListing = useCallback((path: string) => {
    setListings(prev => {
      if (prev.has(path)) return prev
      const next = new Map(prev)
      next.set(path, null)
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
      setListings(prev => {
        if (!prev.has(parent)) return prev
        const next = new Map(prev)
        next.delete(parent)
        return next
      })
      ensureListing(parent)
    }

    void window.electron.files.watch(paths, handleEvent).then(stop => {
      if (cancelled) { void stop() } else { unwatch = stop }
    }).catch(err => {
      console.warn('[user-claude-nav] watch failed:', err instanceof Error ? err.message : err)
    })

    return () => {
      cancelled = true
      if (unwatch) void unwatch()
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
    setSelected({ path, kind })
  }, [])

  const clearSelection = useCallback(() => setSelected(null), [])

  const refresh = useCallback((path: string) => {
    setListings(prev => {
      const next = new Map(prev)
      next.delete(path)
      return next
    })
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
    setSelected({ path: filePath, kind: 'file' })
  }, [])
  const togglePinned = useCallback(() => { /* always pinned */ }, [])
  const toggleShowDotfiles = useCallback(() => { /* always visible */ }, [])

  const state: NavigatorState = {
    cwd: userClaudeRoot,
    selected,
    expanded,
    pinned: true,
    showDotfiles: true, // .claude itself is a dotdir; its contents may be too
    listings
  }
  const actions: NavigatorActions = {
    navigateTo,
    selectItem,
    revealAndSelect,
    clearSelection,
    toggleExpand,
    togglePinned,
    toggleShowDotfiles,
    refresh
  }

  const setShowAll = useCallback((v: boolean) => { setShowAllState(v) }, [])

  return { showAll, setShowAll, state, actions, curatedRootEntries }
}
