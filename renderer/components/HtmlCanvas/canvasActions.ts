// Stage 23 — Canvas actions: Claude ↔ HTML loop.
//
// A canvas can carry interactive elements (buttons, links, anything
// clickable) tagged with `data-duo-action="<verb>"` plus per-verb
// `data-*` siblings carrying the args. Clicking such an element
// dispatches a structured `CanvasAction` to the host (App.tsx via
// CanvasTab → WorkingPane → onCanvasAction), which routes it through
// existing infra (`pty.write` for terminal:send, `browser.addTab`
// for browser:open, App.tsx's claude-tab spawn for claude:spawn).
//
// Why renderer-side, not iframe-side JS: Stage 17a's iframe sandbox
// is `allow-same-origin allow-popups allow-forms` — explicitly NO
// `allow-scripts` (PRD H4/H8). So `<button onclick="…">` is inert.
// Same-origin sandboxing means the parent React component still has
// full DOM access to the iframe document, so we install a delegated
// click listener at the body level. As a bonus this gives us a
// natural choke point for the trust gate.
//
// Trust model (v1, Stage 23a): actions fire only when the canvas
// file's path is under `~/.claude/duo/`. That covers the FAQ /
// What-Duo-Does pages and (later) Stage 18b skill-pack canvases —
// the curated content surface. User-authored canvases elsewhere
// stay inert; clicking an action button calls `onUntrusted` so the
// host can show a one-line toast ("actions disabled outside
// ~/.claude/duo/"). User-marked-trusted folders deferred to a
// follow-up — small JSON allowlist at ~/.claude/duo/trusted-folders.json.

import type { CanvasAction } from '@shared/types'

export interface CanvasActionsOptions {
  /** True when the canvas file lives under a trusted root
   *  (~/.claude/duo/ for v1). When false, action clicks call
   *  `onUntrusted` instead of `onAction`. */
  trusted: boolean
  /** Dispatch a structured action. Host owns the side effect. */
  onAction: (action: CanvasAction) => Promise<{ ok: boolean; error?: string }>
  /** Called when an action is attempted on an untrusted canvas. The
   *  raw action is passed for diagnostic display. */
  onUntrusted?: (action: CanvasAction) => void
  /** Called for malformed `data-duo-action` markup so the host can
   *  surface a developer-friendly hint. Optional — defaults to
   *  console.warn. */
  onMalformed?: (reason: string, el: Element) => void
}

const KNOWN_VERBS = ['claude:spawn', 'terminal:send', 'browser:open'] as const

/**
 * Resolve a click target to its action element.
 *
 * Walks up the parent chain from the original target to find the
 * nearest ancestor with a `data-duo-action` attribute. Bounded at
 * the iframe's body element so we don't escape the canvas.
 */
function findActionElement(target: EventTarget | null): HTMLElement | null {
  let el = target as HTMLElement | null
  while (el && el.nodeType === 1) {
    if (el.hasAttribute && el.hasAttribute('data-duo-action')) return el
    el = el.parentElement
  }
  return null
}

/**
 * Parse `data-*` attributes on the action element into a typed
 * `CanvasAction`. Returns null + a reason on malformed input.
 */
function parseAction(el: HTMLElement): { action: CanvasAction } | { error: string } {
  const verb = (el.getAttribute('data-duo-action') ?? '').trim()
  if (!verb) return { error: 'data-duo-action attribute is empty' }
  if (!(KNOWN_VERBS as readonly string[]).includes(verb)) {
    return { error: `unknown action verb "${verb}" (expected one of: ${KNOWN_VERBS.join(', ')})` }
  }

  switch (verb) {
    case 'claude:spawn': {
      const cwd = el.getAttribute('data-cwd') ?? undefined
      const cmd = el.getAttribute('data-cmd') ?? undefined
      return { action: { kind: 'claude:spawn', cwd, cmd } }
    }
    case 'terminal:send': {
      const text = el.getAttribute('data-text')
      if (text === null) return { error: 'terminal:send requires data-text' }
      const enter = el.getAttribute('data-enter') === 'true'
      return { action: { kind: 'terminal:send', text, enter } }
    }
    case 'browser:open': {
      const url = el.getAttribute('data-url')
      if (!url) return { error: 'browser:open requires data-url' }
      return { action: { kind: 'browser:open', url } }
    }
  }

  return { error: `unhandled verb "${verb}"` }
}

/**
 * Brief visual feedback so users see their click registered.
 * Renders a 1px outline that fades over 600ms. Marked
 * data-duo-canvas-runtime so the serializer scrubs it from saves.
 */
function flashFeedback(el: HTMLElement, doc: Document): void {
  const styleId = 'duo-canvas-action-flash'
  if (!doc.getElementById(styleId)) {
    const style = doc.createElement('style')
    style.id = styleId
    style.setAttribute('data-duo-canvas-runtime', '1')
    style.textContent = `
      @keyframes duo-canvas-action-flash {
        0%   { outline: 2px solid rgba(207, 102, 121, 0.85); outline-offset: 2px; }
        100% { outline: 2px solid rgba(207, 102, 121, 0);    outline-offset: 2px; }
      }
      [data-duo-canvas-runtime-flash] {
        animation: duo-canvas-action-flash 600ms ease-out;
      }
    `
    doc.head?.appendChild(style)
  }
  el.setAttribute('data-duo-canvas-runtime-flash', '1')
  setTimeout(() => {
    try { el.removeAttribute('data-duo-canvas-runtime-flash') } catch { /* node may be detached */ }
  }, 700)
}

/**
 * Install the canvas-action delegated click listener.
 *
 * Returns a cleanup function. Safe to call multiple times across
 * mounts — each call installs an isolated listener with its own
 * cleanup.
 */
export function installCanvasActions(doc: Document, opts: CanvasActionsOptions): () => void {
  const malformed = opts.onMalformed ?? ((reason, el) => {
    console.warn('[duo-canvas-action]', reason, el)
  })

  const onClick = (e: MouseEvent) => {
    // Only primary-button clicks; ignore middle / right / modifier-clicks
    // (modifier-clicks may be the user trying to copy, not invoke).
    if (e.button !== 0) return
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return

    const el = findActionElement(e.target)
    if (!el) return

    // Always preventDefault so contentEditable doesn't move the cursor
    // into a button label, and <a href> doesn't navigate the iframe.
    e.preventDefault()
    e.stopPropagation()

    const parsed = parseAction(el)
    if ('error' in parsed) {
      malformed(parsed.error, el)
      return
    }

    if (!opts.trusted) {
      opts.onUntrusted?.(parsed.action)
      return
    }

    flashFeedback(el, doc)
    void opts.onAction(parsed.action).then((result) => {
      if (!result.ok && result.error) {
        console.warn('[duo-canvas-action] dispatch failed:', result.error, parsed.action)
      }
    }).catch((err) => {
      console.error('[duo-canvas-action] dispatch threw:', err, parsed.action)
    })
  }

  // Capture phase: beats any inner-element click handlers (e.g. user
  // adding a <details>/<summary> toggle to their canvas), and lets us
  // intercept before contentEditable's default cursor-placement runs.
  doc.addEventListener('click', onClick, true)

  return () => {
    doc.removeEventListener('click', onClick, true)
  }
}

/**
 * Trust check (v1): canvas files under `~/.claude/duo/` are trusted.
 * Anywhere else is untrusted. The home parameter accommodates tests
 * + future "user-marked trusted folders" extension where the caller
 * passes additional roots.
 */
export function isCanvasPathTrusted(absolutePath: string, home: string): boolean {
  if (!absolutePath || !home) return false
  // Normalize trailing slash on the trust root so /Users/foo/.claude/duo
  // doesn't accidentally trust /Users/foo/.claude/duo-bar/.
  const root = `${home.replace(/\/+$/, '')}/.claude/duo/`
  return absolutePath === root.slice(0, -1) || absolutePath.startsWith(root)
}
