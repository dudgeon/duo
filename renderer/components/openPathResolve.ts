// ENH-224 D1/D14/D15 — pure path absolutization for the Open-bar open flow
// (App.tsx `openResolvedTarget`). Extracted so the home-`~` expansion +
// cwd-relative resolution is unit-testable without App's full IPC/nav wiring
// (ENH-224 review MUST-FIX: the open→edit→Propose-PR flow had zero coverage).
//
// Turns a raw local-path target into an absolute POSIX path:
//   - bare `~`        → the home dir
//   - `~/x`           → home + `/x`
//   - already-`/abs`  → unchanged
//   - anything else   → resolved against `cwd` (the navigator's), or `home`
//                       if no cwd is known
//
// Trailing slashes on `home`/`cwd` are normalized so we never emit a `//`
// join. This mirrors the inline logic the component used to carry — no
// behavior change.

/**
 * Absolutize a raw local-path open target.
 *
 * @param rawPath the user-typed / pasted / stored path (already classified as
 *   a local path, e.g. `~/notes.md`, `/etc/hosts`, `./draft.md`, `draft.md`).
 * @param home the home directory (no trailing slash required).
 * @param cwd the navigator's current working dir for relative resolution;
 *   falls back to `home` when undefined.
 */
export function absolutizeOpenPath(rawPath: string, home: string, cwd?: string): string {
  let abs = rawPath
  if (abs === '~') abs = home
  else if (abs.startsWith('~/')) abs = home.replace(/\/$/, '') + abs.slice(1)
  else if (!abs.startsWith('/')) abs = `${(cwd ?? home).replace(/\/$/, '')}/${abs}`
  return abs
}
