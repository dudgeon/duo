// BUG-138 / Stage 14b — CriticMarkup `{==text==}` highlight mark.
//
// Visual: warn-amber background tint. Two distinct uses:
//   1. Standalone highlight — author marks text as important / for review.
//   2. Anchor for an adjacent CommentMark — the highlight wraps the
//      excerpt the comment refers to. The CriticMarkup serializer detects
//      adjacency and emits `{==anchor==}{>>comment<<}` together.
//
// We use one mark type for both. The parser/serializer in the integration
// module decides whether to fold an adjacent comment.

import { Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlightMark: {
      applyHighlight: (author: string, ts: string, from?: number, to?: number) => ReturnType
      removeHighlight: (from?: number, to?: number) => ReturnType
    }
  }
}

export const HighlightMark = Mark.create<{}, {}>({
  name: 'highlightMark',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      author: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-duo-author'),
        renderHTML: (attrs) => attrs.author ? { 'data-duo-author': attrs.author as string } : {}
      },
      ts: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-duo-ts'),
        renderHTML: (attrs) => attrs.ts ? { 'data-duo-ts': attrs.ts as string } : {}
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-duo-highlight]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-duo-highlight': '1',
        class: 'duo-cm-highlight'
      }),
      0
    ]
  },

  addCommands() {
    return {
      applyHighlight: (author, ts, from, to) => ({ tr, dispatch, state }) => {
        const range = (typeof from === 'number' && typeof to === 'number')
          ? { from, to }
          : { from: state.selection.from, to: state.selection.to }
        if (range.to <= range.from) return false
        if (dispatch) {
          const markType = state.schema.marks.highlightMark
          if (!markType) return false
          tr.addMark(range.from, range.to, markType.create({ author, ts }))
          dispatch(tr)
        }
        return true
      },

      removeHighlight: (from, to) => ({ tr, dispatch, state }) => {
        const range = (typeof from === 'number' && typeof to === 'number')
          ? { from, to }
          : { from: state.selection.from, to: state.selection.to }
        if (dispatch) {
          const markType = state.schema.marks.highlightMark
          if (!markType) return false
          tr.removeMark(range.from, range.to, markType)
          dispatch(tr)
        }
        return true
      }
    }
  }
})
