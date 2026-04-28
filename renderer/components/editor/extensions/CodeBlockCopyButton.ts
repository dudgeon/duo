// ENH-005 — Copy button on code blocks inside the TipTap markdown editor.
//
// Direct DOM mutation of `<pre>` via querySelectorAll + appendChild gets
// reverted by ProseMirror's contentEditable reconciliation. Likewise,
// `pre.classList.add(HOST_CLASS)` after the fact gets reverted on the
// next transaction (PM rebuilds the pre's class attribute from its node
// state). The proper escape hatch is two PM decorations per codeBlock
// node, both tracked outside the doc model so PM doesn't revert them:
//   - `Decoration.node(...)` adds the host class to the pre, giving it
//     `position: relative` for absolute-positioned children.
//   - `Decoration.widget(pos+1, ...)` renders a `<button>` at the start
//     of the codeBlock's content area. The button is `position:
//     absolute` (top:6 right:6 per CSS), positioned relative to the
//     pre via the host class.
//
// Click handler clones the `<code>` content, removes the button (which
// is a descendant of <code>), and reads textContent — that way the copy
// payload is the doc text, not the button's own "Copy" label.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const SENTINEL_CLASS = 'duo-code-copy-btn'
const HOST_CLASS = 'duo-code-copy-host'
const FEEDBACK_CLASS = 'duo-code-copy-btn--copied'

function buildDecorations(doc: import('@tiptap/pm/model').Node): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return
    // Node decoration adds the host class to the pre so CSS positioning
    // works (.duo-code-copy-host { position: relative }). PM manages
    // node-decoration class adds itself, so they survive transactions
    // without being reverted. Direct DOM class additions to `<pre>` get
    // reverted; this doesn't.
    decos.push(
      Decoration.node(pos, pos + node.nodeSize, { class: HOST_CLASS })
    )
    const widget = Decoration.widget(
      pos + 1,
      (view) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = SENTINEL_CLASS
        btn.textContent = 'Copy'
        btn.setAttribute('aria-label', 'Copy code block')
        btn.setAttribute('contenteditable', 'false')
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
        })
        btn.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          const dom = view.nodeDOM(pos)
          let text = ''
          if (dom instanceof HTMLElement) {
            const code = dom.querySelector('code')
            const source = code ?? dom
            // The widget renders inside the codeBlock's content (the
            // <code>), so source.textContent would include the button's
            // own "Copy"/"Copied" text. Clone + strip the button before
            // reading textContent so the copy is the doc text only.
            const clone = source.cloneNode(true) as HTMLElement
            clone.querySelectorAll(`.${SENTINEL_CLASS}`).forEach(el => el.remove())
            text = clone.textContent ?? ''
          }
          void navigator.clipboard.writeText(text).then(
            () => {
              btn.classList.add(FEEDBACK_CLASS)
              btn.textContent = 'Copied'
              setTimeout(() => {
                btn.classList.remove(FEEDBACK_CLASS)
                btn.textContent = 'Copy'
              }, 1200)
            },
            (err: unknown) => {
              console.warn('[copy-block] clipboard write failed:', err)
              btn.textContent = 'Failed'
              setTimeout(() => { btn.textContent = 'Copy' }, 1200)
            }
          )
        })
        return btn
      },
      {
        // Widget at the START of the codeBlock's content (pos+1) renders
        // the button INSIDE the pre's content area — same DOM ancestor
        // chain as the pre, so the absolute positioning relative to
        // `.duo-code-copy-host` (the pre itself) works.
        side: -1,
        ignoreSelection: true,
        key: `copy-${pos}`,
      }
    )
    decos.push(widget)
  })
  return DecorationSet.create(doc, decos)
}

export const CodeBlockCopyButton = Extension.create({
  name: 'codeBlockCopyButton',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('codeBlockCopyButton'),
        state: {
          init: (_config, state) => buildDecorations(state.doc),
          apply: (tr, old, _oldState, newState) =>
            tr.docChanged ? buildDecorations(newState.doc) : old
        },
        props: {
          decorations(state) {
            return this.getState(state)
          }
        }
      })
    ]
  }
})
