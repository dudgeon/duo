// FOLLOWUP-031 — a single, hoisted claude-presence subscription.
//
// Before this, useClaudePresence() opened its own IPC listener on every call,
// so an N-tab session registered N+2 onClaudePresenceChange listeners (one per
// TerminalInstance + TerminalPane's top-level call + App's body call) and
// tripped Node's MaxListenersExceededWarning (>10). claude-presence is a single
// front-terminal-global scalar broadcast from main, so ONE subscription is
// enough; every consumer now reads it from this context instead.
//
// Source of truth stays in main (electron/claude-presence.ts); this only caches
// the latest broadcast. The provider must wrap <App/> at the ROOT
// (renderer/main.tsx) so App's own-body consumer (useFrontTerminalClaudeLive,
// App.tsx) resolves the context too — a hook called in App's body reads the
// nearest provider ABOVE App, not one rendered inside App's JSX.

import { createContext, useEffect, useState, type ReactNode } from 'react'
import type { ClaudePresenceState } from '@shared/types'

export const ClaudePresenceContext = createContext<ClaudePresenceState>('no-pty')

export function ClaudePresenceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ClaudePresenceState>('no-pty')

  useEffect(() => {
    const unsubscribe = window.electron.terminal?.onClaudePresenceChange((next) => {
      setState(next)
    })
    return () => { unsubscribe?.() }
  }, [])

  return <ClaudePresenceContext.Provider value={state}>{children}</ClaudePresenceContext.Provider>
}
