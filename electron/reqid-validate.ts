// ENH-191 P3 (seam M2) — the sender-validated reqId reply resolver, extracted
// as a pure node-env module (mirrors window-resolve.ts / cache-key.ts) so the
// drop-a-foreign-reply contract is unit-testable without mounting Electron.
//
// Replaces the 12 `Map<reqId, (res) => void>` request/reply families in main.ts
// (docWritePending, docReadPending, htmlOpPending, sessionSnapshotPending, …).
// Today each reply handler resolves the pending purely by reqId — the `_event`
// is discarded — so ANY window could resolve a request dispatched to another.
// P3 records the TARGET window id at dispatch and DROPS a reply whose
// `event.sender` window id doesn't match.
//
// The Maps stay global (reqIds are random + per-family-prefixed, so cross-family
// collisions are vanishingly unlikely): only the REQUEST goes to a chosen window
// and the REPLY is validated. A foreign / unresolvable sender is dropped WITHOUT
// deleting the entry, so the legitimate reply can still arrive (the existing
// per-family timeout cleans up an entry that never gets a valid reply).
//
// At N=1 this is byte-identical to the old `if (resolver) { delete; resolve }`:
// the sole window is always the recorded target, so `deliver` always matches and
// resolves exactly as before (the unknown-reqId miss and the timeout delete are
// unchanged). The `BrowserWindow.fromWebContents(event.sender)?.id` → number
// resolution stays in main.ts (the impure boundary) and is passed in pre-resolved
// — the same split as `resolveBySender(registry, windowId)`.

/** A pending request: the window it was dispatched to + its reply resolver. */
export interface PendingEntry<R> {
  readonly targetWindowId: number
  readonly resolve: (res: R) => void
}

export class PendingRegistry<R> {
  private readonly pending = new Map<string, PendingEntry<R>>()

  /** Record a dispatched request: `reqId` is expected to be answered by the
   *  window `targetWindowId` (the dispatch site resolved it via
   *  `liveMainWindow().id` / `registry.only()`). */
  set(reqId: string, targetWindowId: number, resolve: (res: R) => void): void {
    this.pending.set(reqId, { targetWindowId, resolve })
  }

  /**
   * Resolve `reqId` with `res` IFF the reply came from the recorded target
   * window. Returns `true` when it resolved (and removes the entry), `false`
   * otherwise:
   *   - unknown reqId (never dispatched, or already delivered / timed out) → false
   *   - `senderWindowId` undefined (a destroyed/unresolvable WebContents — never
   *     a wildcard) → false, entry LEFT PENDING
   *   - sender ≠ recorded target → false, entry LEFT PENDING (so the real
   *     window's reply can still arrive; the per-family timeout reaps it)
   */
  deliver(reqId: string, senderWindowId: number | undefined, res: R): boolean {
    const entry = this.pending.get(reqId)
    if (!entry) return false
    if (senderWindowId === undefined || entry.targetWindowId !== senderWindowId) {
      return false
    }
    this.pending.delete(reqId)
    entry.resolve(res)
    return true
  }

  /** Drop a pending entry (the per-family timeout path). */
  delete(reqId: string): void {
    this.pending.delete(reqId)
  }

  has(reqId: string): boolean {
    return this.pending.has(reqId)
  }

  size(): number {
    return this.pending.size
  }
}
