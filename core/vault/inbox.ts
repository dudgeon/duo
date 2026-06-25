// ENH-228 Vault view — the inbox listing layer.
//
// The Vault view's left column lists a vault's `inbox/` capture notes
// (newest-first; stale > 1 week flagged). This is a pure, fs-backed read —
// no running app, no sidecar — the data contract behind both the
// `duo` IPC verb (`vault.listInbox`) and any CLI consumer.
//
// Stale matches the processing dashboard's rule (`bases/processing.base`):
// `captured < today() - "1 week"`. Capture notes carry a `captured:`
// `YYYY-MM-DD` frontmatter date (core/vault/scaffold.ts captureNote); a note
// with no `captured:` is never flagged stale (we can't date it).

import fs from 'node:fs'
import path from 'node:path'
import { parseFile } from './parse'

/** One inbox capture note, as the Vault view consumes it. */
export interface InboxEntry {
  /** Vault-relative POSIX path to the note. */
  note: string
  /** Absolute path (so a consumer can open it directly). */
  absPath: string
  /** Display title: frontmatter `title:`, else the first body line, else the
   *  extension-less filename. */
  title: string
  /** The `captured:` frontmatter date (`YYYY-MM-DD`), or null when absent. */
  captured: string | null
  /** True when `captured` is strictly older than `asOf − staleDays`
   *  (the processing "stale inbox" rule). Never true when `captured` is null. */
  stale: boolean
  /** File mtime (epoch ms) — the newest-first tiebreaker when `captured`
   *  is equal or missing. */
  mtimeMs: number
}

/** The first non-empty body line, stripped of a leading markdown heading
 *  marker / list bullet, collapsed to one line and clipped — a human-ish
 *  label for an untitled capture. Empty string when the body is blank. */
function firstBodyLine(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*[-*+]\s+/, '').trim()
    if (line) return line.length > 80 ? line.slice(0, 80) + '…' : line
  }
  return ''
}

/** `YYYY-MM-DD` for a Date — UTC date parts, matching how `captured` is
 *  stamped (`now.toISOString().slice(0, 10)`); the threshold is a coarse
 *  1-week boundary so the comparison stays date-string lexical. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Read a `captured:` frontmatter value to a `YYYY-MM-DD` string, or null.
 *  js-yaml parses a bare `captured: 2026-06-17` into a Date (the YAML
 *  timestamp type) — exactly how `captureNote` writes it — so handle BOTH a
 *  Date and a pre-stringified value. */
function capturedYmd(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return ymd(v)
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 10)
  return null
}

/** List a vault's `inbox/` capture notes, newest-first, with a stale flag.
 *  Reads the `inbox/` folder directly (capture notes are flat there). Missing
 *  `inbox/` → `[]`. `staleDays` defaults to 7 (the processing "> 1 week" rule);
 *  `asOf` defaults to today (overridable for tests). */
export function listInbox(root: string, opts: { asOf?: Date; staleDays?: number } = {}): InboxEntry[] {
  const inboxDir = path.join(root, 'inbox')
  let names: string[]
  try {
    names = fs.readdirSync(inboxDir).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }

  const asOf = opts.asOf ?? new Date()
  const staleDays = opts.staleDays ?? 7
  // Threshold date (date-only). `captured < threshold` mirrors
  // `captured < today() - "1 week"` — exactly `staleDays` old is NOT stale.
  const threshold = ymd(new Date(asOf.getTime() - staleDays * 24 * 60 * 60 * 1000))

  const entries: InboxEntry[] = []
  for (const name of names) {
    const abs = path.join(inboxDir, name)
    let note
    try {
      note = parseFile(abs, root)
    } catch {
      continue // a race / unreadable file drops out of the list, never throws
    }
    const fm = note.frontmatter
    const captured = capturedYmd(fm.captured)
    const title =
      (typeof fm.title === 'string' && fm.title.trim()) || firstBodyLine(note.body) || note.basename
    entries.push({
      note: note.relPath,
      absPath: abs,
      title,
      captured,
      stale: captured != null && captured < threshold,
      mtimeMs: note.mtimeMs,
    })
  }

  // Newest-first: by `captured` desc, then mtime desc, then name (stable).
  entries.sort((a, b) => {
    if (a.captured && b.captured && a.captured !== b.captured) return a.captured < b.captured ? 1 : -1
    if (a.captured && !b.captured) return -1
    if (!a.captured && b.captured) return 1
    if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
    return a.note.localeCompare(b.note)
  })
  return entries
}
