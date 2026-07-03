// ENH-243 — OKF generated-listing filenames (index + log). Two conventions
// coexist: the underscore-prefixed default (`_index.md` / `_log.md`, sorts
// to the top of a folder and reads unambiguously as "generated," per the
// owner's updated primary-vault convention) and the legacy plain form
// (`index.md` / `log.md`, ENH-216/D4/D8's original marker). Detection ALWAYS
// accepts either; new vaults and new listings default to the underscore form.
//
// This module is the single source of truth other vault code imports from —
// `detect.ts` (OKF marker probe), `scaffold.ts` (init writes), `listings.ts`
// (generated-listing exclusion + writeListings), `render.ts` (source-hash
// exclusion), and `cli/duo.ts` (`publish --open` target) all defer here
// instead of hardcoding the filename.

import fs from 'node:fs'
import path from 'node:path'

// Paired conventions, underscore-prefixed default first (index 0 — the
// preference order), legacy plain form second. `CONVENTIONS[i].index` and
// `CONVENTIONS[i].log` always travel together so a vault that hasn't
// switched its log filename yet still gets a log that MATCHES its root
// index convention on first write, rather than mixing `index.md` +
// `_log.md` in the same folder.
const CONVENTIONS = [
  { index: '_index.md', log: '_log.md' },
  { index: 'index.md', log: 'log.md' },
] as const

export const OKF_INDEX_FILENAMES = CONVENTIONS.map((c) => c.index) as [string, string]
export const OKF_LOG_FILENAMES = CONVENTIONS.map((c) => c.log) as [string, string]

export const OKF_INDEX_FILENAME_DEFAULT: string = CONVENTIONS[0].index
export const OKF_LOG_FILENAME_DEFAULT: string = CONVENTIONS[0].log

const ALL_GENERATED = new Set<string>([...OKF_INDEX_FILENAMES, ...OKF_LOG_FILENAMES])

/** True when `basename` is one of the recognized generated-listing filenames
 *  (either convention, index or log). */
export function isGeneratedListingBasename(basename: string): boolean {
  return ALL_GENERATED.has(basename)
}

/** True only for a REGULAR FILE at `p` (review fix — a bare `existsSync`
 *  would also match a directory, e.g. a stray folder literally named
 *  `_index.md`, and get returned as the resolved marker filename; the
 *  caller's later `readFileSync`/`writeFileSync` on that path then throws an
 *  unguarded `EISDIR` far from this resolver). Never throws. */
function isRegularFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** Which index filename a vault ROOT already uses, checked in preference
 *  order — the first candidate found on disk wins. Falls back to the
 *  default (`_index.md`) when neither is present (a brand-new vault). */
export function resolveIndexFilename(root: string): string {
  for (const name of OKF_INDEX_FILENAMES) {
    if (isRegularFile(path.join(root, name))) return name
  }
  return OKF_INDEX_FILENAME_DEFAULT
}

/** Which log filename a vault ROOT should use. An already-on-disk log file
 *  wins outright (explicit state is never overridden); otherwise the log
 *  PAIRS with the root's resolved index convention (via
 *  {@link resolveIndexFilename}) so a legacy `index.md` vault's first
 *  `publish` writes `log.md`, not a mixed-convention `_log.md`. The pairing
 *  lookup can't miss: `indexFilename` is always a value `resolveIndexFilename`
 *  returned, which is always a member of `OKF_INDEX_FILENAMES` (or the
 *  default) — both derived from `CONVENTIONS` — so `.find` always succeeds. */
export function resolveLogFilename(root: string): string {
  for (const name of OKF_LOG_FILENAMES) {
    if (isRegularFile(path.join(root, name))) return name
  }
  const indexFilename = resolveIndexFilename(root)
  return CONVENTIONS.find((c) => c.index === indexFilename)!.log
}

/** Per-directory index filename: prefers whatever ALREADY exists in `dirAbs`
 *  (so a subfolder that predates the convention switch keeps its own
 *  filename), else inherits `fallback` — normally the vault root's resolved
 *  convention, so a whole vault stays on one convention by default. */
export function resolveIndexFilenameForDir(dirAbs: string, fallback: string): string {
  for (const name of OKF_INDEX_FILENAMES) {
    if (isRegularFile(path.join(dirAbs, name))) return name
  }
  return fallback
}
