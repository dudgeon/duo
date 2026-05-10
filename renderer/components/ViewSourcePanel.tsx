// FOLLOWUP-015 (ENH-117 v2) — read-only "view source" panel-fill.
//
// v1 was a fixed-inset modal overlay. Owner walk-3 (2026-05-09):
// "view source should occupy the full panel … not a modal."
// v2 reshape: this component fills its parent container (flex-1,
// h-full) so the editor / canvas slot it into the same space the
// editor or rendered page would normally render. Toggle in/out via
// chord ⌘⌥V (or Done button); same call sites as v1.
//
// Triggers (all funnel into the same `'duo-view-source'` window event):
//   - ⌘⌥V chord (renderer-side, owned by globalShortcuts.ts)
//   - View → View source menu (electron/main.ts → IPC → renderer)
//   - Tab right-click → View source (electron/main.ts context menu)
//
// Editable view-source (bidi sync to TipTap / canvas) is intentionally
// deferred — needs a CodeMirror integration that's a much bigger
// surface (multi-day vs. half-day). v2 explicitly stays read-only per
// owner pick.

import { useEffect, useRef, useState } from 'react'

interface Props {
  /** The raw source to display (markdown body, HTML pretty-printed, etc.). */
  source: string
  /** Title displayed in the panel header (typically the doc filename). */
  title: string
  /** Called when the user dismisses the panel (Esc, Done button). */
  onClose: () => void
}

export function ViewSourcePanel({ source, title, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Esc to dismiss. Capture-phase so we beat any in-document handler
  // that might react to Escape (e.g. a tab-search palette, a comment
  // composer). The panel is read-only so there's no editable surface
  // inside it that owns Esc legitimately.
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
      console.warn('[ViewSourcePanel] clipboard.writeText failed:', err)
    }
  }

  return (
    <div
      className="flex-1 min-h-0 flex flex-col bg-paper"
      role="region"
      aria-label={`Source: ${title}`}
    >
      <div className="flex items-center justify-between border-b border-paper-rule px-4 py-2 shrink-0">
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
            Done (Esc)
          </button>
        </div>
      </div>
      <pre className="flex-1 overflow-auto p-4 font-mono text-xs text-ink whitespace-pre-wrap break-words m-0">
        {source}
      </pre>
    </div>
  )
}
