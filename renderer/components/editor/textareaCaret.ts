// FOLLOWUP-050 — viewport pixel rect of a <textarea>'s caret, so the wikilink
// autocomplete popover can anchor at the caret like the body editor does with
// ProseMirror's coordsAtPos. Textareas expose no native caret coordinates, so
// this uses the standard mirror-<div> technique: clone the textarea's text +
// computed styles into an off-screen div, drop a marker span at the caret
// index, measure it, then map back to viewport coords via the textarea's own
// bounding rect + scroll offsets.

// Style properties that affect text layout — copied so the mirror wraps
// identically to the textarea.
const COPIED_PROPS = [
  'boxSizing',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
  'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'tabSize',
] as const

export function textareaCaretRect(textarea: HTMLTextAreaElement, position: number): DOMRect {
  const doc = textarea.ownerDocument
  const computed = window.getComputedStyle(textarea)
  const mirror = doc.createElement('div')
  const s = mirror.style

  s.position = 'absolute'
  s.visibility = 'hidden'
  s.whiteSpace = 'pre-wrap'
  s.wordWrap = 'break-word'
  s.overflow = 'hidden'
  s.top = '0'
  s.left = '0'
  // Match the textarea's content width so wrapping lands on the same columns.
  s.width = `${textarea.clientWidth}px`
  for (const prop of COPIED_PROPS) {
    s.setProperty(toKebab(prop), computed.getPropertyValue(toKebab(prop)))
  }

  // Text up to the caret, then a marker holding the remainder. The marker's
  // offsetLeft/offsetTop give the caret's position (start of the remainder);
  // including the remainder keeps wrapping accurate up to the caret.
  mirror.textContent = textarea.value.slice(0, position)
  const marker = doc.createElement('span')
  marker.textContent = textarea.value.slice(position) || '.'
  mirror.appendChild(marker)
  doc.body.appendChild(mirror)

  const borderTop = parseFloat(computed.borderTopWidth) || 0
  const borderLeft = parseFloat(computed.borderLeftWidth) || 0
  const lineHeight =
    parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) || 16
  const markerTop = marker.offsetTop
  const markerLeft = marker.offsetLeft

  doc.body.removeChild(mirror)

  const taRect = textarea.getBoundingClientRect()
  // marker.offsetTop is measured from the mirror's padding edge (inside the
  // border); add the border width to get the offset from the border-box top,
  // which maps to taRect.top. Subtract scroll for the visible caret.
  const top = taRect.top + borderTop + markerTop - textarea.scrollTop
  const left = taRect.left + borderLeft + markerLeft - textarea.scrollLeft
  return new DOMRect(left, top, 0, lineHeight)
}

/** camelCase CSS property → kebab-case for getPropertyValue/setProperty. */
function toKebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}
