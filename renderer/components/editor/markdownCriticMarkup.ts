// BUG-138 / Stage 14b — bridge between CriticMarkup-in-source and TipTap
// marks. Works around tiptap-markdown rather than through its parse/
// serialize plugin API because CriticMarkup tokens are plain text from
// markdown-it's perspective, so they survive parse-emit as literal text;
// we just convert text↔marks at the boundaries.
//
// Round-trip:
//
//   .md source                       PM doc                   .md source
//   ──────────                       ──────                   ──────────
//   Hello {++world++}                Hello world              Hello {++world++}
//                                   (world has InsertionMark)
//
// On load: setContent(md), then applyCriticMarkupFromText(editor) walks
// the doc, finds CriticMarkup-shaped text, and converts to marks.
//
// On save: materializeCriticMarkup(doc) returns a doc-JSON clone where
// marked text runs have been replaced by CriticMarkup-wrapped text and
// the marks stripped. The caller passes the cloned doc through
// tiptap-markdown's serializer which emits the wrapped text verbatim.
//
// Substitution fold: when DeletionMark text is immediately followed by
// InsertionMark text within the same parent, emit `{~~old~>new~~}`.

import type { Editor } from '@tiptap/react'
import {
  parseCriticMarkup,
  serializeCommentBody
} from '../../../core/markdown/criticmarkup'

// ── PRE-PROCESS: shield substitution tokens from tiptap-markdown strikethrough ──
//
// markdown-it (under tiptap-markdown) sees `{~~old~>new~~}` and matches
// the outer `~~…~~` pair as a strikethrough mark — wiping the `~~`
// delimiters and applying strike to the inner text. The CM token is
// destroyed before our applyCriticMarkupFromText walker can see it.
//
// Fix: before passing markdown to setContent, replace substitution
// tokens with a sentinel form using non-printing control chars
// ( / ) that markdown-it emits as literal text. The walker
// recognizes the sentinel pattern and reconstructs the substitution.
//
// Other ops (`{++…++}`, `{--…--}`, `{==…==}`, `{>>…<<}`) round-trip
// cleanly through markdown-it without this trick.

const SUB_OPEN_SENTINEL = '\u0001\u0002'   // SOH+STX (2 chars) — replaces `~~` in `{~~`
const SUB_CLOSE_SENTINEL = '\u001e\u001d'  // RS+GS (2 chars) — replaces `~~` in `~~}`

export function preprocessSubstitutions(source: string): string {
  // Replace `{~~old~>new~~}` with `{<SOH>old~>new<STX>}` — survives
  // markdown-it strikethrough because the inner content no longer
  // starts/ends with `~~`.
  return source.replace(/\{~~([^]*?)~~\}/g, `{${SUB_OPEN_SENTINEL}$1${SUB_CLOSE_SENTINEL}}`)
}

export function restoreSubstitutionsInText(text: string): string {
  // Inverse — used by tests / debug to verify the sentinel cycle.
  return text
    .replace(new RegExp(`\\{${SUB_OPEN_SENTINEL}`, 'g'), '{~~')
    .replace(new RegExp(`${SUB_CLOSE_SENTINEL}\\}`, 'g'), '~~}')
}

// ── PARSE: walk doc text for CriticMarkup tokens, convert to marks ──────────

/**
 * After `editor.commands.setContent(markdown)` runs (tiptap-markdown
 * parses CriticMarkup tokens as literal text), walk the doc and convert
 * each CriticMarkup token to its corresponding mark. Returns the count
 * of ops converted. Single transaction.
 */
export function applyCriticMarkupFromText(editor: Editor): number {
  if (!editor || editor.isDestroyed) return 0
  const view = editor.view
  const state = view.state
  const schema = state.schema

  type Hit = { from: number; text: string }
  const hits: Hit[] = []
  state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text ?? ''
    if (text.indexOf('{') === -1) return // fast-path
    // Restore substitution tokens that were sentinel-encoded by
    // preprocessSubstitutions so the parser can recognize them. We
    // operate on the LOCAL text here; the actual PM transaction below
    // uses the same offset math (sentinels and `~~` are the same length).
    const restored = text
      .replace(new RegExp(`\\{${SUB_OPEN_SENTINEL}`, 'g'), '{~~')
      .replace(new RegExp(`${SUB_CLOSE_SENTINEL}\\}`, 'g'), '~~}')
    hits.push({ from: pos, text: restored })
  })
  if (hits.length === 0) return 0

  const InsMark = schema.marks.insertionMark
  const DelMark = schema.marks.deletionMark
  const HlMark = schema.marks.highlightMark
  const CmtMark = schema.marks.commentMark

  const tr = state.tr
  let converted = 0

  // Walk hits in REVERSE document order so splices don't invalidate
  // earlier positions. Within each hit, walk ops in reverse too.
  for (let h = hits.length - 1; h >= 0; h--) {
    const { from, text } = hits[h]
    const ops = parseCriticMarkup(text)
    if (ops.length === 0) continue
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i]
      // Each op's start/end are character offsets in `text`. Translate
      // to absolute PM positions by adding `from`.
      const opStart = op.kind === 'comment' && op.anchorStart !== undefined ? op.anchorStart : op.start
      const opAbsStart = from + opStart
      const opAbsEnd = from + op.end

      if (op.kind === 'insert' && InsMark) {
        const inner = op.text
        tr.replaceWith(opAbsStart, opAbsEnd, schema.text(inner, [InsMark.create({ author: null, ts: null })]))
        converted++
      } else if (op.kind === 'delete' && DelMark) {
        const inner = op.text
        tr.replaceWith(opAbsStart, opAbsEnd, schema.text(inner, [DelMark.create({ author: null, ts: null })]))
        converted++
      } else if (op.kind === 'substitute' && DelMark && InsMark) {
        // Split into adjacent delete+insert runs.
        const old = op.oldText
        const fresh = op.newText
        const pieces = []
        if (old.length > 0) pieces.push(schema.text(old, [DelMark.create({ author: null, ts: null })]))
        if (fresh.length > 0) pieces.push(schema.text(fresh, [InsMark.create({ author: null, ts: null })]))
        if (pieces.length === 0) {
          tr.delete(opAbsStart, opAbsEnd)
        } else if (pieces.length === 1) {
          tr.replaceWith(opAbsStart, opAbsEnd, pieces[0])
        } else {
          tr.replaceWith(opAbsStart, opAbsEnd, pieces)
        }
        converted++
      } else if (op.kind === 'highlight' && HlMark) {
        const inner = op.text
        tr.replaceWith(opAbsStart, opAbsEnd, schema.text(inner, [HlMark.create({ author: null, ts: null })]))
        converted++
      } else if (op.kind === 'comment') {
        if (op.anchor !== undefined && CmtMark) {
          // Anchored comment — replace the whole `{==anchor==}{>>body<<}` with the anchor text, marked.
          tr.replaceWith(opAbsStart, opAbsEnd, schema.text(op.anchor, [CmtMark.create({
            commentId: op.meta.id ?? null,
            author: op.meta.author ?? null,
            ts: op.meta.ts ?? null,
            body: op.body,
            replyTo: op.meta.replyTo ?? null
          })]))
          converted++
        } else {
          // Standalone comment — v1 limitation: drop the token (marks
          // need text to wrap). A future ENH uses an inline atom node
          // for standalone comments.
          tr.delete(opAbsStart, opAbsEnd)
          converted++
        }
      }
    }
  }
  if (converted > 0) view.dispatch(tr)
  return converted
}

// ── SERIALIZE: clone-doc-JSON with marks materialized as CriticMarkup text ──

/**
 * Returns a JSON clone of the editor's doc where every CM-marked text
 * run has been replaced with CriticMarkup-wrapped text (and the CM
 * marks stripped). Caller feeds this to tiptap-markdown's serializer.
 * The wrapper text passes through unchanged because CriticMarkup syntax
 * is plain text from markdown-it's perspective.
 */
export function materializeCriticMarkupToJSON(editor: Editor): unknown {
  if (!editor || editor.isDestroyed) return editor?.getJSON()
  const docJson = editor.getJSON() as DocJSON
  return transformDoc(docJson)
}

/**
 * Drop-in replacement for `editor.storage.markdown.getMarkdown()`. Walks
 * the editor's doc, materializes CM marks as CriticMarkup text in a
 * temporary cloned doc, runs tiptap-markdown's serializer on the temp
 * doc, and returns the resulting markdown string. The live editor state
 * is NOT mutated.
 */
export function serializeWithCriticMarkup(editor: Editor): string {
  if (!editor || editor.isDestroyed) return ''
  // Storage check: tiptap-markdown's Markdown extension stores a
  // serializer on editor.storage.markdown. If the extension isn't
  // registered (shouldn't happen in MarkdownEditor) we fall back to
  // getJSON-stringify so callers don't see a hard fail.
  const storage = (editor.storage as { markdown?: { serializer?: { serialize: (doc: unknown) => string }; getMarkdown?: () => string } }).markdown
  if (!storage?.serializer) {
    return storage?.getMarkdown?.() ?? ''
  }
  const materialized = materializeCriticMarkupToJSON(editor)
  const schemaCtor = (editor.schema as { nodeFromJSON: (j: unknown) => unknown }).nodeFromJSON
  const tempDoc = schemaCtor.call(editor.schema, materialized)
  return storage.serializer.serialize(tempDoc)
}

// ── Internal: JSON walker ───────────────────────────────────────────────────

interface MarkJSON { type: string; attrs?: Record<string, unknown> }
interface TextNodeJSON { type: 'text'; text: string; marks?: MarkJSON[] }
interface ContainerNodeJSON { type: string; attrs?: Record<string, unknown>; content?: NodeJSON[]; marks?: MarkJSON[] }
type NodeJSON = TextNodeJSON | ContainerNodeJSON
interface DocJSON { type: string; content?: NodeJSON[] }

const CM_MARK_NAMES = new Set(['insertionMark', 'deletionMark', 'highlightMark', 'commentMark'])

function transformDoc(doc: DocJSON): DocJSON {
  if (!doc.content) return doc
  return { ...doc, content: doc.content.map(transformNode) }
}

function transformNode(node: NodeJSON): NodeJSON {
  if (node.type === 'text') return node
  const container = node as ContainerNodeJSON
  if (!container.content) return container
  // For block-level nodes containing text, transform inline children as a unit
  // (so we can do the substitution fold across adjacent text nodes).
  if (containsTextInlines(container)) {
    return { ...container, content: transformInlineChildren(container.content) }
  }
  return { ...container, content: container.content.map(transformNode) }
}

function containsTextInlines(node: ContainerNodeJSON): boolean {
  if (!node.content) return false
  return node.content.some(c => c.type === 'text')
}

function transformInlineChildren(children: NodeJSON[]): NodeJSON[] {
  // First pass: convert each text node carrying a CM mark into a
  // wrapped-text node with the CM marks stripped.
  const transformed: TextNodeJSON[] = []
  const passthrough: NodeJSON[] = []
  // Build a parallel list preserving order so we can fold adjacent del+ins
  // pairs. Non-text inline nodes (images, hardBreak, etc.) interrupt the
  // fold — we re-emit them as-is and reset the "previous text" cursor.
  type Item = { kind: 'text'; node: TextNodeJSON; cm: CmRunInfo } | { kind: 'other'; node: NodeJSON }
  const items: Item[] = children.map(c => {
    if (c.type === 'text') {
      const t = c as TextNodeJSON
      const cm = extractCmInfo(t)
      return { kind: 'text', node: t, cm }
    }
    return { kind: 'other', node: c }
  })
  void transformed
  void passthrough

  // Substitution fold + emission.
  const out: NodeJSON[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'other') {
      out.push(item.node)
      continue
    }
    const cur = item
    const next = items[i + 1]
    // Fold delete → insert into substitute when both are pure (no other CM marks).
    if (
      cur.cm.kind === 'delete' && next && next.kind === 'text' && next.cm.kind === 'insert'
    ) {
      const old = cur.node.text
      const fresh = next.node.text
      const wrappedText = `{~~${old}~>${fresh}~~}`
      out.push(makeWrappedTextNode(wrappedText, cur.cm.preserveMarks))
      i++
      continue
    }
    out.push(emitRun(cur.node, cur.cm))
  }
  return out
}

interface CmRunInfo {
  kind: 'insert' | 'delete' | 'highlight' | 'comment' | 'plain'
  cmAttrs?: Record<string, unknown>
  preserveMarks: MarkJSON[]
}

function extractCmInfo(node: TextNodeJSON): CmRunInfo {
  if (!node.marks || node.marks.length === 0) {
    return { kind: 'plain', preserveMarks: [] }
  }
  let kind: CmRunInfo['kind'] = 'plain'
  let cmAttrs: Record<string, unknown> | undefined
  const preserve: MarkJSON[] = []
  for (const m of node.marks) {
    if (m.type === 'insertionMark') { kind = 'insert'; cmAttrs = m.attrs ?? {} }
    else if (m.type === 'deletionMark') { kind = 'delete'; cmAttrs = m.attrs ?? {} }
    else if (m.type === 'highlightMark') { kind = 'highlight'; cmAttrs = m.attrs ?? {} }
    else if (m.type === 'commentMark') { kind = 'comment'; cmAttrs = m.attrs ?? {} }
    else preserve.push(m)
  }
  return { kind, cmAttrs, preserveMarks: preserve }
}

function emitRun(node: TextNodeJSON, cm: CmRunInfo): NodeJSON {
  if (cm.kind === 'plain') return node
  let wrappedText: string
  switch (cm.kind) {
    case 'insert':
      wrappedText = `{++${node.text}++}`
      break
    case 'delete':
      wrappedText = `{--${node.text}--}`
      break
    case 'highlight':
      wrappedText = `{==${node.text}==}`
      break
    case 'comment': {
      const a = cm.cmAttrs ?? {}
      const body = serializeCommentBody(
        {
          id: (a.commentId as string) ?? undefined,
          author: (a.author as string) ?? undefined,
          ts: (a.ts as string) ?? undefined,
          replyTo: (a.replyTo as string) ?? undefined
        },
        (a.body as string) ?? ''
      )
      wrappedText = `{==${node.text}==}{>>${body}<<}`
      break
    }
  }
  return makeWrappedTextNode(wrappedText, cm.preserveMarks)
}

function makeWrappedTextNode(text: string, preserveMarks: MarkJSON[]): TextNodeJSON {
  const out: TextNodeJSON = { type: 'text', text }
  if (preserveMarks.length > 0) out.marks = preserveMarks
  return out
}
