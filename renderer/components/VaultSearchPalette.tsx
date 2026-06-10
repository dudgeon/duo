// ENH-208 Phase 2 (D22) — Vault search palette.
//
// `⌘⇧F` opens an overlay-style FULL-TEXT search over the UI-resolved
// vault (default vault first, else the active file's vault — main owns
// the resolution; the renderer only supplies `activePath`). Distinct
// from ⌘⇧A (TabSearchPalette — open tabs) and ⌘O (VaultQuickSwitcher —
// vault filenames): this one searches note CONTENT via the vault IPC
// (window.electron.vault.search → core/vault `search`, the same code
// path as `duo vault search`).
//
// Shell cloned from TabSearchPalette (ENH-080) so the overlays read as
// one product: same backdrop/input/list/footer structure and classes,
// same kbd nav, same WCV overlay-mute treatment at the App level
// (setOverlayMuted).
//
// Results are grouped by file (header = relPath; rows = line number +
// excerpt with the first case-insensitive match highlighted). Enter or
// click hands { hit, matchIndex, query } to App.tsx, which opens the
// file and fires the vaultGotoMatch handoff — the editor jumps to the
// Nth occurrence of the query rather than a disk line number, because
// disk lines don't survive the frontmatter strip (see
// editor/vaultGotoMatch.ts for the contract).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { VaultSearchHitDto } from '@shared/host-api'

export interface VaultSearchPick {
  hit: VaultSearchHitDto
  /** 0-based index of the hit among ITS file's hits, document order —
   *  the vaultGotoMatch occurrence contract. */
  matchIndex: number
  /** The query at pick time (the occurrence scan's needle). */
  query: string
}

export interface VaultSearchPaletteProps {
  /** Whether the palette is currently visible. */
  open: boolean
  /** Active file tab's path, or null when no file tab is active. Main
   *  resolves the vault: default vault first, then this file's
   *  enclosing vault (resolveVaultForUi). */
  activePath: string | null
  /** Picking a hit opens the file + jumps to the match (App.tsx wires
   *  openFileSmart + the vaultGotoMatch handoff). */
  onPick: (pick: VaultSearchPick) => void
  /** Esc / outside-click / programmatic close. */
  onDismiss: () => void
}

/** One file's worth of hits, in response order. */
export interface VaultFileGroup {
  /** relPath of the group's file (the header label). */
  path: string
  absPath: string
  hits: VaultSearchHitDto[]
  /** Flat index of the group's first hit — kbd-nav bookkeeping so the
   *  grouped render can map rows back to the flat active index. */
  startIdx: number
}

/**
 * Group hits by file, preserving response order. core/vault search
 * returns hits ordered by path then line (per-file sequential), so
 * adjacency grouping is exact for real responses.
 *
 * Exported for ENH-208 unit tests (no jsdom needed).
 */
export function groupHitsByFile(hits: VaultSearchHitDto[]): VaultFileGroup[] {
  const groups: VaultFileGroup[] = []
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]
    const last = groups[groups.length - 1]
    if (last && last.absPath === hit.absPath) {
      last.hits.push(hit)
    } else {
      groups.push({ path: hit.path, absPath: hit.absPath, hits: [hit], startIdx: i })
    }
  }
  return groups
}

/**
 * 0-based position of hits[flatIdx] among ITS file's hits. Counts
 * same-file predecessors across the whole flat array (not adjacency),
 * so it stays correct even for a hypothetical interleaved response.
 *
 * Exported for ENH-208 unit tests.
 */
export function matchIndexInFile(hits: VaultSearchHitDto[], flatIdx: number): number {
  let n = 0
  for (let i = 0; i < flatIdx; i++) {
    if (hits[i].absPath === hits[flatIdx].absPath) n++
  }
  return n
}

/** One render segment of an excerpt — `match: true` spans get the
 *  highlight styling. */
export interface ExcerptSegment {
  text: string
  match: boolean
}

/**
 * Split an excerpt around the FIRST case-insensitive occurrence of the
 * query. core/vault search is case-insensitive substring over the raw
 * line, so a real hit always contains the needle — but a no-match
 * input degrades to a single non-match segment rather than throwing
 * (the excerpt is capped at 200 chars upstream, so a match past the
 * cap can legitimately be absent from the visible text).
 *
 * Exported for ENH-208 unit tests.
 */
export function segmentExcerpt(excerpt: string, query: string): ExcerptSegment[] {
  if (!query) return [{ text: excerpt, match: false }]
  const idx = excerpt.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return [{ text: excerpt, match: false }]
  const segments: ExcerptSegment[] = []
  if (idx > 0) segments.push({ text: excerpt.slice(0, idx), match: false })
  segments.push({ text: excerpt.slice(idx, idx + query.length), match: true })
  if (idx + query.length < excerpt.length) {
    segments.push({ text: excerpt.slice(idx + query.length), match: false })
  }
  return segments
}

/**
 * Home-abbreviate a path for the footer ('/Users/g/vault' → '~/vault').
 * Exported for ENH-208 unit tests.
 */
export function abbreviateHome(p: string, home: string): string {
  if (!home) return p
  if (p === home) return '~'
  if (p.startsWith(home + '/')) return '~' + p.slice(home.length)
  return p
}

export function VaultSearchPalette({ open, activePath, onPick, onDismiss }: VaultSearchPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<
    { root: string; hits: VaultSearchHitDto[] } | { error: string } | null
  >(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Stale-response guard — searches resolve out of order when the user
  // types faster than main walks the vault. Each keystroke bumps the
  // seq; only the latest seq may commit its resolution.
  const seqRef = useRef(0)

  // Reset state on open transition. Focus the input when the palette
  // becomes visible (same shape as TabSearchPalette).
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setResult(null)
      setSearching(false)
      // Defer focus to the next tick so the input has actually mounted.
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [open])

  // Debounced (~150ms) async search. Empty query short-circuits to the
  // hint state without an IPC round-trip; the cleanup cancels the
  // not-yet-fired timer on every keystroke so only the trailing edge
  // searches.
  useEffect(() => {
    if (!open) return
    if (!query.trim()) {
      seqRef.current++
      setResult(null)
      setSearching(false)
      return
    }
    const seq = ++seqRef.current
    setSearching(true)
    const timer = setTimeout(() => {
      void (async () => {
        const res = await window.electron.vault.search({ query, activePath, limit: 100 })
        if (seq !== seqRef.current) return // stale — a newer keystroke owns the UI
        setSearching(false)
        if (res.ok) {
          setResult({ root: res.root, hits: res.hits })
        } else {
          setResult({ error: res.error })
        }
        setActiveIdx(0)
      })()
    }, 150)
    return () => clearTimeout(timer)
  }, [open, query, activePath])

  const hits = result && 'hits' in result ? result.hits : []
  const groups = useMemo(() => groupHitsByFile(hits), [hits])

  // Clamp the active index when the hit list shrinks.
  useEffect(() => {
    if (activeIdx >= hits.length) {
      setActiveIdx(Math.max(0, hits.length - 1))
    }
  }, [hits.length, activeIdx])

  if (!open) return null

  const pick = (flatIdx: number) => {
    const hit = hits[flatIdx]
    if (!hit) return
    onPick({ hit, matchIndex: matchIndexInFile(hits, flatIdx), query })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(hits.length - 1, i + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      pick(activeIdx)
      return
    }
  }

  const onBackdropClick = (e: React.MouseEvent) => {
    // Only dismiss on backdrop click — clicks inside the palette body
    // shouldn't bubble out and close it.
    if (e.target === e.currentTarget) onDismiss()
  }

  const root = result && 'root' in result ? result.root : null
  const error = result && 'error' in result ? result.error : null
  const home = window.electron.env.HOME || ''

  const renderBody = () => {
    if (!query.trim()) {
      return <li className="px-4 py-3 text-ink-mute text-sm">Type to search the vault&apos;s notes (full text, case-insensitive).</li>
    }
    if (error) {
      // {ok:false} — the IPC error already explains how to set a
      // default vault (Settings → Default Vault), so show it verbatim.
      return <li className="px-4 py-3 text-ink-mute text-sm whitespace-pre-wrap">{error}</li>
    }
    if (hits.length === 0) {
      if (searching || !result) {
        return <li className="px-4 py-3 text-ink-mute text-sm">Searching…</li>
      }
      return <li className="px-4 py-3 text-ink-mute text-sm">No matches.</li>
    }
    return groups.map((group) => (
      <li key={group.absPath}>
        <div className="px-4 pt-2 pb-1 text-xs font-medium text-ink-mute truncate" title={group.path}>
          {group.path}
        </div>
        <ul>
          {group.hits.map((hit, j) => {
            const flatIdx = group.startIdx + j
            const active = flatIdx === activeIdx
            return (
              <li
                key={hit.line + ':' + j}
                onMouseDown={(e) => {
                  // mousedown not click — fires before blur on the input,
                  // so the palette doesn't dismiss-on-blur before pick fires.
                  e.preventDefault()
                  pick(flatIdx)
                }}
                onMouseEnter={() => setActiveIdx(flatIdx)}
                className={[
                  'px-4 py-1.5 cursor-pointer flex items-baseline gap-3',
                  active ? 'bg-accent text-white' : 'hover:bg-surface-2'
                ].join(' ')}
              >
                <span className={[
                  'shrink-0 w-8 text-right text-xs tabular-nums',
                  active ? 'text-white/70' : 'text-ink-mute'
                ].join(' ')}>
                  {hit.line}
                </span>
                <span className="truncate text-sm">
                  {segmentExcerpt(hit.excerpt, query).map((seg, k) =>
                    seg.match ? (
                      <span key={k} className={['font-semibold', active ? 'underline' : 'text-accent'].join(' ')}>
                        {seg.text}
                      </span>
                    ) : (
                      <span key={k}>{seg.text}</span>
                    )
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      </li>
    ))
  }

  return (
    <div
      onClick={onBackdropClick}
      className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Vault search"
    >
      <div className="w-[560px] max-w-[90vw] bg-surface-1 rounded-md shadow-2xl border border-paper-rule overflow-hidden">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search vault notes… (⌘⇧F)"
          className="w-full px-4 py-3 bg-transparent border-b border-paper-rule outline-none text-ink placeholder:text-ink-mute"
          autoComplete="off"
          spellCheck={false}
          data-vault-search-input="1"
        />
        <ul className="max-h-[50vh] overflow-y-auto">
          {renderBody()}
        </ul>
        <div className="px-4 py-2 text-xs text-ink-mute border-t border-paper-rule bg-surface-0 flex justify-between gap-3">
          <span className="shrink-0">↑↓ to navigate · Enter to open · Esc to dismiss</span>
          <span className="truncate">
            {searching
              ? 'Searching…'
              : root
              ? 'Vault: ' + abbreviateHome(root, home) + (hits.length > 0 ? ' · ' + hits.length + (hits.length === 1 ? ' match' : ' matches') : '')
              : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
