// ENH-222 — pure worktree-name helpers, shared by the renderer (the live
// slug preview + "Name it for me" auto-name in the inline-create form) and
// core (createWorktree). Kept node-free (no fs / child_process) so the
// renderer bundle can import it; `core/git/worktree.ts` re-exports these so
// existing imports + tests keep resolving from there.

export const MAX_SLUG_LEN = 50

/**
 * Sanitize free-typed text into a slug safe as BOTH a directory name and
 * a git branch ref: lowercase · spaces/underscores → `-` · allow-list
 * `[a-z0-9-]` (strip everything else) · collapse + trim hyphens · cap
 * length. The allow-list is deliberately stricter than either constraint
 * alone — git refs also forbid ` ~ ^ : ? * [ \ ..`, all excluded here —
 * so the result can never break a path or a ref. Returns `''` for input
 * that sanitizes to nothing (the caller falls back to an auto-name).
 *
 *   "Q3 Pricing: Copy & v2!" → "q3-pricing-copy-v2"
 */
export function slugifyWorktreeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s_]+/g, '-') // whitespace + underscores → hyphen
    .replace(/[^a-z0-9-]/g, '') // allow-list: strip everything else
    .replace(/-{2,}/g, '-') // collapse repeated hyphens
    .replace(/^-+/, '') // trim leading hyphens
    .slice(0, MAX_SLUG_LEN) // cap length
    .replace(/-+$/, '') // trim trailing (incl. a slice mid-hyphen)
}

/**
 * First slug in the series `base`, `base-2`, `base-3`, … for which
 * `taken(slug)` is false. Pure — the impurity (fs + branch existence)
 * lives in the `taken` predicate the caller supplies — so it's unit-
 * testable. Bounded; falls back to a timestamped suffix.
 */
export function nextAvailableSlug(base: string, taken: (slug: string) => boolean): string {
  if (!taken(base)) return base
  for (let i = 2; i < 1000; i++) {
    const cand = `${base}-${i}`
    if (!taken(cand)) return cand
  }
  return `${base}-${Date.now()}`
}

// "Name it for me" — calm adjective + noun, in the same studio register as
// the project palette. Slugified by construction (lowercase, hyphen-joined),
// so the result is always a valid worktree name. `rand` is injectable for
// deterministic tests.
const CODENAME_ADJECTIVES = [
  'amber', 'bright', 'calm', 'dawn', 'dusk', 'fern', 'gold', 'ivory',
  'jade', 'lunar', 'misty', 'olive', 'quiet', 'rust', 'slate', 'umber'
]
const CODENAME_NOUNS = [
  'atlas', 'basin', 'canyon', 'delta', 'ember', 'harbor', 'meadow', 'mesa',
  'orchard', 'pine', 'quarry', 'reef', 'ridge', 'river', 'thicket', 'vale'
]

export function generateWorktreeCodename(rand: () => number = Math.random): string {
  const adj = CODENAME_ADJECTIVES[Math.floor(rand() * CODENAME_ADJECTIVES.length)]
  const noun = CODENAME_NOUNS[Math.floor(rand() * CODENAME_NOUNS.length)]
  return `${adj}-${noun}`
}
