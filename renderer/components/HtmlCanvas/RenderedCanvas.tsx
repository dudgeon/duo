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
}

export interface RenderedCanvasHandle {
  /** Returns the iframe's contentDocument, or null if not yet mounted /
   *  cross-origin (shouldn't happen with srcdoc). */
  getDocument: () => Document | null
  /** Serializes the current iframe DOM back to an HTML string (saved
   *  to disk as-is for 17a; pretty-printer lands in 17b/e). */
  serialize: () => string
}

export const RenderedCanvas = forwardRef<RenderedCanvasHandle, Props>(
  function RenderedCanvas({ initialHtml, onChange, onShortcut }, ref) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null)

    const getDocument = useCallback((): Document | null => {
      const f = iframeRef.current
      if (!f) return null
      try { return f.contentDocument } catch { return null }
    }, [])

    const serialize = useCallback((): string => {
      const doc = getDocument()
      if (!doc || !doc.documentElement) return ''
      // Match the canonical doctype shipped by the boilerplate; doctype
      // doesn't survive contentDocument.documentElement.outerHTML.
      const dt = doc.doctype
        ? `<!DOCTYPE ${doc.doctype.name}${doc.doctype.publicId ? ` PUBLIC "${doc.doctype.publicId}"` : ''}${doc.doctype.systemId ? ` "${doc.doctype.systemId}"` : ''}>`
        : '<!doctype html>'
      return `${dt}\n${doc.documentElement.outerHTML}\n`
    }, [getDocument])

    useImperativeHandle(ref, () => ({ getDocument, serialize }), [getDocument, serialize])

    // Wire contentEditable + observers + key forwarding once per mount.
    // We do this in the iframe's `load` event because contentDocument
    // isn't fully populated until after load fires, even with srcdoc.
    useEffect(() => {
      const iframe = iframeRef.current
      if (!iframe) return
      let cancelled = false
      let observer: MutationObserver | null = null
      let keyHandler: ((e: KeyboardEvent) => void) | null = null

      const wire = () => {
        if (cancelled) return
        const doc = iframe.contentDocument
        if (!doc || !doc.body) return

        // contentEditable on body. PRD H1 — the canvas IS the page.
        doc.body.setAttribute('contenteditable', 'true')
        doc.body.setAttribute('spellcheck', 'true')
        // Visual focus indicator on the body itself is suppressed; the
        // selection is the affordance.
        ;(doc.body.style as CSSStyleDeclaration).outline = 'none'

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
        const doc = iframe.contentDocument
        if (doc && keyHandler) doc.removeEventListener('keydown', keyHandler, true)
        iframe.removeEventListener('load', wire)
      }
    }, [onChange, onShortcut])

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
