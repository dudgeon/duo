// Stage 17b Phase D — pretty-printed HTML serializer (PRD H34).
//
// 2-space indent, stable attribute order:
//   `id`, `class`, `data-duo-id`, then everything else alphabetical.
//
// Behaviour:
//   - Block-level elements with block-level children → multi-line, indented.
//   - Block-level elements with only text / inline children → single-line
//     (open + text + close on one line; cleaner diffs for headings, list
//     items, paragraphs).
//   - Void elements (br, hr, img, input, …) → self-closing without /.
//   - Raw-text elements (pre, code, textarea, script, style) → preserved
//     verbatim via outerHTML (no re-indentation of internal whitespace).
//   - Comments preserved.
//
// Caveat (PRD H34 "preserve untouched markup"): we re-format the whole
// tree on every save. First-save diffs against a hand-authored .html
// will include whitespace + attribute-order changes; second save and
// onward produce stable output. Full source-map preservation is a v2
// concern (would need a token-level parser, not the browser's parsed
// DOM). This is documented in the polish & parity card.

const INDENT = '  '

// HTML void elements per the spec — these never get a closing tag.
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr'
])

// Internal whitespace is meaningful for these — emit outerHTML as-is.
const RAW_TEXT_ELEMENTS = new Set(['pre', 'code', 'textarea', 'script', 'style'])

// Inline elements that pack tightly with surrounding text. When a
// block element contains only inline children + text, we emit it on a
// single line.
const INLINE_ELEMENTS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn',
  'em', 'i', 'img', 'kbd', 'mark', 'q', 'rb', 'rp', 'rt', 'rtc', 'ruby',
  's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u',
  'var', 'wbr'
])

const ATTR_PRIORITY: Record<string, number> = {
  id: 0,
  class: 1,
  'data-duo-id': 2
}

// Runtime-only attributes / sentinels Stage 17a's RenderedCanvas adds to
// the iframe body for editing UX (contentEditable, spellcheck, our own
// <style data-duo-canvas-runtime>). These should NEVER persist to disk —
// the saved file should look like a normal HTML document a user can open
// in any browser. Stripped only from elements that carry the
// `data-duo-canvas-runtime` sentinel, so user-authored `contenteditable`
// or `spellcheck` attributes are preserved.
const RUNTIME_ATTRS_TO_STRIP = new Set([
  'contenteditable', 'spellcheck', 'data-duo-canvas-runtime'
])

// Stage 17c — runtime classes Duo's canvas binding paints on elements
// for visual UX (just-added highlight on agent edits today; possibly
// blur-selection markers later). These must NEVER persist to disk —
// the className is stripped from `class=""` during serialization on
// every element, regardless of the runtime sentinel, because the
// just-added class lives on real user-authored elements (it's the
// element the agent wrote into; no sentinel applies).
const RUNTIME_CLASSES_TO_STRIP = new Set([
  'duo-just-added'
])

// ── Public API ────────────────────────────────────────────────────────────

/** Serialize the full document — doctype + <html>…</html> + trailing newline. */
export function serializeDocument(doc: Document): string {
  const dt = doctypeString(doc)
  return `${dt}\n${serializeElement(doc.documentElement, 0)}\n`
}

// ── Implementation ────────────────────────────────────────────────────────

function doctypeString(doc: Document): string {
  if (!doc.doctype) return '<!doctype html>'
  const { name, publicId, systemId } = doc.doctype
  // Standard HTML5 → emit lowercase to match what authoring tools (and
  // our own boilerplate) write. Anything legacy with PUBLIC/SYSTEM
  // identifiers gets the canonical uppercase form.
  if (name === 'html' && !publicId && !systemId) {
    return '<!doctype html>'
  }
  let out = `<!DOCTYPE ${name}`
  if (publicId) out += ` PUBLIC "${publicId}"`
  if (publicId && systemId) out += ` "${systemId}"`
  else if (systemId) out += ` SYSTEM "${systemId}"`
  out += '>'
  return out
}

function serializeElement(el: Element, depth: number): string {
  // Skip runtime-only injected elements (RenderedCanvas's <style>,
  // placeholder overlay, etc.). Body has the same sentinel so we can
  // strip its runtime attrs in attrString — but we don't skip body
  // itself, which is identified by the BODY tag plus the sentinel.
  if (el.hasAttribute('data-duo-canvas-runtime') && el.tagName !== 'BODY') {
    return ''
  }
  const indent = INDENT.repeat(depth)
  const tag = el.tagName.toLowerCase()
  const open = `<${tag}${attrString(el)}>`

  if (VOID_ELEMENTS.has(tag)) {
    return `${indent}${open}`
  }

  if (RAW_TEXT_ELEMENTS.has(tag)) {
    // Preserve internal whitespace exactly. el.outerHTML round-trips
    // text content + nested tags (e.g. <code class="lang-js">…</code>
    // inside a <pre>) without our re-indentation pass touching them.
    return `${indent}${el.outerHTML}`
  }

  const meaningful = meaningfulChildren(el)
  if (meaningful.length === 0) {
    return `${indent}${open}</${tag}>`
  }

  if (allInline(meaningful)) {
    // Single-line emission. Trim leading/trailing whitespace text nodes
    // so we don't render `<p>  Hello  </p>` from a contentEditable that
    // sometimes inserts stray spaces.
    const inner = meaningful.map(n => serializeInline(n)).join('').trim()
    return `${indent}${open}${inner}</${tag}>`
  }

  // Block-level children: each child on its own line, indented one more.
  const childLines = meaningful
    .map(n => serializeBlockChild(n, depth + 1))
    .filter(s => s.length > 0)
  if (childLines.length === 0) {
    // All children were runtime-only (placeholder, runtime <style>, etc.)
    // and got stripped — collapse to a single-line empty element.
    return `${indent}${open}</${tag}>`
  }
  return `${indent}${open}\n${childLines.join('\n')}\n${indent}</${tag}>`
}

function serializeBlockChild(n: Node, depth: number): string {
  switch (n.nodeType) {
    case 1:  // Element
      return serializeElement(n as Element, depth)
    case 3: {
      // Standalone text node between block children — rare but possible
      // (e.g. fragment files with bare text). Indent + escape.
      const t = (n.textContent ?? '').trim()
      if (!t) return ''
      return INDENT.repeat(depth) + escapeText(t)
    }
    case 8:  // Comment
      return INDENT.repeat(depth) + `<!--${(n as Comment).data}-->`
    default:
      return ''
  }
}

function serializeInline(n: Node): string {
  switch (n.nodeType) {
    case 3:
      return escapeText(n.textContent ?? '')
    case 1: {
      const el = n as Element
      const tag = el.tagName.toLowerCase()
      if (VOID_ELEMENTS.has(tag)) {
        return `<${tag}${attrString(el)}>`
      }
      const inner = Array.from(el.childNodes).map(c => serializeInline(c)).join('')
      return `<${tag}${attrString(el)}>${inner}</${tag}>`
    }
    case 8:
      return `<!--${(n as Comment).data}-->`
    default:
      return ''
  }
}

function meaningfulChildren(el: Element): Node[] {
  return Array.from(el.childNodes).filter(n => {
    if (n.nodeType === 3) {
      return (n.textContent ?? '').trim() !== ''
    }
    return n.nodeType === 1 || n.nodeType === 8
  })
}

function allInline(nodes: Node[]): boolean {
  return nodes.every(n => {
    if (n.nodeType === 3 || n.nodeType === 8) return true
    if (n.nodeType !== 1) return false
    return INLINE_ELEMENTS.has((n as Element).tagName.toLowerCase())
  })
}

function attrString(el: Element): string {
  const isRuntime = el.hasAttribute('data-duo-canvas-runtime')
  let names = el.getAttributeNames()
  if (isRuntime) {
    names = names.filter(n => !RUNTIME_ATTRS_TO_STRIP.has(n))
  }
  names = names.slice().sort(compareAttrs)
  if (names.length === 0) return ''
  return names.map(n => {
    const raw = el.getAttribute(n) ?? ''
    // Stage 17c — strip runtime-only classes from class="" on every
    // element. Keeps `duo-just-added` from leaking to disk if a save
    // races the 6s fade. If the resulting class list is empty we drop
    // the attribute entirely so the serialized output stays clean.
    const value = n === 'class' ? scrubClassValue(raw) : raw
    if (n === 'class' && value === '') return ''
    return ` ${n}="${escapeAttr(value)}"`
  }).join('')
}

function scrubClassValue(raw: string): string {
  if (!raw) return ''
  // class values are whitespace-separated; preserve original spacing
  // semantics by collapsing to a single space-joined list.
  const kept = raw
    .split(/\s+/)
    .filter(c => c.length > 0 && !RUNTIME_CLASSES_TO_STRIP.has(c))
  return kept.join(' ')
}

function compareAttrs(a: string, b: string): number {
  const pa = ATTR_PRIORITY[a] ?? 100
  const pb = ATTR_PRIORITY[b] ?? 100
  if (pa !== pb) return pa - pb
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

// HTML text/attr escaping. Standard 4 entities; we don't escape ' to
// &#39; because we always use double-quoted attribute values.
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
