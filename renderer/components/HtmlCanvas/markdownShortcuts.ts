// Stage 17a polish item 1 — markdown shortcuts on typing for the HTML
// canvas. Owner-committed direction F from the 17a.5 design exploration.
//
// Reuses Stage 11's TipTap input-rule muscle memory without TipTap
// (PRD H3 rejects ProseMirror for the canvas because the canvas must
// accept arbitrary HTML and ProseMirror's strict node model can't
// tolerate that). Implementation: listen for `input` and `keydown` on
// the iframe's contentDocument; do targeted DOM rewrites at the caret.
//
// Patterns supported:
//   `# ` … `###### ` → headings (input event, line-scoped)
//   `- ` / `* `      → bullet list (input event)
//   `1. `            → ordered list (input event)
//   `> `             → blockquote (input event)
//   `**foo**`        → bold (input event, completion-detection)
//   `_foo_`          → italic (input event, completion-detection)
//   `---`<Enter>     → hr (keydown Enter)
//   ```<Enter>       → code block (keydown Enter)
//
// Edge cases handled:
//   - Conversions only fire when the block's textContent matches the
//     pattern exactly (i.e. the user typed the prefix and immediately
//     the trigger character — typing "# Title<space>" does NOT trigger).
//   - Conversions inside <code> / <pre> / <a> are skipped so literal
//     markdown stays literal.

import * as blockOps from './blockOps'

export function installMarkdownShortcuts(doc: Document): () => void {
  const onInput = () => handleInput(doc)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (handleEnterShortcuts(doc)) {
        e.preventDefault()
      }
    }
  }
  doc.addEventListener('input', onInput)
  doc.addEventListener('keydown', onKeyDown, true)
  return () => {
    doc.removeEventListener('input', onInput)
    doc.removeEventListener('keydown', onKeyDown, true)
  }
}

// ── block-prefix conversions (input event) ────────────────────────────────

function handleInput(doc: Document): void {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (!range.collapsed) return
  const node = range.startContainer
  if (node.nodeType !== 3) return  // text nodes only

  // Skip if we're inside a "literal" context.
  if (isInsideLiteralContext(doc, node)) return

  const block = blockOps.findBlockAncestor(doc, node)
  const text = block.textContent ?? ''

  // Block-prefix matches — only trigger on exact match (user typed the
  // prefix and the trigger character with no other content yet).
  const headingMatch = text.match(/^(#{1,6}) $/)
  if (headingMatch) {
    clearBlockText(block)
    blockOps.setBlock(doc, (`h${headingMatch[1].length}`) as 'h1')
    return
  }
  if (text === '- ' || text === '* ') {
    clearBlockText(block)
    blockOps.toggleBulletList(doc)
    return
  }
  if (text === '1. ') {
    clearBlockText(block)
    blockOps.toggleOrderedList(doc)
    return
  }
  if (text === '> ') {
    clearBlockText(block)
    blockOps.toggleBlockquote(doc)
    return
  }

  // Inline-mark completion: detect `**foo**` and `_foo_` ending at the
  // caret. This fires on every input event but only matches when the
  // closing pair just landed.
  applyInlineCompletion(doc, node as Text, range.startOffset, /\*\*([^*]+)\*\*$/, 'strong')
  applyInlineCompletion(doc, node as Text, range.startOffset, /_([^_]+)_$/, 'em')
}

/** If the text just-typed-up-to-caret ends with the pattern, replace
 *  the matched portion with `<tag>inner</tag>`. */
function applyInlineCompletion(
  doc: Document,
  node: Text,
  caretOffset: number,
  pattern: RegExp,
  tag: 'strong' | 'em'
): void {
  const before = node.textContent?.slice(0, caretOffset) ?? ''
  const m = before.match(pattern)
  if (!m) return
  const matchStart = before.length - m[0].length
  const inner = m[1]
  if (!inner.trim()) return  // don't wrap empty content

  // Carve out the matched range and replace with <tag>inner</tag>.
  const range = doc.createRange()
  range.setStart(node, matchStart)
  range.setEnd(node, caretOffset)
  range.deleteContents()
  const wrapper = doc.createElement(tag)
  wrapper.textContent = inner
  range.insertNode(wrapper)

  // Place caret after the wrapper.
  const sel = doc.getSelection()
  if (!sel) return
  const after = doc.createRange()
  after.setStartAfter(wrapper)
  after.collapse(true)
  sel.removeAllRanges()
  sel.addRange(after)
}

/** Strips the matched markdown prefix from a block (used right before
 *  applying the corresponding setBlock / toggleX). */
function clearBlockText(block: Element): void {
  // Remove all child nodes — execCommand-driven block ops will rewrite
  // the wrapper's tag (formatBlock) or wrap it in a list (insertU/Olist).
  // The block needs to be empty so the block-op produces a clean empty
  // heading / list item ready for the user's next keystroke.
  while (block.firstChild) block.removeChild(block.firstChild)
  // Re-anchor the caret inside the now-empty block.
  const doc = block.ownerDocument
  if (!doc) return
  const sel = doc.getSelection()
  if (!sel) return
  const range = doc.createRange()
  range.selectNodeContents(block)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

// ── Enter-key conversions ─────────────────────────────────────────────────

function handleEnterShortcuts(doc: Document): boolean {
  const block = blockOps.findCaretBlock(doc)
  if (!block) return false
  const text = (block.textContent ?? '').trim()

  if (text === '---' || text === '***') {
    // Replace the block with <hr> + a fresh empty paragraph.
    const hr = doc.createElement('hr')
    const p = doc.createElement('p')
    p.innerHTML = '&nbsp;'
    block.parentNode?.replaceChild(hr, block)
    hr.parentNode?.insertBefore(p, hr.nextSibling)
    placeCaretIn(doc, p)
    return true
  }

  // ```<Enter> or ```lang<Enter> → code block.
  const codeMatch = text.match(/^```(\w*)$/)
  if (codeMatch) {
    const pre = doc.createElement('pre')
    const code = doc.createElement('code')
    if (codeMatch[1]) code.setAttribute('data-lang', codeMatch[1])
    pre.appendChild(code)
    block.parentNode?.replaceChild(pre, block)
    placeCaretIn(doc, code)
    return true
  }

  return false
}

function placeCaretIn(doc: Document, el: Element): void {
  const sel = doc.getSelection()
  if (!sel) return
  const range = doc.createRange()
  range.selectNodeContents(el)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

// ── Literal contexts ───────────────────────────────────────────────────────

/** Skip markdown shortcuts inside <code>/<pre>/<a> — those are literal
 *  contexts where the user wants the typed characters preserved. */
function isInsideLiteralContext(doc: Document, node: Node): boolean {
  let cur: Node | null = node
  const literal = new Set(['CODE', 'PRE', 'A'])
  while (cur && cur !== doc.body) {
    if (cur.nodeType === 1 && literal.has((cur as Element).tagName)) return true
    cur = cur.parentNode
  }
  return false
}
