// BUG-138 Phase 2 — silent auto-migration from sidecar-stored comments
// to inline CriticMarkup in the markdown body.
//
// Decision lock (BUG-138 playground Q5/Q6):
//   - Q5 · Migration: silent auto-migrate on first load when a file has
//     sidecar.comments[] AND zero CriticMarkup tokens in the body.
//   - Q6 · Backward read: read-both-until-touched. The migration runs
//     at load time so the next save writes inline tokens; sidecar
//     comments are cleared at the same time.
//
// Why this is a pure function (no Editor, no DOM):
//   - The migration operates on the raw markdown body string + the
//     sidecar's comments[] array. Both are available at file-load
//     time before the editor even mounts the new content.
//   - Pure migration is easier to unit-test and avoids the
//     transaction-position pitfalls of running this inside an active
//     ProseMirror state.
//
// Migration rules:
//   1. Idempotent — if the body already contains ANY CriticMarkup
//      token, skip migration entirely (we assume the file is already
//      partly inline and don't want to double-wrap).
//   2. Multi-entry threads (replies) — collapse all entries in an
//      anchorId group into the lead's body, separated by
//      `\n\n---\n*@<author> at <ts>*\n` lines. Phase 4 may revisit
//      with proper threaded standalone-comment support; for v1 we
//      preserve the prose at the cost of structured-reply metadata.
//   3. Orphan tolerance — entries whose excerpt can't be re-anchored
//      stay in the sidecar with a warning logged by the caller.
//   4. Position safety — splice replacements in REVERSE source order
//      so earlier offsets remain valid.
//   5. Overlap safety — if two anchors resolve to overlapping ranges,
//      migrate the FIRST one and treat the rest as orphans.

import { serializeOp } from '../../../core/markdown/criticmarkup'
import type { SidecarComment, SidecarV1 } from '../Page/sidecar'
import { findExcerptIndex } from './markdownComments'

export interface MigrationResult {
  /** The body after CriticMarkup tokens have been spliced in. Equal to
   *  the input body when no migration ran. */
  body: string
  /** The sidecar with successfully-migrated entries removed from
   *  comments[]. Entries that couldn't be re-anchored stay in place. */
  sidecar: SidecarV1
  /** Number of THREADS (anchorId groups) that migrated into the body.
   *  An anchor with N replies counts as 1 migration. */
  migrated: number
  /** Number of THREADS that couldn't be re-anchored and stayed in the
   *  sidecar as orphans. */
  orphans: number
  /** True when the body parameter changed (i.e. caller should write
   *  the new body to disk). Equivalent to `migrated > 0`. */
  bodyChanged: boolean
  /** True when the sidecar's comments[] changed (i.e. caller should
   *  write the new sidecar to disk). Equivalent to `migrated > 0`. */
  sidecarChanged: boolean
}

/**
 * Quick-test whether a body contains ANY CriticMarkup token. Used as
 * the idempotency gate: when this returns true, the migration is
 * skipped (we assume the file is already inline-comment-aware).
 *
 * Detects the five operator opens: `{++`, `{--`, `{~~`, `{==`, `{>>`.
 * Doesn't validate the full token; a malformed `{++` is enough to
 * suppress migration — better safe than overwriting.
 */
export function bodyHasCriticMarkup(body: string): boolean {
  // Cheap substring scan; faster than running the full parser.
  return (
    body.indexOf('{++') !== -1 ||
    body.indexOf('{--') !== -1 ||
    body.indexOf('{~~') !== -1 ||
    body.indexOf('{==') !== -1 ||
    body.indexOf('{>>') !== -1
  )
}

interface ResolvedAnchor {
  anchorId: string
  excerpt: string
  index: number   // start offset in the original body
  length: number  // excerpt.length, cached for sort/overlap checks
  entries: SidecarComment[] // sorted by ts ascending; lead at [0]
}

export function migrateSidecarCommentsToInline(
  body: string,
  sidecar: SidecarV1
): MigrationResult {
  const comments = sidecar.comments ?? []
  const unchanged: MigrationResult = {
    body,
    sidecar,
    migrated: 0,
    orphans: 0,
    bodyChanged: false,
    sidecarChanged: false
  }
  if (comments.length === 0) return unchanged
  if (bodyHasCriticMarkup(body)) return unchanged

  // Group entries by anchorId, sort each group by timestamp so the
  // earliest entry is the lead. (`buildMarkdownThreads` uses the same
  // ordering — we mirror it here so display order doesn't shift on
  // migration.)
  const byAnchor = new Map<string, SidecarComment[]>()
  for (const c of comments) {
    const list = byAnchor.get(c.anchorId) ?? []
    list.push(c)
    byAnchor.set(c.anchorId, list)
  }
  for (const list of byAnchor.values()) {
    list.sort((a, b) => a.ts.localeCompare(b.ts))
  }

  // Try to re-anchor every group. The lead's excerpt drives the
  // lookup; replies inherit the same range.
  const resolved: ResolvedAnchor[] = []
  const orphanGroups: SidecarComment[][] = []
  for (const [anchorId, entries] of byAnchor.entries()) {
    const lead = entries[0]
    const excerpt = lead.excerpt
    if (!excerpt || excerpt.length === 0) {
      orphanGroups.push(entries)
      continue
    }
    const idx = findExcerptIndex(body, excerpt, lead.contextBefore, lead.contextAfter)
    if (idx < 0) {
      orphanGroups.push(entries)
      continue
    }
    resolved.push({
      anchorId,
      excerpt,
      index: idx,
      length: excerpt.length,
      entries
    })
  }

  // Sort by start offset so we can do overlap detection in a single
  // pass. When two anchors overlap, the earlier-positioned one wins;
  // later overlapping anchors become orphans.
  resolved.sort((a, b) => a.index - b.index)
  const nonOverlapping: ResolvedAnchor[] = []
  let cursor = -1
  for (const r of resolved) {
    if (r.index < cursor) {
      orphanGroups.push(r.entries)
      continue
    }
    nonOverlapping.push(r)
    cursor = r.index + r.length
  }

  if (nonOverlapping.length === 0) {
    // All orphans — sidecar unchanged because we didn't migrate any
    // entries (caller can rerun later when context matches). But the
    // orphan count is still reported so the caller can log it.
    return {
      body,
      sidecar,
      migrated: 0,
      orphans: orphanGroups.length,
      bodyChanged: false,
      sidecarChanged: false
    }
  }

  // Apply splices in REVERSE order so earlier offsets stay valid.
  const reversed = [...nonOverlapping].sort((a, b) => b.index - a.index)
  let nextBody = body
  for (const r of reversed) {
    const lead = r.entries[0]
    const token = serializeOp({
      kind: 'comment',
      start: 0,
      end: 0,
      meta: {
        id: lead.anchorId,
        author: lead.author,
        ts: lead.ts,
        replyTo: undefined
      },
      body: collapseRepliesIntoBody(r.entries),
      anchor: r.excerpt,
      anchorStart: 0
    })
    nextBody = nextBody.slice(0, r.index) + token + nextBody.slice(r.index + r.length)
  }

  // Build the next sidecar: remove successfully-migrated entries from
  // comments[]. resolvedThreads (legacy resolution state) is kept
  // intact — the migrated thread carries the resolution marker by
  // anchorId, and Phase 4 will fold those into the mark.
  const migratedAnchorIds = new Set(nonOverlapping.map(r => r.anchorId))
  const remainingComments = comments.filter(c => !migratedAnchorIds.has(c.anchorId))
  const nextSidecar: SidecarV1 = {
    ...sidecar,
    comments: remainingComments.length > 0 ? remainingComments : []
  }

  return {
    body: nextBody,
    sidecar: nextSidecar,
    migrated: nonOverlapping.length,
    orphans: orphanGroups.length,
    bodyChanged: true,
    sidecarChanged: true
  }
}

/**
 * Concatenate multiple sidecar entries (a thread) into a single
 * comment body string. The lead entry's body goes first; each reply
 * follows on a NEW line prefixed with `↪ @<author> <ts>: <body>`.
 *
 * Critical constraint — the body must stay free of blank lines (no
 * `\n\n`). The CriticMarkup token `{>>…<<}` is parsed as plain text
 * by markdown-it, but a blank line inside it would split the
 * surrounding paragraph and put the opening `{>>` in one text node
 * and the closing `<<}` in another. `applyCriticMarkupFromText`
 * walks text nodes individually; it never sees the whole token in
 * one node, so the mark wouldn't apply. Embedded newlines inside
 * a single paragraph DO survive (markdown-it treats them as soft
 * breaks within the paragraph), so single `\n` separators are fine.
 *
 * v1 — replies become prose inside the lead's body. Phase 4 may
 * revisit with structured standalone-comment support for richer
 * threaded display. For now, the prose is preserved (owner's
 * primary concern: "comments that sit outside the file will not be
 * obvious to the agent").
 */
export function collapseRepliesIntoBody(entries: SidecarComment[]): string {
  if (entries.length === 0) return ''
  if (entries.length === 1) return collapseBodyToSingleParagraph(entries[0].body)
  const lead = entries[0]
  const replies = entries.slice(1)
  const parts: string[] = [collapseBodyToSingleParagraph(lead.body)]
  for (const r of replies) {
    parts.push(`\n↪ @${r.author} ${r.ts}: ${collapseBodyToSingleParagraph(r.body)}`)
  }
  return parts.join('')
}

/** Normalize a comment body to fit in a single markdown paragraph.
 *  Blank lines (`\n\n+`) → single soft break (`\n`); CRs stripped. */
function collapseBodyToSingleParagraph(body: string): string {
  return body.replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n')
}

/**
 * BUG-138 Phase 5 — inverse of `collapseRepliesIntoBody`. Given a
 * comment body that may contain `\n↪ @<author> <ts>: <body>` reply
 * separators (the format produced by Phase 2's migration), split it
 * back into a lead body + an ordered list of replies.
 *
 * Tolerant of bodies with no separators (returns `{ leadBody: body,
 * replies: [] }`). Tolerant of malformed separators (anything that
 * doesn't match the strict regex stays inside the previous segment,
 * so prose accidentally starting with `↪` doesn't break the parse).
 *
 * The separator's `↪` is preceded by either start-of-string or
 * whitespace — the migration's `collapseRepliesIntoBody` emits `\n↪`,
 * but markdown serialization through tiptap-markdown often collapses
 * the soft-break newline to a space by the time the body lands in a
 * mark attribute. Both shapes parse the same way.
 *
 * `<ts>` is ISO 8601 (no whitespace); `<author>` is anything except
 * whitespace. Bodies containing `↪` mid-prose without a following
 * `@author ts:` shape are NOT separators — the strict shape filters
 * those out.
 */
export interface ParsedReply {
  author: string
  ts: string
  body: string
}
export interface ParsedThreadedBody {
  leadBody: string
  replies: ParsedReply[]
}
const REPLY_SEPARATOR_REGEX = /(?:^|\s)↪ @(\S+) (\S+): /

export function parseRepliesFromBody(body: string): ParsedThreadedBody {
  if (typeof body !== 'string' || body.length === 0) {
    return { leadBody: '', replies: [] }
  }
  // Find all separator positions. Walk the body once, collecting
  // (matchIndex, author, ts) for each separator + the slice ranges
  // between them.
  const matches: { index: number; matchLength: number; author: string; ts: string }[] = []
  let cursor = 0
  // Use a fresh global regex so lastIndex iteration works.
  const re = new RegExp(REPLY_SEPARATOR_REGEX.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    matches.push({
      index: m.index,
      matchLength: m[0].length,
      author: m[1],
      ts: m[2]
    })
    // Don't move re.lastIndex backwards even if matchLength is 0; the
    // regex requires non-empty match by construction so this is safe.
    cursor = m.index + m[0].length
  }
  if (matches.length === 0) return { leadBody: body, replies: [] }
  const leadBody = body.slice(0, matches[0].index)
  const replies: ParsedReply[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i].matchLength
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length
    replies.push({
      author: matches[i].author,
      ts: matches[i].ts,
      body: body.slice(start, end)
    })
  }
  void cursor // silence unused-variable lint
  return { leadBody, replies }
}
