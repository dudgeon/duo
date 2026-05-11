// Sprint 16 — Claude-tab Enter key preferences. ENH-127 v2 (v0.6.13)
// shipped "plain Return → newline" by default in Claude tabs and
// ENH-133 added Shift+Return → newline. Owner found the plain-Return
// override surprising (every other terminal in the world treats
// Return as submit), so v0.6.15 inverts the default to 'submit' but
// keeps the override capability behind a localStorage toggle.
// Shift+Return → newline stays as default ON (matches Slack / Discord
// / claude.ai web's "shift+enter = newline within composition"
// convention).
//
// Mirrors `useTheme`'s pattern: hook owns state + localStorage
// persistence, pushes to main so the CLI can read, listens for
// CLI-driven overrides. TerminalPane reads via refs the hook updates
// on every change.

import { useCallback, useEffect, useState } from 'react'

export type ClaudeReturnMode = 'submit' | 'newline'
export type ShiftReturnMode = 'submit' | 'newline'

const CLAUDE_RETURN_KEY = 'duo.claudeReturn.v1'
const SHIFT_RETURN_KEY = 'duo.shiftReturn.v1'

// New defaults (Sprint 16 / v0.6.15): plain Return submits like every
// other terminal; Shift+Return is the newline override.
const DEFAULT_CLAUDE_RETURN: ClaudeReturnMode = 'submit'
const DEFAULT_SHIFT_RETURN: ShiftReturnMode = 'newline'

function loadClaudeReturn(): ClaudeReturnMode {
  try {
    const v = localStorage.getItem(CLAUDE_RETURN_KEY)
    if (v === 'submit' || v === 'newline') return v
  } catch { /* sandbox / quota — fall through */ }
  return DEFAULT_CLAUDE_RETURN
}

function loadShiftReturn(): ShiftReturnMode {
  try {
    const v = localStorage.getItem(SHIFT_RETURN_KEY)
    if (v === 'submit' || v === 'newline') return v
  } catch { /* sandbox / quota — fall through */ }
  return DEFAULT_SHIFT_RETURN
}

export interface ClaudeKeyPrefsApi {
  claudeReturn: ClaudeReturnMode
  shiftReturn: ShiftReturnMode
  setClaudeReturn: (m: ClaudeReturnMode) => void
  setShiftReturn: (m: ShiftReturnMode) => void
}

export function useClaudeKeyPrefs(): ClaudeKeyPrefsApi {
  const [claudeReturn, setClaudeReturnState] = useState<ClaudeReturnMode>(loadClaudeReturn)
  const [shiftReturn, setShiftReturnState] = useState<ShiftReturnMode>(loadShiftReturn)

  // Push to main so `duo claude-return` / `duo shift-return` can read
  // without going through the renderer. Main caches; CLI socket
  // handler returns the cached value.
  useEffect(() => {
    window.electron.claudeKeyPrefs?.pushState({ claudeReturn, shiftReturn })
  }, [claudeReturn, shiftReturn])

  // Listen for CLI-driven overrides.
  useEffect(() => {
    return window.electron.claudeKeyPrefs?.onSet((prefs) => {
      if (prefs.claudeReturn && (prefs.claudeReturn === 'submit' || prefs.claudeReturn === 'newline')) {
        setClaudeReturnState(prefs.claudeReturn)
        try { localStorage.setItem(CLAUDE_RETURN_KEY, prefs.claudeReturn) } catch { /* sandbox */ }
      }
      if (prefs.shiftReturn && (prefs.shiftReturn === 'submit' || prefs.shiftReturn === 'newline')) {
        setShiftReturnState(prefs.shiftReturn)
        try { localStorage.setItem(SHIFT_RETURN_KEY, prefs.shiftReturn) } catch { /* sandbox */ }
      }
    })
  }, [])

  const setClaudeReturn = useCallback((m: ClaudeReturnMode) => {
    setClaudeReturnState(m)
    try { localStorage.setItem(CLAUDE_RETURN_KEY, m) } catch { /* sandbox */ }
  }, [])

  const setShiftReturn = useCallback((m: ShiftReturnMode) => {
    setShiftReturnState(m)
    try { localStorage.setItem(SHIFT_RETURN_KEY, m) } catch { /* sandbox */ }
  }, [])

  return { claudeReturn, shiftReturn, setClaudeReturn, setShiftReturn }
}
