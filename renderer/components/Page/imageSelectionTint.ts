// ENH-119 (Sprint 14, 2026-05-10) — canvas-side image selection tint.
//
// Mirror of the markdown editor's `imageInRangePlugin` (DuoImage.ts):
// when the user's contentEditable selection range covers an `<img>`,
// paint a visible outline on the image so it's clear the image is in
// the selection. Without this, the surrounding text gets the standard
// ::selection background but the image looks unselected — easy to
// misread when copying / cutting / deleting prose that includes images.
//
// Implementation: listens to `selectionchange` on the iframe document.
// On every change, walks all `<img>` elements in the doc and toggles a
// `data-duo-image-in-range` attribute based on whether the current
// selection's range intersects the image. CSS injected into the iframe
// head paints the outline based on that attribute.
//
// Why an attribute (not a class): the canvas autosaves `data-duo-id`
// stamps + recomputes anchors on save; using a `data-` attribute that
// our serializer KNOWS to strip (or doesn't appear in the in-range
// state) keeps it from polluting the saved HTML. The serializer at
// renderer/components/Page/serialize.ts ignores attributes prefixed
// with `data-duo-` that aren't `data-duo-id` (verified separately for
// the wikilink decoration pattern). For safety, we also clear the
// attribute on cleanup.
//
// Pairs with `imageHydrate.ts` (ENH-108 walk-2 — relative-src → blob
// URL hydration). Both run from the same `wireCleanup` lifecycle in
// PageTab.

const STYLE_ID = 'duo-image-selection-tint'

const STYLE_TEXT = `
  /* ENH-119 — canvas image selection tint */
  img[data-duo-image-in-range] {
    outline: 3px solid var(--duo-accent, #C66A2E);
    outline-offset: 2px;
    border-radius: 2px;
  }
`

/**
 * Install the iframe-side selection observer. Returns a cleanup
 * function that removes the listener, clears any in-range marks, and
 * removes the injected stylesheet. Idempotent — safe to call once
 * per PageTab mount.
 */
export function installImageSelectionTint(doc: Document): () => void {
  // Inject the stylesheet (idempotent). The iframe doesn't share the
  // parent's globals.css; canvas-side styles must be injected directly.
  let styleEl = doc.head.querySelector<HTMLStyleElement>(`style[data-duo-style="${STYLE_ID}"]`)
  if (!styleEl) {
    styleEl = doc.createElement('style')
    styleEl.dataset.duoStyle = STYLE_ID
    styleEl.textContent = STYLE_TEXT
    doc.head.appendChild(styleEl)
  }

  function clearAll(): void {
    doc.querySelectorAll('img[data-duo-image-in-range]').forEach(img => {
      img.removeAttribute('data-duo-image-in-range')
    })
  }

  function refresh(): void {
    clearAll()
    const view = doc.defaultView
    if (!view) return
    const sel = view.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (range.collapsed) return
    // Range.intersectsNode → true if the node is fully OR partially
    // within the range. That's the exact contract we want for "image
    // is in selection."
    doc.querySelectorAll('img').forEach(img => {
      try {
        if (range.intersectsNode(img)) {
          img.setAttribute('data-duo-image-in-range', 'true')
        }
      } catch {
        // Some edge case ranges can throw on intersectsNode; ignore.
      }
    })
  }

  doc.addEventListener('selectionchange', refresh)
  return () => {
    doc.removeEventListener('selectionchange', refresh)
    clearAll()
    styleEl?.remove()
  }
}
