// ENH-208 Phase 2 (D22) — the vault-search palette opens a result "at line".
// The editor can't take a raw-disk line number directly (frontmatter is
// stripped into a panel, so disk lines ≠ ProseMirror positions). Instead the
// palette asks the editor to jump to the Nth occurrence of the query, where
// N is core search's per-hit `docMatchIndex` — computed against the file's
// BODY with the same case-insensitive, non-overlapping substring rule the
// editor's occurrence scan uses, so producer and consumer count the same
// thing (frontmatter hits carry null and degrade to N=0, first match).
//
// Two delivery paths, because the target editor may not exist yet:
//  - file already open → window CustomEvent (the mounted editor handles it)
//  - file just opened  → the event fires before the editor mounts, so the
//    request also parks here and the mounting editor consumes it.
// A handler that receives the live event must ALSO consume the parked copy
// (same path), so a stale request can never replay on a later remount.

export const VAULT_GOTO_MATCH_EVENT = 'duo-vault-goto-match'

export interface VaultGotoMatch {
  /** Absolute path of the file the request targets. */
  path: string
  /** The palette's query — what the occurrence scan matches. */
  query: string
  /** 0-based index of the target among the file's matches, document order. */
  matchIndex: number
}

let pending: VaultGotoMatch | null = null

/** Park a request for an editor that hasn't mounted yet. Callers dispatch
 *  the window event afterwards; whichever side runs first wins, the other
 *  no-ops. */
export function parkGotoMatch(req: VaultGotoMatch): void {
  pending = req
}

/** The editor for `path` claims its parked request (mount path), or clears
 *  it after handling the live event (already-open path). */
export function consumeGotoMatch(path: string): VaultGotoMatch | null {
  if (pending && pending.path === path) {
    const req = pending
    pending = null
    return req
  }
  return null
}
