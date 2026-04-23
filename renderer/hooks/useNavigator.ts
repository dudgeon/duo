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

  const navigateTo = useCallback((path: string) => {
    setCwd(path)
    setSelected(null)
  }, [])

  const selectItem = useCallback((path: string, kind: 'file' | 'folder') => {
    setSelected({ path, kind })
    if (kind === 'folder') setCwd(path)
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
