// Stage 17b Phase B — `<file>.duo.json` sidecar (PRD H22).
//
// Per-canvas-file metadata that doesn't belong in the HTML itself:
//   - scripts.allowed       — per-file script execution choice (PRD H8 / 17e)
//   - comments[]            — anchored comments (17d)
//   - recentEdits[]         — last 50 edits with timestamps + author + kind
//   - properties            — free-form extensibility
//
// The .html file remains fully readable without the sidecar. Absence
// is fine (the canvas falls back to defaults). Schema is versioned
// so future migrations can be additive.

import { decodeUtf8, encodeUtf8 } from '../editor/markdown-io'

export const SIDECAR_VERSION = 1
const RECENT_EDITS_CAP = 50

export interface SidecarV1 {
  version: 1
  scripts?: { allowed: 'always' | 'once' | 'never' }
  comments?: SidecarComment[]
  recentEdits?: SidecarRecentEdit[]
  /** Stage 17d — map from `anchorId` (= thread id, since one thread
   *  per anchor) to a resolution record. Threads not present in this
   *  map are open. Storing thread state here (rather than on each
   *  `SidecarComment` entry) keeps the entry shape per-message and
   *  avoids ambiguity about which entry's flag wins. Additive on the
   *  v1 schema — readers without this field treat all threads as
   *  open. */
  resolvedThreads?: Record<string, ResolvedThreadRecord>
  /** BUG-207 — DEPRECATED. `suggestingMode` and `frontmatterPanelCollapsed`
   *  were pure-UI prefs that polluted otherwise-empty sidecars for fresh
   *  notes. They now live in per-path localStorage (renderer/components/
   *  editor/docUiPrefs.ts). Still TYPED here (optional) so the read path and
   *  the one-time migration fallback in MarkdownEditor can consume an
   *  existing legacy value; NEVER written back into the sidecar, and NOT
   *  counted as load-bearing content. */
  suggestingMode?: boolean
  frontmatterPanelCollapsed?: boolean
  properties?: Record<string, unknown>
}

export interface ResolvedThreadRecord {
  ts: string                              // ISO 8601
  by: string                              // 'user' / 'claude' / display name
}

export interface SidecarComment {
  id: string
  anchorId: string
  range?: { textPath: string; startOffset: number; endOffset: number }
  author: string
  ts: string                              // ISO 8601
  body: string
  /** Sprint 6 Phase 4 / MISSING-001 — markdown-side fields. The
   *  markdown editor strips comment marks on serialize (Markdown.html
   *  is configured `false` in MarkdownEditor.tsx so plain `.md` files
   *  stay clean), so on reopen we re-anchor by finding `excerpt` in
   *  the parsed doc. `contextBefore`/`contextAfter` (a slice of
   *  surrounding plaintext) disambiguate when the same excerpt
   *  appears more than once. Canvas ignores these — it reads excerpt
   *  from the live DOM at thread-build time. Optional so v0.6.7's
   *  canvas sidecars don't grow unnecessarily. */
  excerpt?: string
  contextBefore?: string
  contextAfter?: string
}

export type SidecarEditKind =
  | 'inject-ids'
  | 'set'
  | 'replace'
  | 'append'
  | 'remove'
  | 'attr'

export interface SidecarRecentEdit {
  ts: string                              // ISO 8601
  author: 'user' | 'claude' | string
  anchorId?: string                       // present when the edit targets one
  kind: SidecarEditKind
}

// ── Path helpers ───────────────────────────────────────────────────────────

export function sidecarPath(canvasPath: string): string {
  return canvasPath + '.duo.json'
}

export function emptySidecar(): SidecarV1 {
  return { version: SIDECAR_VERSION }
}

/** BUG-207 — true when the sidecar carries any LOAD-BEARING metadata
 *  (comment threads, thread-resolution state, per-file script choice,
 *  recent-edit history, or free-form properties). The two pure-UI prefs
 *  (suggestingMode / frontmatterPanelCollapsed) are intentionally NOT
 *  counted — they live in per-path localStorage now (docUiPrefs.ts), so a
 *  sidecar holding only them is "empty" and must not be written to disk. */
export function sidecarHasLoadBearingContent(sidecar: SidecarV1): boolean {
  if (sidecar.scripts) return true
  if (sidecar.comments && sidecar.comments.length > 0) return true
  if (sidecar.recentEdits && sidecar.recentEdits.length > 0) return true
  if (sidecar.resolvedThreads && Object.keys(sidecar.resolvedThreads).length > 0) return true
  if (sidecar.properties && Object.keys(sidecar.properties).length > 0) return true
  return false
}

// ── IO ─────────────────────────────────────────────────────────────────────

/** Read the sidecar for a canvas file. Returns `null` when the file
 *  doesn't exist OR when the JSON is malformed (caller treats both as
 *  "no metadata yet"). Never throws on a missing file. */
export async function readSidecar(canvasPath: string): Promise<SidecarV1 | null> {
  try {
    const res = await window.electron.files.read(sidecarPath(canvasPath))
    const text = decodeUtf8(res.bytes)
    const parsed = JSON.parse(text) as unknown
    if (!isValidSidecar(parsed)) return null
    return parsed
  } catch {
    // ENOENT, parse error, IPC error — all treated as "no sidecar yet".
    return null
  }
}

/** Write the sidecar atomically (the underlying files-service does
 *  tmp + rename). Caller pre-builds the full SidecarV1 object. */
export async function writeSidecar(canvasPath: string, sidecar: SidecarV1): Promise<void> {
  // BUG-207 — never materialize a sidecar that holds no load-bearing
  // content (the fresh-note pollution case, now that the two UI prefs live
  // in localStorage). If a legacy/empty sidecar already exists on disk,
  // trash it so we leave no orphan behind.
  if (!sidecarHasLoadBearingContent(sidecar)) {
    try {
      const p = sidecarPath(canvasPath)
      if (await window.electron.files.exists(p)) {
        await window.electron.files.trash(p)
      }
    } catch {
      /* best-effort cleanup — never throw out of a save */
    }
    return
  }
  // Pretty-printed JSON (2-space) so a human reading the file or
  // diffing in git gets a readable layout. The sidecar is small (a
  // few KB even with 50 recent edits + a dozen comments).
  const text = JSON.stringify(sidecar, null, 2) + '\n'
  await window.electron.files.write(sidecarPath(canvasPath), encodeUtf8(text))
}

// ── Mutators ───────────────────────────────────────────────────────────────

/** Append a recent-edit entry, capping the list at RECENT_EDITS_CAP.
 *  Returns the next sidecar (caller persists). Pure — does no IO. */
export function withRecentEdit(sidecar: SidecarV1, edit: SidecarRecentEdit): SidecarV1 {
  const existing = sidecar.recentEdits ?? []
  const next = [edit, ...existing].slice(0, RECENT_EDITS_CAP)
  return { ...sidecar, recentEdits: next }
}

/** Append a comment entry. Returns the next sidecar. Caller mints
 *  the comment id (typically `cmt_<short-ulid>`). Pure — no IO. */
export function withComment(sidecar: SidecarV1, comment: SidecarComment): SidecarV1 {
  const existing = sidecar.comments ?? []
  return { ...sidecar, comments: [...existing, comment] }
}

/** Mark a thread (= an anchorId) resolved. Pure — no IO. */
export function withResolvedThread(
  sidecar: SidecarV1,
  anchorId: string,
  by: string
): SidecarV1 {
  const existing = sidecar.resolvedThreads ?? {}
  return {
    ...sidecar,
    resolvedThreads: { ...existing, [anchorId]: { ts: new Date().toISOString(), by } }
  }
}

/** Reopen a previously-resolved thread. Pure — no IO. */
export function withReopenedThread(sidecar: SidecarV1, anchorId: string): SidecarV1 {
  if (!sidecar.resolvedThreads || !(anchorId in sidecar.resolvedThreads)) return sidecar
  const next = { ...sidecar.resolvedThreads }
  delete next[anchorId]
  return { ...sidecar, resolvedThreads: next }
}

// ── Validation ─────────────────────────────────────────────────────────────

function isValidSidecar(value: unknown): value is SidecarV1 {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  // Version-permissive: anything with a numeric `version` field we
  // recognise gets through. Future migrations live here.
  if (typeof v.version !== 'number') return false
  if (v.version !== 1) return false
  // Other fields are optional; we don't deeply validate them in v1.
  return true
}
