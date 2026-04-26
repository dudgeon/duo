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
  properties?: Record<string, unknown>
}

export interface SidecarComment {
  id: string
  anchorId: string
  range?: { textPath: string; startOffset: number; endOffset: number }
  author: string
  ts: string                              // ISO 8601
  body: string
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
