// Tiny reusable context menu. Absolutely-positioned fixed to the viewport
// at `position`, closes on outside click / Escape / any item activation.
//
// BUG-050 (v0.5.5) — portaled to document.body. Was previously rendered
// inline at the call site, which meant it inherited any ancestor stacking
// context (e.g. an `overflow-x-auto` strip or a TipTap editor's internal
// stacking context). Inline rendering caused right-click on a markdown
// editor tab to drop the menu BEHIND the editor canvas — same visual
// failure as BUG-045 / BUG-047 but a different root cause (renderer-DOM
// stacking, not WCV native subview compositing). Portal escapes all
// ancestor stacking contexts.
//
// BUG-029 — flip-aware positioning: after first paint, measure the menu's
// natural size and adjust the position upward / leftward if it would
// overflow the viewport bottom or right edge. The pattern is render-
// then-correct (vs. measure-then-render): the first paint may flicker
// at the click position before snapping into the flipped slot, but it
// avoids a hidden-measure pre-pass and keeps the component synchronous.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
  /** If true, renders a divider ABOVE this item. */
  separatorBefore?: boolean
}

interface ContextMenuProps {
  position: { x: number; y: number }
  items: ContextMenuItem[]
  onClose: () => void
}

const VIEWPORT_GUTTER = 4 // px — keep some breathing room from window edges

export function ContextMenu({ position, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [adjusted, setAdjusted] = useState<{ x: number; y: number }>(position)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // BUG-029 — after first paint, flip up/left when menu overflows viewport.
  // useLayoutEffect runs synchronously after DOM mutation, before browser
  // paints, so the user sees the corrected position on the first frame in
  // most cases.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let x = position.x
    let y = position.y
    if (y + rect.height + VIEWPORT_GUTTER > window.innerHeight) {
      // Flip upward: anchor bottom edge to click point.
      y = Math.max(VIEWPORT_GUTTER, position.y - rect.height)
    }
    if (x + rect.width + VIEWPORT_GUTTER > window.innerWidth) {
      x = Math.max(VIEWPORT_GUTTER, position.x - rect.width)
    }
    if (x !== adjusted.x || y !== adjusted.y) {
      setAdjusted({ x, y })
    }
    // `position` change forces a re-measure when the same menu re-opens at
    // a new spot. `items.length` covers menu-content swaps. `adjusted`
    // intentionally not in deps — would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position.x, position.y, items.length])

  // BUG-050 — portal to document.body so the menu escapes all ancestor
  // stacking contexts (overflow:auto strips, TipTap editor regions, etc.)
  // and reliably layers above the rest of renderer-DOM.
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[1000] min-w-[180px] py-1 rounded bg-surface-2 border border-border shadow-xl text-[12px] text-zinc-200"
      style={{ left: adjusted.x, top: adjusted.y }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separatorBefore && (
            <div className="my-1 h-px bg-border/60" />
          )}
          <button
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              onClose()
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-default transition-colors"
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
