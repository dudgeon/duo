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
//
// Diagnostic traces (Sprint 9 instrumentation) use `console.log`
// (not `console.debug`) so they show up in Chrome DevTools' default
// Console level filter — walk-1 feedback flagged that `console.debug`
// was hidden until the user explicitly enabled the Verbose level.

const TEXT_NODE = 3
const ELEMENT_NODE = 1

export function seedCaretInEmptyParagraph(doc: Document): void {
  const body = doc.body
  if (!body) {
    console.log('[ENH-091 seed] bail: no body')
    return
  }
  // The boilerplate wraps content in <main>; some authored canvases
  // skip the wrapper. Try <main> first, fall back to <body>.
  const root = body.querySelector('main') ?? body
  // Fresh shape: H1 first, single empty <p> at the end of the root.
  const firstChild = root.firstElementChild
  if (!firstChild || firstChild.tagName !== 'H1') {
    console.log('[ENH-091 seed] bail: first child not H1', { firstChildTag: firstChild?.tagName })
    return
  }
  // Walk children. Reject if anything sits between the H1 and the
  // trailing <p> — that's body content the user has already populated,
  // and we don't want to clobber their cursor.
  const children = Array.from(root.children)
  if (children.length > 2) {
    console.log('[ENH-091 seed] bail: too many children', { count: children.length })
    return
  }
  const last = children[children.length - 1]
  if (!last || last.tagName !== 'P') {
    console.log('[ENH-091 seed] bail: last child not P', { lastTag: last?.tagName })
    return
  }
  // The trailing <p> must be empty. "Empty" includes:
  //   - no child nodes at all (boilerplate-on-disk shape: `<p></p>`)
  //   - a single empty text node (some serializers preserve whitespace
  //     between tags)
  //   - a single <br> element (Chromium's auto-inserted placeholder
  //     that contentEditable adds to empty block elements on iframe
  //     load — the disk file says `<p></p>` but the live DOM has
  //     `<p><br></p>` by the time wire() runs the seeder. Walk-1
  //     bug: pre-fix the detector bailed on this case because <br>
  //     is ELEMENT_NODE, not TEXT_NODE.)
  if (last.childNodes.length > 1) {
    console.log('[ENH-091 seed] bail: trailing P has multiple children', { count: last.childNodes.length })
    return
  }
  if (last.childNodes.length === 1) {
    const only = last.childNodes[0]
    if (!only) {
      console.log('[ENH-091 seed] bail: childNodes[0] missing despite length 1')
      return
    }
    if (only.nodeType === TEXT_NODE) {
      if ((only.textContent ?? '').trim().length > 0) {
        console.log('[ENH-091 seed] bail: trailing P has non-empty text')
        return
      }
    } else if (only.nodeType === ELEMENT_NODE) {
      if ((only as Element).tagName !== 'BR') {
        console.log('[ENH-091 seed] bail: trailing P element child is not BR', { tag: (only as Element).tagName })
        return
      }
    } else {
      console.log('[ENH-091 seed] bail: unexpected node type', { nodeType: only.nodeType })
      return
    }
  }
  const range = doc.createRange()
  // Place caret at offset 0 of the <p> directly. selectNodeContents +
  // collapse produces the same range when <p> has no children, but
  // when <p> has a single <br> placeholder, the contents-then-collapse
  // path yields a range whose endpoint is at the START of the <br>,
  // which Chromium can render visually as "after the previous text
  // node" (= end of the H1 title) when the body has just been focused.
  // setStart(<p>, 0) explicitly anchors before any children, sidestepping
  // the rounding behavior.
  range.setStart(last, 0)
  range.collapse(true)
  // Selection lives on the document's window. `doc.getSelection()` is
  // a browser alias but not implemented in jsdom (so unit tests would
  // see null); reach through `defaultView` for a stable accessor that
  // works in both environments.
  const sel = doc.defaultView?.getSelection?.() ?? doc.getSelection?.()
  if (!sel) {
    console.log('[ENH-091 seed] bail: getSelection returned null')
    return
  }
  sel.removeAllRanges()
  sel.addRange(range)
  console.log('[ENH-091 seed] APPLIED', {
    targetTag: last.tagName,
    targetChildCount: last.childNodes.length,
    targetChildTypes: Array.from(last.childNodes).map(n => n.nodeType === TEXT_NODE ? 'text' : (n as Element).tagName ?? '?')
  })

  // ENH-091 walk-3 diagnostic — confirm the selection actually
  // sticks across the next animation frame. If it migrates, something
  // downstream (Chromium auto-focus reposition, secondary
  // body.focus(), srcdoc re-mount) is overriding our placement. The
  // rAF runs AFTER the current task and AFTER any sync DOM mutations
  // that follow this call.
  const w = doc.defaultView
  if (w) {
    w.requestAnimationFrame(() => {
      const sel2 = w.getSelection?.()
      const r = sel2 && sel2.rangeCount > 0 ? sel2.getRangeAt(0) : null
      const inSeededP = r && r.startContainer === last
      const startContainerName = r
        ? (r.startContainer.nodeType === TEXT_NODE
            ? 'text("' + (r.startContainer.textContent ?? '').slice(0, 20) + '")'
            : (r.startContainer as Element).tagName)
        : 'no-range'
      console.log('[ENH-091 seed] post-rAF check', {
        rangeCount: sel2?.rangeCount ?? 0,
        startContainerName,
        startOffset: r?.startOffset,
        stillInSeededP: inSeededP
      })
    })
  }
}
