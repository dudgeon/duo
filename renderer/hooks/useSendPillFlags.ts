// ENH-176 (Sprint 20 / v0.7.7) — independent feature flags for the
// two Send-pill variants. Both default-on-or-off per owner spec; no
// UI surface (intentionally hidden — toggled via DevTools / future
// CLI / agent-pushed config). The pill chrome itself remains shared
// (see SendToDuoPill); these flags only decide which destinations
// the host wires up + what label the pill shows.
//
// Owner-locked design 2026-05-23:
//   - Agent flag (default ON): the Sprint 16 / v0.6.15 behavior.
//     Pill appears when claudePresence reports 'claude' on the front
//     terminal; clicking writes the formatted selection into the
//     active PTY. Label: "Send → agent".
//   - Terminal flag (default OFF): same pill chrome + payload path
//     but fires whenever there's a front terminal at all (regardless
//     of claudePresence). Useful for bare shell or non-Claude agent
//     workflows. Label: "Send → Terminal".
//   - When BOTH could fire (claude live + both flags on), AGENT
//     wins. The terminal variant is opt-in for the no-claude case.
//
// Storage keys are stable across reloads + window resizes; we
// subscribe to the `storage` event so DevTools edits in another
// window propagate without a manual reload.

import { useEffect, useState } from 'react'

const LS_KEY_AGENT = 'duo.sendPill.agent'
const LS_KEY_TERMINAL = 'duo.sendPill.terminal'

export interface SendPillFlags {
  agent: boolean
  terminal: boolean
}

function readFlag(key: string, defaultValue: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return defaultValue
    return raw === 'true' || raw === '1'
  } catch {
    return defaultValue
  }
}

function readFlags(): SendPillFlags {
  return {
    agent: readFlag(LS_KEY_AGENT, true),    // default ON (preserves Sprint 16 behavior)
    terminal: readFlag(LS_KEY_TERMINAL, false) // default OFF (new opt-in)
  }
}

export function useSendPillFlags(): SendPillFlags {
  const [flags, setFlags] = useState<SendPillFlags>(readFlags)

  useEffect(() => {
    function refresh(event: StorageEvent | CustomEvent) {
      if ('key' in event && event.key && event.key !== LS_KEY_AGENT && event.key !== LS_KEY_TERMINAL) {
        return
      }
      setFlags(readFlags())
    }
    window.addEventListener('storage', refresh as EventListener)
    // Also react to same-window writes via a custom event so other
    // tabs in the same renderer can flip flags without a reload.
    window.addEventListener('duo:sendPillFlagsChanged', refresh as EventListener)
    return () => {
      window.removeEventListener('storage', refresh as EventListener)
      window.removeEventListener('duo:sendPillFlagsChanged', refresh as EventListener)
    }
  }, [])

  return flags
}

/** Imperative setter for the agent flag. Used by an eventual CLI
 *  verb / settings surface. */
export function setSendPillAgentFlag(enabled: boolean): void {
  try {
    window.localStorage.setItem(LS_KEY_AGENT, enabled ? 'true' : 'false')
    window.dispatchEvent(new CustomEvent('duo:sendPillFlagsChanged'))
  } catch {
    // Best-effort.
  }
}

/** Imperative setter for the terminal flag. */
export function setSendPillTerminalFlag(enabled: boolean): void {
  try {
    window.localStorage.setItem(LS_KEY_TERMINAL, enabled ? 'true' : 'false')
    window.dispatchEvent(new CustomEvent('duo:sendPillFlagsChanged'))
  } catch {
    // Best-effort.
  }
}
