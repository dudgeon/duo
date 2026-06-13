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

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DirEntry } from '@shared/types'
import { findDeadExpandedPaths, nearestExistingAncestor } from './pruneDeadPaths'

// ENH-191 P4 (seam 3b) — cwd + expanded are per-window navigation STATE (each
// window browses its own location/tree), so they namespace by THIS window's id
// (preload-injected as window.electron.env.windowId == the main-process
// registry id). pinned + showDotfiles are GLOBAL prefs and stay on the shared
// (un-namespaced) keys below. The v2 cwd/expanded keys seed once from the old
// shared v1 keys (read-only) to preserve the initial restore; the v1 keys are
// left UNWRITTEN so a Cut-3 revert reads them untouched (PRD §7.5).
const NAV_WINDOW_ID: number = (() => {
  const id = typeof window !== 'undefined' ? window.electron?.env?.windowId : undefined
  return typeof id === 'number' && id > 0 ? id : 1
})()
const LS_KEY_CWD = `duo.nav.v2.w${NAV_WINDOW_ID}.cwd`
const LS_KEY_CWD_LEGACY = 'duo.nav.cwd'
const LS_KEY_EXPANDED = `duo.nav.v2.w${NAV_WINDOW_ID}.expanded`
const LS_KEY_EXPANDED_LEGACY = 'duo.nav.expanded'
const LS_KEY_PINNED = 'duo.nav.pinned'             // GLOBAL pref — stays shared
// ENH-172 (Sprint 20) — persist the show-hidden-files toggle so the
// View menu checkbox / ⌘⇧. chord / CLI verb survive relaunches.
const LS_KEY_SHOW_DOTFILES = 'duo.nav.showDotfiles' // GLOBAL pref — stays shared

export interface NavigatorState {
  cwd: string
  /** ENH-147 — multi-select set. Maps absolute path → kind. Singular
   *  `selected` below is the derived "primary" view, kept for
   *  callsites that only care about a single selection (computePendingCwd,
   *  CLI nav-state's `selected` field). `selectedItems` is canonical for
   *  rendering: every row checks `selectedItems.has(entry.path)`. */
  selectedItems: Map<string, 'file' | 'folder'>
  /** Derived from `selectedItems`. When the map is empty, null. When
   *  the map has entries, the entry pointed at by `primaryPath` (or
   *  any entry if primaryPath was removed). Single-click sets this to
   *  the sole entry; ⌘-click sets this to the newly-added entry. */
  selected: { path: string; kind: 'file' | 'folder' } | null
  expanded: Set<string>
  pinned: boolean
  showDotfiles: boolean
  /** Children cache keyed by absolute path. `null` means loading. */
  listings: Map<string, DirEntry[] | null>
}

export interface NavigatorActions {
  navigateTo: (path: string) => void
  /** Single-select: replaces the selection set with exactly this one item.
   *  Use when the user clicks a row without modifier keys. */
  selectItem: (path: string, kind: 'file' | 'folder') => void
  /** ENH-147 — multi-select toggle: if `path` is already in selectedItems,
   *  remove it; else add it. Used for ⌘-click. */
  toggleSelection: (path: string, kind: 'file' | 'folder') => void
  /** ENH-148 — ⇧-click range-select. Replaces the current selection
   *  with every path in `paths` (with matching `kinds`). Caller
   *  computes the range via the visible/flattened row list so the
   *  hook stays surface-agnostic. Sets `primaryPath` to the final
   *  entry in the supplied list (the shift-clicked row). */
  selectRange: (paths: string[], kinds: Array<'file' | 'folder'>, newPrimary: string) => void
  /** ENH-148 — ⌘-A select-all. Same shape as `selectRange` but
   *  expressed as a separate verb so the dispatcher's intent is
   *  legible at the call site (FileTree's keyboard handler). Sets
   *  `primaryPath` to the first entry. */
  selectAllVisible: (paths: string[], kinds: Array<'file' | 'folder'>) => void
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
    try { return localStorage.getItem(LS_KEY_CWD) || localStorage.getItem(LS_KEY_CWD_LEGACY) || initialCwd } catch { return initialCwd }
  })
  // ENH-147 — canonical multi-select map. Singular `selected` is derived
  // below for back-compat (computePendingCwd, CLI nav-state, anywhere
  // that expects a single primary item). primaryPath identifies which
  // entry of selectedItems acts as the "primary" — single-click sets
  // it to the sole entry; ⌘-click sets it to the newly-added entry.
  const [selectedItems, setSelectedItems] = useState<Map<string, 'file' | 'folder'>>(() => new Map())
  const [primaryPath, setPrimaryPath] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY_EXPANDED) ?? localStorage.getItem(LS_KEY_EXPANDED_LEGACY)
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>()
    } catch {
      return new Set<string>()
    }
  })
  const [pinned, setPinned] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_KEY_PINNED) === '1' } catch { return false }
  })
  const [showDotfiles, setShowDotfiles] = useState<boolean>(() => {
    // ENH-172 — hydrate from localStorage; '1' = show, anything else = hide.
    try { return localStorage.getItem(LS_KEY_SHOW_DOTFILES) === '1' } catch { return false }
  })
  const [listings, setListings] = useState<NavigatorState['listings']>(() => new Map())
  // Latest cwd, readable from the stable `ensureListing` callback (whose
  // deps are []). Lets the ENOENT self-heal decide whether the dead path
  // is the current cwd without re-creating the callback every navigation.
  const cwdRef = useRef(cwd)

  // ENH-211 D2 — renderer-side coalesce of file events. The watch effect
  // (and thus `handleEvent`) is recreated on every cwd/expanded change, so
  // the pending-dir set + debounce timer MUST live in a ref that survives
  // that recreation — a per-closure timer would never coalesce across
  // events. `handleEvent` adds changed parent-dirs here and arms the timer;
  // the trailing-edge flush re-lists each dir ONCE per burst.
  const pendingRefetchRef = useRef<{ dirs: Set<string>; timer: ReturnType<typeof setTimeout> | null }>({
    dirs: new Set(),
    timer: null
  })

  // Persist whenever relevant state changes. Debounce is minimal because
  // these are tiny writes.
  useEffect(() => {
    cwdRef.current = cwd
    try { localStorage.setItem(LS_KEY_CWD, cwd) } catch { /* storage full or disabled */ }
  }, [cwd])
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_EXPANDED, JSON.stringify([...expanded])) } catch { /* ignore */ }
  }, [expanded])
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_PINNED, pinned ? '1' : '0') } catch { /* ignore */ }
  }, [pinned])
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_SHOW_DOTFILES, showDotfiles ? '1' : '0') } catch { /* ignore */ }
  }, [showDotfiles])

  // ENH-172 — subscribe to main-process pushes from the View menu
  // checkbox and `duo hidden-files` CLI verb. 'toggle' flips current.
  useEffect(() => {
    if (!window.electron?.hiddenFiles) return
    return window.electron.hiddenFiles.onSet(value => {
      if (value === 'toggle') {
        setShowDotfiles(s => !s)
      } else {
        setShowDotfiles(value === true)
      }
    })
  }, [])

  // BUG-167 (folded into ENH-182) — mount-time prune of persisted
  // navigator state. The reactive ENOENT heal above only fires when the
  // user navigates to or expands a dead folder; this one-shot pass
  // drops ghosts at startup, BEFORE the first project switch
  // re-subscribes the watcher and triggers the spammy re-list. Same
  // `dirExists` probe as the reactive heal — a probe failure leaves
  // entries intact (transient flakes must not wipe state). Reads cwd /
  // expanded / initialCwd from the mount-time closure so the effect is
  // intentionally mount-only.
  const prunedRef = useRef(false)
  useEffect(() => {
    if (prunedRef.current) return
    prunedRef.current = true
    let cancelled = false
    const probe = window.electron?.files?.dirExists
    if (!probe) return
    void (async () => {
      // Recover cwd first so the watcher's first subscription sees a
      // live path. Fallback chain: nearest existing ancestor → initialCwd.
      try {
        if (!(await probe(cwd))) {
          const recovered = await nearestExistingAncestor(cwd, probe, initialCwd)
          if (!cancelled) setCwd(prev => (prev === cwd ? recovered : prev))
        }
      } catch { /* probe unreachable — leave cwd as-is */ }
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

  // Shared helper that (lazily) fetches a directory listing and caches it.
  // ENH-211 D1 — stale-while-revalidate: only seed the `null` loading
  // sentinel on the FIRST-EVER load of a path (nothing to show yet). When
  // an entry already exists, leave the prior DirEntry[] in the Map and
  // OVERWRITE it only when the new list resolves — so a refetch never
  // blanks already-painted rows to "Loading…".
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
        console.warn('[nav] list failed for', path, err instanceof Error ? err.message : err)
        setListings(prev => {
          const next = new Map(prev)
          next.set(path, []) // treat errors as empty; UI can surface later
          return next
        })
        // Self-heal stale references to a deleted directory. A removed
        // dir keeps firing ENOENT on every watch-resubscribe — once per
        // project switch — which is the console spam users see. Confirm
        // the dir is genuinely gone (a transient/permission error must
        // NOT drop nav state), then prune it from expanded + the listing
        // cache + selection so it stops being re-listed. If the dead dir
        // is the current cwd, re-root to the nearest surviving ancestor.
        void window.electron.files.dirExists(path).then(exists => {
          if (exists) return
          setExpanded(prev => {
            if (!prev.has(path)) return prev
            const next = new Set(prev)
            next.delete(path)
            return next
          })
          setListings(prev => {
            if (!prev.has(path)) return prev
            const next = new Map(prev)
            next.delete(path)
            return next
          })
          setSelectedItems(prev => {
            if (!prev.has(path)) return prev
            const next = new Map(prev)
            next.delete(path)
            return next
          })
          setPrimaryPath(prev => (prev === path ? null : prev))
          if (cwdRef.current === path) {
            void nearestExistingAncestor(
              path,
              p => window.electron.files.dirExists(p),
              '/'
            ).then(fallback => {
              setCwd(prev => (prev === path ? fallback : prev))
            })
          }
        }).catch(() => { /* probe unreachable — leave nav state intact */ })
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
      // ENH-211 D1 — do NOT delete/null the parent listing before refetch;
      // ensureListing now overwrites the stale array in place on resolve.
      // ENH-211 D2 — coalesce the refetch: collect the parent dir and flush
      // on a trailing-edge debounce so a burst yields ONE re-list per dir.
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
      if (event.kind === 'removed') {
        // ENH-147 — drop the removed path from the multi-select map; if
        // it was the primary, advance primary to any remaining entry
        // (or null if the set emptied). ENH-211 keeps this SYNCHRONOUS —
        // only the listing refetch above is debounced; a deleted file's
        // selection must clear at once.
        setSelectedItems(curr => {
          if (!curr.has(event.path)) return curr
          const next = new Map(curr)
          next.delete(event.path)
          return next
        })
        setPrimaryPath(curr => (curr === event.path ? null : curr))
      }
    }

    void window.electron.files.watch(paths, handleEvent).then(stop => {
      if (cancelled) { void stop(); return }
      unwatch = stop
      // Belt-and-suspenders: refresh visible folders once after the
      // watcher is fully attached, so any events that fired during
      // the sub-resub window are reflected. Cheap (one fs.readdir per
      // visible folder) and keeps the tree honest.
      // ENH-211 D1 — refetch in place; do NOT delete the existing listing
      // first (ensureListing overwrites on resolve), so a resubscribe
      // doesn't blank already-painted folders to "Loading…".
      for (const p of paths) ensureListing(p)
    }).catch(err => {
      console.warn('[nav] watch failed:', err instanceof Error ? err.message : err)
    })

    return () => {
      cancelled = true
      if (unwatch) void unwatch()
      // ENH-211 D2 — clear any pending debounced refetch so no setState
      // fires after teardown. (The trailing flush also re-checks
      // `cancelled` as a second guard.)
      const pending = pendingRefetchRef.current
      if (pending.timer) { clearTimeout(pending.timer); pending.timer = null }
      pending.dirs.clear()
    }
  }, [cwd, expanded, ensureListing])

  const navigateTo = useCallback((path: string) => {
    setCwd(path)
    setSelectedItems(new Map())
    setPrimaryPath(null)
  }, [])

  const selectItem = useCallback((path: string, kind: 'file' | 'folder') => {
    // Stage 26 item 1: select-only. The previous "selecting a folder
    // re-roots the tree" coupling lived here as a setCwd side effect;
    // it now requires an explicit double-click (FileTree) or
    // navigateTo() call. computePendingCwd already returns sel.path
    // for folder selections, so terminal-CWD inheritance is preserved.
    // ENH-147 — single-select replaces the entire multi-select map.
    setSelectedItems(new Map([[path, kind]]))
    setPrimaryPath(path)
  }, [])

  const toggleSelection = useCallback((path: string, kind: 'file' | 'folder') => {
    // ENH-147 — ⌘-click toggle: if path is in the map, remove it; else
    // add it. Sets primary to the newly-added path; if removing, drops
    // primary if it pointed at the removed path (next render will
    // surface the back-compat `selected` as the next remaining entry,
    // or null if emptied).
    setSelectedItems(prev => {
      const next = new Map(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.set(path, kind)
      }
      return next
    })
    setPrimaryPath(prev => {
      // If we were removing this path AND it was the primary, drop it.
      // If we were adding, make it the new primary.
      if (selectedItems.has(path)) {
        return prev === path ? null : prev
      }
      return path
    })
  }, [selectedItems])

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
    // ENH-147 — also replaces the multi-select map with the revealed
    // path as the sole entry (consistent with the "atomic single-
    // select" guarantee callers depend on).
    const dir = filePath.slice(0, filePath.lastIndexOf('/')) || '/'
    setCwd(dir)
    setSelectedItems(new Map([[filePath, 'file']]))
    setPrimaryPath(filePath)
  }, [])

  /** ENH-148 — ⇧-click range-select. Replaces the entire selection
   *  with the supplied paths in one update so partial states never
   *  leak through React's batching. */
  const selectRange = useCallback((paths: string[], kinds: Array<'file' | 'folder'>, newPrimary: string) => {
    if (paths.length === 0) return
    const map = new Map<string, 'file' | 'folder'>()
    for (let i = 0; i < paths.length; i++) {
      map.set(paths[i], kinds[i] ?? 'file')
    }
    setSelectedItems(map)
    setPrimaryPath(newPrimary)
  }, [])

  /** ENH-148 — ⌘-A select all visible rows. Same shape as selectRange
   *  but the primary becomes the FIRST entry (most-natural anchor for
   *  follow-up ⇧-click extends). Caller decides the cap (see the spec:
   *  current directory + immediate children). */
  const selectAllVisible = useCallback((paths: string[], kinds: Array<'file' | 'folder'>) => {
    if (paths.length === 0) return
    const map = new Map<string, 'file' | 'folder'>()
    for (let i = 0; i < paths.length; i++) {
      map.set(paths[i], kinds[i] ?? 'file')
    }
    setSelectedItems(map)
    setPrimaryPath(paths[0])
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedItems(new Map())
    setPrimaryPath(null)
  }, [])

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
    // ENH-211 D1 — refetch in place; keep the stale listing until the new
    // one resolves (ensureListing overwrites on resolve) instead of
    // deleting first and flashing the "Loading…" sentinel.
    ensureListing(path)
  }, [ensureListing])

  // ENH-147 — derive `selected` for back-compat. Points at the primary
  // entry of selectedItems when one exists, or any remaining entry if
  // primaryPath was removed but the map still has members. Null when
  // the map is empty.
  const selected: NavigatorState['selected'] = (() => {
    if (selectedItems.size === 0) return null
    const primaryKind = primaryPath !== null ? selectedItems.get(primaryPath) : undefined
    if (primaryPath !== null && primaryKind !== undefined) {
      return { path: primaryPath, kind: primaryKind }
    }
    // primaryPath stale (removed) — surface the first remaining entry.
    const [firstPath, firstKind] = selectedItems.entries().next().value as [string, 'file' | 'folder']
    return { path: firstPath, kind: firstKind }
  })()

  const state: NavigatorState = { cwd, selectedItems, selected, expanded, pinned, showDotfiles, listings }
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
