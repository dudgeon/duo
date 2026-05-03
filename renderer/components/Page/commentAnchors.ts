// Stage 17d — Canvas-side anchor badge painter (PRD H21, H23).
//
// Paints numbered `<span class="duo-comment-anchor">` badges into the
// iframe body next to each anchored element so the user can see at a
// glance which elements have comments. Click → invokes the supplied
// `onJumpTo(threadId)` so the parent can scroll the rail / activate
// the thread.
//
// All badges carry `data-duo-canvas-runtime` so the serializer strips
// them from saved HTML — the badges are render-time UX, never on
// disk. Same convention as the placeholder + just-added wash.
//
// One badge per thread (= one per anchor element). When the canvas
// binding's comment store changes, the parent re-runs `paintAnchors`
// to re-sync.

import type { SidecarComment, SidecarV1 } from './sidecar'

const BADGE_CLASS = 'duo-comment-anchor'
const BADGE_DATA = 'data-duo-comment-anchor'

export interface AnchorBadge {
  /** The thread id (canvas: anchor's `data-duo-id`). */
  threadId: string
  /** Display number (1-indexed, matches the rail's thread.number). */
  number: number
  /** Whether the thread is fully resolved (visual variant). */
  resolved: boolean
}

export interface PaintAnchorsOptions {
  doc: Document
  badges: AnchorBadge[]
  /** Currently active thread id — receives the `--active` modifier
   *  class so the badge gets a focus ring. */
  activeThreadId?: string | null
  /** Click handler — fires when the user clicks a body badge. */
  onClick: (threadId: string) => void
}

/**
 * Reconcile the painted badges with the supplied list. Idempotent —
 * removes stale badges, updates numbers/active state on existing ones,
 * inserts missing ones. Safe to call on every render.
 *
 * Every badge sits next to its anchor element (sibling, after the
 * element). Inserting it as a child would violate H19's "structural
 * elements protect their child structure" — and would dirty the
 * agent's `--id`-targeted lookups (which use `querySelector` and
 * would match the badge's own attrs).
 */
export function paintAnchors({ doc, badges, activeThreadId, onClick }: PaintAnchorsOptions): void {
  // Build a quick lookup of expected badges keyed by threadId.
  const expected = new Map(badges.map(b => [b.threadId, b]))
  const seen = new Set<string>()

  // Walk existing badges; either update or remove.
  doc.body.querySelectorAll<HTMLElement>(`[${BADGE_DATA}]`).forEach((badge) => {
    const tid = badge.getAttribute(BADGE_DATA)
    if (!tid) { badge.remove(); return }
    const want = expected.get(tid)
    if (!want) { badge.remove(); return }
    seen.add(tid)
    updateBadge(badge, want, tid === activeThreadId)
  })

  // Insert missing badges next to their anchors. We append after the
  // anchor element (as a sibling) — see PRD H19 + the function header
  // for why we don't nest inside.
  for (const badge of badges) {
    if (seen.has(badge.threadId)) continue
    const anchor = doc.querySelector(`[data-duo-id="${cssEscape(badge.threadId)}"]`)
    if (!anchor) continue
    const node = createBadge(doc, badge, badge.threadId === activeThreadId, onClick)
    anchor.insertAdjacentElement('afterend', node)
  }
}

/**
 * Tear down all anchor badges (e.g. on canvas unmount). Removes only
 * elements with the runtime-anchor sentinel; never touches user
 * content.
 */
export function clearAnchors(doc: Document): void {
  doc.body.querySelectorAll<HTMLElement>(`[${BADGE_DATA}]`).forEach((el) => el.remove())
}

export interface BuiltThread {
  threadId: string
  entries: SidecarComment[]
  excerpt: string
  resolved: boolean
  /** Document-order index (0-based). Threads without a live anchor
   *  in the current DOM sink to the bottom (orphans). */
  documentOrderIndex: number
}

/**
 * Build a sorted thread list from the sidecar's flat `comments[]`,
 * grouping by anchorId. Each thread's number is its position in
 * document order (1-indexed) — so opening the file shows comments
 * numbered top-to-bottom even if the sidecar appended them out of
 * order. `excerpt` is the anchor element's textContent truncated.
 */
export function buildThreads(doc: Document, sidecar: SidecarV1): BuiltThread[] {
  const comments = sidecar.comments ?? []
  const resolved = sidecar.resolvedThreads ?? {}

  const byAnchor = new Map<string, SidecarComment[]>()
  for (const c of comments) {
    const list = byAnchor.get(c.anchorId) ?? []
    list.push(c)
    byAnchor.set(c.anchorId, list)
  }

  // Sort entries within each thread chronologically.
  for (const list of byAnchor.values()) {
    list.sort((a, b) => a.ts.localeCompare(b.ts))
  }

  // Order threads by document position. Anchors that don't exist in
  // the current DOM (file was edited externally to remove them) sink
  // to the bottom — they're orphans the user can still see + resolve.
  const orderForAnchor = new Map<string, number>()
  let cursor = 0
  doc.body.querySelectorAll<HTMLElement>('[data-duo-id]').forEach((el) => {
    const id = el.getAttribute('data-duo-id')
    if (!id) return
    if (byAnchor.has(id) && !orderForAnchor.has(id)) {
      orderForAnchor.set(id, cursor++)
    }
  })

  const threads: BuiltThread[] = Array.from(byAnchor.entries()).map(([threadId, entries]) => {
    const anchorEl = doc.querySelector(`[data-duo-id="${cssEscape(threadId)}"]`)
    const excerpt = truncate((anchorEl?.textContent ?? '').trim(), 60)
    return {
      threadId,
      entries,
      excerpt,
      resolved: threadId in resolved,
      documentOrderIndex: orderForAnchor.get(threadId) ?? Number.MAX_SAFE_INTEGER
    }
  })

  threads.sort((a, b) => a.documentOrderIndex - b.documentOrderIndex)
  return threads
}

/**
 * Scroll the iframe body so the anchor element is visible. Used by
 * the rail's onJumpTo — when the user clicks a thread, the body
 * scrolls to its anchor + flashes a temporary highlight ring.
 */
export function scrollToAnchor(doc: Document, threadId: string): void {
  const el = doc.querySelector<HTMLElement>(`[data-duo-id="${cssEscape(threadId)}"]`)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

// ── helpers ─────────────────────────────────────────────────────────────

function createBadge(
  doc: Document,
  badge: AnchorBadge,
  active: boolean,
  onClick: (threadId: string) => void
): HTMLElement {
  const el = doc.createElement('span')
  el.setAttribute('data-duo-canvas-runtime', '1')
  el.setAttribute(BADGE_DATA, badge.threadId)
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', `Comment ${badge.number}`)
  // Pointer events fire on the iframe doc, not the parent — listener
  // captured here is what drives the rail focus.
  el.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick(badge.threadId)
  })
  updateBadge(el, badge, active)
  return el
}

function updateBadge(el: HTMLElement, badge: AnchorBadge, active: boolean): void {
  el.textContent = String(badge.number)
  const classes = [BADGE_CLASS]
  if (active) classes.push(`${BADGE_CLASS}--active`)
  if (badge.resolved) classes.push(`${BADGE_CLASS}--resolved`)
  el.className = classes.join(' ')
}

function cssEscape(s: string): string {
  return s.replace(/(["\\])/g, '\\$1')
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…'
}
