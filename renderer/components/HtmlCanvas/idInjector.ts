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

import { newULID } from './ulid'

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
