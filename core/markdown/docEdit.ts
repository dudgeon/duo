// BUG-138 Phase 3 — pure markdown-body editor for CriticMarkup
// operations. Each function takes a body string + parameters and
// returns a new body. No file IO, no editor, no DOM — testable in
// isolation.
//
// Locked playground decisions:
//   - Q1 · pipe-delimited comment metadata (`id|author|ts|reply-to|body`)
//   - Q2 · all five CriticMarkup ops
//   - Q3 · named authors (stored on comments only; insertions /
//     deletions / substitutions / highlights stay as plain CM tokens
//     for compatibility with standard CriticMarkup tooling)
//   - Q4 · explicit per-op verbs (`duo doc insert / delete / ...`)
//
// Anchor matching:
//   - All matchers operate on the body AFTER any existing CriticMarkup
//     tokens are stripped (via `stripCriticMarkup`). This means
//     "matching the literal text `foo`" works against the
//     all-suggestions-accepted view of the document, NOT the raw
//     source containing `{...}` wrappers. Match positions are then
//     mapped back to source-position offsets so the new token is
//     inserted at the right place in the raw markdown.
//
// Why match on the stripped view: the agent's mental model of "the
// text" is the prose, not the source — `--text "important paragraph"`
// should hit even if the paragraph already contains a comment marker.

import {
  parseCriticMarkup,
  serializeCommentBody,
  type CmOp,
  type CommentMeta
} from './criticmarkup'

// ── Identifier types ───────────────────────────────────────────────────────

export interface DocEditOpts {
  /** When the match text appears more than once in the body, pick the
   *  Nth occurrence (1-indexed). Default: 1 (first). */
  occurrence?: number
}

export interface AcceptRejectIdentifier {
  /** When set, look up the CM op whose `meta.id` equals this string.
   *  Only comment ops have ids; for ins/del/sub/highlight use `match`. */
  id?: string
  /** When set, look up the CM op whose inner text matches this string.
   *  For substitutions: matches either oldText or newText. */
  match?: string
  /** When `match` matches more than one op, pick the Nth (1-indexed). */
  occurrence?: number
}

export interface DocEditResult {
  /** The body after the operation. Equal to the input on a no-op. */
  body: string
  /** Whether the body actually changed. False indicates a no-op
   *  (e.g. anchor not found, idempotent re-apply). */
  changed: boolean
  /** Human-readable description of the no-op reason, when applicable.
   *  Empty string on success. */
  reason: string
}

// ── Source-position mapping ────────────────────────────────────────────────

interface StrippedView {
  /** The body with all CriticMarkup wrappers stripped per the standard
   *  "accept-all" semantics. */
  stripped: string
  /** Maps an offset in `stripped` back to the corresponding offset in
   *  the original body. Length = stripped.length + 1 (an entry per
   *  position, including the trailing position). */
  strippedToSource: number[]
}

function buildStrippedView(body: string): StrippedView {
  const ops = parseCriticMarkup(body)
  if (ops.length === 0) {
    // Identity map.
    const map: number[] = []
    for (let i = 0; i <= body.length; i++) map.push(i)
    return { stripped: body, strippedToSource: map }
  }
  // Walk source positions, emitting stripped positions for each char
  // that survives the strip, and recording the source offset for each
  // stripped offset.
  let out = ''
  const map: number[] = []
  let cursor = 0
  for (const op of ops) {
    const opStart = op.kind === 'comment' && op.anchorStart !== undefined ? op.anchorStart : op.start
    // Emit the gap before this op.
    for (let i = cursor; i < opStart; i++) {
      map.push(i)
      out += body[i]
    }
    // Emit the op's "accepted" content + map each emitted char to the
    // source offset of the original character inside the op's body.
    if (op.kind === 'insert') {
      // `{++text++}` — emit text; map each char to its position
      // inside the source (op.start + 3 + i, because `{++` is 3 chars).
      const innerSourceStart = op.start + 3
      for (let i = 0; i < op.text.length; i++) {
        map.push(innerSourceStart + i)
        out += op.text[i]
      }
    } else if (op.kind === 'delete') {
      // Stripped view drops the deleted text entirely.
    } else if (op.kind === 'substitute') {
      // Emit newText; map to its source positions inside the token.
      // Token shape: `{~~old~>new~~}`. newText starts after `{~~old~>`.
      const innerSourceStart = op.start + 3 + op.oldText.length + 2
      for (let i = 0; i < op.newText.length; i++) {
        map.push(innerSourceStart + i)
        out += op.newText[i]
      }
    } else if (op.kind === 'highlight') {
      // `{==text==}` — emit text; map to source position inside the
      // token (op.start + 3).
      const innerSourceStart = op.start + 3
      for (let i = 0; i < op.text.length; i++) {
        map.push(innerSourceStart + i)
        out += op.text[i]
      }
    } else if (op.kind === 'comment') {
      // Anchored comment: emit anchor text. Standalone: drop entirely.
      if (op.anchor !== undefined && op.anchorStart !== undefined) {
        const innerSourceStart = op.anchorStart + 3
        for (let i = 0; i < op.anchor.length; i++) {
          map.push(innerSourceStart + i)
          out += op.anchor[i]
        }
      }
    }
    cursor = op.end
  }
  // Emit the trailing gap after the last op.
  for (let i = cursor; i < body.length; i++) {
    map.push(i)
    out += body[i]
  }
  // Final position (length) maps to length of source.
  map.push(body.length)
  return { stripped: out, strippedToSource: map }
}

/**
 * True when the source range [from, to) crosses any existing CM op's
 * span. Used by delete/substitute/comment to refuse operations whose
 * resolved range would split an existing token. Boundary touches at
 * either end DON'T count as overlap (a delete that ends exactly where
 * a comment starts is fine).
 */
function rangeOverlapsExistingOp(body: string, from: number, to: number): boolean {
  const ops = parseCriticMarkup(body)
  for (const op of ops) {
    const opStart = op.kind === 'comment' && op.anchorStart !== undefined ? op.anchorStart : op.start
    const opEnd = op.end
    // Strict overlap: the two ranges share at least one position
    // (not just touching at a boundary).
    if (from < opEnd && to > opStart) return true
  }
  return false
}

function nthIndexOf(haystack: string, needle: string, occurrence: number): number {
  if (occurrence < 1) return -1
  let pos = 0
  for (let i = 0; i < occurrence; i++) {
    const idx = haystack.indexOf(needle, pos)
    if (idx < 0) return -1
    if (i === occurrence - 1) return idx
    pos = idx + Math.max(1, needle.length)
  }
  return -1
}

// ── Insertions ─────────────────────────────────────────────────────────────

export function insertAfter(
  body: string,
  anchorText: string,
  newText: string,
  opts: DocEditOpts = {}
): DocEditResult {
  if (!anchorText) return { body, changed: false, reason: 'anchor text is empty' }
  if (!newText) return { body, changed: false, reason: 'new text is empty' }
  const occurrence = opts.occurrence ?? 1
  const view = buildStrippedView(body)
  const idxStripped = nthIndexOf(view.stripped, anchorText, occurrence)
  if (idxStripped < 0) {
    return { body, changed: false, reason: `anchor "${anchorText}" not found (occurrence ${occurrence})` }
  }
  const tailStripped = idxStripped + anchorText.length
  const tailSource = view.strippedToSource[tailStripped]
  const token = `{++${newText}++}`
  return {
    body: body.slice(0, tailSource) + token + body.slice(tailSource),
    changed: true,
    reason: ''
  }
}

export function insertBefore(
  body: string,
  anchorText: string,
  newText: string,
  opts: DocEditOpts = {}
): DocEditResult {
  if (!anchorText) return { body, changed: false, reason: 'anchor text is empty' }
  if (!newText) return { body, changed: false, reason: 'new text is empty' }
  const occurrence = opts.occurrence ?? 1
  const view = buildStrippedView(body)
  const idxStripped = nthIndexOf(view.stripped, anchorText, occurrence)
  if (idxStripped < 0) {
    return { body, changed: false, reason: `anchor "${anchorText}" not found (occurrence ${occurrence})` }
  }
  const headSource = view.strippedToSource[idxStripped]
  const token = `{++${newText}++}`
  return {
    body: body.slice(0, headSource) + token + body.slice(headSource),
    changed: true,
    reason: ''
  }
}

export function insertAtLine(
  body: string,
  line: number,
  newText: string
): DocEditResult {
  if (line < 1) return { body, changed: false, reason: 'line must be 1-indexed' }
  if (!newText) return { body, changed: false, reason: 'new text is empty' }
  // Find the start offset of `line` in the original body. Insertions
  // at line boundaries don't need the stripped-view mapping (line
  // breaks survive both views identically).
  let cursor = 0
  let currentLine = 1
  while (currentLine < line && cursor < body.length) {
    const next = body.indexOf('\n', cursor)
    if (next < 0) {
      // The requested line is past EOF — clamp to EOF and emit a
      // trailing newline before the insertion so the new text lands
      // on its own line.
      const token = `{++${newText}++}`
      const sep = body.endsWith('\n') ? '' : '\n'
      return {
        body: body + sep + token,
        changed: true,
        reason: ''
      }
    }
    cursor = next + 1
    currentLine++
  }
  const token = `{++${newText}++}`
  return {
    body: body.slice(0, cursor) + token + body.slice(cursor),
    changed: true,
    reason: ''
  }
}

// ── Deletions ──────────────────────────────────────────────────────────────

export function deleteText(
  body: string,
  targetText: string,
  opts: DocEditOpts = {}
): DocEditResult {
  if (!targetText) return { body, changed: false, reason: 'target text is empty' }
  const occurrence = opts.occurrence ?? 1
  const view = buildStrippedView(body)
  const idxStripped = nthIndexOf(view.stripped, targetText, occurrence)
  if (idxStripped < 0) {
    return { body, changed: false, reason: `text "${targetText}" not found (occurrence ${occurrence})` }
  }
  const headSource = view.strippedToSource[idxStripped]
  const tailSource = view.strippedToSource[idxStripped + targetText.length]
  if (rangeOverlapsExistingOp(body, headSource, tailSource)) {
    return { body, changed: false, reason: 'text overlaps existing CriticMarkup — split the operation' }
  }
  const slice = body.slice(headSource, tailSource)
  const token = `{--${slice}--}`
  return {
    body: body.slice(0, headSource) + token + body.slice(tailSource),
    changed: true,
    reason: ''
  }
}

// ── Highlights ─────────────────────────────────────────────────────────────

/**
 * BUG-138 family — CLI parity for `{==X==}` highlight ops. The
 * `HighlightMark` already exists in the TipTap editor (parsed +
 * serialized via `applyCriticMarkupFromText` / `materializeCriticMarkupToJSON`);
 * this verb closes the gap where the user could highlight in the UI but
 * the agent couldn't.
 *
 * Shape is identical to `deleteText` — pick the Nth occurrence of
 * `targetText` in the stripped-CM view, refuse if the range overlaps
 * an existing CM token (split the operation), wrap the source slice
 * with `{==…==}`. Author/ts attrs land null on load and stay null
 * unless the user later edits the marked text (where SuggestingMode's
 * appendTransaction would stamp them) — consistent with how
 * `duo doc insert/delete/substitute` behave.
 */
export function highlightText(
  body: string,
  targetText: string,
  opts: DocEditOpts = {}
): DocEditResult {
  if (!targetText) return { body, changed: false, reason: 'target text is empty' }
  const occurrence = opts.occurrence ?? 1
  const view = buildStrippedView(body)
  const idxStripped = nthIndexOf(view.stripped, targetText, occurrence)
  if (idxStripped < 0) {
    return { body, changed: false, reason: `text "${targetText}" not found (occurrence ${occurrence})` }
  }
  const headSource = view.strippedToSource[idxStripped]
  const tailSource = view.strippedToSource[idxStripped + targetText.length]
  if (rangeOverlapsExistingOp(body, headSource, tailSource)) {
    return { body, changed: false, reason: 'text overlaps existing CriticMarkup — split the operation' }
  }
  const slice = body.slice(headSource, tailSource)
  const token = `{==${slice}==}`
  return {
    body: body.slice(0, headSource) + token + body.slice(tailSource),
    changed: true,
    reason: ''
  }
}

// ── Substitutions ──────────────────────────────────────────────────────────

export function substituteText(
  body: string,
  oldText: string,
  newText: string,
  opts: DocEditOpts = {}
): DocEditResult {
  if (!oldText) return { body, changed: false, reason: 'old text is empty' }
  // newText empty is a valid substitution (equivalent to delete).
  const occurrence = opts.occurrence ?? 1
  const view = buildStrippedView(body)
  const idxStripped = nthIndexOf(view.stripped, oldText, occurrence)
  if (idxStripped < 0) {
    return { body, changed: false, reason: `text "${oldText}" not found (occurrence ${occurrence})` }
  }
  const headSource = view.strippedToSource[idxStripped]
  const tailSource = view.strippedToSource[idxStripped + oldText.length]
  if (rangeOverlapsExistingOp(body, headSource, tailSource)) {
    return { body, changed: false, reason: 'text overlaps existing CriticMarkup — split the operation' }
  }
  const slice = body.slice(headSource, tailSource)
  const token = `{~~${slice}~>${newText}~~}`
  return {
    body: body.slice(0, headSource) + token + body.slice(tailSource),
    changed: true,
    reason: ''
  }
}

// ── Comments ───────────────────────────────────────────────────────────────

export interface CommentParams {
  anchorText: string
  commentBody: string
  author: string
  ts: string
  commentId: string
  replyTo?: string
  occurrence?: number
}

export function addAnchoredComment(
  body: string,
  params: CommentParams
): DocEditResult {
  if (!params.anchorText) return { body, changed: false, reason: 'anchor text is empty' }
  if (!params.commentBody) return { body, changed: false, reason: 'comment body is empty' }
  if (!params.author) return { body, changed: false, reason: 'author is required' }
  if (!params.commentId) return { body, changed: false, reason: 'comment id is required' }
  const occurrence = params.occurrence ?? 1
  const view = buildStrippedView(body)
  const idxStripped = nthIndexOf(view.stripped, params.anchorText, occurrence)
  if (idxStripped < 0) {
    return { body, changed: false, reason: `anchor "${params.anchorText}" not found (occurrence ${occurrence})` }
  }
  const headSource = view.strippedToSource[idxStripped]
  const tailSource = view.strippedToSource[idxStripped + params.anchorText.length]
  if (rangeOverlapsExistingOp(body, headSource, tailSource)) {
    return { body, changed: false, reason: 'anchor overlaps existing CriticMarkup — split the operation' }
  }
  const slice = body.slice(headSource, tailSource)
  // Comment bodies must remain in a single markdown paragraph (no
  // blank lines) so the surrounding `{>>...<<}` token doesn't split
  // across paragraphs at parse time. See
  // migrateSidecarComments.collapseRepliesIntoBody for the same rule.
  const safeBody = params.commentBody.replace(/\r\n?/g, '\n').replace(/\n{2,}/g, '\n')
  const meta: CommentMeta = {
    id: params.commentId,
    author: params.author,
    ts: params.ts,
    replyTo: params.replyTo
  }
  const inner = serializeCommentBody(meta, safeBody)
  const token = `{==${slice}==}{>>${inner}<<}`
  return {
    body: body.slice(0, headSource) + token + body.slice(tailSource),
    changed: true,
    reason: ''
  }
}

// ── Reply (BUG-143) ────────────────────────────────────────────────────────

/** Parameters for appending a reply to an existing comment thread.
 *  No anchor text — replies attach to the parent comment by id, and the
 *  reply body is appended inside the parent's `{>>…<<}` token using the
 *  `↪ @author ts: body` separator that `parseRepliesFromBody` reads. */
export interface CommentReplyParams {
  /** Parent comment's id (the `id:` field inside its `{>>…<<}` body). */
  replyTo: string
  /** Reply body text. Single-paragraph (newlines collapsed). */
  replyBody: string
  /** Reply author display name. */
  author: string
  /** ISO 8601 timestamp for the reply. */
  ts: string
}

/** BUG-143 — append a reply entry to an existing comment thread.
 *
 *  Pre-fix the only way an agent could "reply" was to call
 *  `addAnchoredComment` with the parent id smuggled as the anchor text,
 *  which corrupted the parent token (nested `{==id==}{>>NEW<<}` inside
 *  the existing `{>>…<<}` body) and broke the editor's thread render.
 *
 *  Post-fix this is the canonical path: find the parent by id, append
 *  `\n↪ @<author> <ts>: <body>` to the parent's body, re-serialize. The
 *  editor's existing `parseRepliesFromBody` (BUG-138 Phase 5) splits the
 *  joined body back into thread entries at render time. */
export function addCommentReply(
  body: string,
  params: CommentReplyParams
): DocEditResult {
  if (!params.replyTo) return { body, changed: false, reason: 'reply-to is required' }
  if (!params.replyBody) return { body, changed: false, reason: 'reply body is empty' }
  if (!params.author) return { body, changed: false, reason: 'author is required' }
  if (!params.ts) return { body, changed: false, reason: 'ts is required' }

  const ops = parseCriticMarkup(body)
  const target = ops.find(
    (op): op is CmOp & { kind: 'comment' } =>
      op.kind === 'comment' && op.meta.id === params.replyTo
  )
  if (!target) {
    return { body, changed: false, reason: `comment with id "${params.replyTo}" not found` }
  }

  // Single-paragraph guard — match collapseRepliesIntoBody's rule. The
  // `{>>…<<}` token must stay in one markdown paragraph or the editor
  // splits the token across paragraphs at parse time.
  const safeReplyBody = params.replyBody
    .replace(/\r\n?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/\n/g, ' ')
    .trim()

  const newBody = `${target.body}\n↪ @${params.author} ${params.ts}: ${safeReplyBody}`
  const newInner = serializeCommentBody(target.meta, newBody)
  const newToken = target.anchor !== undefined
    ? `{==${target.anchor}==}{>>${newInner}<<}`
    : `{>>${newInner}<<}`

  // For anchored comments, target.start covers the `{==anchor==}{>>…<<}`
  // range (the parser folds the highlight+comment pair into a single op
  // with start = highlight's start, end = comment's closing). For
  // standalone comments, start/end cover just `{>>…<<}`. Either way,
  // body.slice(start, end) gives us the exact token to replace.
  return {
    body: body.slice(0, target.start) + newToken + body.slice(target.end),
    changed: true,
    reason: ''
  }
}

// ── Accept / Reject ────────────────────────────────────────────────────────

function findOpByIdentifier(
  body: string,
  ident: AcceptRejectIdentifier
): { op: CmOp; index: number } | null {
  const ops = parseCriticMarkup(body)
  if (ops.length === 0) return null
  if (ident.id) {
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      if (op.kind === 'comment' && op.meta.id === ident.id) {
        return { op, index: i }
      }
    }
    return null
  }
  if (ident.match) {
    const occurrence = ident.occurrence ?? 1
    let hits = 0
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      const innerText =
        op.kind === 'substitute'
          ? `${op.oldText}~>${op.newText}`
          : op.kind === 'comment'
            ? (op.anchor ?? op.body)
            : op.text
      if (innerText === ident.match || innerText.indexOf(ident.match) !== -1) {
        hits++
        if (hits === occurrence) return { op, index: i }
      }
    }
  }
  return null
}

/**
 * Accept the CM op identified by `ident`. Accept semantics per
 * standard CriticMarkup:
 *   - insert    → keep the inserted text, drop the wrapping
 *   - delete    → actually delete the text
 *   - substitute → keep newText, drop oldText + wrapping
 *   - highlight → keep the text, drop the wrapping
 *   - comment   → keep the anchor text (if anchored), drop the comment
 *                 marker entirely (and the wrapping for standalone)
 */
export function acceptOp(body: string, ident: AcceptRejectIdentifier): DocEditResult {
  const hit = findOpByIdentifier(body, ident)
  if (!hit) {
    return { body, changed: false, reason: 'op not found' }
  }
  const { op } = hit
  const opStart = op.kind === 'comment' && op.anchorStart !== undefined ? op.anchorStart : op.start
  let replacement: string
  if (op.kind === 'insert') replacement = op.text
  else if (op.kind === 'delete') replacement = ''
  else if (op.kind === 'substitute') replacement = op.newText
  else if (op.kind === 'highlight') replacement = op.text
  else if (op.kind === 'comment') replacement = op.anchor ?? ''
  else replacement = ''
  return {
    body: body.slice(0, opStart) + replacement + body.slice(op.end),
    changed: true,
    reason: ''
  }
}

/**
 * Reject the CM op identified by `ident`. Reject is the inverse of
 * accept:
 *   - insert    → drop the inserted text entirely
 *   - delete    → keep the text, drop the wrapping
 *   - substitute → keep oldText, drop newText + wrapping
 *   - highlight → keep the text, drop the wrapping (same as accept)
 *   - comment   → keep the anchor (if anchored), drop the comment
 *                 marker (same as accept — there's no "rejected
 *                 comment" semantic in CriticMarkup)
 */
export function rejectOp(body: string, ident: AcceptRejectIdentifier): DocEditResult {
  const hit = findOpByIdentifier(body, ident)
  if (!hit) {
    return { body, changed: false, reason: 'op not found' }
  }
  const { op } = hit
  const opStart = op.kind === 'comment' && op.anchorStart !== undefined ? op.anchorStart : op.start
  let replacement: string
  if (op.kind === 'insert') replacement = ''
  else if (op.kind === 'delete') replacement = op.text
  else if (op.kind === 'substitute') replacement = op.oldText
  else if (op.kind === 'highlight') replacement = op.text
  else if (op.kind === 'comment') replacement = op.anchor ?? ''
  else replacement = ''
  return {
    body: body.slice(0, opStart) + replacement + body.slice(op.end),
    changed: true,
    reason: ''
  }
}
