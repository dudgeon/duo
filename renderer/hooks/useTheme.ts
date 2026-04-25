// Stage 11 § D33d — theme toggle. Refreshed in Stage 12 (Atelier).
//
// Three modes: 'system' (follows macOS appearance), 'light', 'dark'.
// **Default for fresh installs is 'light'** — Atelier's "light is hero,
// dark is a respectful follower" framing. Existing users keep their
// saved preference. The hook owns the state, the localStorage
// persistence, and the `<html class="light"|"dark">` write-out. The
// renderer also pushes state to main so `duo theme` can read/write
// without an IPC round-trip.

import { useCallback, useEffect, useState } from 'react'
import type { ThemeMode } from '@shared/types'

export type { ThemeMode }

const STORAGE_KEY = 'duo.theme'

function loadMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* localStorage may be sandboxed */ }
  // Stage 12 — fresh installs default to light (the Atelier hero).
  // Was 'system' before; existing users with a saved preference keep it.
  return 'light'
}

function getSystemDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyClass(effective: 'light' | 'dark') {
  const html = document.documentElement
  if (effective === 'light') {
    html.classList.add('light')
    html.classList.remove('dark')
  } else {
    html.classList.add('dark')
    html.classList.remove('light')
  }
}

export interface ThemeApi {
  mode: ThemeMode
  effective: 'light' | 'dark'
  setMode: (m: ThemeMode) => void
  cycleMode: () => void
}

export function useTheme(): ThemeApi {
  const [mode, setModeState] = useState<ThemeMode>(loadMode)
  const [systemDark, setSystemDark] = useState<boolean>(getSystemDark)

  // Track macOS appearance changes when in 'system' mode.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const effective: 'light' | 'dark' =
    mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  // Apply on every render where effective changes.
  useEffect(() => {
    applyClass(effective)
  }, [effective])

  // Push the current state to the main process so `duo theme` works.
  useEffect(() => {
    window.electron.theme?.pushState({ mode, effective })
  }, [mode, effective])

  // Listen for CLI-driven overrides (`duo theme <mode>`).
  useEffect(() => {
    return window.electron.theme?.onSet((m) => {
      setModeState(m)
      try { localStorage.setItem(STORAGE_KEY, m) } catch { /* sandbox */ }
    })
  }, [])

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m)
    try { localStorage.setItem(STORAGE_KEY, m) } catch { /* sandbox */ }
  }, [])

  const cycleMode = useCallback(() => {
    setMode(mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system')
  }, [mode, setMode])

  return { mode, effective, setMode, cycleMode }
}
