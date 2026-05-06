// ENH-080 — Tab-search palette.
//
// `⌘⇧A` opens an overlay-style fuzzy search across all tabs in the
// working strip (file tabs + browser tabs). Type to filter, arrow
// keys to navigate the result list, Enter to switch focus to the
// chosen tab, Esc to dismiss.
//
// v1 architecture per the research at
// `docs/prd/canvas-tab-search-research.md` § Option B (renderer
// overlay + WCV mute pattern). The native-child-window option (A)
// is queued for v2 if the WCV-mute flicker bothers users; v1 ships
// the simpler renderer-only path.
//
// WCV occlusion handling: the palette host shrinks the active
// browser tab's WebContentsView bounds to 1×1 while the palette is
// open, then restores them on close. This is the same "mute" pattern
// pre-NSMenu context menus used (BUG-058) and is well-trodden.

import { useEffect, useMemo, useRef, useState } from 'react'

export interface TabSearchEntry {
  /** Tab id — the renderer-side `b:<n>` / `f:<uuid>` form. */
  id: string
  /** Display title (file basename, or browser tab title). */
  title: string
  /** Subtitle (browser URL, or absolute path). Optional. */
  subtitle?: string
  /** Tab kind for the icon. Accepts the `WorkingTabType` union plus
   *  `'browser'` for browser tabs. Unknown kinds fall back to a
   *  generic glyph. */
  kind: string
}

export interface TabSearchPaletteProps {
  /** Whether the palette is currently visible. */
  open: boolean
  /** Full list of tabs to search across. Filtered by the user's query. */
  entries: TabSearchEntry[]
  /** Picking a result should switch focus to it (App.tsx wires the
   *  setActiveWorking call). */
  onPick: (entry: TabSearchEntry) => void
  /** Esc / outside-click / programmatic close. */
  onDismiss: () => void
}

/**
 * Score a tab entry against the user's query. Simple substring +
 * prefix match — fuzzy matching can come in v2 if v1 feels lacking.
 *
 * Returns -1 when no match. Higher scores rank first.
 *
 * Exported for ENH-080 unit tests.
 */
export function scoreEntry(entry: TabSearchEntry, q: string): number {
  if (!q) return 0
  const haystackTitle = entry.title.toLowerCase()
  const haystackSubtitle = (entry.subtitle ?? '').toLowerCase()
  const needle = q.toLowerCase()
  // Exact title match wins
  if (haystackTitle === needle) return 1000
  // Title starts with query
  if (haystackTitle.startsWith(needle)) return 500
  // Title contains query
  const titleIdx = haystackTitle.indexOf(needle)
  if (titleIdx >= 0) return 200 - titleIdx // earlier = higher
  // Subtitle contains query
  const subIdx = haystackSubtitle.indexOf(needle)
  if (subIdx >= 0) return 50 - subIdx
  return -1
}

export function TabSearchPalette({ open, entries, onPick, onDismiss }: TabSearchPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Filter + sort by score.
  const results = useMemo(() => {
    if (!query) return entries
    const scored = entries
      .map((e) => ({ entry: e, score: scoreEntry(e, query) }))
      .filter((s) => s.score >= 0)
      .sort((a, b) => b.score - a.score)
    return scored.map((s) => s.entry)
  }, [entries, query])

  // Reset state on open transition. Focus the input when the palette
  // becomes visible.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      // Defer focus to the next tick so the input has actually mounted.
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [open])

  // Clamp the active index when results shrink.
  useEffect(() => {
    if (activeIdx >= results.length) {
      setActiveIdx(Math.max(0, results.length - 1))
    }
  }, [results.length, activeIdx])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(results.length - 1, i + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = results[activeIdx]
      if (chosen) onPick(chosen)
      return
    }
  }

  const onBackdropClick = (e: React.MouseEvent) => {
    // Only dismiss on backdrop click — clicks inside the palette body
    // shouldn't bubble out and close it.
    if (e.target === e.currentTarget) onDismiss()
  }

  return (
    <div
      onClick={onBackdropClick}
      className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Tab search"
    >
      <div className="w-[560px] max-w-[90vw] bg-surface-1 rounded-md shadow-2xl border border-paper-rule overflow-hidden">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search open tabs… (⌘⇧A)"
          className="w-full px-4 py-3 bg-transparent border-b border-paper-rule outline-none text-ink placeholder:text-ink-mute"
          autoComplete="off"
          spellCheck={false}
          data-tab-search-input="1"
        />
        <ul className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 ? (
            <li className="px-4 py-3 text-ink-mute text-sm">No matching tabs.</li>
          ) : (
            results.map((entry, i) => (
              <li
                key={entry.id}
                onMouseDown={(e) => {
                  // mousedown not click — fires before blur on the input,
                  // so the palette doesn't dismiss-on-blur before pick fires.
                  e.preventDefault()
                  onPick(entry)
                }}
                onMouseEnter={() => setActiveIdx(i)}
                className={[
                  'px-4 py-2 cursor-pointer flex items-center gap-3',
                  i === activeIdx ? 'bg-accent text-white' : 'hover:bg-surface-2'
                ].join(' ')}
              >
                <KindGlyph kind={entry.kind} active={i === activeIdx} />
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="truncate text-sm font-medium">{entry.title}</span>
                  {entry.subtitle && (
                    <span className={[
                      'truncate text-xs',
                      i === activeIdx ? 'text-white/70' : 'text-ink-mute'
                    ].join(' ')}>
                      {entry.subtitle}
                    </span>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
        <div className="px-4 py-2 text-xs text-ink-mute border-t border-paper-rule bg-surface-0 flex justify-between">
          <span>↑↓ to navigate · Enter to switch · Esc to dismiss</span>
          <span>{results.length} {results.length === 1 ? 'tab' : 'tabs'}</span>
        </div>
      </div>
    </div>
  )
}

function KindGlyph({ kind, active }: { kind: string; active: boolean }) {
  const symbol = (() => {
    switch (kind) {
      case 'editor': return '📝'
      case 'page': return '🔗'
      case 'browser': return '🌐'
      case 'image': return '🖼'
      case 'pdf': return '📄'
      default: return '📁'
    }
  })()
  // Use fontSize directly — Tailwind's text-* sizes don't grow these
  // glyphs well on Retina.
  return <span className={active ? 'opacity-100' : 'opacity-70'} style={{ fontSize: 16 }}>{symbol}</span>
}
