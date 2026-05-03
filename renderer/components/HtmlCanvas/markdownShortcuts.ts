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

// ── Pure trigger matcher (extracted v0.6.4 for unit testing) ────────────────
//
// The block-prefix conversion regexes are extracted into a single
// pure function so they can be locked in by Vitest unit tests
// (`renderer/components/HtmlCanvas/markdownShortcuts.test.ts`).
// BUG-061 has cycled through three implementations (v1 strict eq →
// v2 start-match → v3 nbsp-tolerant `\s`); a small test surface
// captures the precise regex shape so a fourth iteration can be
// caught at unit-test time, not at smoke-walk time.
//
// Inputs: text content of the caret block (typically `block.textContent`
// from `findBlockAncestor`).
// Outputs: a tagged trigger descriptor or null.
//
// Regexes use `\s` (not literal U+0020) to match both standard
// space and the nbsp (U+00A0) Chromium auto-converts trailing
// literal spaces to in contentEditable. See BUG-061 v3 commit
// `56e986b` for the live-DOM diagnosis.
//
// Start-match (`^...`), not exact equality, because when the caret
// block resolves to `<body>` (canvas with no wrapping `<p>`),
// body.textContent concatenates all descendants — strict equality
// fails when other content sits below the prefix line. See BUG-061
// v2 commit `4baba8b`.

export type BlockTrigger =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: 'ul' }
  | { kind: 'ol' }
  | { kind: 'blockquote' }

export function matchBlockTrigger(text: string): BlockTrigger | null {
  const headingMatch = text.match(/^(#{1,6})\s$/)
  if (headingMatch) {
    return { kind: 'heading', level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6 }
  }
  if (/^[-*+]\s$/.test(text)) return { kind: 'ul' }
  if (/^1\.\s$/.test(text)) return { kind: 'ol' }
  if (/^>\s$/.test(text)) return { kind: 'blockquote' }
  return null
}

export function installMarkdownShortcuts(doc: Document): () => void {
  const onInput = () => handleInput(doc)
  const onKeyDown = (e: KeyboardEvent) => {
    // ENH-076 (v0.6.4) — ⌘[ / ⌘] indent/outdent inside list items,
    // mirroring the markdown editor's ListIndentShortcuts.ts (ENH-025).
    // Editor-canvas parity rule (CLAUDE.md § 4) disposition: (a) Mirrored
    // — same chord, same handler shape, same no-op-outside-list semantics.
    // ⌘⇧[ / ⌘⇧] are claimed globally per ListIndentShortcuts comments;
    // the !shiftKey guard keeps us from shadowing those.
    if (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && (e.key === '[' || e.key === ']')) {
      if (handleListIndent(doc, e.key === '[')) {
        e.preventDefault()
      }
      return
    }
    // BUG-061 (v0.6.3) — Tab / Shift-Tab inside list items indent
    // and outdent, mirroring the markdown editor's parity (Stage 11
    // ENH-025) and the Obsidian / VS Code muscle memory. Outside a
    // list, Tab falls through to the iframe's default behavior
    // (typically a focus shift — fine, no useful default for Tab in
    // a contentEditable that we'd be stepping on).
    if (e.key === 'Tab') {
      if (handleListIndent(doc, e.shiftKey)) {
        e.preventDefault()
      }
      return
    }
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

  // BUG-061 — block-trigger matcher (extracted v0.6.4 to a pure
  // function `matchBlockTrigger` so the regex shape is locked in by
  // unit tests in `markdownShortcuts.test.ts`). Three iterations of
  // this fix landed (v1 strict-equality → v2 start-match → v3
  // nbsp-tolerant `\s`); the test surface captures the BUG-061 v3
  // shape so v4 won't regress the same Chromium quirks. See the
  // matchBlockTrigger comment header for the full regex rationale
  // (start-match for body-as-block; `\s` for nbsp-converted trailing
  // spaces). Conversion path stays here (DOM ops, not portable to
  // unit tests).
  const trigger = matchBlockTrigger(text)
  if (trigger) {
    clearBlockText(block)
    if (trigger.kind === 'heading') {
      blockOps.setBlock(doc, `h${trigger.level}` as 'h1')
    } else if (trigger.kind === 'ul') {
      // Hand-roll `<ul>` creation rather than execCommand because
      // `insertUnorderedList` returns true on an empty contentEditable
      // block but produces no list element (Chromium quirk; same
      // reason `blockOps.toggleTaskList` is hand-rolled).
      convertEmptyBlockToList(doc, block, 'ul')
    } else if (trigger.kind === 'ol') {
      convertEmptyBlockToList(doc, block, 'ol')
    } else if (trigger.kind === 'blockquote') {
      blockOps.toggleBlockquote(doc)
    }
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

/** BUG-061 — hand-rolled `<ul>` / `<ol>` builder for the empty-block
 *  case. Caller (handleInput) has already run clearBlockText so the
 *  block has no children; we replace it wholesale with a fresh
 *  single-item list and park the caret inside the new `<li>`.
 *
 *  The empty `<li>` has no filler (no `<br>`, no `&nbsp;`) — Chromium
 *  renders zero height for the brief instant before the user's first
 *  keystroke, after which the typed character expands the item and
 *  the caret becomes visible naturally. Filler placeholders would
 *  serialize to disk and leak our editing chrome into the saved file.
 *  The mirror pattern in `blockOps.toggleTaskList` (which IS hand-
 *  rolled for the same execCommand-can't-do-this reason) takes the
 *  same approach with the move-existing-children variant. */
function convertEmptyBlockToList(
  doc: Document,
  block: Element,
  listTag: 'ul' | 'ol'
): void {
  const list = doc.createElement(listTag)
  const li = doc.createElement('li')
  list.appendChild(li)
  block.parentNode?.replaceChild(list, block)

  const sel = doc.getSelection()
  if (!sel) return
  const range = doc.createRange()
  range.selectNodeContents(li)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
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

// ── Tab / Shift-Tab list indent (BUG-061) ────────────────────────────────
//
// Mirrors the markdown editor's ⌘[ / ⌘] indent / outdent behavior
// (ENH-025). Tab inside a list item nests the item under the
// previous sibling; Shift-Tab unnests it back to the parent list's
// level. Implementation uses Chromium's `indent` / `outdent`
// execCommand which IS well-behaved for list items in
// contentEditable: it produces a nested <ul><li>...</li></ul> on
// indent and unwraps one level on outdent. Same execCommand we use
// for `insertUnorderedList` / `insertOrderedList` (cf. blockOps.ts
// — block ops use execCommand, inline marks are hand-rolled per
// PRD §8).
//
// Returns true when the keystroke was consumed (caller calls
// preventDefault on the Tab event so focus doesn't shift). Returns
// false when the caret isn't inside a list, leaving Tab to bubble
// to the browser's default — which in a contentEditable iframe
// typically does nothing useful for Tab anyway, so falling through
// is harmless.

function handleListIndent(doc: Document, shift: boolean): boolean {
  const block = blockOps.findCaretBlock(doc)
  if (!block) return false
  // Climb to the nearest <li> ancestor; if we're not in one, bail.
  const li = block.tagName === 'LI' ? block : block.closest('li')
  if (!li) return false
  doc.execCommand(shift ? 'outdent' : 'indent', false)
  return true
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
