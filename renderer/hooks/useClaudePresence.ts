// ENH-013 — claude-presence state for the front terminal. The Send →
// Duo pill is enabled when this returns 'claude' or 'starting'. Other
// states ('shell', 'no-pty') hide the pill — sending into a non-Claude
// PTY produces noise the user has to clean up.
//
// Source-of-truth lives in main (electron/claude-presence.ts); the
// renderer only subscribes and caches the latest state.

import { useEffect, useState } from 'react'
import type { ClaudePresenceState } from '@shared/types'

export function useClaudePresence(): ClaudePresenceState {
  const [state, setState] = useState<ClaudePresenceState>('no-pty')

  useEffect(() => {
    const unsubscribe = window.electron.terminal?.onClaudePresenceChange((next) => {
      setState(next)
    })
    return () => { unsubscribe?.() }
  }, [])

  return state
}

/** Convenience: true iff the front terminal has a live Claude session
 *  (or is in the starting-grace window after a kind=='claude' tab
 *  spawn). False otherwise — pill should not render. */
export function useFrontTerminalClaudeLive(): boolean {
  const state = useClaudePresence()
  return state === 'claude' || state === 'starting'
}
