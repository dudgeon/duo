// ENH-091 — caret seeding for fresh canvases.
//
// On a freshly-created canvas (boilerplate shape: H1 with title +
// trailing empty <p>), `body.focus()` lands the contentEditable
// cursor at the body's first focusable position — typically the
// start of the H1 — so the user's first keystroke mutates the title
// instead of seeding body content. This helper detects the
// boilerplate shape and repositions the caret inside the empty <p>
// so typing flows into the body paragraph as the user expects.
//
// Detection (intentionally conservative — runs on every focus-steal
// but only mutates the selection when the doc looks fresh):
//
//   1. The body has at most one structural ancestor (e.g. <main>) and
//      that ancestor's first child is an <h1> with text.
//   2. The same ancestor contains exactly one trailing empty <p> with
//      no child nodes (or only an empty text node).
//
// If both hold, place the caret inside the empty <p>. Otherwise leave
// the cursor wherever body.focus() landed it — we don't clobber an
// existing user cursor.
//
// Keystroke-cheap: a fresh canvas matches in two DOM reads
// (firstElementChild + a small children walk); a non-fresh canvas
// exits early on the structural check.

const TEXT_NODE = 3

export function seedCaretInEmptyParagraph(doc: Document): void {
  const body = doc.body
  if (!body) return
  // The boilerplate wraps content in <main>; some authored canvases
  // skip the wrapper. Try <main> first, fall back to <body>.
  const root = body.querySelector('main') ?? body
  // Fresh shape: H1 first, single empty <p> at the end of the root.
  const firstChild = root.firstElementChild
  if (!firstChild || firstChild.tagName !== 'H1') return
  // Walk children. Reject if anything sits between the H1 and the
  // trailing <p> — that's body content the user has already populated,
  // and we don't want to clobber their cursor.
  const children = Array.from(root.children)
  if (children.length > 2) return
  const last = children[children.length - 1]
  if (!last || last.tagName !== 'P') return
  // The trailing <p> must be empty (no child nodes, or a single empty
  // text node — some serializers preserve whitespace between tags).
  if (last.childNodes.length > 1) return
  if (last.childNodes.length === 1) {
    const only = last.childNodes[0]
    if (!only || only.nodeType !== TEXT_NODE) return
    if ((only.textContent ?? '').trim().length > 0) return
  }
  const range = doc.createRange()
  range.selectNodeContents(last)
  range.collapse(true)
  // Selection lives on the document's window. `doc.getSelection()` is
  // a browser alias but not implemented in jsdom (so unit tests would
  // see null); reach through `defaultView` for a stable accessor that
  // works in both environments.
  const sel = doc.defaultView?.getSelection?.() ?? doc.getSelection?.()
  if (!sel) return
  sel.removeAllRanges()
  sel.addRange(range)
}
