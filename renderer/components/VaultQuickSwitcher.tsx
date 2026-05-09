// Sprint 11 ENH-096 B.4 — `⌘O` vault quick switcher.
//
// Renderer-overlay shell that fuzzy-matches across the entire vault
// root (not just open tabs — that's `⌘⇧A` / TabSearchPalette). Same
// vault index source as the WikilinkSuggestion / AtMention popovers
// (vaultIndex.ts), but a different UI shell because:
//   1. Not anchored to a caret position (centered overlay).
//   2. Opens via global chord, not text trigger.
//   3. Selection invokes `openFileSmart`, not text insertion.
//
// Mirrors the visual shape of TabSearchPalette (ENH-080 § ⌘⇧A) so
// the two overlays read as one product. Phase-3c BUG-095 etc. apply
// the same overlay-mute pattern at the WCV level (`setOverlayMuted`).

import { useEffect, useMemo, useRef, useState } from 'react'
import { rankVaultFiles } from './editor/vaultIndex'
import type { VaultFile } from './editor/wikilinkResolver'

export interface VaultQuickSwitcherProps {
  /** Whether the overlay is currently visible. */
  open: boolean
  /** Full vault file list (computed by the host via useVaultIndex
   *  on the active file's path). */
  files: VaultFile[]
  /** True while the host's vault walk is in flight — drives the
   *  empty-state hint while the index is initializing. */
  loading: boolean
  /** Detected vault root, or null if no `.obsidian/` was found from
   *  the active path. Used for the empty-state messaging when the
   *  user fires ⌘O outside a vault. */
  vaultRoot: string | null
  /** Picking a result opens the file via openFileSmart. The host
   *  wires this. */
  onPick: (file: VaultFile) => void
  /** Esc / outside-click / programmatic close. */
  onDismiss: () => void
}

const MAX_ROWS_VISIBLE = 50

export function VaultQuickSwitcher({
  open, files, loading, vaultRoot, onPick, onDismiss
}: VaultQuickSwitcherProps) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const results = useMemo(() => rankVaultFiles(files, query, MAX_ROWS_VISIBLE), [files, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      requestAnimationFrame(() => { inputRef.current?.focus() })
    }
  }, [open])

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
      const picked = results[activeIdx]
      if (picked) onPick(picked)
      return
    }
  }

  // Empty state messaging — three branches:
  //   1. Loading initial walk (vault root known, files empty).
  //   2. Outside any vault (no `.obsidian/` ancestor).
  //   3. Empty query in a known vault — render the full file list
  //      sorted alphabetically (rankVaultFiles handles this).
  const renderBody = () => {
    if (!vaultRoot) {
      return <div className="duo-qs-empty">Open a file inside a vault (a directory with <code>.obsidian/</code>) to use ⌘O.</div>
    }
    if (loading && files.length === 0) {
      return <div className="duo-qs-empty">Searching vault…</div>
    }
    if (results.length === 0) {
      return <div className="duo-qs-empty">No matches in this vault.</div>
    }
    return (
      <ul className="duo-qs-list" role="listbox" aria-label="Vault files">
        {results.map((file, idx) => (
          <li
            key={file.absPath}
            role="option"
            aria-selected={idx === activeIdx}
            className={['duo-qs-item', idx === activeIdx ? 'is-active' : ''].join(' ')}
            onMouseDown={(e) => { e.preventDefault(); onPick(file) }}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <span className="duo-qs-basename">{file.basename}</span>
            <span className="duo-qs-relpath">{file.relPath}</span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="duo-qs-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onDismiss() }}>
      <div className="duo-qs-shell" role="dialog" aria-label="Vault quick switcher">
        <div className="duo-qs-header">
          <input
            ref={inputRef}
            type="text"
            className="duo-qs-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={vaultRoot ? `Search vault — ${vaultRoot.slice(vaultRoot.lastIndexOf('/') + 1)}` : 'Search vault…'}
            aria-label="Vault search query"
          />
        </div>
        {renderBody()}
        <div className="duo-qs-footer">
          ↑↓ navigate · Enter open · Esc dismiss
        </div>
      </div>
    </div>
  )
}
