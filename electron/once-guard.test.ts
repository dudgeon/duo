// ENH-191 P2 (item 8) — the re-register dry-run assertion: proves the
// app-scoped one-time registration (duo-asset protocol.handle, the
// persist:duo-browser partition handler) fires EXACTLY once even when a
// reentrant createWindow (P5a) drives the registration path a second time.
// The negative control pins that without the guard a second call WOULD
// re-run (the duplicate-handler crash class). Pure node-env, mirrors
// safe-send.test.ts.

import { describe, it, expect, vi } from 'vitest'
import { makeOnceGuard } from './once-guard'

describe('once-guard — app-scoped register-once (ENH-191 P2 item 8)', () => {
  it('runs the action exactly once across repeated invocations (window 2 dry-run)', () => {
    const register = vi.fn()
    const guard = makeOnceGuard()
    guard(register) // createWindow #1 (first window)
    guard(register) // createWindow #2 (dock-reopen / window 2) — must NOT re-register
    guard(register) // a third, for good measure
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('ignores the action passed to later calls (first registration wins)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const guard = makeOnceGuard()
    guard(first)
    guard(second)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  // NEGATIVE CONTROL: an UNGUARDED registration re-runs on the second call —
  // exactly the duplicate-protocol-handler crash item 8 prevents. Proves the
  // guard above is load-bearing, not decorative.
  it('an unguarded registration re-runs (the crash this guard prevents)', () => {
    const register = vi.fn()
    const unguarded = (action: () => void) => action() // no once-latch
    unguarded(register)
    unguarded(register)
    expect(register).toHaveBeenCalledTimes(2)
  })

  it('separate guard instances are independent', () => {
    const a = vi.fn()
    const b = vi.fn()
    const guardA = makeOnceGuard()
    const guardB = makeOnceGuard()
    guardA(a)
    guardA(a)
    guardB(b)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })
})
