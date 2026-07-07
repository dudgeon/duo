// ENH-224 Phase 2 — shared git/gh stderr classifiers, now used by ALL the
// git surfaces (push / fork / pr via the loose matcher, clone via
// `{ strict: true }`, pull via the loose matcher). ENH-253 dedup'd clone.ts's
// older private copies into here; the `strict` flag preserves clone's
// original (narrower) pattern set so the dedup didn't change its behavior.

/** Heuristic: does this stderr read like a GitHub auth failure (→ bounce to
 *  `gh auth login`, D9)? Pure.
 *
 *  `strict: true` reproduces clone.ts's pre-ENH-253 private matcher exactly:
 *  no 'access denied' pattern, and only the full 'please run: gh auth login'
 *  phrase (gh's literal wording) rather than any bare 'gh auth login'
 *  mention. The share-back path (push/fork/pr) keeps the looser default. */
export function looksLikeAuthFailure(stderr: string, opts: { strict?: boolean } = {}): boolean {
  const s = (stderr || '').toLowerCase()
  return (
    s.includes('authentication') ||
    s.includes('could not read username') ||
    s.includes('permission denied') ||
    (!opts.strict && s.includes('access denied')) ||
    s.includes('403') ||
    s.includes('401') ||
    s.includes('not logged in') ||
    s.includes(opts.strict ? 'please run: gh auth login' : 'gh auth login')
  )
}

/** Heuristic: does this stderr read like "the remote/URL doesn't exist" (bad
 *  URL / typo / private repo the user can't see) rather than a real failure?
 *  Pure. ENH-253 — hoisted out of clone.ts's private copy so clone/pull share
 *  one classifier instead of drifting. */
export function looksLikeBadUrl(stderr: string): boolean {
  const s = (stderr || '').toLowerCase()
  return (
    s.includes('repository not found') ||
    s.includes('not found') ||
    s.includes('does not exist') ||
    s.includes('invalid url')
  )
}
