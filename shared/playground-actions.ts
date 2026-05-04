// Stage 23 / 27 / Sprint 5 — playground action parser, shared.
//
// The 9-verb playground action vocabulary (`claude:spawn`, `terminal:send`,
// `browser:open`, `editor:open`, `nav:reveal`, `selection:set`, `theme:set`,
// `terminal:focus`, `duo:event`) parses the same way regardless of where
// the click originated:
//
// - Canvas iframe → renderer's `installPlaygroundActions(doc)` reads
//   attributes from the clicked HTMLElement
// - Browser pane → CDP IIFE captures attributes page-side and ships them
//   via `Runtime.binding`; main process needs to parse them on receipt
//
// To keep ONE parser, this module accepts an attribute-getter function
// (`AttrGetter`) instead of taking an HTMLElement directly. Callers in
// either context wrap their attribute source: the canvas runtime passes
// `(name) => el.getAttribute(name)`; the main-process CDP handler passes
// `(name) => attrsBundle[name] ?? null` against the JSON the IIFE sent.
//
// Lives in `shared/` so both renderer and main can import without
// dragging DOM types into the main process or Electron types into the
// renderer.
//
// Trust gate (`isPagePathTrusted`) also lives here for the same reason:
// browser-pane runtime injection (ENH-094) needs the same trust check
// applied in the main process before forwarding to the renderer.

import type { PlaygroundAction } from './host-api'

export const KNOWN_PLAYGROUND_VERBS = [
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

export type PlaygroundVerb = typeof KNOWN_PLAYGROUND_VERBS[number]

/** Attribute-source abstraction. Returns `null` when the attribute is
 *  absent (matching `Element.getAttribute` semantics). */
export type AttrGetter = (name: string) => string | null

/**
 * Parse a playground action from its `data-*` attributes. Returns an
 * `{action}` discriminated-union value on success or `{error}` with a
 * human-readable reason on malformed input.
 *
 * Pure — no DOM access. Callers supply an `AttrGetter` to abstract over
 * "real HTMLElement" vs "JSON bundle from the CDP IIFE."
 */
export function parseActionFromAttrs(
  getAttr: AttrGetter
): { action: PlaygroundAction } | { error: string } {
  const verb = (getAttr('data-duo-action') ?? '').trim()
  if (!verb) return { error: 'data-duo-action attribute is empty' }
  if (!(KNOWN_PLAYGROUND_VERBS as readonly string[]).includes(verb)) {
    return {
      error: `unknown action verb "${verb}" (expected one of: ${KNOWN_PLAYGROUND_VERBS.join(', ')})`
    }
  }

  switch (verb as PlaygroundVerb) {
    case 'claude:spawn': {
      const cwd = getAttr('data-cwd') ?? undefined
      const cmd = getAttr('data-cmd') ?? undefined
      return { action: { kind: 'claude:spawn', cwd, cmd } }
    }
    case 'terminal:send': {
      const text = getAttr('data-text')
      if (text === null) return { error: 'terminal:send requires data-text' }
      const enter = getAttr('data-enter') === 'true'
      return { action: { kind: 'terminal:send', text, enter } }
    }
    case 'browser:open': {
      const url = getAttr('data-url')
      if (!url) return { error: 'browser:open requires data-url' }
      return { action: { kind: 'browser:open', url } }
    }
    // Stage 27 — open an arbitrary file in whichever surface fits.
    // `data-mode` forces the routing surface (editor | canvas | browser);
    // when omitted, host falls back to openFileSmart which honors the
    // file's `<meta name="duo-open-in">` hint.
    case 'editor:open': {
      const path = getAttr('data-path')
      if (!path) return { error: 'editor:open requires data-path' }
      const modeRaw = getAttr('data-mode')
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
      const path = getAttr('data-path')
      if (!path) return { error: 'nav:reveal requires data-path' }
      return { action: { kind: 'nav:reveal', path } }
    }
    // Stage 27 — scroll-to-and-select inside the editor or canvas. v1
    // ships text-search for editor + anchor (data-duo-id) for canvas;
    // `data-line` is best-effort (clamps to last line in editor; coarse
    // top-level-child index in canvas — see PageTab onDocGoto).
    case 'selection:set': {
      const target = getAttr('data-target')
      if (target !== 'editor' && target !== 'canvas') {
        return { error: 'selection:set requires data-target="editor" or "canvas"' }
      }
      const text = getAttr('data-text') ?? undefined
      const lineRaw = getAttr('data-line')
      let line: number | undefined
      if (lineRaw !== null) {
        const parsed = Number.parseInt(lineRaw, 10)
        if (!Number.isFinite(parsed) || parsed < 1) {
          return { error: `selection:set data-line must be a positive integer (got "${lineRaw}")` }
        }
        line = parsed
      }
      const anchor = getAttr('data-anchor') ?? undefined
      if (!text && line === undefined && !anchor) {
        return { error: 'selection:set requires one of data-text / data-line / data-anchor' }
      }
      return { action: { kind: 'selection:set', target, text, line, anchor } }
    }
    // Stage 27 — flip the global theme. Mirrors the titlebar toggle and
    // `duo theme <mode>`. Persists via the same localStorage key.
    case 'theme:set': {
      const mode = getAttr('data-theme')
      if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
        return { error: `theme:set requires data-theme="light"|"dark"|"system" (got "${mode ?? '<missing>'}")` }
      }
      return { action: { kind: 'theme:set', mode } }
    }
    // Stage 27 — focus the active terminal (or a specific tab when
    // data-tab-id is set). Mirrors ⌘\` toggle behaviour to working-pane
    // when already on a terminal.
    case 'terminal:focus': {
      const tabId = getAttr('data-tab-id') ?? undefined
      return { action: { kind: 'terminal:focus', tabId } }
    }
    // Stage 27 — emit an arbitrary named event for `duo events --follow`
    // subscribers. `data-payload` is parsed as JSON literal; malformed
    // JSON surfaces as a developer-facing onMalformed warning.
    // `data-payload-from` is read by the dispatcher (canvas-side runtime
    // for iframe pages, IIFE for browser-pane pages) so it stays out of
    // the parser surface.
    case 'duo:event': {
      const event = getAttr('data-event')
      if (!event) return { error: 'duo:event requires data-event' }
      const payloadRaw = getAttr('data-payload')
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
 * Trust check (v1): canvas / browser-pane pages under `~/.claude/duo/`
 * are trusted. Anywhere else is untrusted. The `home` parameter
 * accommodates tests + future "user-marked trusted folders" where the
 * caller passes additional roots.
 *
 * Lives in `shared/` because BOTH the renderer (canvas-side trust gate)
 * and the main process (browser-pane CDP forward, ENH-094) need it.
 */
export function isPagePathTrusted(absolutePath: string, home: string): boolean {
  if (!absolutePath || !home) return false
  // Normalize trailing slash on the trust root so /Users/foo/.claude/duo
  // doesn't accidentally trust /Users/foo/.claude/duo-bar/.
  const root = `${home.replace(/\/+$/, '')}/.claude/duo/`
  return absolutePath === root.slice(0, -1) || absolutePath.startsWith(root)
}
