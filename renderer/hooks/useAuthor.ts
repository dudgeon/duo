// BUG-138 Phase 2 — author identity hook used when stamping
// CriticMarkup marks (track-changes inserts/deletes/substitutes,
// comments). Mirrors `useTheme` / `useClaudeKeyPrefs`: this hook owns
// state + localStorage persistence, pushes the current value to main
// so `duo author` can read without a renderer round-trip, and
// listens for CLI-driven overrides via the AUTHOR_SET IPC.
//
// Default: the OS `USER` env var when localStorage is empty. The
// renderer's `window.electron.env.user` snapshot carries this so we
// don't need a separate IPC for first-read attribution.

import { useCallback, useEffect, useState } from 'react'

const AUTHOR_KEY = 'duo:author'

function loadStoredAuthor(): string {
  try {
    const v = localStorage.getItem(AUTHOR_KEY)
    if (typeof v === 'string' && v.trim().length > 0) return v.trim()
  } catch { /* sandbox / quota — fall through */ }
  // Fall back to the OS user. Surfaced by preload's env snapshot
  // (process.env.USER). Defaults to '' on unexpected environments.
  const envUser = window.electron?.env?.USER ?? ''
  return envUser.trim()
}

export interface AuthorApi {
  author: string
  setAuthor: (next: string) => void
}

export function useAuthor(): AuthorApi {
  const [author, setAuthorState] = useState<string>(loadStoredAuthor)

  // Push to main so `duo author` returns the cached value without
  // round-tripping the renderer. Re-fires on every change so the
  // cache stays current.
  useEffect(() => {
    window.electron.author?.pushState({ author })
  }, [author])

  // Listen for CLI-driven overrides (`duo author "<name>"` in a Duo
  // terminal). The main process echoes the new value back; the hook
  // updates local state + localStorage. The cache in main was set
  // eagerly when the CLI verb fired, so a read between the verb
  // returning and this listener firing still gets the right value.
  useEffect(() => {
    return window.electron.author?.onSet((next) => {
      const trimmed = (next ?? '').trim()
      if (trimmed.length === 0) return
      setAuthorState(trimmed)
      try { localStorage.setItem(AUTHOR_KEY, trimmed) } catch { /* sandbox */ }
    })
  }, [])

  const setAuthor = useCallback((next: string) => {
    const trimmed = (next ?? '').trim()
    if (trimmed.length === 0) return
    setAuthorState(trimmed)
    try { localStorage.setItem(AUTHOR_KEY, trimmed) } catch { /* sandbox */ }
  }, [])

  return { author, setAuthor }
}
