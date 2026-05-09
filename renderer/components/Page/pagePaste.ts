// Canvas paste handlers — BUG-016 + ENH-002 + ENH-108.
//
// Installs three listeners on the iframe document:
//
//   1. `paste` (capture) — image-first branch (ENH-108): if the
//      clipboard has an image item, save it beside the active doc
//      and insert an `<img src="blob:...">` at the caret. Otherwise
//      scrub inline `style="color: …"` and `style="background: …"`
//      from pasted HTML, plus any `class` attributes (the source
//      page's classes reference foreign stylesheets that don't exist
//      here, so they're noise at best and dark-mode-breaking at
//      worst). Closes BUG-016 — pasting bold text from Google Docs
//      / a markdown editor in dark mode no longer renders as
//      dark-brown-on-dark-brown.
//
//   2. `drop` (capture) for image files (ENH-108) — drag-drop parity
//      with the paste branch. Saves to disk + inserts inline.
//
//   3. `keydown` (capture) for ⌘⇧V / ⌃⇧V — paste-as-plain-text.
//      Reads the clipboard's `text/plain` and inserts it without
//      any HTML, mirroring "Paste and Match Style" on macOS.
//      Available via the Edit menu accelerator too (ENH-002).
//
// Returns a cleanup function. Safe to call multiple times across
// mounts; each call wires its own listeners with isolated cleanup.

export interface PagePasteOptions {
  /** Absolute path of the active doc — used for `saveImageBeside`
   *  on image paste/drop (ENH-108). Pass null for untitled / new
   *  buffers so the image-paste branch warns instead of failing. */
  activeDocPath: string | null
}

// ENH-108 — MIME → file extension map. Mirrors the markdown-editor
// table. Anything not in here falls through to .png.
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff'
}

export function installPagePasteHandlers(doc: Document, opts: PagePasteOptions = { activeDocPath: null }): () => void {
  const onPaste = (e: ClipboardEvent) => {
    if (!e.clipboardData) return

    // ENH-108 — image-first branch. Detect any image clipboardData
    // item; if found, save beside the active doc and insert as
    // `<img src=blobUrl>` at caret. Falls through if no image.
    const items = Array.from(e.clipboardData.items)
    const imgItem = items.find(it => it.kind === 'file' && it.type.startsWith('image/'))
    if (imgItem) {
      const file = imgItem.getAsFile()
      if (!file) return
      if (!opts.activeDocPath) {
        console.warn('[ENH-108 canvas] paste-image into untitled doc — save the doc first so we know where to put the image')
        return
      }
      e.preventDefault()
      e.stopPropagation()
      const ext = MIME_TO_EXT[file.type] ?? 'png'
      void file.arrayBuffer().then(async (buf) => {
        try {
          await window.electron.files.saveImageBeside(opts.activeDocPath!, new Uint8Array(buf), ext)
          // Same v1 trade-off as MarkdownEditor: insert blob URL for
          // immediate visible render. Markdown source persistence
          // doesn't apply (canvas is HTML — the saved doc carries
          // `<img src=blob:...>` which goes stale on reload). v2
          // path mirrors FOLLOWUP-013 — store the abs path in src,
          // use a NodeView/postprocessor to hydrate to blob at mount.
          const blobUrl = URL.createObjectURL(new Blob([new Uint8Array(buf)], { type: file.type }))
          doc.execCommand('insertHTML', false, `<img src="${blobUrl}" alt="">`)
        } catch (err) {
          console.error('[ENH-108 canvas] saveImageBeside failed:', err)
        }
      })
      return
    }

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

  // ENH-108 — drag-drop image parity with paste.
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer) return
    const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'))
    if (!file) return
    if (!opts.activeDocPath) {
      console.warn('[ENH-108 canvas] drop-image into untitled doc — save the doc first')
      return
    }
    e.preventDefault()
    e.stopPropagation()
    const ext = MIME_TO_EXT[file.type] ?? 'png'
    void file.arrayBuffer().then(async (buf) => {
      try {
        await window.electron.files.saveImageBeside(opts.activeDocPath!, new Uint8Array(buf), ext)
        const blobUrl = URL.createObjectURL(new Blob([new Uint8Array(buf)], { type: file.type }))
        doc.execCommand('insertHTML', false, `<img src="${blobUrl}" alt="">`)
      } catch (err) {
        console.error('[ENH-108 canvas] saveImageBeside failed:', err)
      }
    })
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
  doc.addEventListener('drop', onDrop, true)
  doc.addEventListener('keydown', onKeyDown, true)

  return () => {
    doc.removeEventListener('paste', onPaste, true)
    doc.removeEventListener('drop', onDrop, true)
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
