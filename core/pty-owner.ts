// ENH-191 P3 (seam M4) — pure owner-routing + lifecycle logic for PtyManager,
// extracted as a node-env module (mirrors core/event-sink.ts being pure) so the
// multi-window PTY contract is unit-testable without node-pty or Electron.
//
// The shared PTY pool gains an ownerWindowId per Session (P3-S4). These three
// helpers are how that ownership routes:
//   - routeSend       — deliver a PTY_DATA/PTY_EXIT/substituted-note send to the
//                        session's OWNING window, FALLING BACK to the sole window
//                        when the owner is unresolved (the cold-start drop guard).
//   - disposeForWindow — tear down only one window's sessions (the workspace-swap
//                        path), leaving other windows' terminals alive.
//   - listIdsByCwdOwned — cwd match filtered by owner (the C9 positional-match
//                        fix: a shared pool interleaves same-cwd terminals across
//                        windows, so the positional cwd→tabId walk must stay
//                        within one window's tabs).
//
// Electron-FREE by construction: routeSend is generic over the window type `W`
// (the caller passes resolveOwner/fallback closures that produce a WindowLike),
// and the session shapes are minimal structural interfaces — no `electron` or
// `node-pty` import, so the whole module loads in a node-env test.
//
// At N=1 every helper is byte-identical to today: the sole window is every
// session's owner, so routeSend hits the same webContents safeSend did,
// disposeForWindow(soleId) kills the same set dispose() did, and
// listIdsByCwdOwned(cwd, soleId) === the unfiltered list in the same order.

/** A session that knows which window owns it (the field PtyManager adds in S4). */
export interface OwnedSession {
  ownerWindowId?: number
}

/** Owner-routing of a single session's send to its window, with sole-window
 *  fallback. `W` is the window type (WindowLike in main.ts) — kept generic so
 *  this module imports zero Electron.
 *
 *  The fallback is LOAD-BEARING: a naive `resolveOwner(ownerId)?.send(...)`
 *  SILENTLY DROPS a send when the owner is transiently unresolved (a PTY_DATA
 *  firing before/around window registration, or after the owner window closed).
 *  routeSend instead delivers to `fallback()` (the sole window) in that case.
 */
export function routeSend<W>(
  sessions: ReadonlyMap<string, OwnedSession>,
  sessionId: string,
  resolveOwner: (windowId: number) => W | undefined,
  fallback: () => W | undefined
): W | undefined {
  const ownerId = sessions.get(sessionId)?.ownerWindowId
  return (ownerId != null ? resolveOwner(ownerId) : undefined) ?? fallback()
}

/** A killable, owned session — the shape disposeForWindow needs. */
export interface KillableSession extends OwnedSession {
  pty: { kill: () => void }
}

/** Kill + delete every session owned by `windowId`; return the killed ids (in
 *  insertion order). Does NOT mark ids exited — parity with the old `dispose()`
 *  (the onExit handler the caller already registered does that asynchronously).
 *  The workspace-swap path (applyNewSessionState) uses this so swapping window A
 *  can never nuke window B's terminals. */
export function disposeForWindow(
  sessions: Map<string, KillableSession>,
  windowId: number
): string[] {
  const killed: string[] = []
  for (const [id, s] of sessions) {
    if (s.ownerWindowId === windowId) {
      s.pty.kill()
      killed.push(id)
    }
  }
  for (const id of killed) sessions.delete(id)
  return killed
}

/** A cwd-bearing, owned session — the shape listIdsByCwdOwned needs. */
export interface CwdSession extends OwnedSession {
  cwd: string
}

/** Ids whose session matches `cwd` (exact, in insertion order — same predicate
 *  as PtyManager.listIdsByCwd today), optionally filtered to one owner. An
 *  undefined `ownerWindowId` means "all owners" → byte-identical to the
 *  unfiltered list. Owner-filtering keeps the C9 positional cwd→tabId match
 *  within a single window's tabs when the shared pool interleaves same-cwd
 *  terminals from multiple windows. */
export function listIdsByCwdOwned(
  sessions: ReadonlyMap<string, CwdSession>,
  cwd: string,
  ownerWindowId?: number
): string[] {
  const ids: string[] = []
  for (const [id, s] of sessions) {
    if (s.cwd === cwd && (ownerWindowId === undefined || s.ownerWindowId === ownerWindowId)) {
      ids.push(id)
    }
  }
  return ids
}
