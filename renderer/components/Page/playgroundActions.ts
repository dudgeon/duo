// Stage 23 — Canvas actions: Claude ↔ HTML loop.
//
// A canvas can carry interactive elements (buttons, links, anything
// clickable) tagged with `data-duo-action="<verb>"` plus per-verb
// `data-*` siblings carrying the args. Clicking such an element
// dispatches a structured `PlaygroundAction` to the host (App.tsx via
// PageTab → WorkingPane → onPlaygroundAction), which routes it through
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

import type { PlaygroundAction } from '@shared/types'
import { parseActionFromAttrs, isPagePathTrusted as sharedIsPagePathTrusted } from '@shared/playground-actions'

export interface PlaygroundActionsOptions {
  /** True when the canvas file lives under a trusted root
   *  (~/.claude/duo/ for v1). When false, action clicks call
   *  `onUntrusted` instead of `onAction`. */
  trusted: boolean
  /** Dispatch a structured action. Host owns the side effect. */
  onAction: (action: PlaygroundAction) => Promise<{ ok: boolean; error?: string }>
  /** Called when an action is attempted on an untrusted canvas. The
   *  raw action is passed for diagnostic display. */
  onUntrusted?: (action: PlaygroundAction) => void
  /** Called for malformed `data-duo-action` markup so the host can
   *  surface a developer-friendly hint. Optional — defaults to
   *  console.warn. */
  onMalformed?: (reason: string, el: Element) => void
}

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
 * `PlaygroundAction`. Thin wrapper around the shared parser at
 * `shared/playground-actions.ts § parseActionFromAttrs` — the shared
 * surface lets the main process (ENH-094 browser-pane CDP injection)
 * use the SAME parser logic on attribute bundles received over CDP.
 */
function parseAction(el: HTMLElement): { action: PlaygroundAction } | { error: string } {
  return parseActionFromAttrs((name) => el.getAttribute(name))
}

/**
 * Stage 27 — read `.value` (or `.checked` for boolean inputs) from a
 * form element addressed by CSS selector. Used by the `duo:event`
 * action verb's `data-payload-from` attribute so a "submit name"
 * button can ship the user's typed value as part of the emitted
 * event's payload without bespoke JS. Returns `undefined` when the
 * selector is missing, doesn't match, or the element type isn't a
 * known form input — the caller treats that as "no value to attach"
 * and emits the static payload alone.
 *
 * Supported element types:
 *  - `<input type="checkbox|radio">` → boolean `.checked`
 *  - any other `<input>` (text, number, date, etc.) → string `.value`
 *  - `<textarea>` → string `.value`
 *  - `<select>` (single + multi) → string for single, string[] for multi
 *
 * Lives at module scope (not hidden inside the dispatcher) so the
 * authoring skill can document the exact lookup semantics + tests
 * can hit it directly.
 */
export function captureFormValue(doc: Document, selector: string | undefined): unknown {
  if (!selector) return undefined
  let el: Element | null = null
  try {
    el = doc.querySelector(selector)
  } catch {
    // Bad CSS selector — surface as undefined rather than throwing the
    // whole click handler.
    return undefined
  }
  if (!el) return undefined
  // Cross-realm safety: the doc is the iframe's Document, which has its
  // OWN HTMLInputElement / HTMLTextAreaElement / HTMLSelectElement
  // constructors distinct from the parent renderer's. `el instanceof
  // HTMLInputElement` evaluates `instanceof` against the PARENT's
  // constructor and returns false even when the element IS an input —
  // a classic same-origin-different-realm gotcha. Tag-name checks side-
  // step the issue entirely. Discovered during the Stage 27 smoke walk
  // (V9/V10 emitted but with empty payload because the instanceof
  // check fell through).
  const tag = el.tagName
  if (tag === 'INPUT') {
    const input = el as HTMLInputElement
    if (input.type === 'checkbox' || input.type === 'radio') return input.checked
    return input.value
  }
  if (tag === 'TEXTAREA') return (el as HTMLTextAreaElement).value
  if (tag === 'SELECT') {
    const sel = el as HTMLSelectElement
    if (sel.multiple) {
      return Array.from(sel.selectedOptions).map(opt => opt.value)
    }
    return sel.value
  }
  return undefined
}

/**
 * Brief visual feedback so users see their click registered.
 * Renders a 1px outline that fades over 600ms. Marked
 * data-duo-canvas-runtime so the serializer scrubs it from saves.
 */
function flashFeedback(el: HTMLElement, doc: Document): void {
  const styleId = 'duo-playground-flash'
  if (!doc.getElementById(styleId)) {
    const style = doc.createElement('style')
    style.id = styleId
    style.setAttribute('data-duo-canvas-runtime', '1')
    style.textContent = `
      @keyframes duo-playground-flash {
        0%   { outline: 2px solid rgba(207, 102, 121, 0.85); outline-offset: 2px; }
        100% { outline: 2px solid rgba(207, 102, 121, 0);    outline-offset: 2px; }
      }
      [data-duo-canvas-runtime-flash] {
        animation: duo-playground-flash 600ms ease-out;
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
export function installPlaygroundActions(doc: Document, opts: PlaygroundActionsOptions): () => void {
  const malformed = opts.onMalformed ?? ((reason, el) => {
    console.warn('[duo-playground]', reason, el)
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

    // Stage 27 — `duo:event` data-payload-from binding. The parser
    // doesn't have access to the iframe document; capture happens
    // here, after parseAction has constructed the static payload.
    // Captured form value lands at payload.value (matching the PRD §
    // 6 contract). Static `data-payload` JSON wins on key collision —
    // an author who explicitly set `value: "x"` in data-payload meant
    // it; we don't clobber.
    let action = parsed.action
    if (action.kind === 'duo:event') {
      const payloadFromSel = el.getAttribute('data-payload-from') ?? undefined
      const captured = captureFormValue(doc, payloadFromSel)
      if (captured !== undefined) {
        const staticPayload = action.payload ?? {}
        action = {
          ...action,
          payload: 'value' in staticPayload
            ? staticPayload
            : { ...staticPayload, value: captured }
        }
      }
    }

    if (!opts.trusted) {
      opts.onUntrusted?.(action)
      return
    }

    flashFeedback(el, doc)
    void opts.onAction(action).then((result) => {
      if (!result.ok && result.error) {
        console.warn('[duo-playground] dispatch failed:', result.error, action)
      }
    }).catch((err) => {
      console.error('[duo-playground] dispatch threw:', err, action)
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
 * Trust check — re-exported from shared/ for backwards-compatibility
 * with existing imports (`PageTab.tsx`). The implementation moved to
 * `shared/playground-actions.ts § isPagePathTrusted` so the main
 * process (ENH-094 browser-pane CDP forward) can apply the same gate
 * before forwarding actions to the renderer.
 */
export const isPagePathTrusted = sharedIsPagePathTrusted
