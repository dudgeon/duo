// Canvas paste handlers — BUG-016 + ENH-002.
//
// Installs two listeners on the iframe document:
//
//   1. `paste` (capture) — scrub inline `style="color: …"` and
//      `style="background: …"` from pasted HTML, plus any `class`
//      attributes (the source page's classes reference foreign
//      stylesheets that don't exist here, so they're noise at best
//      and dark-mode-breaking at worst). Closes BUG-016 — pasting
//      bold text from Google Docs / a markdown editor in dark mode
//      no longer renders as dark-brown-on-dark-brown because the
//      pasted `<b style="color: #444">` loses its color and
//      inherits the canvas's `--ink` token.
//
//   2. `keydown` (capture) for ⌘⇧V / ⌃⇧V — paste-as-plain-text.
//      Reads the clipboard's `text/plain` and inserts it without
//      any HTML, mirroring "Paste and Match Style" on macOS.
//      Available via the Edit menu accelerator too (ENH-002).
//
// Returns a cleanup function. Safe to call multiple times across
// mounts; each call wires its own listeners with isolated cleanup.

export function installCanvasPasteHandlers(doc: Document): () => void {
  const onPaste = (e: ClipboardEvent) => {
    if (!e.clipboardData) return
    const html = e.clipboardData.getData('text/html')
    // No HTML payload? Let the default plain-text paste path run.
    if (!html) return
    e.preventDefault()
    e.stopPropagation()
    const sanitized = sanitizePastedHtml(html, doc)
    // execCommand is deprecated but is still the only API that
    // composes correctly with `contentEditable`'s undo stack.
    // The newer `document.execCommand('insertHTML', ...)` shape is
    // what TipTap also falls back to for similar reasons.
    doc.execCommand('insertHTML', false, sanitized)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // ⌘⇧V / ⌃⇧V — paste plain text, dropping any clipboard HTML.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
      e.preventDefault()
      e.stopPropagation()
      // Read the clipboard's plain-text view via the async API so we
      // don't depend on `e.clipboardData` (paste-key chord doesn't
      // populate it the same way a paste event does).
      void navigator.clipboard.readText().then((text) => {
        if (!text) return
        doc.execCommand('insertText', false, text)
      }).catch((err) => {
        console.warn('[duo-canvas-paste] readText failed:', err)
      })
    }
  }

  doc.addEventListener('paste', onPaste, true)
  doc.addEventListener('keydown', onKeyDown, true)

  return () => {
    doc.removeEventListener('paste', onPaste, true)
    doc.removeEventListener('keydown', onKeyDown, true)
  }
}

/**
 * Strip inline color / background styles + class attributes from an
 * HTML fragment. We parse via the same document's
 * `createHTMLDocument` so the tree manipulation lives in DOM-space
 * (safer than regex over arbitrary HTML).
 */
function sanitizePastedHtml(html: string, doc: Document): string {
  const tmp = doc.implementation.createHTMLDocument('')
  tmp.body.innerHTML = html

  // Drop classes (they reference stylesheets we don't have).
  tmp.querySelectorAll('[class]').forEach((el) => el.removeAttribute('class'))

  // Drop color / background declarations from inline styles. Keep
  // structural rules (margins, padding, font-size, etc.) — the user
  // copied them deliberately if they bothered.
  tmp.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style') ?? ''
    const cleaned = style
      .split(';')
      .map(decl => decl.trim())
      .filter(decl => decl.length > 0)
      .filter(decl => !/^color\s*:/i.test(decl))
      .filter(decl => !/^background(-color)?\s*:/i.test(decl))
      .join('; ')
    if (cleaned) el.setAttribute('style', cleaned + ';')
    else el.removeAttribute('style')
  })

  return tmp.body.innerHTML
}
