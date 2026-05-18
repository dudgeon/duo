// BUG-138 / Stage 14b — CriticMarkup `{++text++}` insertion mark.
//
// Visual: green underline tint. Author attribution via `author` attr.
// Round-trips through markdown via `markdownComments` integration
// (separate module that handles all 5 CriticMarkup marks).
//
// Companion to DeletionMark, HighlightMark, SubstitutionMark, and the
// CommentMark refactor. All five share the same author attribute model.

import { Mark, mergeAttributes } from '@tiptap/core'

export interface InsertionMarkAttributes {
  author: string | null
  ts: string | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    insertionMark: {
      /** Wrap a range in insertion. Uses the current selection if
       *  from/to omitted. No-op on collapsed range. */
      applyInsertion: (author: string, ts: string, from?: number, to?: number) => ReturnType
      /** Strip every insertion mark in a range. Called when the user
       *  accepts the insertion ("keep this text"). */
      acceptInsertion: (from?: number, to?: number) => ReturnType
    }
  }
}

export const InsertionMark = Mark.create<{}, {}>({
  name: 'insertionMark',
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
    return [{ tag: 'span[data-duo-insertion]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-duo-insertion': '1',
        class: 'duo-cm-insertion'
      }),
      0
    ]
  },

  addCommands() {
    return {
      applyInsertion: (author, ts, from, to) => ({ tr, dispatch, state }) => {
        const range = (typeof from === 'number' && typeof to === 'number')
          ? { from, to }
          : { from: state.selection.from, to: state.selection.to }
        if (range.to <= range.from) return false
        if (dispatch) {
          const markType = state.schema.marks.insertionMark
          if (!markType) return false
          tr.addMark(range.from, range.to, markType.create({ author, ts }))
          dispatch(tr)
        }
        return true
      },

      acceptInsertion: (from, to) => ({ tr, dispatch, state }) => {
        const range = (typeof from === 'number' && typeof to === 'number')
          ? { from, to }
          : { from: state.selection.from, to: state.selection.to }
        if (dispatch) {
          const markType = state.schema.marks.insertionMark
          if (!markType) return false
          tr.removeMark(range.from, range.to, markType)
          dispatch(tr)
        }
        return true
      }
    }
  }
})
