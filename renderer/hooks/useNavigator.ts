// Stage 10 Phase 4 — navigator state and file-listing cache.
//
// Owns:
//   - navigator CWD (folder currently shown)
//   - selection (file or folder or none)
//   - expanded paths (which folders are unfolded in the tree)
//   - pinned flag (follow-mode override)
//   - a cache of directory listings keyed by absolute path
//
// Computes:
//   - `pendingCwd` — the path a new terminal tab would launch in.
//
// Persistence: Phase 4 uses localStorage for a quick seed across reloads.
// Phase 7 replaces this with the main-process state.json persistence.

import { useCallback, useEffect, useState } from 'react'
import type { DirEntry } from '@shared/types'

const LS_KEY_CWD = 'duo.nav.cwd'
const LS_KEY_EXPANDED = 'duo.nav.expanded'
const LS_KEY_PINNED = 'duo.nav.pinned'

export interface NavigatorState {
  cwd: string
  selected: { path: string; kind: 'file' | 'folder' } | null
  expanded: Set<string>
  pinned: boolean
  showDotfiles: boolean
  /** Children cache keyed by absolute path. `null` means loading. */
  listings: Map<string, DirEntry[] | null>
}

export interface NavigatorActions {
  navigateTo: (path: string) => void
  selectItem: (path: string, kind: 'file' | 'folder') => void
  clearSelection: () => void
  toggleExpand: (path: string) => void
  togglePinned: () => void
  toggleShowDotfiles: () => void
  /** Force a re-list of a folder (e.g. after the agent writes a file). */
  refresh: (path: string) => void
  /** BUG-053 — atomic "reveal a file in the navigator": switch the
   *  tree's cwd to the file's parent dir AND set the file as selected
   *  in one update, without the navigateTo-then-selectItem race
   *  (navigateTo nulls selection; selectItem then re-sets it; relying
   *  on React 18 auto-batching to make the second win). Use this from
   *  any "reveal X" callsite (`nav:reveal` action verb, file-tab
   *  context-menu "Reveal in navigator"). */
  revealAndSelect: (filePath: string) => void
}

export function useNavigator(initialCwd: string) {
  const [cwd, setCwd] = useState<string>(() => {
    try { return localStorage.getItem(LS_KEY_CWD) || initialCwd } catch { return initialCwd }
  })
  const [selected, setSelected] = useState<NavigatorState['selected']>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY_EXPANDED)
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>()
    } catch {
      return new Set<string>()
    }
  })
  const [pinned, setPinned] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_KEY_PINNED) === '1' } catch { return false }
  })
  const [showDotfiles, setShowDotfiles] = useState<boolean>(false)
  const [listings, setListings] = useState<NavigatorState['listings']>(() => new Map())

  // Persist whenever relevant state changes. Debounce is minimal because
  // these are tiny writes.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_CWD, cwd) } catch { /* storage full or disabled */ }
  }, [cwd])
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_EXPANDED, JSON.stringify([...expanded])) } catch { /* ignore */ }
  }, [expanded])
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_PINNED, pinned ? '1' : '0') } catch { /* ignore */ }
  }, [pinned])

  // Shared helper that (lazily) fetches a directory listing and caches it.
  const ensureListing = useCallback((path: string) => {
    setListings(prev => {
      if (prev.has(path)) return prev
      const next = new Map(prev)
      next.set(path, null) // sentinel: loading
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
        console.warn('[nav] list failed for', path, err instanceof Error ? err.message : err)
        setListings(prev => {
          const next = new Map(prev)
          next.set(path, []) // treat errors as empty; UI can surface later
          return next
        })
      }
    )
  }, [])

  // Auto-load the current cwd + any expanded children.
  useEffect(() => { ensureListing(cwd) }, [cwd, ensureListing])
  useEffect(() => {
    for (const p of expanded) ensureListing(p)
  }, [expanded, ensureListing])

  // BUG-007 — subscribe to filesystem events so the navigator reflects
  // external mutations (file deletes, agent writes, terminal `mv`/`rm`,
  // Finder ops) without a full reload. v0.3.1 added the renderer
  // subscription; v0.5.1 hardens the unlink path:
  //   - On every (re)subscribe, refresh the watched paths' listings
  //     once. Catches deletes that fired during the sub-resub gap
  //     (e.g. when the user expanded a folder mid-delete).
  //   - When an event invalidates the parent cache, also clear any
  //     `selected` row whose path equals `event.path` — the row's
  //     vanishing should not leave a stale highlight on a row that
  //     was deleted.
  useEffect(() => {
    const paths = [cwd, ...Array.from(expanded)]
    if (paths.length === 0) return
    let unwatch: (() => Promise<void>) | null = null
    let cancelled = false

    const handleEvent = (event: { kind: 'added' | 'changed' | 'removed'; path: string }) => {
      const parent = event.path.slice(0, event.path.lastIndexOf('/')) || cwd
      setListings(prev => {
        if (!prev.has(parent)) return prev
        const next = new Map(prev)
        next.delete(parent)
        return next
      })
      ensureListing(parent)
      if (event.kind === 'removed') {
        setSelected(curr => (curr && curr.path === event.path ? null : curr))
      }
    }

    void window.electron.files.watch(paths, handleEvent).then(stop => {
      if (cancelled) { void stop(); return }
      unwatch = stop
      // Belt-and-suspenders: refresh visible folders once after the
      // watcher is fully attached, so any events that fired during
      // the sub-resub window are reflected. Cheap (one fs.readdir per
      // visible folder) and keeps the tree honest.
      for (const p of paths) {
        setListings(prev => {
          if (!prev.has(p)) return prev
          const next = new Map(prev)
          next.delete(p)
          return next
        })
        ensureListing(p)
      }
    }).catch(err => {
      console.warn('[nav] watch failed:', err instanceof Error ? err.message : err)
    })

    return () => {
      cancelled = true
      if (unwatch) void unwatch()
    }
  }, [cwd, expanded, ensureListing])

  const navigateTo = useCallback((path: string) => {
    setCwd(path)
    setSelected(null)
  }, [])

  const selectItem = useCallback((path: string, kind: 'file' | 'folder') => {
    // Stage 26 item 1: select-only. The previous "selecting a folder
    // re-roots the tree" coupling lived here as a setCwd side effect;
    // it now requires an explicit double-click (FileTree) or
    // navigateTo() call. computePendingCwd already returns sel.path
    // for folder selections, so terminal-CWD inheritance is preserved.
    setSelected({ path, kind })
  }, [])

  const revealAndSelect = useCallback((filePath: string) => {
    // BUG-053 — atomic reveal. Computes the parent dir from filePath,
    // sets cwd + selected in the same render so there's no window
    // where selected is null. Fixes nav:reveal action AND file-tab
    // right-click "Reveal in navigator" — both used to do
    // `navigateTo(dir); selectItem(filePath)` and rely on React 18
    // auto-batching to make the final selected state stick. That
    // works MOST of the time but the listing-load async cycle could
    // re-render with selected=null peeking through (the navigateTo
    // sets selected=null immediately; selectItem sets it back; if
    // anything between the two reads the state, it sees null).
    // Single-action update eliminates the race.
    const dir = filePath.slice(0, filePath.lastIndexOf('/')) || '/'
    setCwd(dir)
    setSelected({ path: filePath, kind: 'file' })
  }, [])

  const clearSelection = useCallback(() => setSelected(null), [])

  const toggleExpand = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const togglePinned = useCallback(() => setPinned(p => !p), [])
  const toggleShowDotfiles = useCallback(() => setShowDotfiles(s => !s), [])

  const refresh = useCallback((path: string) => {
    setListings(prev => {
      const next = new Map(prev)
      next.delete(path)
      return next
    })
    ensureListing(path)
  }, [ensureListing])

  const state: NavigatorState = { cwd, selected, expanded, pinned, showDotfiles, listings }
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

  return { state, actions, setCwd }
}

/** Compute the pending CWD for a new terminal tab from navigator state. */
export function computePendingCwd(state: NavigatorState): string {
  const sel = state.selected
  if (sel?.kind === 'file') {
    // Use the file's parent directory (Stage 10 § D9).
    const lastSlash = sel.path.lastIndexOf('/')
    return lastSlash > 0 ? sel.path.slice(0, lastSlash) : '/'
  }
  if (sel?.kind === 'folder') return sel.path
  return state.cwd
}
