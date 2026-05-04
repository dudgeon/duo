// Stage 17b — `data-duo-id` injection (PRD H12–H15).
//
// Walks the iframe's body and stamps every editable element with a
// `data-duo-id="<ULID>"` attribute. Existing attributes (including
// any user-authored `id="…"`) are NEVER touched — the duo-id is
// additive. Re-running the injector is safe: elements that already
// have a duo-id keep theirs; only new elements pick one up.
//
// Skipped per PRD H13:
//   - text nodes (text is addressed by parent-id + offset; no marker
//     attribute possible)
//   - <br>, <hr>
//   - elements explicitly carrying `data-duo-id="opt-out"`
//   - <head> elements (the TreeWalker is rooted at <body>)
//
// Per-directory persistence (PRD H14): once the user picks "always
// inject" or "never inject" for a directory, we don't prompt again
// for files in that directory. The choice is stored in localStorage
// keyed by the file's parent path.

import { newULID } from '@shared/ulid'

const SKIP_TAGS = new Set(['BR', 'HR'])
const STORAGE_KEY = 'duo.html.autoInjectIds.byDir'

/** Visit every body element and stamp it with `data-duo-id` if it
 *  doesn't already have one. Returns counts so the caller can flag
 *  the buffer dirty only when something actually changed. */
export function injectIds(doc: Document): { injected: number; total: number } {
  let injected = 0
  let total = 0
  if (!doc.body) return { injected, total }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT)
  let node: Node | null = walker.currentNode
  while (node) {
    if (node.nodeType === 1 && node !== doc.body) {
      const el = node as Element
      const existing = el.getAttribute('data-duo-id')
      if (!SKIP_TAGS.has(el.tagName) && existing !== 'opt-out') {
        total++
        if (!existing) {
          el.setAttribute('data-duo-id', newULID())
          injected++
        }
      }
    }
    node = walker.nextNode()
  }
  return { injected, total }
}

/** Count of body elements that currently carry a real duo-id (excludes
 *  the opt-out sentinel). Drives the first-open detection: if the file
 *  has zero duo-ids, the canvas prompts to inject. */
export function countDuoIds(doc: Document): number {
  if (!doc.body) return 0
  return doc.body.querySelectorAll('[data-duo-id]:not([data-duo-id="opt-out"])').length
}

/**
 * Sprint 6 BUG-088 / BUG-090 — auto-stamp data-duo-id on every NEW
 * element added to the canvas body after mount. The boilerplate seeds
 * IDs only on `body` / `h1` / `p` (one of each); markdown-shortcut
 * conversions (`- bullet`, `1. ordered`, `> quote`, etc.) and any
 * other DOM mutations create elements WITHOUT IDs. When the user
 * later commented on one of those elements, the closest ancestor
 * with a `data-duo-id` was a generic container (`<body>`, `<ul>`),
 * so multiple distinct comments grouped into the same thread.
 *
 * Returns a cleanup function. Idempotent (the install bails if the
 * sentinel-marked observer is already attached). Observes ONLY
 * childList mutations — attribute changes are excluded so the
 * stamp itself doesn't re-fire the observer.
 *
 * Skip rules mirror `injectIds`:
 *   - Skip `BR` / `HR` (no comment / agent semantics for void marks).
 *   - Skip elements with `data-duo-id="opt-out"`.
 *   - Don't stamp text / comment nodes (only Element nodes).
 *
 * Stamping happens after the mutation lands, so the autosave's
 * MutationObserver (observing attributes too) DOES see the
 * stamp-as-attribute-change. That's intentional — the resulting
 * stamp ends up in the next save, exactly as it would if the
 * agent had stamped IDs through `duo html stamp-ids`.
 */
export function installAutoStampIds(doc: Document): () => void {
  if (!doc.body) return () => {}
  // Idempotency sentinel — re-running handleReady (or HMR cycles)
  // shouldn't double-install.
  if (doc.body.hasAttribute('data-duo-auto-stamp-installed')) return () => {}
  doc.body.setAttribute('data-duo-auto-stamp-installed', '1')

  const stampElement = (el: Element): void => {
    if (SKIP_TAGS.has(el.tagName)) return
    const existing = el.getAttribute('data-duo-id')
    if (existing === 'opt-out') return
    if (existing) return
    el.setAttribute('data-duo-id', newULID())
  }

  // Walk a subtree, stamping every element. Used for newly-added
  // nodes that themselves contain children (e.g. paste of a complex
  // fragment, or a `<ul>` containing multiple `<li>`s).
  const stampSubtree = (root: Node): void => {
    if (root.nodeType !== 1) return
    stampElement(root as Element)
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    let node = walker.nextNode()
    while (node) {
      stampElement(node as Element)
      node = walker.nextNode()
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== 'childList') continue
      m.addedNodes.forEach((n) => stampSubtree(n))
    }
  })
  observer.observe(doc.body, {
    subtree: true,
    childList: true
  })

  return () => {
    observer.disconnect()
    doc.body?.removeAttribute('data-duo-auto-stamp-installed')
  }
}

// ── Per-directory choice persistence (PRD H14) ─────────────────────────────

export type AutoInjectChoice = 'always' | 'never'

interface ChoiceMap {
  [dir: string]: AutoInjectChoice
}

function loadMap(): ChoiceMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch { return {} }
}

function saveMap(map: ChoiceMap): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)) } catch { /* quota */ }
}

export function getChoiceForDir(dir: string): AutoInjectChoice | undefined {
  return loadMap()[dir]
}

export function setChoiceForDir(dir: string, choice: AutoInjectChoice): void {
  const map = loadMap()
  map[dir] = choice
  saveMap(map)
}

export function dirOf(absPath: string): string {
  const i = absPath.lastIndexOf('/')
  return i <= 0 ? '/' : absPath.slice(0, i)
}
