// ENH-013 — claude-presence state for the front terminal. The Send → Duo pill
// is enabled when this returns 'claude' or 'starting'. Other states ('shell',
// 'no-pty') hide the pill — sending into a non-Claude PTY produces noise the
// user has to clean up.
//
// FOLLOWUP-031 — these are now thin consumers of ClaudePresenceContext, which
// owns the single IPC subscription (one listener for the whole app, not one per
// call — the old per-call subscription tripped MaxListenersExceededWarning).
// Source of truth still lives in main (electron/claude-presence.ts).

import { useContext } from 'react'
import type { ClaudePresenceState } from '@shared/types'
import { ClaudePresenceContext } from '../contexts/ClaudePresenceContext'

export function useClaudePresence(): ClaudePresenceState {
  return useContext(ClaudePresenceContext)
}

/** Convenience: true iff the front terminal has a live Claude session (or is in
 *  the starting-grace window after a kind=='claude' tab spawn). False otherwise
 *  — the pill should not render. */
export function useFrontTerminalClaudeLive(): boolean {
  const state = useClaudePresence()
  return state === 'claude' || state === 'starting'
}
