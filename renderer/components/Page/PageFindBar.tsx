// BUG-126 — canvas-mode find bar.
//
// Parallel to renderer/components/editor/FindBar.tsx (the markdown
// editor's find UI). This one operates against an iframe contentDocument
// via the pageFind helpers. CSS Custom Highlight API does the visual
// work; no DOM mutation inside the user's HTML.
//
// Keyboard inside the find input (capture-phase so the global shortcut
// matcher doesn't pre-empt):
//   - ↩      → next match
//   - ⇧↩     → previous match
//   - ↓ / ↑  → next / previous match
//   - ⎋      → close the bar
//   - ⌘F     → re-focus + select-all (Chrome parity)
//   - ⌘G     → next match
//   - ⌘⇧F    → previous match

import { useEffect, useRef, useState, useMemo } from 'react'
import {
  findMatchesInDoc,
  paintHighlights,
  clearHighlights,
  scrollToCurrent,
  installFindStyles,
  isHighlightSupported,
  type FindMatchRange
} from './pageFind'

interface Props {
  /** Live iframe element. Null when iframe hasn't mounted yet. */
  iframe: HTMLIFrameElement | null
  open: boolean
  onClose: () => void
  /** Bump this when the iframe's contentDocument has been replaced
   *  (e.g. canvas reload). Forces a re-search against the fresh doc. */
  reloadTick?: number
}

export function PageFindBar({ iframe, open, onClose, reloadTick = 0 }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<FindMatchRange[]>([])
  const [current, setCurrent] = useState(-1)

  const doc = iframe?.contentDocument ?? null
  const win = iframe?.contentWindow ?? null
  const supported = useMemo(
    () => (win ? isHighlightSupported(win) : false),
    [win]
  )

  // Focus + select on open. Re-select on subsequent ⌘F.
  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [open])

  // Install highlight CSS in the iframe doc when it changes (or on
  // reload). Idempotent.
  useEffect(() => {
    if (!open || !doc) return
    installFindStyles(doc)
  }, [open, doc, reloadTick])

  // Re-run search whenever query, open state, doc, or reload tick
  // changes. Clearing query → clear highlights immediately.
  useEffect(() => {
    if (!open || !doc || !win) {
      if (win) clearHighlights(win)
      setMatches([])
      setCurrent(-1)
      return
    }
    if (!query) {
      clearHighlights(win)
      setMatches([])
      setCurrent(-1)
      return
    }
    const found = findMatchesInDoc(doc, query)
    setMatches(found)
    const next = found.length > 0 ? 0 : -1
    setCurrent(next)
    paintHighlights(win, doc, { matches: found, current: next })
    if (next >= 0) scrollToCurrent(doc, { matches: found, current: next })
  }, [open, doc, win, query, reloadTick])

  // Clean up when the bar closes.
  useEffect(() => {
    if (!open && win) clearHighlights(win)
  }, [open, win])

  // Re-paint when `current` changes without a re-search.
  useEffect(() => {
    if (!open || !doc || !win || matches.length === 0) return
    paintHighlights(win, doc, { matches, current })
    if (current >= 0) scrollToCurrent(doc, { matches, current })
  }, [current, matches, open, doc, win])

  if (!open) return null

  const total = matches.length
  const counterLabel = total === 0
    ? (query ? '0/0' : '')
    : `${current + 1}/${total}`

  const goNext = () => {
    if (matches.length === 0) return
    setCurrent(i => (i + 1) % matches.length)
  }
  const goPrev = () => {
    if (matches.length === 0) return
    setCurrent(i => (i - 1 + matches.length) % matches.length)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      e.stopPropagation()
      inputRef.current?.select()
      return
    }
    if (e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      e.stopPropagation()
      goPrev()
      return
    }
    if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      e.stopPropagation()
      goNext()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (e.shiftKey) goPrev()
      else goNext()
      return
    }
    if (e.key === 'ArrowDown' && !e.metaKey && !e.altKey && !e.ctrlKey) {
      e.preventDefault()
      e.stopPropagation()
      goNext()
      return
    }
    if (e.key === 'ArrowUp' && !e.metaKey && !e.altKey && !e.ctrlKey) {
      e.preventDefault()
      e.stopPropagation()
      goPrev()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-paper-edge bg-paper-deep shrink-0"
      data-duo-findbar="page"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={supported ? 'Find in canvas' : 'Find not supported in this Chromium build'}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        disabled={!supported}
        className="flex-1 min-w-0 px-2 py-0.5 text-[12px] bg-paper border border-paper-rule rounded text-ink placeholder-ink-ghost outline-none focus:border-accent disabled:opacity-50"
      />
      <span className="shrink-0 text-[11px] text-ink-mute tabular-nums min-w-[44px] text-right">
        {counterLabel}
      </span>
      <button
        type="button"
        onClick={goPrev}
        disabled={total === 0}
        title="Previous match (⌘⇧F)"
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-ink-mute hover:text-ink hover:bg-paper-edge disabled:opacity-30 disabled:hover:bg-transparent"
      >
        ▲
      </button>
      <button
        type="button"
        onClick={goNext}
        disabled={total === 0}
        title="Next match (⌘G)"
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-ink-mute hover:text-ink hover:bg-paper-edge disabled:opacity-30 disabled:hover:bg-transparent"
      >
        ▼
      </button>
      <button
        type="button"
        onClick={onClose}
        title="Close (⎋)"
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-ink-mute hover:text-ink hover:bg-paper-edge"
      >
        ✕
      </button>
    </div>
  )
}
