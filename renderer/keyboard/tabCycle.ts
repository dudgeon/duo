// BUG-038 (4th instance) — extract the ⌃Tab / ⌃⇧Tab cycle into pure
// helpers so the contract is testable when the unit-test framework
// lands (PROCESS-001 Phase 2). This file has zero React/DOM deps so
// a future test fixture can do:
//
//   import { cycleNext } from './tabCycle'
//   const tabs = [{id:'a'}, {id:'b'}, {id:'c'}]
//   expect(cycleNext(tabs, 'a',  1)).toEqual('b')   // forward
//   expect(cycleNext(tabs, 'a', -1)).toEqual('c')   // backward (wrap)
//   expect(cycleNext(tabs, 'b',  1)).toEqual('c')
//   expect(cycleNext(tabs, 'c',  1)).toEqual('a')   // wrap forward
//   expect(cycleNext(tabs, 'unknown', 1)).toEqual('a')  // -1 idx → fall through
//
// The recurring failure mode (BUG-001 / BUG-021 / BUG-038 v1 / BUG-038
// v2) was always one of:
//   1. Stale closure over `tabs` or `activeTabId` (BUG-021 — fixed
//      with refs in the call site).
//   2. Stale closure over `activePaneFocus` so the cycle took the
//      wrong branch (BUG-038 v2 — fixed with another ref).
//   3. xterm eating the ⌃Tab key (BUG-001 — fixed with the global
//      shortcut matcher in `globalShortcuts.ts`).
//
// All three failure modes are upstream of this module. Every cycle
// failure observed since BUG-021 has been a `pane` / `activeTabId`
// staleness issue, not a math bug. This helper is intentionally
// small — the value is making the contract a single named function
// other code can reason about + test, not adding logic.

export interface CycleableTab {
  id: string
}

/**
 * Compute the next tab ID when cycling forward (delta=1) or
 * backward (delta=-1). Wraps around either end. If `currentId`
 * isn't in `tabs`, falls back to the first tab going forward or
 * the last tab going backward (so a stale activeTabId never
 * silently no-ops).
 */
export function cycleNext(
  tabs: ReadonlyArray<CycleableTab>,
  currentId: string,
  delta: 1 | -1
): string | null {
  if (tabs.length === 0) return null
  const idx = tabs.findIndex(t => t.id === currentId)
  // findIndex === -1 fallthrough: forward → first, backward → last.
  // (idx + delta + length) % length yields:
  //   forward: (-1 + 1 + N) % N = 0
  //   backward: (-1 + -1 + N) % N = N - 2  (NOT what we want)
  // — so handle the fallback explicitly for parity.
  if (idx === -1) return tabs[delta === 1 ? 0 : tabs.length - 1].id
  const nextIdx = (idx + delta + tabs.length) % tabs.length
  return tabs[nextIdx].id
}
