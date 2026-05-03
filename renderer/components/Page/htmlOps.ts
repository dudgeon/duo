// Stage 17b Phase C — `duo html *` op executor.
// PRD docs/prd/stage-17-html-canvas.md H37, H38.
//
// All ops operate on the iframe's contentDocument. PageTab subscribes
// to `IPC.PAGE_HTML_OP`, calls `executeHtmlOp(doc, req)`, replies via
// `IPC.PAGE_HTML_OP_RESULT`. Each op is pure DOM manipulation — no
// React, no MutationObserver wiring (the existing observer in
// RenderedPage catches every mutation and fires the dirty/autosave
// path automatically).
//
// Targeting: ops support either `--id <duo-id>` (preferred — addresses
// a specific element by data-duo-id) or `--selector <css>` (resolved
// server-side via `doc.querySelector`). PRD H38: when both are provided,
// `--id` wins. When neither, the op fails with a clear error.

import type {
  HtmlOpRequest,
  HtmlOpResult,
  HtmlQueryMatch,
  HtmlGetResult
} from '@shared/types'

export function executeHtmlOp(doc: Document, req: HtmlOpRequest): HtmlOpResult {
  try {
    switch (req.op) {
      case 'query':       return ok(req, runQuery(doc, req))
      case 'get':         return ok(req, runGet(doc, req))
      case 'set':         return ok(req, runSet(doc, req))
      case 'replace':     return ok(req, runReplace(doc, req))
      case 'append':      return ok(req, runAppend(doc, req))
      case 'remove':      return ok(req, runRemove(doc, req))
      case 'attr':        return ok(req, runAttr(doc, req))
      case 'click':       return ok(req, runClick(doc, req))
      default: {
        // Exhaustiveness check — TS will complain here if a new op is
        // added to the union without a corresponding case above.
        const _exhaustive: never = req
        return { reqId: (_exhaustive as { reqId: string }).reqId, ok: false, error: 'Unknown op' }
      }
    }
  } catch (err) {
    return { reqId: req.reqId, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function ok(req: HtmlOpRequest, result: unknown): HtmlOpResult {
  return { reqId: req.reqId, ok: true, result }
}

// ── Op implementations ────────────────────────────────────────────────────

function runQuery(doc: Document, req: Extract<HtmlOpRequest, { op: 'query' }>): HtmlQueryMatch[] {
  const els = Array.from(doc.body.querySelectorAll(req.selector))
  return els.map(el => ({
    id: el.getAttribute('data-duo-id'),
    tag: el.tagName.toLowerCase(),
    text: truncate(el.textContent ?? '', 200),
    classes: Array.from(el.classList)
  }))
}

function runGet(doc: Document, req: Extract<HtmlOpRequest, { op: 'get' }>): HtmlGetResult {
  const el = resolveTarget(doc, req)
  if (!el) throw new Error(targetErr(req))
  return {
    id: el.getAttribute('data-duo-id'),
    tag: el.tagName.toLowerCase(),
    html: el.outerHTML,
    text: el.textContent ?? ''
  }
}

function runSet(doc: Document, req: Extract<HtmlOpRequest, { op: 'set' }>): { id: string | null } {
  const el = resolveTarget(doc, req)
  if (!el) throw new Error(targetErr(req))
  el.innerHTML = req.html
  return { id: el.getAttribute('data-duo-id') }
}

function runReplace(doc: Document, req: Extract<HtmlOpRequest, { op: 'replace' }>): { id: string | null } {
  const el = resolveTarget(doc, req)
  if (!el) throw new Error(targetErr(req))
  // outerHTML replacement: parse, swap, return the new element's id (or
  // null if the new HTML doesn't carry one).
  const tmpl = doc.createElement('template')
  tmpl.innerHTML = req.html.trim()
  const newNode = tmpl.content.firstElementChild
  if (!newNode) throw new Error('replace: provided html had no element')
  const parent = el.parentNode
  if (!parent) throw new Error('replace: target has no parent')
  parent.replaceChild(newNode, el)
  return { id: newNode.getAttribute('data-duo-id') }
}

function runAppend(doc: Document, req: Extract<HtmlOpRequest, { op: 'append' }>): { id: string | null } {
  const parent = resolveAppendTarget(doc, req)
  if (!parent) throw new Error('append: parent not found (use --parent <duo-id> or --parent-selector <css>)')
  const tmpl = doc.createElement('template')
  tmpl.innerHTML = req.html.trim()
  const newNode = tmpl.content.firstElementChild
  if (!newNode) throw new Error('append: provided html had no element')
  parent.appendChild(newNode)
  return { id: newNode.getAttribute('data-duo-id') }
}

function runRemove(doc: Document, req: Extract<HtmlOpRequest, { op: 'remove' }>): { id: string | null } {
  const el = resolveTarget(doc, req)
  if (!el) throw new Error(targetErr(req))
  const id = el.getAttribute('data-duo-id')
  el.remove()
  return { id }
}

function runAttr(doc: Document, req: Extract<HtmlOpRequest, { op: 'attr' }>): { id: string | null } {
  const el = resolveTarget(doc, req)
  if (!el) throw new Error(targetErr(req))
  if (req.set) {
    for (const [k, v] of Object.entries(req.set)) el.setAttribute(k, v)
  }
  if (req.remove) {
    for (const k of req.remove) el.removeAttribute(k)
  }
  return { id: el.getAttribute('data-duo-id') }
}

function runClick(doc: Document, req: Extract<HtmlOpRequest, { op: 'click' }>): { id: string | null; tag: string } {
  // ENH-055 — programmatic click. The element must support .click()
  // (HTMLElement does; SVG and a few exotic types don't reliably).
  // We dispatch via the native click() rather than a synthesized
  // MouseEvent because click() correctly walks the activation
  // behavior for buttons, anchors, etc., AND the canvas-action
  // delegated dispatcher (canvasActions.ts) doesn't gate on
  // event.isTrusted — a synthetic click bubbles up and fires the
  // verb just like a real user click.
  const el = resolveTarget(doc, req)
  if (!el) throw new Error(targetErr(req))
  if (typeof (el as HTMLElement).click !== 'function') {
    throw new Error(`click: element <${el.tagName.toLowerCase()}> does not support .click()`)
  }
  ;(el as HTMLElement).click()
  return { id: el.getAttribute('data-duo-id'), tag: el.tagName.toLowerCase() }
}

// ── Targeting helpers ──────────────────────────────────────────────────────

function resolveTarget(
  doc: Document,
  req: { id?: string; selector?: string }
): Element | null {
  if (req.id) {
    return doc.querySelector(`[data-duo-id="${escapeAttrSelector(req.id)}"]`)
  }
  if (req.selector) {
    // doc-rooted, not body-rooted, so a selector like `body` or `html`
    // resolves correctly (Element.querySelector only matches descendants,
    // never the host itself). Targeting head is technically possible but
    // unconventional — agents should stick to body content per PRD H37.
    return doc.querySelector(req.selector)
  }
  return null
}

function resolveAppendTarget(
  doc: Document,
  req: { parentId?: string; parentSelector?: string }
): Element | null {
  if (req.parentId) {
    return doc.querySelector(`[data-duo-id="${escapeAttrSelector(req.parentId)}"]`)
  }
  if (req.parentSelector) {
    return doc.querySelector(req.parentSelector)
  }
  return null
}

function targetErr(req: { id?: string; selector?: string }): string {
  if (req.id) return `No element with data-duo-id="${req.id}"`
  if (req.selector) return `No element matching selector "${req.selector}"`
  return 'Target required (use --id <duo-id> or --selector <css>)'
}

function escapeAttrSelector(s: string): string {
  // CSS attribute-selector escape: the duo-id is alphanumeric (Crockford
  // base32) so backslash-escape is sufficient. Defense in depth in case
  // the CLI ever lets user-supplied raw IDs through.
  return s.replace(/(["\\])/g, '\\$1')
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…'
}
