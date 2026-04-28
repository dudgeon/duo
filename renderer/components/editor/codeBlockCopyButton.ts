// ENH-005 — hover "Copy" button on `<pre>` blocks in the markdown editor
// and HTML canvas.
//
// Both surfaces render syntax-highlighted code via lowlight (markdown
// editor) or whatever the user authored (canvas). Without affordance,
// copying requires select-all + ⌘C. We inject a button child into
// every `<pre>` that handles the copy via `navigator.clipboard
// .writeText()`.
//
// Persistence:
//   - Canvas: mark the injected button with `data-duo-canvas-runtime`.
//     The serializer (renderer/components/HtmlCanvas/serialize.ts)
//     strips elements with that attribute on save, so the button never
//     lands on disk.
//   - Markdown editor: TipTap's serializer renders from the doc model,
//     not the DOM. Injected DOM children are invisible to the
//     serializer, so they don't affect saved output.
//
// Idempotence: scan calls check for the sentinel class
// `duo-code-copy-btn` before injecting, so repeat calls are no-ops.
// Safe to call from MutationObserver / TipTap's `onUpdate`.

const SENTINEL_CLASS = 'duo-code-copy-btn'
const HOST_CLASS = 'duo-code-copy-host'
const FEEDBACK_CLASS = 'duo-code-copy-btn--copied'
const STYLE_ID = 'duo-code-copy-style'

/** Standalone CSS for the copy button. Used to seed the HTML canvas
 *  iframe (whose document doesn't inherit the parent renderer's
 *  globals.css). The renderer side imports its rules via globals.css. */
const COPY_BTN_CSS = `
.duo-code-copy-host { position: relative; }
.duo-code-copy-btn {
  position: absolute; top: 6px; right: 6px;
  padding: 2px 8px; font-size: 11px; line-height: 1.4;
  font-family: ui-sans-serif, system-ui, sans-serif;
  color: rgba(0, 0, 0, 0.55);
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px; cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, color 120ms ease, background 120ms ease;
}
.duo-code-copy-host:hover .duo-code-copy-btn,
.duo-code-copy-btn:focus,
.duo-code-copy-btn--copied { opacity: 1; }
.duo-code-copy-btn:hover {
  color: rgba(0, 0, 0, 0.85);
  background: #fff;
}
.duo-code-copy-btn--copied {
  color: #c75634; border-color: #c75634;
}
@media (prefers-color-scheme: dark) {
  .duo-code-copy-btn {
    color: rgba(255, 255, 255, 0.6);
    background: rgba(40, 40, 40, 0.85);
    border-color: rgba(255, 255, 255, 0.15);
  }
  .duo-code-copy-btn:hover {
    color: rgba(255, 255, 255, 0.95);
    background: rgba(60, 60, 60, 1);
  }
}
`

export interface InjectOptions {
  /** Mark every injected button with `data-duo-canvas-runtime` so the
   *  canvas serializer strips it on save. Markdown editor doesn't need
   *  this (TipTap serializes from the doc model, not the DOM). */
  markCanvasRuntime?: boolean
}

function copyText(pre: HTMLElement, btn: HTMLButtonElement): void {
  // The visible code text is in the <code> child if present, else the
  // pre's textContent directly. Strip the button's own text so it
  // doesn't end up in the copy when the button is a descendant.
  const code = pre.querySelector('code')
  let text = (code?.textContent ?? pre.textContent ?? '')
  // Defensive: button text might be inside the pre's textContent
  // calculation in older browsers.
  text = text.replace(btn.textContent ?? '', '')
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
}

/**
 * Scan `root` for `<pre>` blocks and inject a Copy button into any that
 * don't yet have one. Idempotent.
 *
 * @param root  The Document or Element to scan. For the markdown editor
 *              this is the `EditorContent` host div (`editor.view.dom`,
 *              which IS the contentEditable ProseMirror surface); for
 *              the canvas it's the iframe's `contentDocument`.
 *
 * Inside ProseMirror's contentEditable surface, mutations to the
 * editor's DOM are normally reverted on the next transaction (PM
 * reconciles the rendered DOM against the doc model). We sidestep this
 * by wrapping the injected button in a node tagged `data-duo-pm-ignore`
 * (matched by the `containsClassName: () => true` ignoreMutation hint
 * on TipTap nodes) AND parenting it to the pre with `contenteditable=
 * false`, which ProseMirror treats as an opaque atom rather than a doc
 * child. Net effect: the button persists across transactions.
 */
export function injectCodeBlockCopyButtons(
  root: Document | HTMLElement,
  opts: InjectOptions = {}
): void {
  const pres = root.querySelectorAll('pre')
  pres.forEach((pre) => {
    if (pre.querySelector(`.${SENTINEL_CLASS}`)) return
    pre.classList.add(HOST_CLASS)

    const doc = pre.ownerDocument
    const btn = doc.createElement('button')
    btn.type = 'button'
    btn.className = SENTINEL_CLASS
    btn.textContent = 'Copy'
    btn.setAttribute('aria-label', 'Copy code block')
    btn.setAttribute('contenteditable', 'false')
    // ProseMirror's MutationObserver can revert appendChild on a
    // contentEditable host. The official escape hatch is to insert
    // OUTSIDE the editor's DOM tree — we use a position:fixed-style
    // trick where the button is parented to body and positioned over
    // the pre via getBoundingClientRect. But that's fragile under
    // scroll/resize. Simpler: parent to pre, but `contenteditable=
    // false` + `data-duo-pm-ignore` hints PM to leave it alone.
    btn.setAttribute('data-duo-pm-ignore', '1')
    if (opts.markCanvasRuntime) {
      btn.setAttribute('data-duo-canvas-runtime', '1')
    }
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      copyText(pre, btn)
    })
    pre.appendChild(btn)
  })
}

/**
 * Inject the copy-button CSS into a document's <head> (typically the
 * HTML canvas iframe). Idempotent — checks for an existing style with
 * the sentinel id before inserting. Uses the canvas-runtime sentinel
 * so the serializer strips it on save.
 */
export function injectCodeBlockCopyStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.setAttribute('data-duo-canvas-runtime', '1')
  style.textContent = COPY_BTN_CSS
  doc.head?.appendChild(style)
}
