// BUG-207 — per-path UI-pref storage for the markdown editor's two
// pure-UI toggles (Properties-panel collapse + Suggesting mode). These
// previously lived in the `<file>.duo.json` sidecar, which caused a
// sibling sidecar file to be created for otherwise-untouched fresh notes
// (the sidecar's load-bearing fields — comments / resolvedThreads /
// scripts / recentEdits / properties — were all empty). They now persist
// in the same path-keyed localStorage layer Duo already uses for per-path
// UI prefs (see PageTab.tsx READONLY_OVERRIDE_KEY_PREFIX). Keyed on the
// absolute file path; tri-state (null = never set → caller applies its
// default).

const SUGGESTING_KEY_PREFIX = 'duo:md-suggesting:'
const FM_COLLAPSED_KEY_PREFIX = 'duo:md-frontmatter-collapsed:'

function readBoolPref(prefix: string, absPath: string): boolean | null {
  try {
    const raw = localStorage.getItem(`${prefix}${absPath}`)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return null
  } catch {
    return null
  }
}

function writeBoolPref(prefix: string, absPath: string, value: boolean): void {
  try {
    localStorage.setItem(`${prefix}${absPath}`, String(value))
  } catch {
    /* private mode / quota — best-effort, drop silently */
  }
}

/** Suggesting-mode toggle, keyed on the doc's absolute path. null = unset. */
export function readSuggestingPref(absPath: string): boolean | null {
  return readBoolPref(SUGGESTING_KEY_PREFIX, absPath)
}
export function writeSuggestingPref(absPath: string, value: boolean): void {
  writeBoolPref(SUGGESTING_KEY_PREFIX, absPath, value)
}

/** Properties-panel collapsed flag, keyed on the doc's absolute path.
 *  null = unset → caller defaults to COLLAPSED (BUG-139 v1.1 Q4). */
export function readFrontmatterCollapsedPref(absPath: string): boolean | null {
  return readBoolPref(FM_COLLAPSED_KEY_PREFIX, absPath)
}
export function writeFrontmatterCollapsedPref(absPath: string, value: boolean): void {
  writeBoolPref(FM_COLLAPSED_KEY_PREFIX, absPath, value)
}
