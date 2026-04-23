// Tiny reusable context menu. Absolutely-positioned fixed to the viewport
// at `position`, closes on outside click / Escape / any item activation.
// Portal-free (just renders in place) — consumers should render it
// conditionally based on their own open/closed state.

import { useEffect, useRef } from 'react'

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

export function ContextMenu({ position, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

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

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[180px] py-1 rounded bg-surface-2 border border-border shadow-xl text-[12px] text-zinc-200"
      style={{ left: position.x, top: position.y }}
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
    </div>
  )
}
