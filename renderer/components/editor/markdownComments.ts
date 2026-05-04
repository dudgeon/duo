// Sprint 6 Phase 4 (MISSING-001 / Stage 14a) — markdown-side comment
// thread builder + re-anchor logic. Sister to
// `renderer/components/Page/commentAnchors.ts` for the canvas, but
// operates against a TipTap (ProseMirror) doc instead of the iframe
// DOM.
//
// Lifecycle.
//   - On file load: editor.commands.setContent(body) parses markdown
//     into a PM doc with NO comment marks (the Markdown extension
//     strips unknown HTML on parse, and we configure html=false). The
//     sidecar's comments[] is the source of truth — we walk the doc
//     and re-apply commentMark over each comment's `excerpt` + nearby
//     `contextBefore`/`contextAfter` for disambiguation.
//   - On edit: TipTap's mark machinery follows the marked range
//     across every transaction. Adjacent edits extend or contract;
//     deletes shrink; pastes split. Heavy edits can produce orphan
//     comments (no surviving range) — those still appear in the
//     rail with `resolved: false` but `excerpt` will report the
//     last-known text.
//   - On autosave: the markdown-IO step strips comment marks (html=false
//     in tiptap-markdown). Before writing the .md file we walk the
//     doc once and refresh each sidecar comment's `excerpt` +
//     `contextBefore`/`contextAfter` to the current text — so the
//     next reopen's re-anchor pass finds the right text. Sidecar is
//     persisted in parallel.
//
// What this module exposes.
//   - `applyCommentMarksFromSidecar(editor, sidecar)` — re-anchor pass
//     run once on file load AFTER the markdown body has been parsed
//     into the PM doc. Idempotent: skips comments whose marks are
//     already present.
//   - `refreshSidecarFromDoc(doc, sidecar)` — pre-save pass that
//     updates each comment's excerpt + context. Returns a NEW
//     SidecarV1 (immutable). Comments whose mark has disappeared
//     keep their last-known excerpt (orphan-safe).
//   - `buildMarkdownThreads(doc, sidecar)` — produces the same
//     `BuiltThread` shape the canvas uses, sorted by document order.
//     Pure: no DOM mutation, no sidecar mutation.
//   - `scrollToCommentAnchor(view, commentId)` — focus rail-side
//     helpers that need to jump the editor to a thread's anchor.

import type { Editor } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import type { SidecarComment, SidecarV1 } from '../Page/sidecar'
import { collectCommentRanges } from './extensions/CommentMark'

const CONTEXT_CHARS = 40

export interface BuiltMarkdownThread {
  threadId: string                 // = commentId
  entries: SidecarComment[]
  excerpt: string                  // current marked text, or last-known (orphan)
  resolved: boolean
  /** Document position index (0-based, by from-position). Threads
   *  whose mark is no longer in the doc sink to the end. */
  documentOrderIndex: number
  /** Live PM positions. `null` for orphan threads. */
  range: { from: number; to: number } | null
}

/**
 * Group sidecar comments by anchorId (= commentId) and order them by
 * the live mark's document position. Orphan threads (mark missing)
 * sink to the end and report their last-known excerpt. Mirrors the
 * canvas's `buildThreads` so the rail primitive accepts the same
 * thread shape from both surfaces.
 */
export function buildMarkdownThreads(
  doc: PMNode,
  sidecar: SidecarV1
): BuiltMarkdownThread[] {
  const comments = sidecar.comments ?? []
  const resolved = sidecar.resolvedThreads ?? {}

  const byAnchor = new Map<string, SidecarComment[]>()
  for (const c of comments) {
    const list = byAnchor.get(c.anchorId) ?? []
    list.push(c)
    byAnchor.set(c.anchorId, list)
  }
  for (const list of byAnchor.values()) {
    list.sort((a, b) => a.ts.localeCompare(b.ts))
  }

  const ranges = collectCommentRanges(doc)

  // Sort by from-position, ties broken by id (stable).
  const sortedIds = [...ranges.entries()]
    .sort(([, a], [, b]) => a.from - b.from)
    .map(([id]) => id)
  const orderIndexById = new Map<string, number>()
  sortedIds.forEach((id, i) => orderIndexById.set(id, i))

  const threads: BuiltMarkdownThread[] = []
  for (const [threadId, entries] of byAnchor.entries()) {
    const live = ranges.get(threadId) ?? null
    const fallbackExcerpt = entries[entries.length - 1]?.excerpt ?? ''
    threads.push({
      threadId,
      entries,
      excerpt: live ? live.text : fallbackExcerpt,
      resolved: threadId in resolved,
      documentOrderIndex: orderIndexById.get(threadId) ?? Number.MAX_SAFE_INTEGER,
      range: live ? { from: live.from, to: live.to } : null
    })
  }
  threads.sort((a, b) => a.documentOrderIndex - b.documentOrderIndex)
  return threads
}

/**
 * After a markdown file has been freshly loaded into the editor,
 * re-apply commentMark over each sidecar comment's excerpt. Uses the
 * stored contextBefore/contextAfter to disambiguate when the excerpt
 * appears multiple times in the doc. Skips already-marked comments
 * (idempotent — safe to call repeatedly).
 *
 * Returns the count of comments successfully re-anchored, useful for
 * caller-side telemetry / debugging. Comments that couldn't be
 * matched are silently left as orphans — the rail surfaces them.
 */
export function applyCommentMarksFromSidecar(
  editor: Editor,
  sidecar: SidecarV1
): number {
  const comments = sidecar.comments ?? []
  if (comments.length === 0) return 0

  // Snapshot which commentIds already have a mark (don't double-apply).
  const existing = collectCommentRanges(editor.state.doc)
  const todo: SidecarComment[] = []
  const seen = new Set<string>()
  for (const c of comments) {
    if (seen.has(c.anchorId)) continue
    seen.add(c.anchorId)
    if (existing.has(c.anchorId)) continue
    if (!c.excerpt || c.excerpt.length === 0) continue
    todo.push(c)
  }
  if (todo.length === 0) return 0

  const docText = editor.state.doc.textContent
  let applied = 0
  // Build cumulative position index so a textContent offset maps back
  // to a PM position. PM positions account for nodes (each open/close
  // adds 1 position); textContent collapses block transitions to
  // empty (just text nodes concatenated). We walk the doc once and
  // record (textOffset, pmPosition) anchors at each text node.
  type TextAnchor = { text: string; pmStart: number; textStart: number }
  const anchors: TextAnchor[] = []
  let cursor = 0
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text ?? ''
    anchors.push({ text, pmStart: pos, textStart: cursor })
    cursor += text.length
  })
  const totalTextLen = cursor

  // Translate a text-offset range into a PM-position range. Returns
  // null when the range straddles a non-text boundary in a way we
  // can't cleanly map (most block transitions are fine — they just
  // bridge two text-anchors directly).
  const textRangeToPm = (textFrom: number, textTo: number): { from: number; to: number } | null => {
    if (textFrom < 0 || textTo > totalTextLen || textTo <= textFrom) return null
    let pmFrom = -1
    let pmTo = -1
    for (const a of anchors) {
      const aEnd = a.textStart + a.text.length
      if (pmFrom === -1 && textFrom >= a.textStart && textFrom <= aEnd) {
        pmFrom = a.pmStart + (textFrom - a.textStart)
      }
      if (textTo >= a.textStart && textTo <= aEnd) {
        pmTo = a.pmStart + (textTo - a.textStart)
        break
      }
    }
    if (pmFrom < 0 || pmTo < 0 || pmTo <= pmFrom) return null
    return { from: pmFrom, to: pmTo }
  }

  for (const c of todo) {
    // `todo` was filtered above to drop entries without an excerpt,
    // but the type system doesn't track that — reassert via guard.
    const excerpt = c.excerpt
    if (!excerpt) continue
    const idx = findExcerptIndex(docText, excerpt, c.contextBefore, c.contextAfter)
    if (idx < 0) continue
    const range = textRangeToPm(idx, idx + excerpt.length)
    if (!range) continue
    const ok = editor.commands.applyCommentMark(c.anchorId, range.from, range.to)
    if (ok) applied += 1
  }
  return applied
}

/** Locate `excerpt` in `docText`. When `contextBefore`/`contextAfter`
 *  are present, prefer the occurrence with matching surrounding text;
 *  fall back to first occurrence otherwise. Returns -1 when not
 *  found.
 */
function findExcerptIndex(
  docText: string,
  excerpt: string,
  contextBefore?: string,
  contextAfter?: string
): number {
  if (!excerpt) return -1
  if (contextBefore || contextAfter) {
    let start = 0
    while (start <= docText.length - excerpt.length) {
      const i = docText.indexOf(excerpt, start)
      if (i < 0) return -1
      const beforeOk = contextBefore
        ? docText.slice(Math.max(0, i - contextBefore.length), i) === contextBefore
        : true
      const afterOk = contextAfter
        ? docText.slice(i + excerpt.length, i + excerpt.length + contextAfter.length) === contextAfter
        : true
      if (beforeOk && afterOk) return i
      start = i + 1
    }
    return -1
  }
  return docText.indexOf(excerpt)
}

/**
 * Pre-save pass: refresh each sidecar comment's excerpt +
 * contextBefore/contextAfter to the current marked text. Comments
 * whose mark has been removed (orphans) keep their last-known fields
 * — we never silently delete a thread just because its anchor
 * vanished; the user resolves orphans explicitly through the rail.
 *
 * Pure — returns a new SidecarV1; caller persists.
 */
export function refreshSidecarFromDoc(
  doc: PMNode,
  sidecar: SidecarV1
): SidecarV1 {
  const comments = sidecar.comments ?? []
  if (comments.length === 0) return sidecar
  const ranges = collectCommentRanges(doc)
  const docText = doc.textContent
  // Same PM-position → text-offset map captureExcerptContext uses.
  // Necessary because PM positions count node boundaries while
  // textContent collapses them — naive subtraction skews the slice.
  type TextAnchor = { pmStart: number; textStart: number; len: number }
  const anchors: TextAnchor[] = []
  let cursor = 0
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const len = (node.text ?? '').length
    anchors.push({ pmStart: pos, textStart: cursor, len })
    cursor += len
  })
  const totalTextLen = cursor
  const pmToText = (pmPos: number): number => {
    for (const a of anchors) {
      if (pmPos >= a.pmStart && pmPos <= a.pmStart + a.len) {
        return a.textStart + (pmPos - a.pmStart)
      }
    }
    return Math.min(totalTextLen, Math.max(0, pmPos))
  }

  const next = comments.map((c) => {
    const range = ranges.get(c.anchorId)
    if (!range) return c
    const textFrom = pmToText(range.from)
    const textTo = textFrom + range.text.length
    const before = docText.slice(Math.max(0, textFrom - CONTEXT_CHARS), textFrom)
    const after = docText.slice(textTo, Math.min(docText.length, textTo + CONTEXT_CHARS))
    if (range.text === c.excerpt && before === (c.contextBefore ?? '') && after === (c.contextAfter ?? '')) {
      return c
    }
    return {
      ...c,
      excerpt: range.text,
      contextBefore: before,
      contextAfter: after
    }
  })
  return { ...sidecar, comments: next }
}

/**
 * Capture excerpt + surrounding context for a freshly-applied mark.
 * Caller passes the just-applied range; we slice surrounding text out
 * of doc.textContent (the same string the re-anchor pass searches),
 * keying off a PM-position → text-offset mapping so multi-occurrence
 * excerpts still match the right one on reopen.
 *
 * Direct PM `textBetween` for the context produced overlapping slices
 * — block-separator behavior at heading→paragraph boundaries spilled
 * the start of the excerpt into `contextBefore`, then the
 * `findExcerptIndex` check failed because `docText` couldn't satisfy
 * the over-long contextBefore. textContent slicing avoids the
 * overlap entirely; matches what the re-anchor pass operates on.
 */
export function captureExcerptContext(
  doc: PMNode,
  range: { from: number; to: number }
): { excerpt: string; contextBefore: string; contextAfter: string } {
  const excerpt = doc.textBetween(range.from, range.to, '\n', ' ')
  // Map range.from → textContent offset by walking the same text
  // anchors `applyCommentMarksFromSidecar` uses for the inverse
  // direction (text-offset → PM position). Off by node-boundary
  // costs; the cumulative sum over text nodes gives us a clean offset.
  type TextAnchor = { pmStart: number; textStart: number; len: number }
  const anchors: TextAnchor[] = []
  let cursor = 0
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const len = (node.text ?? '').length
    anchors.push({ pmStart: pos, textStart: cursor, len })
    cursor += len
  })
  const totalTextLen = cursor
  const docText = doc.textContent

  const pmToText = (pmPos: number): number => {
    for (const a of anchors) {
      if (pmPos >= a.pmStart && pmPos <= a.pmStart + a.len) {
        return a.textStart + (pmPos - a.pmStart)
      }
    }
    // Fall back to clamping at the end — happens for positions at
    // empty doc tails or block-only spaces.
    return Math.min(totalTextLen, Math.max(0, pmPos))
  }

  const textFrom = pmToText(range.from)
  const textTo = textFrom + excerpt.length
  const contextBefore = docText.slice(Math.max(0, textFrom - CONTEXT_CHARS), textFrom)
  const contextAfter = docText.slice(textTo, Math.min(docText.length, textTo + CONTEXT_CHARS))
  return { excerpt, contextBefore, contextAfter }
}

/**
 * Scroll the editor to the given comment thread's anchor. No-op when
 * the mark has been removed from the doc (orphan thread).
 */
export function scrollToCommentAnchor(view: EditorView, commentId: string): void {
  const ranges = collectCommentRanges(view.state.doc)
  const r = ranges.get(commentId)
  if (!r) return
  const dom = view.domAtPos(r.from)
  const node = dom.node.nodeType === 1 ? (dom.node as HTMLElement) : (dom.node.parentElement as HTMLElement | null)
  node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
