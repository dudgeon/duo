// Sprint 10 ENH-104 — single per-app autosave preference, persisted
// to localStorage at the same key for both the markdown editor and
// the HTML canvas. Owner-locked Sprint 10: no per-tab override, no
// per-file override. Single global toggle, defaults to ON.

import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'duo.autosave.v1'

/** Read the persisted preference. Defaults to true (autosave on) when
 *  unset or unparseable (private browsing, quota errors, corruption). */
export function readAutosavePreference(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return true
    return raw === 'on'
  } catch {
    return true
  }
}

function writeAutosavePreference(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off')
    // BroadcastChannel-style cross-tab sync — but localStorage's
    // 'storage' event already fires for OTHER tabs (not the one
    // that wrote). We dispatch a custom event in this tab so the
    // SaveControl in any other open editor/canvas re-renders too.
    window.dispatchEvent(new CustomEvent('duo:autosave-changed', { detail: value }))
  } catch { /* private browsing / quota — drop silently */ }
}

/** Hook — read the current preference + a stable toggler. Subscribes
 *  to changes from OTHER editor/canvas tabs in the same window so
 *  flipping the toggle in one surface updates every visible
 *  SaveControl in the same Duo session.
 *
 *  Walk-1 fix (Sprint 10) — pre-fix `toggle` called `writeAutosave-
 *  Preference(next)` from INSIDE the setState updater. `writeAutosave-
 *  Preference` synchronously dispatches a `duo:autosave-changed`
 *  CustomEvent, which fires listeners on every OTHER editor/canvas
 *  instance — those listeners call `setAutosaveOn(detail)`. When the
 *  trigger is a setState updater currently mid-flight, those setState
 *  calls land "during render of another component," which React 18
 *  flags as a developer warning. The fix below reads the current value
 *  through a ref so we can compute `next` and write it OUTSIDE any
 *  updater — same end state, no cross-instance render race. */
export function useAutosavePreference(): [boolean, () => void] {
  const [autosaveOn, setAutosaveOn] = useState<boolean>(() => readAutosavePreference())
  const currentRef = useRef(autosaveOn)
  currentRef.current = autosaveOn

  useEffect(() => {
    const onSameWindow = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail
      if (typeof detail === 'boolean') setAutosaveOn(detail)
    }
    const onOtherWindow = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      setAutosaveOn(e.newValue === 'on')
    }
    window.addEventListener('duo:autosave-changed', onSameWindow as EventListener)
    window.addEventListener('storage', onOtherWindow)
    return () => {
      window.removeEventListener('duo:autosave-changed', onSameWindow as EventListener)
      window.removeEventListener('storage', onOtherWindow)
    }
  }, [])

  const toggle = useCallback(() => {
    const next = !currentRef.current
    setAutosaveOn(next)
    // Outside the setState updater — the dispatchEvent in writeAutosave-
    // Preference fires listeners synchronously, but they're now batched
    // alongside setAutosaveOn rather than landing during another
    // component's render commit.
    writeAutosavePreference(next)
  }, [])

  return [autosaveOn, toggle]
}
