// Sprint 10 ENH-104 — single per-app autosave preference, persisted
// to localStorage at the same key for both the markdown editor and
// the HTML canvas. Owner-locked Sprint 10: no per-tab override, no
// per-file override. Single global toggle, defaults to ON.

import { useCallback, useEffect, useState } from 'react'

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
 *  SaveControl in the same Duo session. */
export function useAutosavePreference(): [boolean, () => void] {
  const [autosaveOn, setAutosaveOn] = useState<boolean>(() => readAutosavePreference())

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
    setAutosaveOn(prev => {
      const next = !prev
      writeAutosavePreference(next)
      return next
    })
  }, [])

  return [autosaveOn, toggle]
}
