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
// (`renderer/components/Page/markdownShortcuts.test.ts`).
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

export type UlMarker = 'dash' | 'asterisk' | 'plus'

export type BlockTrigger =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: 'ul'; marker: UlMarker }
  | { kind: 'ol' }
  | { kind: 'blockquote' }

export function matchBlockTrigger(text: string): BlockTrigger | null {
  const headingMatch = text.match(/^(#{1,6})\s$/)
  if (headingMatch) {
    return { kind: 'heading', level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6 }
  }
  // BUG-073 — capture WHICH marker character fired the trigger so the
  // converter can stamp `data-list-marker` for marker-aware styling
  // (`-` → dashed, `+` → plus, `*` → default disc). Pre-BUG-073 this
  // was a single `[-*+]` class with no capture; round-bullet was the
  // only rendered style regardless of typed marker.
  const ulMatch = text.match(/^([-*+])\s$/)
  if (ulMatch) {
    const ch = ulMatch[1]
    const marker: UlMarker = ch === '-' ? 'dash' : ch === '+' ? 'plus' : 'asterisk'
    return { kind: 'ul', marker }
  }
  if (/^1\.\s$/.test(text)) return { kind: 'ol' }
  if (/^>\s$/.test(text)) return { kind: 'blockquote' }
  return null
}

/** Pure matcher for the Enter-key conversions in handleEnterShortcuts.
 *  Operates on the trimmed textContent of the caret block (handler
 *  trims before calling). Returns:
 *  - { kind: 'hr' } when the block is exactly `---` or `***`
 *  - { kind: 'code', lang: '...' | null } when the block matches
 *    ``` followed by an optional fence-language word and end-of-string.
 *    `lang` is the captured language identifier (e.g. 'ts', 'python')
 *    or null when the user typed bare ``` with no language.
 *  - null otherwise.
 *
 *  Extracted v0.6.4 as a pure function so the regex shape is locked
 *  in by Vitest tests. Same rationale as matchBlockTrigger above:
 *  Enter triggers are user-facing entry points whose subtle regex
 *  changes can break editor muscle memory in non-obvious ways.
 */
export type EnterTrigger =
  | { kind: 'hr' }
  | { kind: 'code'; lang: string | null }

export function matchEnterTrigger(text: string): EnterTrigger | null {
  if (text === '---' || text === '***') return { kind: 'hr' }
  const codeMatch = text.match(/^```(\w*)$/)
  if (codeMatch) {
    return { kind: 'code', lang: codeMatch[1] || null }
  }
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
      convertEmptyBlockToList(doc, block, 'ul', trigger.marker)
    } else if (trigger.kind === 'ol') {
      convertEmptyBlockToList(doc, block, 'ol')
    } else if (trigger.kind === 'blockquote') {
      // BUG-072 v2 (v0.6.5 Phase 5 re-walk) — hand-roll the
      // blockquote shape rather than calling
      // `blockOps.toggleBlockquote` (which uses
      // `execCommand('formatBlock', false, '<blockquote>')`). The
      // execCommand path REPLACES the current `<p>` tag with
      // `<blockquote>` rather than WRAPPING it — leaving text and
      // caret directly inside the blockquote, not nested inside a
      // `<p>` child. That structure caused the v1 BUG-072 fix to
      // fail: pressing Enter at end of `<blockquote>text</blockquote>`
      // splits the blockquote itself into TWO sibling blockquotes
      // (because the blockquote IS the current "block" from
      // Chromium's contentEditable perspective). Owner re-walk
      // 2026-05-04 showed this exact pattern — five stacked
      // blockquote-bars after Enter Enter Enter Enter, instead of
      // one blockquote + one paragraph.
      //
      // Fix: replace the empty `<p>` with `<blockquote><p></p></blockquote>`
      // (same pattern as `convertEmptyBlockToList`). Now the inner
      // `<p>` is the current block, Enter splits IT (creating a new
      // `<p>` sibling within the blockquote — Chromium's normal
      // behavior with `defaultParagraphSeparator='p'`), and the
      // exit logic in `handleEnterShortcuts` correctly identifies
      // the empty trailing `<p>` for double-Enter exit.
      convertEmptyBlockToBlockquote(doc, block)
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
  listTag: 'ul' | 'ol',
  marker?: UlMarker
): void {
  const list = doc.createElement(listTag)
  // BUG-073 — stamp `data-list-marker` so the boilerplate CSS in
  // `shared/html-boilerplate.ts` can render `–` for `-` and `+` for
  // `+`. Falls back to default `disc` rendering for `*` (no rule
  // matches `data-list-marker="asterisk"` in the boilerplate, by
  // design — `*` is the most-conventional Markdown disc marker).
  // Older canvases authored without the boilerplate rules fall
  // through to default disc — acceptable; this is a polish hint, not
  // a behavioral contract.
  if (listTag === 'ul' && marker) list.setAttribute('data-list-marker', marker)
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

/** BUG-072 v2 — hand-rolled `<blockquote>` builder for the empty-block
 *  case. Caller (`handleInput`) has already run `clearBlockText` so
 *  the block has no children. We replace it wholesale with a fresh
 *  `<blockquote>` containing a single empty `<p>` and park the caret
 *  inside the `<p>`.
 *
 *  Why hand-rolled (not `execCommand('formatBlock', false, '<blockquote>')`):
 *  Chromium's formatBlock CHANGES the current block's tag to
 *  `<blockquote>` rather than WRAPPING it — leaving caret + future
 *  text directly inside the blockquote, with no `<p>` child. That
 *  structure breaks the double-Enter exit (Enter splits the
 *  blockquote itself into two sibling blockquotes, because the
 *  blockquote IS the current block from Chromium's perspective).
 *  See the BUG-072 v2 comment in `handleInput` for the re-walk
 *  evidence.
 *
 *  Empty `<p>` filler (no `<br>`, no `&nbsp;`) — same rationale as
 *  `convertEmptyBlockToList`: filler placeholders would serialize to
 *  disk and leak our editing chrome into the saved file. Chromium
 *  renders zero height briefly before the user's first keystroke;
 *  the typed character expands the `<p>` and the caret becomes
 *  visible naturally. */
function convertEmptyBlockToBlockquote(doc: Document, block: Element): void {
  const blockquote = doc.createElement('blockquote')
  const p = doc.createElement('p')
  // BUG-072 v3 (re-walk #2 evidence) — empty `<p>` inside `<blockquote>`
  // is the well-known Chromium contentEditable caret-snap quirk: the
  // caret CANNOT sit inside an empty `<p>` nested in a blockquote;
  // it bumps to offset 0 of the blockquote instead. v2's `selectNodeContents(p)`
  // technically pointed at the empty `<p>`, but Chromium relocated the
  // caret to the parent because the `<p>` had zero height + no
  // anchor-able position. User typing landed directly in the blockquote
  // — the saved DOM showed `<blockquote>typed text<p></p></blockquote>`.
  // Bullet lists (<ul><li></li></ul>) don't have this because Chromium
  // has special-case handling for empty `<li>` that doesn't extend to
  // empty `<p>`.
  //
  // Fix: insert a `<br>` filler. This is the standard contentEditable
  // trick — gives the `<p>` measurable height, anchors the caret, and
  // Chromium's typing replaces the `<br>` with the typed text on the
  // first keystroke (the `<br>` is treated as a "fragile" placeholder).
  // Even if the `<br>` survives serialization in some edge cases,
  // it's harmless visually (just a line break inside the `<p>`).
  p.appendChild(doc.createElement('br'))
  blockquote.appendChild(p)
  block.parentNode?.replaceChild(blockquote, block)

  const sel = doc.getSelection()
  if (!sel) return
  const range = doc.createRange()
  // Place caret BEFORE the <br> filler. selectNodeContents + collapse(true)
  // points at offset 0 of `<p>`, which is the position before the <br>.
  range.selectNodeContents(p)
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

  // BUG-072 — blockquote double-Enter exit. Mirrors the bullet/
  // ordered-list double-Enter convention: pressing Enter on an empty
  // trailing block inside a blockquote lifts that block out of the
  // blockquote so the user can resume normal-paragraph typing.
  //
  // Detection: caret block has empty text content AND its parent is
  // a <blockquote> AND it is the last child of that blockquote. The
  // last-child check is the heuristic that "this Enter is the second
  // one" — the user pressed Enter once (creating the empty trailing
  // child via browser default), then pressed Enter again (this
  // handler fires). Without the last-child check, an empty paragraph
  // mid-blockquote (rare but possible after editing) would also
  // trigger an exit, which would surprise the user.
  //
  // Editor-canvas parity disposition (CLAUDE.md § 4): (a) Mirrored —
  // TipTap StarterKit's Blockquote should already do this; verify
  // and file a paired ENH if it doesn't.
  if (isEmptyTrailingBlockquoteChild(block)) {
    const blockquote = block.parentElement!
    blockquote.removeChild(block)
    blockquote.parentNode?.insertBefore(block, blockquote.nextSibling)
    // Edge case: typing `> ` then Enter immediately exits the
    // blockquote on the very first Enter — the original empty <p>
    // IS the trailing empty child. After lifting, the blockquote
    // has no remaining children; remove the empty husk so the user
    // doesn't see a phantom border on the page.
    if (blockquote.childNodes.length === 0) {
      blockquote.parentNode?.removeChild(blockquote)
    }
    placeCaretIn(doc, block)
    return true
  }

  const text = (block.textContent ?? '').trim()
  const trigger = matchEnterTrigger(text)
  if (!trigger) return false

  if (trigger.kind === 'hr') {
    // Replace the block with <hr> + a fresh empty paragraph.
    const hr = doc.createElement('hr')
    const p = doc.createElement('p')
    p.innerHTML = '&nbsp;'
    block.parentNode?.replaceChild(hr, block)
    hr.parentNode?.insertBefore(p, hr.nextSibling)
    placeCaretIn(doc, p)
    return true
  }

  // trigger.kind === 'code'
  const pre = doc.createElement('pre')
  const code = doc.createElement('code')
  if (trigger.lang) code.setAttribute('data-lang', trigger.lang)
  pre.appendChild(code)
  block.parentNode?.replaceChild(pre, block)
  placeCaretIn(doc, code)
  return true
}

/** BUG-072 — true when `block` is an empty paragraph that sits as the
 *  last child of a `<blockquote>`. Used by `handleEnterShortcuts` to
 *  detect the double-Enter exit gesture. Pure structural check; does
 *  not consult selection. */
function isEmptyTrailingBlockquoteChild(block: Element): boolean {
  const parent = block.parentElement
  if (!parent || parent.tagName !== 'BLOCKQUOTE') return false
  if (parent.lastElementChild !== block) return false
  // Empty = no text content and no meaningful children. <br> filler
  // is OK (Chromium auto-inserts one in empty contentEditable blocks).
  const text = (block.textContent ?? '').trim()
  if (text.length > 0) return false
  return true
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
