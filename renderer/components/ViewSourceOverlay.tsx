// ENH-117 — read-only "view source" overlay.
//
// Triggered by ⌘⌥V on the active editor (markdown source) or canvas
// (pretty-printed HTML). Shows the raw source in a monospaced block
// with a Copy button. Esc dismisses; click outside dismisses.
//
// V1 is read-only. Editable view-source (live two-way sync) is a
// much bigger surface (would need CodeMirror integration with bidi
// sync to TipTap) and is intentionally deferred.

import { useEffect, useRef, useState } from 'react'

interface Props {
  /** The raw source to display (markdown body, HTML pretty-printed, etc.). */
  source: string
  /** Title displayed in the overlay header (typically the doc filename). */
  title: string
  /** Called when the user dismisses the overlay (Esc, backdrop click, Close button). */
  onClose: () => void
}

export function ViewSourceOverlay({ source, title, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Esc to dismiss. Capture-phase so we beat any in-overlay handler.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(source)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch (err) {
      console.warn('[ViewSourceOverlay] clipboard.writeText failed:', err)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        // Backdrop click dismisses. e.target === currentTarget means
        // the click landed on the backdrop itself, not on a descendant.
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-label={`Source: ${title}`}
    >
      <div className="bg-paper border border-paper-rule rounded-md shadow-2xl w-[80vw] max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-paper-rule px-4 py-2">
          <div className="font-serif italic text-sm text-ink-mute">Source · {title}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1 text-xs rounded border border-paper-rule hover:bg-paper-deep"
              onClick={onCopy}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button
              type="button"
              className="px-3 py-1 text-xs rounded border border-paper-rule hover:bg-paper-deep"
              onClick={onClose}
            >
              Close (Esc)
            </button>
          </div>
        </div>
        <pre className="flex-1 overflow-auto p-4 font-mono text-xs text-ink whitespace-pre-wrap break-words m-0">
          {source}
        </pre>
      </div>
    </div>
  )
}
