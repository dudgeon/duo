// Stage 26 PR 2 (ENH-010) — navigator pins state machine.
//
// Mirrors useNavigator's shape: state + actions. Backed by main's
// NavPinsService (atomic-write nav-pins.json). v1 keeps the entire
// pin list in renderer memory — pins are typically <100 entries; the
// list never paginates, so a snapshot-and-toggle model is fine.
//
// Why a separate hook from Stage 24's tab pins: different storage,
// different identity model (path-only vs. kind+url/path), different
// UI surface (left-pane bottom section vs. right-pane tab strip).
// Sharing a hook would have forced a discriminated-union state shape
// that doesn't pay off — the use sites are entirely disjoint.

import { useCallback, useEffect, useState } from 'react'
import type { NavPinEntry } from '@shared/types'

export interface NavPinsApi {
  pins: NavPinEntry[]
  isPinned: (path: string) => boolean
  toggle: (entry: NavPinEntry) => Promise<void>
}

export function useNavPins(): NavPinsApi {
  const [pins, setPins] = useState<NavPinEntry[]>([])

  // Load on mount. Failures fall back to an empty list (matches the
  // service's read-best-effort posture — corrupt nav-pins.json should
  // not break the navigator).
  useEffect(() => {
    let cancelled = false
    void window.electron.navPins.list().then(list => {
      if (!cancelled) setPins(list)
    }).catch(err => {
      console.warn('[nav-pins] load failed:', err instanceof Error ? err.message : err)
    })
    return () => { cancelled = true }
  }, [])

  // BUG-030 — subscribe to main-process push events so CLI mutations
  // (`duo nav pin/unpin`) and any future window-to-window updates show
  // up live without a relaunch.
  useEffect(() => {
    const unsubscribe = window.electron.navPins.onChange((next) => {
      setPins(next)
    })
    return () => { unsubscribe() }
  }, [])

  const isPinned = useCallback((path: string) => {
    return pins.some(p => p.path === path)
  }, [pins])

  const toggle = useCallback(async (entry: NavPinEntry) => {
    try {
      const next = await window.electron.navPins.toggle(entry)
      setPins(next)
    } catch (err) {
      console.warn('[nav-pins] toggle failed:', err instanceof Error ? err.message : err)
    }
  }, [])

  return { pins, isPinned, toggle }
}
