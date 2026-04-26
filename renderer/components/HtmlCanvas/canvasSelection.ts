// Stage 17c — Canvas selection observer (PRD H25).
//
// Watches `selectionchange` inside the iframe and computes the
// `HtmlCanvasSelectionSnapshot` shape used by `duo selection`. Mirrors
// the markdown editor's `pushSelection` pattern but operates against
// the iframe's contentDocument instead of a ProseMirror state.
//
// Caller wires:
//   const obs = installCanvasSelection({ doc, path, onPush, onRect })
//   ...
//   obs.dispose()
//
// onPush fires with the latest snapshot (or null when the selection
// collapses or the iframe loses focus). onRect fires with the selection's
// page-relative bounding rect (for the Send → Duo pill); the host
// translates iframe-coords → screen-coords by adding the iframe element's
// own bounding rect.

import type { HtmlCanvasSelectionSnapshot } from '@shared/types'

const SURROUNDING_LIMIT = 1000

interface InstallOptions {
  doc: Document
  path: string
  /** Fires whenever the selection shape changes. `null` clears any
   *  cached selection (collapse, focus loss, body unmounted). */
  onPush: (snap: HtmlCanvasSelectionSnapshot | null) => void
  /** Fires with the selection's bounding rect in iframe-content
   *  coordinates. The host translates this to screen coordinates for
   *  the Send → Duo pill. `null` hides the pill. */
  onRect: (rect: DOMRect | null) => void
}

export interface CanvasSelectionHandle {
  dispose: () => void
}

export function installCanvasSelection({
  doc,
  path,
  onPush,
  onRect
}: InstallOptions): CanvasSelectionHandle {
  const win = doc.defaultView
  if (!win) return { dispose: () => {} }

  const compute = () => {
    const snap = computeCanvasSnapshot(doc, path)
    onPush(snap)
    onRect(computeSelectionRect(doc))
  }

  const onSelChange = () => compute()
  doc.addEventListener('selectionchange', onSelChange)

  // Re-compute on focus changes — moving focus away from the iframe
  // hides the pill (selection state stays, but the pill is a focus-
  // anchored affordance).
  const onFocusChange = () => compute()
  win.addEventListener('focus', onFocusChange)
  win.addEventListener('blur', onFocusChange)

  // Reposition the pill on scroll inside the iframe — selection rect
  // is iframe-content-relative.
  const onScroll = () => onRect(computeSelectionRect(doc))
  win.addEventListener('scroll', onScroll, true)

  // Initial push so callers can subscribe + immediately receive the
  // current shape (typically `null` on a fresh canvas mount).
  compute()

  return {
    dispose: () => {
      doc.removeEventListener('selectionchange', onSelChange)
      win.removeEventListener('focus', onFocusChange)
      win.removeEventListener('blur', onFocusChange)
      win.removeEventListener('scroll', onScroll, true)
      onPush(null)
      onRect(null)
    }
  }
}

// ── Snapshot computation ──────────────────────────────────────────────────

export function computeCanvasSnapshot(
  doc: Document,
  path: string
): HtmlCanvasSelectionSnapshot | null {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0) return null

  const range = sel.getRangeAt(0)
  const isCollapsed = sel.isCollapsed

  const text = isCollapsed ? '' : sel.toString()
  // Anchor: the nearest ancestor with a `data-duo-id`. Fall back to the
  // body itself (which never carries an id; in that case anchorId is
  // omitted from the payload — the agent reads it as "no stable
  // anchor").
  const anchorEl = nearestDuoIdAncestor(range.startContainer)
  const anchorId = anchorEl?.getAttribute('data-duo-id') ?? undefined
  const anchorPath = anchorEl ? buildAnchorPath(anchorEl) : undefined

  // For non-collapsed selections, capture the selection's outerHTML.
  // Use cloneContents() to avoid mutating the live document.
  let html: string | undefined
  if (!isCollapsed) {
    try {
      const frag = range.cloneContents()
      const tmp = doc.createElement('div')
      tmp.appendChild(frag)
      html = tmp.innerHTML
    } catch {
      html = undefined
    }
  }

  // Surrounding context: the enclosing block element's textContent,
  // truncated. Mirrors the markdown editor's `paragraph` field.
  const blockEl = nearestBlockAncestor(range.startContainer)
  const surrounding = blockEl
    ? truncate(blockEl.textContent ?? '', SURROUNDING_LIMIT)
    : undefined

  // Sub-element range — only meaningful for selections inside a single
  // text node within an anchored element. v1 captures
  // `{startOffset, endOffset, textPath}` only when start and end live
  // in the same text node; complex selections (across multiple nodes)
  // get `range: undefined` and the agent must rely on `text` + anchor.
  const subRange =
    range.startContainer === range.endContainer && range.startContainer.nodeType === 3
      ? {
          startOffset: range.startOffset,
          endOffset: range.endOffset,
          textPath: textPathFromAnchor(range.startContainer as Text, anchorEl)
        }
      : undefined

  return {
    kind: 'html-canvas',
    path,
    text,
    html,
    anchorId,
    anchorPath,
    range: subRange,
    surrounding
  }
}

function computeSelectionRect(doc: Document): DOMRect | null {
  // Only show the rect (drives the pill) when the iframe body has DOM
  // focus. Mirrors the editor's `editor.isFocused` gate. Selection
  // payload still pushes regardless — `duo selection` reads it.
  const active = doc.activeElement
  if (active !== doc.body && !doc.body.contains(active)) return null

  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null

  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return rect
}

// ── Helpers ──────────────────────────────────────────────────────────────

function nearestDuoIdAncestor(node: Node | null): Element | null {
  let cur: Node | null = node
  while (cur) {
    if (cur.nodeType === 1) {
      const el = cur as Element
      if (el.hasAttribute('data-duo-id')) return el
    }
    cur = cur.parentNode
  }
  return null
}

function nearestBlockAncestor(node: Node | null): Element | null {
  let cur: Node | null = node
  while (cur) {
    if (cur.nodeType === 1) {
      const el = cur as Element
      const display = el.ownerDocument?.defaultView?.getComputedStyle(el).display
      if (display && display !== 'inline' && display !== 'inline-block') return el
    }
    cur = cur.parentNode
  }
  return null
}

function buildAnchorPath(el: Element): string[] {
  const path: string[] = []
  let cur: Element | null = el
  while (cur) {
    const id = cur.getAttribute('data-duo-id')
    if (id) path.unshift(id)
    cur = cur.parentElement
  }
  return path
}

function textPathFromAnchor(text: Text, anchor: Element | null): string {
  // Best-effort path: tag-name with sibling index from the anchor down
  // to the text node's parent. `p[1]/text()`-ish — useful for the
  // sidecar comment range resolver in 17d.
  if (!anchor) return ''
  const parent = text.parentElement
  if (!parent) return ''
  const segs: string[] = []
  let cur: Element | null = parent
  while (cur && cur !== anchor) {
    const sibs = Array.from(cur.parentElement?.children ?? []).filter(
      e => e.tagName === cur!.tagName
    )
    const idx = sibs.indexOf(cur)
    segs.unshift(`${cur.tagName.toLowerCase()}[${idx}]`)
    cur = cur.parentElement
  }
  return segs.join('/')
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…'
}
