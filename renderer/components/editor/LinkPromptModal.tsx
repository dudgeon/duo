// BUG-137 walk-3 follow-up — replacement for `window.prompt('Link URL')`.
// Electron's renderer throws `prompt() is and will not be supported`
// on every call, so the toolbar link button + ⌘K were silently no-ops
// (the throw was unhandled; the user saw nothing). This modal stands
// in for window.prompt with the same shape: a small dialog with an
// input + Save/Cancel, resolving a Promise<string | null>.
//
// Mounted once at the App level (next to CloneModal). Callers use
// `requestLinkPrompt(currentHref)` to open it.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const REQUEST_EVENT = 'duo-link-prompt-request'

interface PromptDetail {
  current: string
  resolve: (value: string | null) => void
}

/** Public helper. Returns a Promise that resolves on Save (with the
 *  URL string) or Cancel (with null). Same contract as window.prompt
 *  except never throws. */
export function requestLinkPrompt(current: string): Promise<string | null> {
  return new Promise((resolve) => {
    const detail: PromptDetail = { current, resolve }
    window.dispatchEvent(new CustomEvent<PromptDetail>(REQUEST_EVENT, { detail }))
  })
}

export function LinkPromptModal() {
  const [active, setActive] = useState<PromptDetail | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Subscribe once on mount.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PromptDetail>).detail
      if (!detail) return
      setActive(detail)
      setValue(detail.current)
    }
    window.addEventListener(REQUEST_EVENT, handler)
    return () => window.removeEventListener(REQUEST_EVENT, handler)
  }, [])

  // Focus + select-all on open.
  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    }, 0)
    return () => clearTimeout(t)
  }, [active])

  if (!active) return null

  const close = (result: string | null) => {
    active.resolve(result)
    setActive(null)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-duo-link-prompt="1"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(null)
      }}
    >
      <div className="bg-surface-2 border border-border rounded-lg shadow-xl w-[420px] max-w-[90vw] p-4 flex flex-col gap-3">
        <div className="text-xs uppercase tracking-wider text-zinc-500">Link URL</div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              close(value)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              close(null)
            }
          }}
          placeholder="https://…"
          className="w-full bg-surface-1 border border-border rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-accent/60"
          data-duo-link-prompt-input="1"
        />
        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 rounded hover:bg-surface-3"
            onMouseDown={(e) => {
              e.preventDefault()
              close(null)
            }}
          >
            Cancel
          </button>
          {value.trim() !== '' && (
            <button
              type="button"
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-rose-400 rounded hover:bg-surface-3"
              onMouseDown={(e) => {
                e.preventDefault()
                close('')
              }}
              title="Remove the link mark"
            >
              Remove link
            </button>
          )}
          <button
            type="button"
            className="px-3 py-1.5 text-xs bg-accent hover:bg-accent/85 text-white rounded font-medium"
            onMouseDown={(e) => {
              e.preventDefault()
              close(value)
            }}
          >
            Save
          </button>
        </div>
        <div className="text-[10px] text-zinc-500">
          Enter to save · Esc to cancel · empty + Save removes the link
        </div>
      </div>
    </div>,
    document.body
  )
}
