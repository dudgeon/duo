// Stage 17a — selection-aware inline-mark toggler for the iframe canvas.
//
// PRD H28 explicitly rejects `document.execCommand` (deprecated; spec
// describes its behaviour as "intentionally non-interoperable"). This is
// our minimal v1 replacement: bold / italic / underline / strike /
// inline-code, plus a link toggle that wraps in <a href>. Robust enough
// for prose typing inside contentEditable; the H18 component snippets
// that exercise edge cases (lists, tables, nested marks) land in 17d
// when we can build a regression set against them.
//
// Algorithm:
//   - If the selection is collapsed → no-op (parity with rich editors).
//   - If the selection is fully inside an existing mark of the same kind
//     → "unwrap": remove that ancestor element, leaving its children in
//     place.
//   - Otherwise wrap the range in a fresh element. surroundContents()
//     handles simple ranges; for ranges that cross element boundaries we
//     fall back to extractContents → wrap → insert.

export type InlineTag = 'strong' | 'em' | 'u' | 's' | 'code'

export function toggleInlineMark(doc: Document, tag: InlineTag): void {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  const range = sel.getRangeAt(0)

  // If the entire range sits inside an existing element of `tag`, unwrap
  // it. This is the toggle-off path.
  const enclosing = enclosingTag(range, tag)
  if (enclosing) {
    unwrap(enclosing)
    return
  }

  wrapRange(doc, range, tag)
}

/**
 * Wrap or unwrap the current selection in <a href>. If the selection
 * is already inside a link, prompts to edit (or empties → unset).
 */
export function applyLink(doc: Document, url: string | null): void {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)

  const existing = enclosingTag(range, 'a')
  if (existing) {
    if (url === null || url.trim() === '') {
      unwrap(existing)
    } else {
      ;(existing as HTMLAnchorElement).href = url
    }
    return
  }

  if (url === null || url.trim() === '') return
  if (sel.isCollapsed) return

  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener noreferrer'
  wrapRangeWith(doc, range, anchor)
}

function wrapRange(doc: Document, range: Range, tag: InlineTag): void {
  const wrapper = doc.createElement(tag)
  wrapRangeWith(doc, range, wrapper)
}

function wrapRangeWith(doc: Document, range: Range, wrapper: Element): void {
  try {
    range.surroundContents(wrapper)
  } catch {
    // Range crosses element boundaries — extract → wrap → re-insert.
    const fragment = range.extractContents()
    wrapper.appendChild(fragment)
    range.insertNode(wrapper)
  }
  // Restore the selection to the new wrapper's contents so a follow-up
  // toggle (e.g. ⌘B then ⌘I) operates on the same span.
  const sel = doc.getSelection()
  if (sel) {
    const newRange = doc.createRange()
    newRange.selectNodeContents(wrapper)
    sel.removeAllRanges()
    sel.addRange(newRange)
  }
}

function unwrap(el: Element): void {
  const parent = el.parentNode
  if (!parent) return
  const sel = el.ownerDocument?.getSelection()
  const newRange = el.ownerDocument?.createRange()
  if (newRange) {
    newRange.setStartBefore(el.firstChild ?? el)
    newRange.setEndAfter(el.lastChild ?? el)
  }
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
  if (sel && newRange) {
    sel.removeAllRanges()
    sel.addRange(newRange)
  }
}

function enclosingTag(range: Range, tag: string): Element | null {
  let node: Node | null = range.commonAncestorContainer
  // Walk up until we find an element whose tagName matches and whose
  // contents fully contain the range. The fully-contains check matters:
  // if the user partially selected text inside an existing <strong>, we
  // want to wrap the full selection (which crosses out of the strong),
  // not unwrap.
  while (node) {
    if (node.nodeType === 1) {
      const el = node as Element
      if (el.tagName.toLowerCase() === tag) {
        if (containsRange(el, range)) return el
      }
    }
    node = node.parentNode
  }
  return null
}

function containsRange(el: Element, range: Range): boolean {
  const elRange = el.ownerDocument?.createRange()
  if (!elRange) return false
  elRange.selectNodeContents(el)
  return (
    elRange.compareBoundaryPoints(Range.START_TO_START, range) <= 0 &&
    elRange.compareBoundaryPoints(Range.END_TO_END, range) >= 0
  )
}
