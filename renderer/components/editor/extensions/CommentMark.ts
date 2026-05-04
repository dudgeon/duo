// Sprint 6 Phase 4 (MISSING-001 / Stage 14a) — TipTap mark extension
// for inline comment anchors in the markdown editor. Mirrors the
// canvas-side `data-duo-comment-id` model used by `commentAnchors.ts`,
// but lives at the ProseMirror layer instead of in the iframe DOM.
//
// What it gives us:
//   - A `commentMark` mark with a single `commentId` attribute. When a
//     range is wrapped in this mark, the rendered span carries
//     `data-duo-comment-id="<id>"` and the `duo-comment-anchor-text`
//     class — the same hooks `installCommentAnchorStyles` styles in
//     the iframe (light + dark variants are mirrored in
//     `globals.css` for the parent renderer).
//   - Position-tracking for free. ProseMirror's mark system maps the
//     mark range across every transaction: typing inside the mark
//     extends it, typing right at the boundary stays inside (default
//     inclusive/exclusive heuristic); deletes and pastes adjust the
//     range automatically. Heavy edits (paste-across, delete-across)
//     can still produce orphans — the rail surfaces those gracefully.
//   - `addCommand` exposes `applyCommentMark(commentId, from?, to?)`
//     and `removeCommentMark(commentId)` so PageTab-equivalent
//     handlers can wrap selections + tear down resolved threads.
//
// Persistence note. tiptap-markdown is configured with `html: false`
// in MarkdownEditor (line ~212) so unknown HTML elements are stripped
// on serialize. That means the `<span data-duo-comment-id>` does NOT
// round-trip through the .md source — comments live in the sidecar
// (`<file>.md.duo.json`) and are re-applied on file load by walking
// the parsed doc and matching excerpts. This keeps the user's
// markdown source clean (no stray comment spans on disk) and aligns
// with how the canvas stores comments in its sidecar rather than
// inline in the .html.

import { Mark, mergeAttributes } from '@tiptap/core'

export interface CommentMarkAttributes {
  commentId: string
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMark: {
      /** Apply a comment mark with the given id. If `from`/`to` are
       *  omitted, the current selection is used. No-op when the
       *  range is collapsed (a comment with no anchored text is
       *  ill-defined). Returns true on success. */
      applyCommentMark: (commentId: string, from?: number, to?: number) => ReturnType
      /** Remove every commentMark with the given id. Used when a
       *  thread is resolved (visual cleanup) — the sidecar entry
       *  itself is updated separately. */
      removeCommentMark: (commentId: string) => ReturnType
    }
  }
}

export const CommentMark = Mark.create<{}, { commentId: string | null }>({
  name: 'commentMark',

  // Marks keep their boundaries when typing AT the boundary — this
  // makes "type at the end of a commented word" extend the comment
  // anchor. If users want unbounded boundaries they can resolve +
  // re-anchor; this is the more useful default for comment threads.
  inclusive: true,

  // Don't merge into adjacent marks of the same type with a different
  // id — two distinct comments on adjacent text must stay distinct.
  excludes: '',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-duo-comment-id'),
        renderHTML: (attrs) => {
          if (!attrs.commentId) return {}
          return { 'data-duo-comment-id': attrs.commentId as string }
        }
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-duo-comment-id]'
      }
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'duo-comment-anchor-text'
      }),
      0
    ]
  },

  addCommands() {
    return {
      applyCommentMark: (commentId, from, to) => ({ tr, dispatch, state }) => {
        if (!commentId) return false
        const range = (typeof from === 'number' && typeof to === 'number')
          ? { from, to }
          : { from: state.selection.from, to: state.selection.to }
        if (range.to <= range.from) return false
        if (dispatch) {
          const markType = state.schema.marks.commentMark
          if (!markType) return false
          tr.addMark(range.from, range.to, markType.create({ commentId }))
          dispatch(tr)
        }
        return true
      },

      removeCommentMark: (commentId) => ({ tr, dispatch, state }) => {
        const markType = state.schema.marks.commentMark
        if (!markType) return false
        const ranges: Array<{ from: number; to: number }> = []
        state.doc.descendants((node, pos) => {
          node.marks.forEach((m) => {
            if (m.type === markType && m.attrs.commentId === commentId) {
              ranges.push({ from: pos, to: pos + node.nodeSize })
            }
          })
        })
        if (ranges.length === 0) return false
        if (dispatch) {
          for (const r of ranges) {
            tr.removeMark(r.from, r.to, markType)
          }
          dispatch(tr)
        }
        return true
      }
    }
  }
})

/** Walk the editor doc and return every range that carries a
 *  commentMark, grouped by commentId. Result is ordered by
 *  document position. Used by the rail's thread builder + the
 *  scroll-to-anchor handler. */
export function collectCommentRanges(
  doc: import('@tiptap/pm/model').Node
): Map<string, { from: number; to: number; text: string }> {
  const out = new Map<string, { from: number; to: number; text: string }>()
  doc.descendants((node, pos) => {
    if (!node.isText) return
    for (const m of node.marks) {
      if (m.type.name !== 'commentMark') continue
      const id = m.attrs.commentId as string | null
      if (!id) continue
      const existing = out.get(id)
      const from = pos
      const to = pos + node.nodeSize
      if (existing) {
        // Same comment can span multiple text nodes (different inline
        // marks intersecting); collapse to the outer range and
        // concatenate text.
        out.set(id, {
          from: Math.min(existing.from, from),
          to: Math.max(existing.to, to),
          text: existing.text + (node.text ?? '')
        })
      } else {
        out.set(id, { from, to, text: node.text ?? '' })
      }
    }
  })
  return out
}
