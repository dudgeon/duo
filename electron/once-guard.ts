// ENH-191 P2 (seam: item 8) — a run-exactly-once guard for app-scoped
// registrations that a reentrant createWindow (P5a) must NOT repeat. The
// canonical use is the duo-asset protocol.handle registration: Electron
// throws an opaque "Attempted to register a second handler for 'duo-asset'"
// if a per-window path re-runs it. Routing app-scoped one-time setup through
// this guard makes the "register once, never re-register per window"
// invariant durable even if the call later moves into a reentrant path —
// the second invocation is a silent no-op instead of a crash.
//
// Pure (zero Electron imports) so the once-semantics are unit-testable in a
// vitest node env (mirrors safe-send.ts / window-registry.ts). This is the
// "re-register dry-run assertion" for spec item 8.

/**
 * Returns a guard that runs the FIRST `action` it is given and no-ops on
 * every subsequent call (regardless of the action passed). One guard instance
 * protects one logical registration (which may itself perform several
 * sub-registrations inside the single action).
 */
export function makeOnceGuard(): (action: () => void) => void {
  let done = false
  return (action: () => void) => {
    if (done) return
    done = true
    action()
  }
}
