// BUG-138 / Stage 14 — CriticMarkup parser/serializer + structured-body
// extension for Duo metadata (id, author, timestamp, reply-to).
//
// Pure module: no editor / TipTap / DOM imports. Round-trip:
//
//   parseCriticMarkup(md)  → CmOp[]     (positions in source markdown)
//   serializeOps(ops, md)  → markdown   (re-emits CriticMarkup at the right positions)
//
// Standard CriticMarkup syntax:
//
//   {++inserted text++}                                  insertion
//   {--deleted text--}                                   deletion
//   {~~old text~>new text~~}                             substitution
//   {==highlighted text==}                               highlight
//   {>>comment body<<}                                   standalone comment
//   {==anchor==}{>>comment body<<}                       anchored comment
//
// Duo's opinionated extension (locked in BUG-138 playground Q1·A):
// the comment body has a pipe-delimited metadata prefix:
//
//   {>>id:c-01HXYZ|author:claude|ts:2026-05-18T12:34:56Z|reply-to:c-00?|body<<}
//
// Metadata keys are recognized by name (`id:`, `author:`, `ts:`, `reply-to:`).
// First non-recognized segment + everything after it = the body. So bodies
// containing `|` work as long as the body doesn't start with one of the
// metadata-key prefixes. Old comments without metadata (just `{>>body<<}`)
// parse cleanly with empty metadata + body=everything.

export type CmOpKind = 'insert' | 'delete' | 'substitute' | 'highlight' | 'comment'

export interface CmOpBase {
  kind: CmOpKind
  /** Absolute char offset in the source markdown where the operator starts (the opening `{`). */
  start: number
  /** Absolute char offset just past the operator's closing `}`. */
  end: number
}

export interface CmInsertOp extends CmOpBase {
  kind: 'insert'
  text: string
}
export interface CmDeleteOp extends CmOpBase {
  kind: 'delete'
  text: string
}
export interface CmSubstituteOp extends CmOpBase {
  kind: 'substitute'
  oldText: string
  newText: string
}
export interface CmHighlightOp extends CmOpBase {
  kind: 'highlight'
  text: string
}
export interface CmCommentOp extends CmOpBase {
  kind: 'comment'
  /** Parsed metadata from the pipe-prefix. All optional — old bodies that
   *  were never written by Duo will have empty metadata + body=full text. */
  meta: CommentMeta
  body: string
  /** When the comment is anchored to a preceding `{==…==}`, this carries
   *  the anchored text. The anchor's `start` is included in this comment's
   *  `start`; the anchor's `end` becomes the comment's `start`. */
  anchor?: string
  /** Char offset of the anchor's opening `{` when present. Used for
   *  serialization round-trip. */
  anchorStart?: number
}

export type CmOp = CmInsertOp | CmDeleteOp | CmSubstituteOp | CmHighlightOp | CmCommentOp

export interface CommentMeta {
  id?: string
  author?: string
  ts?: string
  replyTo?: string
}

// ── Parser ──────────────────────────────────────────────────────────────────

// Single regex with named captures (per-op alternation). Anchor-comment is
// composed at a higher level so we keep this readable.
//
// Insertion:   {++ … ++}   (lazy match between, no nested braces)
// Deletion:    {-- … --}
// Substitute:  {~~ old~>new ~~}
// Highlight:   {== … ==}
// Comment:     {>> … <<}
const TOKEN_RE = /\{(\+\+|--|~~|==|>>)([\s\S]*?)(?:(\+\+|--|~~|==|<<))\}/g

const OPEN_TO_KIND: Record<string, CmOpKind> = {
  '++': 'insert',
  '--': 'delete',
  '~~': 'substitute',
  '==': 'highlight',
  '>>': 'comment'
}
const CLOSE_FOR: Record<string, string> = {
  '++': '++',
  '--': '--',
  '~~': '~~',
  '==': '==',
  '>>': '<<'
}

/**
 * Parse all CriticMarkup operators in source markdown. Returns an array of
 * ops with absolute char offsets. Operators are NOT removed from the
 * source — callers can use the offsets to either splice them out (when
 * serializing the doc body into TipTap marks) or render them inline (when
 * displaying raw source).
 *
 * Adjacent `{==anchor==}{>>comment<<}` pairs are collapsed into a single
 * anchored comment op (the highlight gets folded into the comment's
 * `anchor` field). Standalone highlights without a trailing comment stay
 * as their own `kind: 'highlight'` op.
 */
export function parseCriticMarkup(source: string): CmOp[] {
  const ops: CmOp[] = []
  TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(source)) !== null) {
    const open = match[1]
    const body = match[2]
    const close = match[3]
    if (CLOSE_FOR[open] !== close) continue // mismatched delimiters; skip
    const kind = OPEN_TO_KIND[open]
    const start = match.index
    const end = match.index + match[0].length
    if (kind === 'insert') {
      ops.push({ kind: 'insert', start, end, text: body })
    } else if (kind === 'delete') {
      ops.push({ kind: 'delete', start, end, text: body })
    } else if (kind === 'substitute') {
      // Body format: `old~>new`. The `~>` separator splits old and new.
      const sepIdx = body.indexOf('~>')
      if (sepIdx === -1) continue // malformed; skip
      ops.push({
        kind: 'substitute',
        start,
        end,
        oldText: body.slice(0, sepIdx),
        newText: body.slice(sepIdx + 2)
      })
    } else if (kind === 'highlight') {
      ops.push({ kind: 'highlight', start, end, text: body })
    } else if (kind === 'comment') {
      const { meta, body: bodyText } = parseCommentBody(body)
      ops.push({ kind: 'comment', start, end, meta, body: bodyText })
    }
  }

  // Fold adjacent `highlight + comment` pairs into anchored comments.
  const folded: CmOp[] = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    const next = ops[i + 1]
    if (op.kind === 'highlight' && next && next.kind === 'comment' && next.start === op.end) {
      folded.push({
        kind: 'comment',
        // The anchored op covers both: start at the highlight's `{`, end at the comment's `}`.
        start: op.start,
        end: next.end,
        meta: next.meta,
        body: next.body,
        anchor: op.text,
        anchorStart: op.start
      })
      i++ // consume both
    } else {
      folded.push(op)
    }
  }
  return folded
}

// ── Structured-body parser ──────────────────────────────────────────────────

const META_KEYS = new Set(['id', 'author', 'ts', 'reply-to'])

/**
 * Parse the comment body's pipe-prefix metadata. Body format:
 *
 *   id:<ulid>|author:<name>|ts:<iso>|reply-to:<id>?|<body>
 *
 * Each leading segment that matches `<known-key>:<value>` is consumed as
 * metadata. The first segment that doesn't match becomes the start of the
 * body. So bodies can contain `|` as long as they don't START with a
 * known-key prefix.
 *
 * Bodies without ANY pipe-prefix (legacy / hand-typed) parse to
 * `{ meta: {}, body: <full text> }`.
 */
export function parseCommentBody(raw: string): { meta: CommentMeta; body: string } {
  const meta: CommentMeta = {}
  let rest = raw
  while (true) {
    const pipe = rest.indexOf('|')
    const colon = rest.indexOf(':')
    if (colon === -1) break
    // The candidate metadata segment is everything up to the next `|`.
    const segEnd = pipe === -1 ? rest.length : pipe
    if (colon > segEnd) break
    const key = rest.slice(0, colon).trim()
    if (!META_KEYS.has(key)) break
    const value = rest.slice(colon + 1, segEnd).trim()
    if (key === 'id') meta.id = value
    else if (key === 'author') meta.author = value
    else if (key === 'ts') meta.ts = value
    else if (key === 'reply-to') meta.replyTo = value
    if (pipe === -1) {
      // Last segment WAS metadata; no body remains.
      return { meta, body: '' }
    }
    rest = rest.slice(pipe + 1)
  }
  return { meta, body: rest }
}

/** Serialize structured comment body to the pipe-delimited form.
 *  Returns just the body — callers wrap in `{>>…<<}`. */
export function serializeCommentBody(meta: CommentMeta, body: string): string {
  const parts: string[] = []
  if (meta.id) parts.push(`id:${meta.id}`)
  if (meta.author) parts.push(`author:${meta.author}`)
  if (meta.ts) parts.push(`ts:${meta.ts}`)
  if (meta.replyTo) parts.push(`reply-to:${meta.replyTo}`)
  parts.push(body)
  return parts.join('|')
}

// ── Per-op serialization helpers ────────────────────────────────────────────

/** Build a CriticMarkup token from an op (no positional concerns). */
export function serializeOp(op: CmOp): string {
  switch (op.kind) {
    case 'insert': return `{++${op.text}++}`
    case 'delete': return `{--${op.text}--}`
    case 'substitute': return `{~~${op.oldText}~>${op.newText}~~}`
    case 'highlight': return `{==${op.text}==}`
    case 'comment': {
      const inner = serializeCommentBody(op.meta, op.body)
      const commentToken = `{>>${inner}<<}`
      return op.anchor !== undefined
        ? `{==${op.anchor}==}${commentToken}`
        : commentToken
    }
  }
}

// ── Strip helper: produce clean markdown with all ops removed ────────────────

/**
 * Strip CriticMarkup from source markdown, leaving only the "accepted" view:
 * insertions kept, deletions removed, substitutions replaced with new text,
 * highlights kept (just the text), comments removed entirely. Used for the
 * "view with all suggestions accepted" mode AND for the migration logic
 * that needs to know what the body SHOULD be after migration.
 */
export function stripCriticMarkup(source: string): string {
  const ops = parseCriticMarkup(source)
  if (ops.length === 0) return source
  let out = ''
  let cursor = 0
  for (const op of ops) {
    // Append everything between the prior op and this op.
    const opStart = op.kind === 'comment' && op.anchorStart !== undefined ? op.anchorStart : op.start
    out += source.slice(cursor, opStart)
    // Append the op's "accepted" content.
    if (op.kind === 'insert') out += op.text
    else if (op.kind === 'delete') { /* drop */ }
    else if (op.kind === 'substitute') out += op.newText
    else if (op.kind === 'highlight') out += op.text
    else if (op.kind === 'comment') {
      // Anchored comment: keep the anchor text; drop the comment marker.
      // Standalone comment: drop entirely.
      if (op.anchor !== undefined) out += op.anchor
    }
    cursor = op.end
  }
  out += source.slice(cursor)
  return out
}
