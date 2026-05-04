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

/** Sprint 6 BUG-083 — attribute on the anchor element itself (NOT the
 *  badge) marking that it has a comment thread. CSS in
 *  `installCommentAnchorStyles` styles these for the visual
 *  association between rail and body. */
const HAS_COMMENT_DATA = 'data-duo-has-comment'
/** Sprint 6 BUG-083 — set on the anchor element whose thread is
 *  currently focused in the rail. Stronger highlight than has-comment. */
const COMMENT_ACTIVE_DATA = 'data-duo-comment-active'

/**
 * Sprint 6 BUG-083 — install the iframe-side stylesheet for comment
 * anchors. Same pattern as `installJustAddedStyles`: parent-document
 * `globals.css` rules don't reach the iframe's `srcdoc` document, so
 * we inline a minimal stylesheet at iframe-ready time. Idempotent —
 * subsequent calls no-op via the data-attribute sentinel. Tagged with
 * `data-duo-canvas-runtime` so the serializer strips it from saved
 * HTML alongside the other runtime decorations.
 *
 * Three concerns covered:
 *
 *   1. The numbered badge (`.duo-comment-anchor`). Previously styled
 *      ONLY in `renderer/styles/globals.css`, which doesn't reach the
 *      iframe — the badge rendered as plain text "1" inside canvases.
 *      Mirrors the parent declaration verbatim, with hard-coded color
 *      tokens (iframes don't inherit CSS custom properties).
 *
 *   2. The anchor-decoration on the commented element itself
 *      (`[data-duo-has-comment]`). Subtle bottom-border using the
 *      accent-soft tone so the user can see WHICH text the comment
 *      attaches to. Google Docs parity (yellow highlight there;
 *      Atelier accent-soft here for tonal consistency).
 *
 *   3. The active-thread emphasis (`[data-duo-comment-active]`). When
 *      a thread is focused in the rail (or its anchor is clicked in
 *      the body), the corresponding anchor swaps from the soft tint
 *      to a stronger background — Google Docs' "this is the one
 *      we're looking at" affordance.
 */
export function installCommentAnchorStyles(doc: Document): void {
  if (doc.head?.querySelector('style[data-duo-comment-anchor]')) return
  const style = doc.createElement('style')
  style.setAttribute('data-duo-canvas-runtime', '1')
  style.setAttribute('data-duo-comment-anchor', '1')
  // Atelier tokens hard-coded; iframe documents don't inherit CSS
  // custom properties from the parent, so referencing
  // `var(--duo-accent)` from inside an `srcdoc` doc would fall back
  // to nothing. Light + dark variants honored via @media. If the
  // tokens shift, update both this file AND globals.css.
  style.textContent = `
.${BADGE_CLASS} {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #C66A2E;
  color: white;
  font-size: 10px;
  font-weight: 600;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif;
  line-height: 1;
  cursor: pointer;
  margin-left: 4px;
  vertical-align: super;
  user-select: none;
  -webkit-user-select: none;
  transition: transform 80ms ease-out, box-shadow 80ms ease-out;
}
.${BADGE_CLASS}:hover {
  transform: translateY(-0.5px);
  box-shadow: 0 1px 4px rgba(20, 14, 8, 0.16);
}
.${BADGE_CLASS}--active {
  box-shadow: 0 0 0 2px #F2D9B8;
}
.${BADGE_CLASS}--resolved {
  background: #E5DFCE;
  color: #7B6F58;
}
[${HAS_COMMENT_DATA}] {
  background: rgba(198, 106, 46, 0.08);
  border-bottom: 1px solid rgba(198, 106, 46, 0.45);
  cursor: pointer;
  /* BUG-089 fix — no transition on the static state. Typing inside
     a commented element triggers contentEditable repaints; a 100ms
     transition restarted on each keystroke produced a visible
     flicker. Hover state gets no transition either; the visual
     change is small enough to read instantly. */
}
[${HAS_COMMENT_DATA}]:hover {
  background: rgba(198, 106, 46, 0.16);
}
[${COMMENT_ACTIVE_DATA}] {
  background: rgba(198, 106, 46, 0.22);
  border-bottom-color: #C66A2E;
}
@media (prefers-color-scheme: dark) {
  .${BADGE_CLASS} {
    background: #E08F4A;
  }
  .${BADGE_CLASS}--active {
    box-shadow: 0 0 0 2px #3F2A18;
  }
  .${BADGE_CLASS}--resolved {
    background: #2A2218;
    color: #8A7E66;
  }
  [${HAS_COMMENT_DATA}] {
    background: rgba(224, 143, 74, 0.12);
    border-bottom-color: rgba(224, 143, 74, 0.55);
  }
  [${HAS_COMMENT_DATA}]:hover {
    background: rgba(224, 143, 74, 0.22);
  }
  [${COMMENT_ACTIVE_DATA}] {
    background: rgba(224, 143, 74, 0.32);
    border-bottom-color: #E08F4A;
  }
}
`.trim()
  doc.head?.appendChild(style)
}

/**
 * Sprint 6 BUG-083 — delegated click handler on the iframe body that
 * catches clicks on commented anchor elements (NOT the badge sibling,
 * which has its own listener). Lets the user click directly on the
 * highlighted text to focus the corresponding rail thread — Google
 * Docs parity, completing the bidirectional click-to-focus.
 *
 * Returns a cleanup function. Caller (PageTab) wires this in
 * handleReady alongside the other selection / paste listeners.
 */
export function installAnchorClickListener(
  doc: Document,
  onClick: (threadId: string) => void
): () => void {
  const handler = (e: MouseEvent) => {
    const target = e.target as Element | null
    if (!target) return
    // Walk up to the nearest [data-duo-has-comment] element (or stop
    // at body). The user might have clicked a child node (e.g. a
    // <strong> inside the commented <p>) — we still want the click
    // to count as "click on the commented element".
    const commented = target.closest(`[${HAS_COMMENT_DATA}]`) as HTMLElement | null
    if (!commented) return
    const tid = commented.getAttribute('data-duo-id')
    if (!tid) return
    // Don't preventDefault — the user may be placing a caret as part
    // of a normal edit. Just fire the focus signal as a side effect.
    onClick(tid)
  }
  doc.body.addEventListener('click', handler)
  return () => doc.body.removeEventListener('click', handler)
}

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

  // Sprint 6 BUG-083 — stamp / unstamp the anchor-decoration markers
  // on the anchor ELEMENTS (separate from the sibling badges). We
  // walk every [data-duo-id] in the body so we also remove markers
  // from elements that USED to have a comment thread but no longer do
  // (resolved + last-comment-deleted, or the file was edited
  // externally). Saved HTML never carries these attributes — the
  // serializer strips data-duo-* runtime markers via the canvas-
  // runtime sentinel pathway.
  doc.body.querySelectorAll<HTMLElement>('[data-duo-id]').forEach((el) => {
    const id = el.getAttribute('data-duo-id')
    if (!id) return
    if (expected.has(id)) {
      el.setAttribute(HAS_COMMENT_DATA, '1')
      // Don't decorate the anchor for resolved-only threads — once
      // the user resolves a thread, the visual association becomes
      // noise. Resolved threads still appear in the rail but the
      // body-side highlight goes away.
      const meta = expected.get(id)
      if (meta && meta.resolved) el.removeAttribute(HAS_COMMENT_DATA)
      if (id === activeThreadId) el.setAttribute(COMMENT_ACTIVE_DATA, '1')
      else el.removeAttribute(COMMENT_ACTIVE_DATA)
    } else {
      el.removeAttribute(HAS_COMMENT_DATA)
      el.removeAttribute(COMMENT_ACTIVE_DATA)
    }
  })
}

/**
 * Tear down all anchor badges (e.g. on canvas unmount). Removes only
 * elements with the runtime-anchor sentinel; never touches user
 * content.
 */
export function clearAnchors(doc: Document): void {
  doc.body.querySelectorAll<HTMLElement>(`[${BADGE_DATA}]`).forEach((el) => el.remove())
  // Sprint 6 BUG-083 — also strip the anchor-decoration markers so
  // an unmount / save handoff doesn't leave them on the DOM.
  doc.body.querySelectorAll<HTMLElement>(`[${HAS_COMMENT_DATA}]`).forEach((el) => {
    el.removeAttribute(HAS_COMMENT_DATA)
    el.removeAttribute(COMMENT_ACTIVE_DATA)
  })
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
