// Stage 17a polish item 7 — placeholder text on fresh + empty canvas
// pages. Mirrors Stage 11's TipTap placeholder ("Start typing — markdown
// shortcuts work …") so the canvas signals what's available the moment
// it opens, without leaving an actual prose hint that the user has to
// delete.
//
// Implementation: a non-editable <div> overlay that shows when the body
// has no meaningful content. Toggled by inspecting the body on every
// mutation. Cheaper than a CSS :empty pseudo because it survives nested
// tag wrappers (<p><br></p> still reads as "empty" to a human).

const PLACEHOLDER_TEXT =
  'Type a heading: # Title · markdown shortcuts work (- bullet, > quote, **bold**)'

const PLACEHOLDER_ID = 'duo-canvas-placeholder'
const STYLE_ID = 'duo-canvas-placeholder-style'

export function installPlaceholder(doc: Document): () => void {
  if (!doc.body) return () => {}

  // Inject the stylesheet once per document.
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style')
    style.id = STYLE_ID
    // Runtime-only marker so serialize.ts strips this <style> on save.
    style.setAttribute('data-duo-canvas-runtime', '1')
    style.textContent = `
      #${PLACEHOLDER_ID} {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: #999;
        font-style: italic;
        font-family: -apple-system, system-ui, sans-serif;
        font-size: 14px;
        text-align: center;
        pointer-events: none;
        user-select: none;
        max-width: 80%;
      }
    `
    doc.head?.appendChild(style)
  }

  const refresh = () => {
    const empty = isBodyEmpty(doc)
    const existing = doc.getElementById(PLACEHOLDER_ID)
    if (empty && !existing) {
      const overlay = doc.createElement('div')
      overlay.id = PLACEHOLDER_ID
      overlay.contentEditable = 'false'
      // Runtime-only marker so serialize.ts strips this overlay on save.
      overlay.setAttribute('data-duo-canvas-runtime', '1')
      overlay.textContent = PLACEHOLDER_TEXT
      doc.body.appendChild(overlay)
    } else if (!empty && existing) {
      existing.remove()
    }
  }

  refresh()
  const observer = new MutationObserver(refresh)
  observer.observe(doc.body, {
    subtree: true,
    childList: true,
    characterData: true
  })
  return () => {
    observer.disconnect()
    doc.getElementById(PLACEHOLDER_ID)?.remove()
  }
}

/** "Empty" means: the body has no text and no structural content other
 *  than the placeholder itself, possibly wrapped in a single empty
 *  block (`<p></p>` or `<p><br></p>` — what fresh boilerplate produces).
 *  As soon as the user types anything or the agent inserts a snippet,
 *  this returns false. */
function isBodyEmpty(doc: Document): boolean {
  const body = doc.body
  if (!body) return false
  // Strip the placeholder itself from consideration.
  const meaningfulNodes = Array.from(body.childNodes).filter(
    n => !(n.nodeType === 1 && (n as Element).id === PLACEHOLDER_ID)
  )
  if (meaningfulNodes.length === 0) return true

  // Treat a single empty block as empty.
  if (meaningfulNodes.length === 1) {
    const only = meaningfulNodes[0]
    if (only.nodeType === 1) {
      const el = only as Element
      const tag = el.tagName
      if ((tag === 'P' || tag === 'DIV') && isElementEmpty(el)) return true
    }
  }
  return false
}

function isElementEmpty(el: Element): boolean {
  const text = (el.textContent ?? '').replace(/ /g, '').trim()
  if (text.length > 0) return false
  // A lone <br> (the contentEditable placeholder) counts as empty.
  return Array.from(el.children).every(c => c.tagName === 'BR')
}
