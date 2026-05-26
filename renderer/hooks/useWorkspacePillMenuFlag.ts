// Workspace-pill click-to-open-menu feature flag.
//
// Gates the title-bar workspace badge's click handler (ENH-171). When
// OFF (default 2026-05-24), the badge renders as a passive label —
// click is a no-op, no dropdown opens, no caret shown. When ON, the
// ENH-171 dropdown behavior is restored.
//
// Mirrors the ENH-176 useSendPillFlags pattern: localStorage-backed,
// no UI surface, toggle via DevTools or a future CLI verb. Subscribes
// to both the cross-window `storage` event and a same-window
// `duo:workspacePillMenuFlagChanged` event so flips propagate
// without reload.
//
// Storage key: `duo.workspacePillMenu` — `'true'` / `'1'` to enable,
// anything else (or unset) keeps the default OFF.
//
// To re-enable in DevTools:
//   localStorage.setItem('duo.workspacePillMenu', 'true')
//   window.dispatchEvent(new CustomEvent('duo:workspacePillMenuFlagChanged'))

import { useEffect, useState } from 'react'

const LS_KEY = 'duo.workspacePillMenu'
const EVENT = 'duo:workspacePillMenuFlagChanged'
const DEFAULT_ENABLED = false

function readFlag(): boolean {
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (raw === null) return DEFAULT_ENABLED
    return raw === 'true' || raw === '1'
  } catch {
    return DEFAULT_ENABLED
  }
}

export function useWorkspacePillMenuFlag(): boolean {
  const [enabled, setEnabled] = useState<boolean>(readFlag)

  useEffect(() => {
    function refresh(event: StorageEvent | CustomEvent) {
      if ('key' in event && event.key && event.key !== LS_KEY) return
      setEnabled(readFlag())
    }
    window.addEventListener('storage', refresh as EventListener)
    window.addEventListener(EVENT, refresh as EventListener)
    return () => {
      window.removeEventListener('storage', refresh as EventListener)
      window.removeEventListener(EVENT, refresh as EventListener)
    }
  }, [])

  return enabled
}

export function setWorkspacePillMenuFlag(enabled: boolean): void {
  try {
    window.localStorage.setItem(LS_KEY, enabled ? 'true' : 'false')
    window.dispatchEvent(new CustomEvent(EVENT))
  } catch {
    // Best-effort.
  }
}
