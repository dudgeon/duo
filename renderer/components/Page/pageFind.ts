// BUG-126 — canvas-mode ⌘F find handler.
//
// Canvas mode (kind: 'page') is an iframe; Chromium's native ⌘F on the
// iframe contentDocument is broken (stops narrowing after first
// character; doesn't clear highlights on close). This module replaces
// the native flow with a Duo-managed search using the CSS Custom
// Highlight API — no DOM mutation, sandbox-safe, re-searches on every
// query update.
//
// Surface area: pure functions over an iframe's contentDocument +
// contentWindow. PageTab owns the React state + bar component; this
// module is the highlight + walk engine.

const HIGHLIGHT_NAME = 'duo-find-match'
const HIGHLIGHT_NAME_CURRENT = 'duo-find-current'

export interface FindMatchRange {
  startNode: Text
  startOffset: number
  endNode: Text
  endOffset: number
}

export interface FindState {
  matches: FindMatchRange[]
  current: number  // -1 when no matches
}

/**
 * Walk the iframe contentDocument's text nodes and find every occurrence
 * of `query`. Case-insensitive substring match. Skips text inside
 * <script>, <style>, <noscript>, and elements with `data-duo-find-skip`.
 */
export function findMatchesInDoc(doc: Document, query: string): FindMatchRange[] {
  if (!query || !doc.body) return []
  const lower = query.toLowerCase()
  const matches: FindMatchRange[] = []

  const walker = doc.createTreeWalker(
    doc.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        const tag = parent.tagName
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
          return NodeFilter.FILTER_REJECT
        }
        if (parent.closest('[data-duo-find-skip]')) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
    }
  )

  let textNode: Node | null = walker.nextNode()
  while (textNode) {
    const t = textNode as Text
    const haystack = (t.data || '').toLowerCase()
    let idx = haystack.indexOf(lower)
    while (idx !== -1) {
      matches.push({
        startNode: t,
        startOffset: idx,
        endNode: t,
        endOffset: idx + query.length
      })
      idx = haystack.indexOf(lower, idx + query.length)
    }
    textNode = walker.nextNode()
  }

  return matches
}

/**
 * Apply CSS Custom Highlights for the matches. The `current` index gets
 * a separate highlight name so the active match can be visually
 * distinguished (color set by CSS).
 *
 * Requires `CSS.highlights.set` (Chromium 105+, Electron uses recent
 * Chromium). On unsupported browsers, this becomes a no-op and matches
 * aren't visible — callers should check `isHighlightSupported(win)` and
 * fall back if needed.
 */
export function paintHighlights(
  win: Window,
  doc: Document,
  state: FindState
): void {
  if (!isHighlightSupported(win)) return

  const W = win as Window & {
    Highlight: typeof Highlight
    CSS: typeof CSS & { highlights: Map<string, Highlight> }
  }

  // Clear prior highlights.
  W.CSS.highlights.delete(HIGHLIGHT_NAME)
  W.CSS.highlights.delete(HIGHLIGHT_NAME_CURRENT)

  if (state.matches.length === 0) return

  const allRanges: Range[] = []
  let currentRange: Range | null = null

  state.matches.forEach((m, i) => {
    try {
      const range = doc.createRange()
      range.setStart(m.startNode, m.startOffset)
      range.setEnd(m.endNode, m.endOffset)
      if (i === state.current) {
        currentRange = range
      } else {
        allRanges.push(range)
      }
    } catch {
      // Text node was removed since the walk; skip silently.
    }
  })

  if (allRanges.length > 0) {
    W.CSS.highlights.set(HIGHLIGHT_NAME, new W.Highlight(...allRanges))
  }
  if (currentRange) {
    W.CSS.highlights.set(HIGHLIGHT_NAME_CURRENT, new W.Highlight(currentRange))
  }
}

/**
 * Clear all Duo find highlights. Called when the find bar closes or
 * the query becomes empty.
 */
export function clearHighlights(win: Window): void {
  if (!isHighlightSupported(win)) return
  const W = win as Window & {
    CSS: typeof CSS & { highlights: Map<string, Highlight> }
  }
  W.CSS.highlights.delete(HIGHLIGHT_NAME)
  W.CSS.highlights.delete(HIGHLIGHT_NAME_CURRENT)
}

/**
 * Scroll the current match into the iframe's viewport, centered if
 * possible. Uses scrollIntoView on a temporary span we insert and
 * immediately remove (DOM-cheap alternative to range.getBoundingClientRect
 * + manual scroll math).
 */
export function scrollToCurrent(doc: Document, state: FindState): void {
  if (state.current < 0 || state.current >= state.matches.length) return
  const m = state.matches[state.current]
  try {
    const range = doc.createRange()
    range.setStart(m.startNode, m.startOffset)
    range.setEnd(m.endNode, m.endOffset)
    const rect = range.getBoundingClientRect()
    const win = doc.defaultView
    if (!win) return
    // Center vertically; preserve horizontal.
    const targetY = win.scrollY + rect.top - (win.innerHeight / 2) + (rect.height / 2)
    win.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' })
  } catch {
    // Range invalid; nothing to scroll to.
  }
}

export function isHighlightSupported(win: Window): boolean {
  const W = win as Window & { CSS?: { highlights?: unknown }, Highlight?: unknown }
  return typeof W.Highlight === 'function' && !!W.CSS?.highlights
}

/**
 * Install the highlight CSS into the iframe document. Idempotent —
 * looks for an existing <style data-duo-style="duo-find"> first.
 */
export function installFindStyles(doc: Document): void {
  const marker = 'duo-find'
  if (doc.querySelector(`style[data-duo-style="${marker}"]`)) return
  const style = doc.createElement('style')
  style.setAttribute('data-duo-style', marker)
  style.textContent = `
    ::highlight(${HIGHLIGHT_NAME}) {
      background-color: #f4d9b6;
      color: #2b2620;
    }
    ::highlight(${HIGHLIGHT_NAME_CURRENT}) {
      background-color: #c46a1c;
      color: #ffffff;
    }
  `
  // Append to <head> if present; else <html>; else body.
  const target = doc.head || doc.documentElement || doc.body
  target.appendChild(style)
}
