// ENH-244 — the rendered-artifact output folder. `output/` is the default
// for any newly scaffolded vault (reads unambiguously vs. the generic word
// "out"); the legacy `out/` (ENH-208/ENH-229) is still detected and honored
// for a vault that already has one. Mode-agnostic: both OKF and Obsidian
// vaults use this folder for `duo base render`/`duo rollup render` artifacts.
//
// Single source of truth other vault code imports from — `parse.ts`
// (`SKIP_DIRS`), `detect.ts` (`SCAN_SKIP`), `render.ts` (`sourceHash`'s
// SKIP), `search.ts` (`SEARCH_SKIP_DIRS`), `scaffold.ts` (init writes), and
// `cli/duo.ts` (`base render`'s default `--out` target) all defer here
// instead of hardcoding the folder name.

import fs from 'node:fs'
import path from 'node:path'

/** Preference order: the new default first, the legacy name second. */
export const OUTPUT_DIR_CANDIDATES = ['output', 'out'] as const

export const OUTPUT_DIR_DEFAULT: string = OUTPUT_DIR_CANDIDATES[0]

/** Both candidate names — for skip-set membership, where either an `output/`
 *  or a legacy `out/` folder should be excluded from the corpus walk. */
export const OUTPUT_DIR_NAMES: readonly string[] = OUTPUT_DIR_CANDIDATES

/** True only for a DIRECTORY at `p` (review fix — a bare `existsSync` would
 *  also match a stray FILE literally named `output`, and get returned as the
 *  resolved output folder; a caller's later `mkdirSync`/`writeFileSync` into
 *  that path then throws an unguarded `ENOTDIR`/`EEXIST` far from this
 *  resolver). Never throws. */
function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Which output folder a vault ROOT already uses, checked in preference
 *  order — the first candidate found on disk wins. Falls back to the
 *  default (`output`) when neither is present (a brand-new vault, or one
 *  that has never rendered an artifact yet). */
export function resolveOutputDir(root: string): string {
  for (const name of OUTPUT_DIR_CANDIDATES) {
    if (isDir(path.join(root, name))) return name
  }
  return OUTPUT_DIR_DEFAULT
}
