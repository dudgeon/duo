// Stage 17a polish item 4 — canvas-side block-level operations + state
// queries. Sister to `inlineMarks.ts`. Powers the shared EditorToolbar's
// block buttons (heading picker, list buttons, blockquote, code block,
// hr, table) and the markdown-shortcuts-on-typing path (item 1).
//
// Implementation note on `document.execCommand`:
//
// PRD §8 says "we write our own selection-aware mark applicator on day
// one" — that rule is scoped to inline MARKS (bold / italic / underline /
// strike / code), where we want predictable wrapping behaviour the spec
// never settled on. For BLOCK operations (formatBlock, lists), Chromium's
// execCommand is well-behaved AND captures into the native contentEditable
// undo stack — which means ⌘Z works for free. We use it where it fits.
// Tables, task lists, and code blocks have no execCommand equivalents and
// are hand-rolled below.
//
// All functions assume the iframe's contentDocument has focus and a live
// selection. Callers may need to refocus the body before invoking.

import type { BlockKind } from '../editor/EditorActions'

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'PRE', 'LI', 'DIV'
])

// ── State queries ──────────────────────────────────────────────────────────

/** Nearest block-level ancestor of the caret. Returns body if no specific
 *  block is found (e.g. caret directly inside a body that has no block
 *  children — a fragment file). */
export function findBlockAncestor(doc: Document, node: Node): Element {
  let cur: Node | null = node
  while (cur && cur !== doc.body) {
    if (cur.nodeType === 1 && BLOCK_TAGS.has((cur as Element).tagName)) {
      return cur as Element
    }
    cur = cur.parentNode
  }
  return doc.body
}

export function findCaretBlock(doc: Document): Element | null {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  return findBlockAncestor(doc, sel.getRangeAt(0).startContainer)
}

/** Returns the tag of the caret's enclosing block, mapped to BlockKind.
 *  Falls back to 'p' for unknown tags. */
export function currentBlock(doc: Document): BlockKind {
  const block = findCaretBlock(doc)
  if (!block) return 'p'
  const tag = block.tagName.toLowerCase()
  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return tag as BlockKind
    case 'p': default:
      return 'p'
  }
}

export function isInList(doc: Document, listTag: 'UL' | 'OL'): boolean {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  let cur: Node | null = sel.getRangeAt(0).startContainer
  while (cur && cur !== doc.body) {
    if (cur.nodeType === 1 && (cur as Element).tagName === listTag) return true
    cur = cur.parentNode
  }
  return false
}

export function isInTaskList(doc: Document): boolean {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  let cur: Node | null = sel.getRangeAt(0).startContainer
  while (cur && cur !== doc.body) {
    if (cur.nodeType === 1) {
      const el = cur as Element
      if (el.tagName === 'LI' && el.classList.contains('duo-task-item')) return true
    }
    cur = cur.parentNode
  }
  return false
}

export function isInBlock(doc: Document, tags: string[]): boolean {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  let cur: Node | null = sel.getRangeAt(0).startContainer
  const wanted = new Set(tags.map(t => t.toUpperCase()))
  while (cur && cur !== doc.body) {
    if (cur.nodeType === 1 && wanted.has((cur as Element).tagName)) return true
    cur = cur.parentNode
  }
  return false
}

export function inTable(doc: Document): boolean {
  return isInBlock(doc, ['table'])
}

// ── Mutations ──────────────────────────────────────────────────────────────

/** Wrap the caret's block in <h1>/<h2>/.../<p>. Uses execCommand for
 *  native undo capture — the formatBlock call returns true on success
 *  in Chromium for any of these tags. */
export function setBlock(doc: Document, kind: BlockKind): void {
  // execCommand expects the tag wrapped in <…> for formatBlock.
  doc.execCommand('formatBlock', false, `<${kind}>`)
}

export function toggleBulletList(doc: Document): void {
  doc.execCommand('insertUnorderedList', false)
}

export function toggleOrderedList(doc: Document): void {
  doc.execCommand('insertOrderedList', false)
}

/** Task list — hand-rolled. execCommand has no equivalent. We mark task
 *  list items with `data-duo-task` + a checkbox child + a CSS class so
 *  we can recognize them on toggle and so the iframe's <style> can render
 *  them with a visible checkbox affordance. */
export function toggleTaskList(doc: Document): void {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const block = findCaretBlock(doc)
  if (!block) return

  // If caret is inside a task-list <li>, unwrap it back to a <p>.
  if (isInTaskList(doc)) {
    let li: Element | null = block.tagName === 'LI' ? block : block.closest('li')
    if (!li) return
    const list = li.parentElement
    if (!list) return
    const p = doc.createElement('p')
    // strip the leading checkbox
    const cb = li.querySelector('input[type="checkbox"][data-duo-task]')
    cb?.remove()
    while (li.firstChild) p.appendChild(li.firstChild)
    li.remove()
    if (list.children.length === 0) {
      list.parentElement?.replaceChild(p, list)
    } else {
      list.parentElement?.insertBefore(p, list.nextSibling)
    }
    return
  }

  // Wrap current block as a task-list <li>.
  const list = doc.createElement('ul')
  list.classList.add('duo-task-list')
  const li = doc.createElement('li')
  li.classList.add('duo-task-item')
  const cb = doc.createElement('input')
  cb.type = 'checkbox'
  cb.setAttribute('data-duo-task', '1')
  cb.contentEditable = 'false'
  li.appendChild(cb)
  while (block.firstChild) li.appendChild(block.firstChild)
  list.appendChild(li)
  block.parentNode?.replaceChild(list, block)
}

export function toggleBlockquote(doc: Document): void {
  if (isInBlock(doc, ['blockquote'])) {
    // Unwrap: replace blockquote with its children
    const sel = doc.getSelection()
    if (!sel || sel.rangeCount === 0) return
    let cur: Node | null = sel.getRangeAt(0).startContainer
    while (cur && cur !== doc.body) {
      if (cur.nodeType === 1 && (cur as Element).tagName === 'BLOCKQUOTE') {
        const bq = cur as Element
        const parent = bq.parentNode
        if (!parent) return
        while (bq.firstChild) parent.insertBefore(bq.firstChild, bq)
        parent.removeChild(bq)
        return
      }
      cur = cur.parentNode
    }
  } else {
    doc.execCommand('formatBlock', false, '<blockquote>')
  }
}

export function toggleCodeBlock(doc: Document): void {
  if (isInBlock(doc, ['pre'])) {
    // Unwrap pre → p
    const sel = doc.getSelection()
    if (!sel || sel.rangeCount === 0) return
    let cur: Node | null = sel.getRangeAt(0).startContainer
    while (cur && cur !== doc.body) {
      if (cur.nodeType === 1 && (cur as Element).tagName === 'PRE') {
        const pre = cur as Element
        const p = doc.createElement('p')
        // pre may contain a <code>; flatten one level
        const inner = pre.querySelector('code') ?? pre
        p.textContent = inner.textContent ?? ''
        pre.parentNode?.replaceChild(p, pre)
        return
      }
      cur = cur.parentNode
    }
  } else {
    // Wrap current block in <pre><code>.
    const block = findCaretBlock(doc)
    if (!block) return
    const pre = doc.createElement('pre')
    const code = doc.createElement('code')
    code.textContent = block.textContent ?? ''
    pre.appendChild(code)
    block.parentNode?.replaceChild(pre, block)
  }
}

export function insertHr(doc: Document): void {
  doc.execCommand('insertHorizontalRule', false)
}

/** Insert a 3×3 table at the caret with a header row. Hand-rolled because
 *  execCommand has no insertTable. Uses execCommand('insertHTML', …) so
 *  the insertion lands on the native undo stack. */
export function insertTable(doc: Document, rows = 3, cols = 3, withHeader = true): void {
  const html = buildTableHtml(rows, cols, withHeader)
  doc.execCommand('insertHTML', false, html)
}

function buildTableHtml(rows: number, cols: number, withHeader: boolean): string {
  const out: string[] = ['<table class="duo-canvas-table">']
  if (withHeader) {
    out.push('<thead><tr>')
    for (let c = 0; c < cols; c++) out.push('<th>&nbsp;</th>')
    out.push('</tr></thead>')
  }
  out.push('<tbody>')
  const bodyRows = withHeader ? rows - 1 : rows
  for (let r = 0; r < bodyRows; r++) {
    out.push('<tr>')
    for (let c = 0; c < cols; c++) out.push('<td>&nbsp;</td>')
    out.push('</tr>')
  }
  out.push('</tbody></table><p>&nbsp;</p>')
  return out.join('')
}

// ── History (native execCommand undo/redo) ─────────────────────────────────

export function undo(doc: Document): void {
  doc.execCommand('undo', false)
}
export function redo(doc: Document): void {
  doc.execCommand('redo', false)
}
export function canUndo(doc: Document): boolean {
  try { return doc.queryCommandEnabled('undo') } catch { return false }
}
export function canRedo(doc: Document): boolean {
  try { return doc.queryCommandEnabled('redo') } catch { return false }
}
