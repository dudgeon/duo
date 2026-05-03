// Stage 17c — Persistent blurred selection (PRD H26 / Stage 11 D29c parity).
//
// Browsers don't paint `::selection` styling on a blurred contenteditable.
// The markdown editor solves this with a ProseMirror decoration — for the
// canvas we use the CSS Custom Highlight Registry API (Chromium 105+; we
// run on Electron's modern Chromium). When the iframe body blurs, we add
// the current Range to a named highlight; on focus, we clear it.
//
// Why CSS Highlight API and not a span overlay: highlights are
// presentation-only — they don't mutate the DOM, so the
// MutationObserver-driven dirty/autosave path doesn't fire. A span
// wrap would dirty the buffer just by selecting + clicking away.
//
// The highlight is named `duo-blurred-selection` to mirror the parent
// document's class name (used by the markdown editor); the iframe's
// stylesheet uses the matching `::highlight()` pseudo so the colors
// stay in lock-step with `--duo-mark`.

const HIGHLIGHT_NAME = 'duo-blurred-selection'

interface InstallOptions {
  doc: Document
}

export interface BlurredSelectionHandle {
  /** Tear down listeners + clear any active highlight. Call on canvas
   *  unmount or path change. */
  dispose: () => void
}

/**
 * Install the "show selection while blurred" behaviour on the iframe
 * document. Watches `focus` / `blur` on the body and mirrors selection
 * state into a named CSS Highlight while blurred. The styles are
 * injected into the iframe's <head> with the runtime sentinel so they
 * don't persist to disk.
 *
 * Caller is responsible for invoking `dispose()` on cleanup.
 */
export function installBlurredSelection({ doc }: InstallOptions): BlurredSelectionHandle {
  installStyles(doc)
  const win = doc.defaultView
  if (!win) return { dispose: () => {} }

  // CSS.highlights is the registry. Feature-detect; older browsers will
  // simply not paint the persistent selection (graceful degradation).
  const highlights = (win as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights
  const HighlightCtor = (win as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (!highlights || !HighlightCtor) {
    return { dispose: () => {} }
  }

  let active = false

  const clear = () => {
    if (!active) return
    highlights.delete(HIGHLIGHT_NAME)
    active = false
  }

  const paint = () => {
    const sel = doc.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      clear()
      return
    }
    const range = sel.getRangeAt(0).cloneRange()
    const highlight = new HighlightCtor(range)
    highlights.set(HIGHLIGHT_NAME, highlight)
    active = true
  }

  const onFocus = () => {
    // Body re-focused — native ::selection takes over again.
    clear()
  }
  const onBlur = () => {
    paint()
  }

  doc.body.addEventListener('focus', onFocus, true)
  doc.body.addEventListener('blur', onBlur, true)

  // The iframe itself can lose focus to the parent renderer (clicking
  // the terminal) without firing a blur on body. Listen on the iframe's
  // window too — when the parent window's `focusin` lands on a node
  // outside the iframe, the iframe's `Document.activeElement` falls
  // back to body, but no body-blur fires. The iframe window receiving
  // a `blur` is the reliable signal.
  win.addEventListener('blur', onBlur)
  win.addEventListener('focus', onFocus)

  return {
    dispose: () => {
      doc.body.removeEventListener('focus', onFocus, true)
      doc.body.removeEventListener('blur', onBlur, true)
      win.removeEventListener('blur', onBlur)
      win.removeEventListener('focus', onFocus)
      clear()
    }
  }
}

function installStyles(doc: Document): void {
  if (doc.head?.querySelector('style[data-duo-blurred-selection]')) return
  const style = doc.createElement('style')
  style.setAttribute('data-duo-canvas-runtime', '1')
  style.setAttribute('data-duo-blurred-selection', '1')
  style.textContent = `
::highlight(${HIGHLIGHT_NAME}) {
  background-color: #F0CB6A;
  color: inherit;
}
`.trim()
  doc.head?.appendChild(style)
}
