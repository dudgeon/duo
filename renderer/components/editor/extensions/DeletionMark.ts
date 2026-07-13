// BUG-138 / Stage 14b — CriticMarkup `{--text--}` deletion mark.
//
// Visual: red strikethrough tint. Author attribution via `author` attr.
// Round-trips through markdown via `markdownCriticMarkup` integration.

import { Mark, mergeAttributes } from '@tiptap/core'
import { META_SUGGEST_AUTO } from '../suggestMeta'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    deletionMark: {
      /** Wrap a range in deletion ("strike this through"). Uses current
       *  selection if from/to omitted. No-op on collapsed range. */
      applyDeletion: (author: string, ts: string, from?: number, to?: number) => ReturnType
      /** Accept the deletion (remove the actual text from the doc).
       *  Different semantic than `acceptInsertion` — there we just strip
       *  the mark; here we delete the underlying content. */
      acceptDeletion: (from?: number, to?: number) => ReturnType
      /** Reject the deletion (keep the text, strip the mark). */
      rejectDeletion: (from?: number, to?: number) => ReturnType
    }
  }
}

export const DeletionMark = Mark.create<{}, {}>({
  name: 'deletionMark',
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
    return [{ tag: 'span[data-duo-deletion]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-duo-deletion': '1',
        class: 'duo-cm-deletion'
      }),
      0
    ]
  },

  addCommands() {
    return {
      applyDeletion: (author, ts, from, to) => ({ tr, dispatch, state }) => {
        const range = (typeof from === 'number' && typeof to === 'number')
          ? { from, to }
          : { from: state.selection.from, to: state.selection.to }
        if (range.to <= range.from) return false
        if (dispatch) {
          const markType = state.schema.marks.deletionMark
          if (!markType) return false
          tr.addMark(range.from, range.to, markType.create({ author, ts }))
          dispatch(tr)
        }
        return true
      },

      acceptDeletion: (from, to) => ({ tr, dispatch, state }) => {
        const range = (typeof from === 'number' && typeof to === 'number')
          ? { from, to }
          : { from: state.selection.from, to: state.selection.to }
        if (dispatch) {
          // Accepting a deletion = removing the text from the doc.
          tr.delete(range.from, range.to)
          // ENH-260 D9 — this dispatch deletes content programmatically
          // (not itself a new user edit); stamp so the suggesting-mode
          // reconciler doesn't resurrect the just-removed text as a fresh
          // tracked deletion.
          tr.setMeta(META_SUGGEST_AUTO, true)
          dispatch(tr)
        }
        return true
      },

      rejectDeletion: (from, to) => ({ tr, dispatch, state }) => {
        const range = (typeof from === 'number' && typeof to === 'number')
          ? { from, to }
          : { from: state.selection.from, to: state.selection.to }
        if (dispatch) {
          const markType = state.schema.marks.deletionMark
          if (!markType) return false
          tr.removeMark(range.from, range.to, markType)
          dispatch(tr)
        }
        return true
      }
    }
  }
})
