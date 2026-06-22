// ENH-224 Phase 2 — shared git/gh stderr classifiers for the share-back write
// path (push / fork / pr). clone.ts (ENH-151) carries its own older private
// copies; these intentionally stay separate so a refactor never churns the
// shipped clone path — unify only if they drift in practice.

/** Heuristic: does this stderr read like a GitHub auth failure (→ bounce to
 *  `gh auth login`, D9)? Pure. */
export function looksLikeAuthFailure(stderr: string): boolean {
  const s = (stderr || '').toLowerCase()
  return (
    s.includes('authentication') ||
    s.includes('could not read username') ||
    s.includes('permission denied') ||
    s.includes('access denied') ||
    s.includes('403') ||
    s.includes('401') ||
    s.includes('not logged in') ||
    s.includes('gh auth login')
  )
}
