// Project / checkout color tokens — the single renderer-side map from a
// colorIndex (0..5) to a `--duo-project-*` CSS var. These six tokens
// mirror `renderer/styles/globals.css` (themselves mirrored from the
// Atelier kernel at `skill/references/duo-atelier.css`).
//
// Extracted from ProjectRail.tsx (ENH-182) so the project rail, the
// per-checkout worktree badges on terminal tabs, and the navigator
// Worktrees section (ENH-210) all resolve hues through one place rather
// than each re-declaring the array (the "one ref, two purposes" trap).

export const PROJECT_COLOR_TOKENS = [
  'var(--duo-project-pine)',
  'var(--duo-project-harbor)',
  'var(--duo-project-iris)',
  'var(--duo-project-plum)',
  'var(--duo-project-rose)',
  'var(--duo-project-moss)'
] as const

/** colorIndex (any integer) → a `--duo-project-*` CSS var string.
 *  Out-of-range / negative indices wrap into the palette so callers can
 *  pass a raw hash without bounds-checking. */
export function projectColorToken(index: number): string {
  const n = PROJECT_COLOR_TOKENS.length
  const i = ((Math.trunc(index) % n) + n) % n
  return PROJECT_COLOR_TOKENS[i]
}
