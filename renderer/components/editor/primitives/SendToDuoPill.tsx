// Stage 15.1 — Send → Duo pill (editor-agnostic primitive).
//
// Floating affordance that appears next to a user selection in any
// host surface (markdown editor today; HTML canvas in Stage 17;
// browser pane in Stage 15.2). One click pipes the formatted payload
// into the active terminal — the host owns that wire, the primitive
// owns the chrome.
//
// Pure visual layer — no editor imports, no IPC. The host computes a
// DOMRect for the selection and an `onClick` callback; this component
// places the pill 6px above the rect (falls back below if there's no
// room above), right-aligns to the rect, and clamps to the viewport.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Minimum geometry the pill needs to anchor itself: viewport-relative
 * top/bottom/right of the selection's bounding box. `DOMRect` is
 * structurally compatible (the editor passes one verbatim from
 * `Selection.getRangeAt(0).getBoundingClientRect()`); the browser
 * surface (Stage 15.2) constructs one by translating the page-side
 * rect through the WebContentsView's screen bounds, since DOMRect
 * isn't constructable in renderer code that hasn't run inside a real
 * page.
 */
export interface PillAnchorRect {
  top: number
  bottom: number
  right: number
}

export interface SendToDuoPillProps {
  /** Bounding rect of the user's current selection in viewport
   *  coordinates. `null` hides the pill. */
  rect: PillAnchorRect | null
  /** Click handler — host formats the payload and writes it to the
   *  active terminal's PTY. */
  onClick: () => void
  /** Optional label override (default: "Send → Duo"). */
  label?: string
}

const PILL_OFFSET_PX = 6
const VIEWPORT_PAD_PX = 8

interface ComputedPos {
  top: number
  left: number
  /** Whether the pill is rendered above the rect (default) or below it
   *  (fallback when there's no room above). Used to flip the arrow. */
  placement: 'above' | 'below'
}

function computePosition(rect: PillAnchorRect, pillSize: { width: number; height: number }): ComputedPos {
  const placeAbove = rect.top - pillSize.height - PILL_OFFSET_PX >= VIEWPORT_PAD_PX
  const top = placeAbove
    ? rect.top - pillSize.height - PILL_OFFSET_PX
    : rect.bottom + PILL_OFFSET_PX
  // Right-align to selection's right edge; clamp to viewport.
  const rawLeft = rect.right - pillSize.width
  const maxLeft = window.innerWidth - pillSize.width - VIEWPORT_PAD_PX
  const left = Math.max(VIEWPORT_PAD_PX, Math.min(rawLeft, maxLeft))
  return { top, left, placement: placeAbove ? 'above' : 'below' }
}

export function SendToDuoPill({ rect, onClick, label = 'Send → Duo' }: SendToDuoPillProps) {
  // Measure the pill once it mounts so we can position it precisely.
  // Default size is a reasonable estimate so first paint isn't misplaced
  // by more than a few pixels.
  const [pillSize, setPillSize] = useState({ width: 96, height: 24 })

  // Re-measure on rect changes — selection-padding can change typography
  // and we want the right edge tight against the selection's right.
  useEffect(() => {
    if (!rect) return
    const node = document.querySelector<HTMLButtonElement>('.duo-send-pill')
    if (node) {
      const r = node.getBoundingClientRect()
      // Only update if dimensions changed by more than 1px to avoid
      // the loop where a re-render → re-measure → re-render → …
      if (Math.abs(r.width - pillSize.width) > 1 || Math.abs(r.height - pillSize.height) > 1) {
        setPillSize({ width: r.width, height: r.height })
      }
    }
  }, [rect, pillSize.width, pillSize.height])

  if (!rect) return null

  const { top, left, placement } = computePosition(rect, pillSize)

  return createPortal(
    <button
      type="button"
      className={`duo-send-pill duo-send-pill--${placement}`}
      // mousedown — not click — so the editor doesn't blur first and
      // collapse the selection before the click registers.
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`
      }}
      aria-label={label}
    >
      <span className="duo-send-pill__label">{label}</span>
      <span className="duo-send-pill__arrow" aria-hidden="true">↗</span>
    </button>,
    document.body
  )
}
