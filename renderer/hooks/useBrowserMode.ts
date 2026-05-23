// ENH-178 (Sprint 20 / v0.7.7) — renderer-side persistence + main
// sync for the three-mode browser URL filter.
//
// Source of truth: this hook reads on mount + pushes any subsequent
// changes (from CLI verb `duo browser-mode <mode>`, or future
// Settings UI) to the main process so BrowserManager.setBrowserMode
// is in lockstep with the renderer's cached value.
//
// Default: `'local-only'` for new installs. Existing users whose
// machine already has `~/.claude/duo/external-domains.json` get
// migrated to `'filtered'` on first read so their off-host redirects
// keep working as before.

import { useEffect, useState } from 'react'
import type { BrowserMode } from '@shared/types'

const LS_KEY = 'duo.browserMode'

function readPersistedMode(defaultMode: BrowserMode = 'local-only'): BrowserMode {
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (raw === 'unfiltered' || raw === 'filtered' || raw === 'local-only') return raw
    return defaultMode
  } catch {
    return defaultMode
  }
}

function writePersistedMode(mode: BrowserMode): void {
  try { window.localStorage.setItem(LS_KEY, mode) } catch { /* best-effort */ }
}

export function useBrowserMode(): { mode: BrowserMode; setMode: (mode: BrowserMode) => void } {
  const [mode, setModeState] = useState<BrowserMode>(() => readPersistedMode())

  // On mount: push the persisted value to main so BrowserManager
  // picks it up immediately. Without this, main would start in its
  // hardcoded default (also 'local-only') and ignore the user's
  // saved preference until the first CLI invocation.
  useEffect(() => {
    void window.electron.browserMode?.set(mode)
  }, [mode])

  // Subscribe to CLI-driven pushes (`duo browser-mode <mode>`).
  useEffect(() => {
    const unsubscribe = window.electron.browserMode?.onPush((next) => {
      setModeState(next)
      writePersistedMode(next)
    })
    return () => { unsubscribe?.() }
  }, [])

  const setMode = (next: BrowserMode) => {
    setModeState(next)
    writePersistedMode(next)
    void window.electron.browserMode?.set(next)
  }

  return { mode, setMode }
}
