// BUG-138 / Stage 14a (refactor) — TipTap mark extension for inline
// comments. Anchored to a range of text; carries the full comment
// payload (id, author, ts, body, replyTo) as attributes.
//
// CriticMarkup notation: `{==anchored text==}{>>id:c-01|author:claude|ts:...|body<<}`
// The HighlightMark + this CommentMark are adjacent in the doc when an
// anchored comment is present; the serializer folds the pair into a
// single `{==…==}{>>…<<}` block.
//
// History.
//   v1 (pre-BUG-138): `commentId` was the only attribute. Body lived in
//   the `<file>.md.duo.json` sidecar. Comments stripped on serialize;
//   re-anchored on load via excerpt + context match.
//   v2 (BUG-138 Q-1·A locked 2026-05-18): all metadata + body inline.
//   Sidecar's `comments[]` deprecated. Round-trips through CriticMarkup.

import { Mark, mergeAttributes } from '@tiptap/core'

export interface CommentMarkAttributes {
  commentId: string | null
  author: string | null
  ts: string | null
  body: string | null
  replyTo: string | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMark: {
      /** Apply a comment mark with full metadata + body. If `from`/`to`
       *  are omitted, uses current selection. No-op when collapsed.
       *  Returns true on success. ENH-221 — pass `addToHistory:false` for
       *  programmatic re-anchoring (sidecar load/reload) so the mark pass
       *  stays OFF the undo stack; omit it (default true) for user-created
       *  comments, which SHOULD be undoable. */
      applyCommentMark: (
        attrs: { commentId: string; author: string; ts: string; body: string; replyTo?: string },
        from?: number,
        to?: number,
        addToHistory?: boolean
      ) => ReturnType
      /** Remove every commentMark with the given id. */
      removeCommentMark: (commentId: string) => ReturnType
      /** Update body / metadata for an existing comment (e.g. edit a
       *  thread reply). Range stays where the mark already is. */
      updateCommentMark: (
        commentId: string,
        patch: { body?: string; ts?: string }
      ) => ReturnType
    }
  }
}

export const CommentMark = Mark.create<{}, {}>({
  name: 'commentMark',
  inclusive: true,
  excludes: '',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-duo-comment-id'),
        renderHTML: (attrs) => attrs.commentId ? { 'data-duo-comment-id': attrs.commentId as string } : {}
      },
      author: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-duo-author'),
        renderHTML: (attrs) => attrs.author ? { 'data-duo-author': attrs.author as string } : {}
      },
      ts: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-duo-ts'),
        renderHTML: (attrs) => attrs.ts ? { 'data-duo-ts': attrs.ts as string } : {}
      },
      body: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-duo-comment-body'),
        renderHTML: (attrs) => attrs.body ? { 'data-duo-comment-body': attrs.body as string } : {}
      },
      replyTo: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-duo-comment-reply-to'),
        renderHTML: (attrs) => attrs.replyTo ? { 'data-duo-comment-reply-to': attrs.replyTo as string } : {}
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-duo-comment-id]' }]
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
      applyCommentMark: (attrs, from, to, addToHistory = true) => ({ tr, dispatch, state }) => {
        if (!attrs.commentId) return false
        const range = (typeof from === 'number' && typeof to === 'number')
          ? { from, to }
          : { from: state.selection.from, to: state.selection.to }
        if (range.to <= range.from) return false
        if (dispatch) {
          const markType = state.schema.marks.commentMark
          if (!markType) return false
          tr.addMark(range.from, range.to, markType.create({
            commentId: attrs.commentId,
            author: attrs.author,
            ts: attrs.ts,
            body: attrs.body,
            replyTo: attrs.replyTo ?? null
          }))
          // ENH-221 — programmatic re-anchoring keeps the mark pass off the
          // undo stack so Cmd+Z never lands on an invisible mark application.
          if (!addToHistory) tr.setMeta('addToHistory', false)
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
      },

      updateCommentMark: (commentId, patch) => ({ tr, dispatch, state }) => {
        const markType = state.schema.marks.commentMark
        if (!markType) return false
        let found = false
        state.doc.descendants((node, pos) => {
          node.marks.forEach((m) => {
            if (m.type === markType && m.attrs.commentId === commentId) {
              found = true
              const next = {
                ...m.attrs,
                body: patch.body ?? m.attrs.body,
                ts: patch.ts ?? m.attrs.ts
              }
              if (dispatch) {
                tr.removeMark(pos, pos + node.nodeSize, markType)
                tr.addMark(pos, pos + node.nodeSize, markType.create(next))
              }
            }
          })
        })
        if (dispatch && found) dispatch(tr)
        return found
      }
    }
  }
})

/** Walk the editor doc and return every range that carries a
 *  commentMark, grouped by commentId. Result is ordered by document
 *  position. Used by the rail's thread builder + scroll-to-anchor. */
export function collectCommentRanges(
  doc: import('@tiptap/pm/model').Node
): Map<string, { from: number; to: number; text: string; attrs: CommentMarkAttributes }> {
  const out = new Map<string, { from: number; to: number; text: string; attrs: CommentMarkAttributes }>()
  doc.descendants((node, pos) => {
    if (!node.isText) return
    for (const m of node.marks) {
      if (m.type.name !== 'commentMark') continue
      const id = m.attrs.commentId as string | null
      if (!id) continue
      const attrs: CommentMarkAttributes = {
        commentId: m.attrs.commentId,
        author: m.attrs.author,
        ts: m.attrs.ts,
        body: m.attrs.body,
        replyTo: m.attrs.replyTo
      }
      const existing = out.get(id)
      const from = pos
      const to = pos + node.nodeSize
      if (existing) {
        out.set(id, {
          from: Math.min(existing.from, from),
          to: Math.max(existing.to, to),
          text: existing.text + (node.text ?? ''),
          attrs: existing.attrs
        })
      } else {
        out.set(id, { from, to, text: node.text ?? '', attrs })
      }
    }
  })
  return out
}
