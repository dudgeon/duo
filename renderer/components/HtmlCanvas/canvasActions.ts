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

const KNOWN_VERBS = [
  // Stage 23 originals.
  'claude:spawn',
  'terminal:send',
  'browser:open',
  // Stage 27 additions — canvas authoring vocabulary.
  'editor:open',
  'nav:reveal',
  'selection:set',
  'theme:set',
  'terminal:focus',
  'duo:event',
] as const

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
    // Stage 27 — open an arbitrary file in whichever surface fits.
    // `data-mode` forces the routing surface (editor | canvas | browser);
    // when omitted, host falls back to openFileSmart which honors the
    // file's `<meta name="duo-open-in">` hint.
    case 'editor:open': {
      const path = el.getAttribute('data-path')
      if (!path) return { error: 'editor:open requires data-path' }
      const modeRaw = el.getAttribute('data-mode')
      let mode: 'editor' | 'canvas' | 'browser' | undefined
      if (modeRaw !== null) {
        if (modeRaw !== 'editor' && modeRaw !== 'canvas' && modeRaw !== 'browser') {
          return { error: `editor:open data-mode must be editor|canvas|browser (got "${modeRaw}")` }
        }
        mode = modeRaw
      }
      return { action: { kind: 'editor:open', path, mode } }
    }
    // Stage 27 — reveal a path in the file navigator (selects + scrolls
    // into view, expands ancestors). Same plumbing as the file-tab
    // context menu's "Reveal in Navigator" entry.
    case 'nav:reveal': {
      const path = el.getAttribute('data-path')
      if (!path) return { error: 'nav:reveal requires data-path' }
      return { action: { kind: 'nav:reveal', path } }
    }
    // Stage 27 — scroll-to-and-select inside the editor or canvas. v1
    // ships text-search for editor + anchor (data-duo-id) for canvas;
    // `data-line` is best-effort (clamps to last line in editor; coarse
    // top-level-child index in canvas — see CanvasTab onDocGoto).
    case 'selection:set': {
      const target = el.getAttribute('data-target')
      if (target !== 'editor' && target !== 'canvas') {
        return { error: 'selection:set requires data-target="editor" or "canvas"' }
      }
      const text = el.getAttribute('data-text') ?? undefined
      const lineRaw = el.getAttribute('data-line')
      let line: number | undefined
      if (lineRaw !== null) {
        const parsed = Number.parseInt(lineRaw, 10)
        if (!Number.isFinite(parsed) || parsed < 1) {
          return { error: `selection:set data-line must be a positive integer (got "${lineRaw}")` }
        }
        line = parsed
      }
      const anchor = el.getAttribute('data-anchor') ?? undefined
      if (!text && line === undefined && !anchor) {
        return { error: 'selection:set requires one of data-text / data-line / data-anchor' }
      }
      return { action: { kind: 'selection:set', target, text, line, anchor } }
    }
    // Stage 27 — flip the global theme. Mirrors the titlebar toggle and
    // `duo theme <mode>`. Persists via the same localStorage key.
    case 'theme:set': {
      const mode = el.getAttribute('data-theme')
      if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
        return { error: `theme:set requires data-theme="light"|"dark"|"system" (got "${mode ?? '<missing>'}")` }
      }
      return { action: { kind: 'theme:set', mode } }
    }
    // Stage 27 — focus the active terminal (or a specific tab when
    // data-tab-id is set). Mirrors ⌘\` toggle behaviour to working-pane
    // when already on a terminal.
    case 'terminal:focus': {
      const tabId = el.getAttribute('data-tab-id') ?? undefined
      return { action: { kind: 'terminal:focus', tabId } }
    }
    // Stage 27 — emit an arbitrary named event for `duo events --follow`
    // subscribers. `data-payload` is parsed as JSON literal; malformed
    // JSON surfaces as a developer-facing onMalformed warning.
    // `data-payload-from` is read by the dispatcher (Commit 3) so it
    // stays out of the parser surface.
    case 'duo:event': {
      const event = el.getAttribute('data-event')
      if (!event) return { error: 'duo:event requires data-event' }
      const payloadRaw = el.getAttribute('data-payload')
      let payload: Record<string, unknown> | undefined
      if (payloadRaw !== null && payloadRaw !== '') {
        try {
          const parsed = JSON.parse(payloadRaw)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            payload = parsed as Record<string, unknown>
          } else {
            return { error: 'duo:event data-payload must be a JSON object literal' }
          }
        } catch (err) {
          return { error: `duo:event data-payload is not valid JSON: ${err instanceof Error ? err.message : String(err)}` }
        }
      }
      return { action: { kind: 'duo:event', event, payload } }
    }
  }

  return { error: `unhandled verb "${verb}"` }
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
        console.warn('[duo-canvas-action] dispatch failed:', result.error, action)
      }
    }).catch((err) => {
      console.error('[duo-canvas-action] dispatch threw:', err, action)
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
