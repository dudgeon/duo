// Sprint 16 BUG-122 — shared echo-comparison + diagnostic-log helpers
// for MarkdownEditor + PageTab's external-write reconciliation.
//
// Two recurring failure modes in the BUG-085 / BUG-099 / BUG-107
// family:
//
//   1. chokidar event fires after our save; disk content equals what we
//      wrote modulo whitespace / line-ending / BOM variations, but the
//      trailing-whitespace-only normalize doesn't catch all of them.
//   2. Production users hit the conflict banner but the diagnostic data
//      lives only in the renderer console (ENH-121's `[renderer:log]`
//      forwarder is dev-only). Without DevTools open at conflict time,
//      we can't tell which race window fired.
//
// `normalizeForEchoCompare` widens the compare to cover BOM, CRLF→LF,
// per-line trailing whitespace, and document-end whitespace.
//
// `writeConflictLog` persists the diagnostic to
// `~/.claude/duo/logs/last-conflict.log` so the owner can fetch it
// post-repro on a production DMG (no DevTools required).

import { encodeUtf8 } from '../components/editor/markdown-io'

/**
 * BUG-122 — wider echo normalization than BUG-107's trailing-only
 * `.replace(/\s+$/, '')`. Catches:
 *
 *   - BOM at document start (some sync agents add it back on touch)
 *   - CRLF vs LF line endings (cloud-sync rewrite, cross-OS edits)
 *   - Trailing whitespace per line (editors / linters strip them silently)
 *   - Trailing whitespace at document end (tiptap-markdown round-trip
 *     normalization; original BUG-107)
 *
 * Conservative — doesn't touch internal whitespace or unicode
 * normalization (would mask real conflicts). If the BUG-122 next-repro
 * data shows we need NFC/NFD normalization, expand here.
 */
export function normalizeForEchoCompare(s: string): string {
  return s
    .replace(/^\uFEFF/, '')         // strip leading BOM
    .replace(/\r\n/g, '\n')         // CRLF → LF
    .replace(/[ \t]+$/gm, '')       // per-line trailing whitespace
    .replace(/\s+$/, '')            // document-end trailing whitespace
}

/**
 * BUG-122 — locate the first byte that differs between two strings.
 * Returns null when strings are identical. Used to surface a tight
 * diff position in the production diagnostic log without dumping
 * full body content.
 */
export function computeFirstDiffOffset(a: string, b: string): number | null {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return i
  }
  if (a.length !== b.length) return len
  return null
}

export interface ConflictDiagnostic {
  /** ISO 8601 timestamp. */
  ts: string
  /** Absolute file path that the editor/canvas had open. */
  path: string
  /** Which code path surfaced the conflict. `watcher-dirty` = chokidar
   *  fired AND buffer was dirty. `save-pre-reconcile` = autosave's
   *  read-disk-before-write found drift. `watcher-clean` is the
   *  no-banner reload path (logged for completeness but no UI surface). */
  trigger: 'watcher-clean' | 'watcher-dirty' | 'save-pre-reconcile'
  /** Editor surface — markdown editor or HTML canvas (FOLLOWUP-019). */
  surface: 'markdown' | 'canvas'
  /** Lengths in characters (not bytes). */
  diskLength: number
  baselineLength: number
  /** Only present for `watcher-dirty` (the only path that reads live
   *  editor buffer). `null` for save-pre-reconcile / watcher-clean. */
  liveLength: number | null
  /** Size of the recently-written echo set at conflict time. Tells us
   *  whether the BUG-099 echo guard had any entries to match against. */
  recentlyWrittenSize: number
  /** First ~80 chars (post-normalize) of disk + baseline. Enough to
   *  visually bisect "BOM? CRLF? content diff?" without dumping the
   *  full body (privacy). */
  diskHead: string
  baselineHead: string
  /** Last ~80 chars (post-normalize), for the case where the diff is
   *  at the document tail (common: tiptap appending an extra newline). */
  diskTail: string
  baselineTail: string
  /** Position of first differing character (post-normalize), or null
   *  when strings are byte-identical post-normalize (in which case
   *  the banner shouldn't have fired — log captures the apparent
   *  mismatch path so we can fix the comparison). */
  firstDiffOffset: number | null
  /** Build version at time of capture — so owner can correlate the
   *  log to a specific cut after upgrade. */
  appVersion: string
}

/**
 * BUG-122 — persist the diagnostic to disk so owner can fetch it
 * after a production repro. Writes
 * `~/.claude/duo/logs/last-conflict.log` (single-file, latest-only;
 * one repro stomps the prior log — that's fine for first-data-
 * capture, can rotate later if needed). Best-effort — never let a
 * log-write failure mask the actual conflict surfacing.
 */
export async function writeConflictLog(payload: ConflictDiagnostic): Promise<void> {
  try {
    const home = window.electron?.env?.HOME ?? ''
    if (!home) return
    const logPath = `${home}/.claude/duo/logs/last-conflict.log`
    const text = JSON.stringify(payload, null, 2) + '\n'
    await window.electron.files.write(logPath, encodeUtf8(text))
  } catch {
    // Best-effort.
  }
}
