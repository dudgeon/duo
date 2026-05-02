// Stage 17a — iframe-srcdoc host for the HTML canvas.
//
// Renders a sandboxed iframe whose body is contentEditable. We watch
// the iframe's DOM with MutationObserver and surface "did-change"
// signals to the parent CanvasTab; the parent owns dirty state, save,
// and external-write reconciliation (deferred to 17e).
//
// Sandbox attributes follow PRD H4: `allow-same-origin allow-popups
// allow-forms` always; `allow-scripts` only when scripts are allowed
// for the file (H8 — 17e). For 17a we never set allow-scripts, so a
// page with inline `<script>` tags renders inert (the markup is
// preserved on disk; the script just doesn't execute).
//
// Why srcdoc instead of a `duo-file://` URL: srcdoc keeps the iframe
// same-origin with the parent renderer, so we can reach into
// contentDocument synchronously. A real URL would force a postMessage
// bridge, which we don't need yet.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { serializeDocument } from './serialize'
import { installGlobalShortcutForwarder } from '../../keyboard/iframeForwarder'

interface Props {
  /** Initial HTML the iframe should render. Set on mount; the iframe
   *  is then re-keyed only when the path changes (CanvasTab handles
   *  that via React `key`). */
  initialHtml: string
  /** Fires after each batched DOM mutation inside the iframe (debounced
   *  by the MutationObserver's microtask coalescing — same shape as the
   *  markdown editor's `editor.on('update')`). */
  onChange: () => void
  /** Forward keyboard shortcuts (⌘B/I/U/S, ⌘K, ⌘S) so the parent can
   *  apply marks / save / etc. The handler returns true if it consumed
   *  the event (preventDefault is applied inside the iframe). */
  onShortcut: (e: KeyboardEvent) => boolean
  /** Fires once the iframe has finished parsing srcdoc and the body is
   *  fully populated. CanvasTab uses this to wire iframe-side hooks
   *  (selectionchange listener, markdown shortcuts, placeholder
   *  overlay, ID-injection probe) after the body content is real —
   *  setting up against an empty / pre-parse body causes the parser
   *  to wipe whatever we mounted. */
  onReady?: (doc: Document) => void
  /** When true, the canvas mounts read-only: no contentEditable, no
   *  MutationObserver (no dirty-state plumbing), no shortcut keydown
   *  handler. Used to honor `<meta name="duo-editable" content="false">`
   *  on system reference HTMLs (FAQ, What Duo Does, etc.) so they can
   *  be displayed without accidental human edits. */
  readOnly?: boolean
  /** BUG-032 — when false, the iframe's `wire()` SKIPS the
   *  `body.focus()` call on every load (intended only for the very
   *  first mount). The iframe load event re-fires on srcdoc changes,
   *  HMR re-mounts, and post-doc-write reloads — letting `wire()`
   *  re-grab focus then steals the cursor from a terminal the user
   *  has clicked into. The host (CanvasTab) gates this on
   *  `focusedColumn === 'working'` so the canvas only steals focus
   *  when the user has clearly chosen the working pane. */
  shouldStealFocus?: boolean
  /** BUG-037 — fires on mousedown inside the iframe document. The
   *  iframe is a separate document, so its mousedown events don't
   *  bubble up to the column wrapper's `onMouseDown` handler that
   *  flips `focusedColumn`. Without this forwarder, clicking into
   *  the canvas when terminal had focus leaves `focusedColumn` stuck
   *  at `'terminal'` and subsequent ⌃Tab / ⌘T cycle the wrong pane. */
  onUserInteract?: () => void
}

export interface RenderedCanvasHandle {
  /** Returns the iframe's contentDocument, or null if not yet mounted /
   *  cross-origin (shouldn't happen with srcdoc). */
  getDocument: () => Document | null
  /** Serializes the current iframe DOM back to an HTML string (saved
   *  to disk as-is for 17a; pretty-printer lands in 17b/e). */
  serialize: () => string
  /** Stage 17c — the iframe element itself, so the parent can
   *  translate iframe-content-relative selection rects to viewport-
   *  relative pill anchor rects. Returns null until the iframe is
   *  attached. */
  getIframeElement: () => HTMLIFrameElement | null
}

export const RenderedCanvas = forwardRef<RenderedCanvasHandle, Props>(
  function RenderedCanvas({ initialHtml, onChange, onShortcut, onReady, readOnly = false, shouldStealFocus = true, onUserInteract }, ref) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null)
    // BUG-032 — read shouldStealFocus through a ref inside `wire()` so
    // toggling focus on/off doesn't tear down the iframe effect. Without
    // this, adding `shouldStealFocus` to the effect's deps array would
    // remount the entire iframe (including srcdoc reload) on every
    // focus change.
    const shouldStealFocusRef = useRef(shouldStealFocus)
    useEffect(() => { shouldStealFocusRef.current = shouldStealFocus }, [shouldStealFocus])
    // BUG-037 — same pattern as shouldStealFocusRef so prop changes
    // don't tear down the iframe effect.
    const onUserInteractRef = useRef(onUserInteract)
    useEffect(() => { onUserInteractRef.current = onUserInteract }, [onUserInteract])

    const getDocument = useCallback((): Document | null => {
      const f = iframeRef.current
      if (!f) return null
      try { return f.contentDocument } catch { return null }
    }, [])

    const serialize = useCallback((): string => {
      const doc = getDocument()
      if (!doc || !doc.documentElement) return ''
      // Stage 17b Phase D — pretty-printed serialization with stable
      // attribute order. See serialize.ts for the formatting contract.
      return serializeDocument(doc)
    }, [getDocument])

    const getIframeElement = useCallback((): HTMLIFrameElement | null => iframeRef.current, [])

    useImperativeHandle(ref, () => ({ getDocument, serialize, getIframeElement }), [getDocument, serialize, getIframeElement])

    // Wire contentEditable + observers + key forwarding once per mount.
    // We do this in the iframe's `load` event because contentDocument
    // isn't fully populated until after load fires, even with srcdoc.
    useEffect(() => {
      const iframe = iframeRef.current
      if (!iframe) return
      let cancelled = false
      let wired = false
      let observer: MutationObserver | null = null
      let keyHandler: ((e: KeyboardEvent) => void) | null = null
      let mouseHandler: ((e: MouseEvent) => void) | null = null
      let cleanForwarder: (() => void) | null = null

      const wire = () => {
        if (cancelled || wired) return
        const doc = iframe.contentDocument
        if (!doc || !doc.body) return
        wired = true

        // Preventative kb-shortcut architecture (BUG-012 et al). Install
        // the forwarder UNCONDITIONALLY (read-only canvases still want
        // ⌘T / ⌘N / ⌃Tab to escape — the readOnly flag only gates
        // editing affordances). Capture-phase listener on the iframe
        // doc inspects each keydown via the shared matcher; matched
        // globals get re-dispatched on the parent doc where
        // `useKeyboardShortcuts` catches them. No bespoke wiring per
        // pane; new global shortcuts get free coverage.
        if (window) cleanForwarder = installGlobalShortcutForwarder(doc, window)

        // BUG-037 / BUG-055 — mousedown forwarder. Same UNCONDITIONAL
        // logic as the global-shortcut forwarder above: read-only
        // canvases ALSO need clicks-into-canvas to flip
        // `focusedColumn` to 'working' (otherwise ⌃Tab / ⌘T after
        // clicking into a read-only canvas like welcome.html target
        // the wrong pane, AND the focus indicator stays on whatever
        // pane the user came from). BUG-055 was the regression: this
        // listener was inside `if (!readOnly)` so canvases mounted
        // with `<meta duo-default-editable="false">` (welcome.html,
        // claude-code-basics, the smoke walk page in canvas mode,
        // etc.) didn't get it. Capture-phase so we see the click
        // before any iframe-side handlers (none today, but keeps it
        // robust to future canvas-authored event handlers calling
        // stopPropagation).
        mouseHandler = () => {
          try { onUserInteractRef.current?.() } catch { /* ignore */ }
        }
        doc.addEventListener('mousedown', mouseHandler, true)

        if (!readOnly) {
          // contentEditable on body. PRD H1 — the canvas IS the page.
          // We mark these as runtime-only via a sentinel attribute so the
          // pretty-printer can strip them from the on-disk serialization.
          // Saving raw <body contenteditable="true" spellcheck="true" …>
          // would leak our editing chrome into a file the user might open
          // in any browser.
          doc.body.setAttribute('contenteditable', 'true')
          doc.body.setAttribute('spellcheck', 'true')
          doc.body.setAttribute('data-duo-canvas-runtime', '1')

          // Visual focus indicator suppressed via a runtime <style> tag
          // (also marked data-duo-canvas-runtime so the serializer skips
          // it), instead of body.style.outline directly — that would
          // mutate any user-authored style="…" on body and leak into the
          // saved file.
          if (!doc.head?.querySelector('style[data-duo-canvas-runtime]')) {
            const style = doc.createElement('style')
            style.setAttribute('data-duo-canvas-runtime', '1')
            // ENH-022 — `.duo-goto-flash` highlight applied for ~1.5s
            // when `duo doc goto --anchor X` lands. Class is added by
            // CanvasTab; this rule keeps the flash inside the iframe
            // scope where parent stylesheets don't reach.
            style.textContent = `
              body { outline: none; }
              .duo-goto-flash { animation: duo-goto-flash-anim 1.5s ease-out; }
              @keyframes duo-goto-flash-anim {
                0%   { background: rgba(248, 229, 156, 0.85); }
                100% { background: transparent; }
              }
            `
            doc.head?.appendChild(style)
          }

          observer = new MutationObserver(() => {
            if (!cancelled) onChange()
          })
          observer.observe(doc, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true
          })

          keyHandler = (e: KeyboardEvent) => {
            // Forward to parent first; parent decides whether to consume.
            if (onShortcut(e)) {
              e.preventDefault()
              e.stopPropagation()
            }
          }
          doc.addEventListener('keydown', keyHandler, true)

          // BUG-037 / BUG-055 — mousedown forwarder moved above the
          // `if (!readOnly)` gate (it now fires unconditionally).
          // Editing-specific install stays here.

          // BUG-022 fix — focus the body when the canvas opens so
          // the first keystroke lands as content (matches the
          // markdown editor's behavior — the user shouldn't have to
          // click into the page before typing). Wrapped in try/catch
          // because some sandboxed iframe states reject focus().
          //
          // BUG-032 — `wire()` re-fires on every iframe `load` event:
          // initial mount, srcdoc changes, HMR re-mounts, post-doc-
          // write reloads. Without a focus gate, those re-fires steal
          // the cursor from a terminal the user has clicked into. The
          // host (CanvasTab) sets `shouldStealFocus = focusedColumn ===
          // 'working'`, so a re-mount under terminal focus stays put.
          if (shouldStealFocusRef.current) {
            try { doc.body.focus() } catch { /* ignore */ }
          }
        } else {
          // BUG-051 — re-mount under `readOnly: true` after a prior
          // mount with `readOnly: false`. The effect re-runs because
          // `readOnly` is in the dep list, but `wire()` only ADDS
          // edit-mode attributes (in the `!readOnly` branch above) and
          // never removes them. Without this branch, toggling
          // off → on → off leaves body with `contenteditable="true"`
          // forever, so the canvas looks read-only (toolbar says so)
          // but clicks still place a cursor and typing still mutates.
          // Explicit revert: drop the attributes, blur the body so a
          // stuck cursor doesn't linger, and the goto-flash <style>
          // (also marked data-duo-canvas-runtime) can stay — the
          // keyframe is harmless when no goto fires.
          if (doc.body.hasAttribute('contenteditable')) {
            doc.body.removeAttribute('contenteditable')
          }
          if (doc.body.hasAttribute('spellcheck')) {
            doc.body.removeAttribute('spellcheck')
          }
          if (doc.body.getAttribute('data-duo-canvas-runtime') === '1') {
            doc.body.removeAttribute('data-duo-canvas-runtime')
          }
          try {
            const active = doc.activeElement as HTMLElement | null
            if (active && typeof active.blur === 'function') active.blur()
          } catch { /* ignore */ }
        }

        // Fire onReady AFTER the body is populated. CanvasTab mounts
        // iframe-side hooks (selectionchange, markdown shortcuts,
        // placeholder overlay, ID-injection probe) here — earlier
        // mounting risks the srcdoc parser wiping our injections.
        // CanvasTab's own readOnly check gates which hooks it installs.
        try { onReady?.(doc) } catch (e) { console.error('[RenderedCanvas] onReady threw:', e) }
      }

      // srcdoc + load timing: try immediately (handles HMR re-mounts
      // where the load event already fired) and listen for load (handles
      // first mount).
      if (iframe.contentDocument && iframe.contentDocument.readyState !== 'loading') {
        wire()
      }
      iframe.addEventListener('load', wire)

      return () => {
        cancelled = true
        observer?.disconnect()
        cleanForwarder?.()
        const doc = iframe.contentDocument
        if (doc && keyHandler) doc.removeEventListener('keydown', keyHandler, true)
        if (doc && mouseHandler) doc.removeEventListener('mousedown', mouseHandler, true)
        iframe.removeEventListener('load', wire)
      }
    }, [onChange, onShortcut, onReady, readOnly])

    return (
      <iframe
        ref={iframeRef}
        // Stage 17a — body width / typography come from the file's own
        // <style>, not from a host stylesheet. Atelier integration (cap,
        // typography) is on the 17b/17e roadmap.
        className="flex-1 w-full h-full bg-white border-0"
        // PRD H4 — never `allow-scripts` in 17a. Scripts are inert until
        // 17e ships the per-file opt-in dialog.
        sandbox="allow-same-origin allow-popups allow-forms"
        srcDoc={initialHtml}
        title="HTML canvas"
      />
    )
  }
)
