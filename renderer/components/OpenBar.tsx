// ENH-221 D1/D15/D18 — the merged Open bar (the ⌘O surface).
//
// ONE progressive overlay that SUBSUMES the old VaultQuickSwitcher (D18):
//
//   • empty            → Open Recent (D14) + a Browse… button (D17).
//   • a bare token     → vault fuzzy-find (the old ⌘O behavior, preserved).
//   • a path / URL     → resolver classification + a single Open action.
//   • a GitHub file URL→ the file-vs-repo choice (D19): "just this doc" is
//                        disabled ("Soon" — the round-trip is DR-blocked);
//                        "clone the whole repo" routes to the clone flow.
//   • a GitHub repo URL→ Clone <owner>/<repo> → the clone flow.
//
// Routing is delegated to the host via a single `onOpenTarget(rawTarget)`
// callback (App.tsx classifies → FS-checks → opens/clones → records the
// recent), so the bar, the File ▸ Open Recent menu, and `duo open` all share
// one open path. The bar owns only its own chrome + the Browse / recents IPC.
//
// Visual language mirrors VaultQuickSwitcher + TabSearchPalette (the
// `duo-qs-*` classes) so the overlays read as one product; the new
// affordances add a small `duo-ob-*` set.

import { useEffect, useMemo, useRef, useState } from 'react'
import { rankVaultFiles } from './editor/vaultIndex'
import type { VaultFile } from './editor/wikilinkResolver'
import { resolveOpenTarget } from '../../core/open-resolve'
import type { OpenTarget } from '../../core/open-resolve'
import type { RecentEntry } from '@shared/types'

export interface OpenBarProps {
  /** Whether the overlay is currently visible. */
  open: boolean
  /** Full vault file list (host computes via useVaultIndex on the active
   *  file's path) — drives the fuzzy-find ("search") mode. */
  files: VaultFile[]
  /** True while the host's vault walk is in flight (index initializing). */
  loading: boolean
  /** Detected vault root, or null when the active path has no `.obsidian/`
   *  / OKF ancestor. Search mode needs a vault; path/URL opens never do. */
  vaultRoot: string | null
  /** Route a raw Open-bar target (a vault file's absPath, a typed/pasted
   *  path or URL, a Browse… pick, or a recent's target). The host resolves
   *  + opens/clones it and records the Open Recent entry. */
  onOpenTarget: (rawTarget: string) => void
  /** Esc / outside-click / post-activation close. */
  onDismiss: () => void
}

const MAX_ROWS_VISIBLE = 50

/** A selectable row in the bar body (recent, fuzzy result, or open action). */
interface Row {
  key: string
  node: React.ReactNode
  /** Undefined for non-actionable rows (a disabled "Soon" choice). */
  onActivate?: () => void
  disabled?: boolean
}

type BarMode =
  | { mode: 'empty' }
  | { mode: 'search'; query: string }
  | { mode: 'target'; target: OpenTarget; raw: string }

/**
 * Decide whether the input is a vault SEARCH query or an open-TARGET.
 * Anything the resolver classifies as a URL / GitHub link is a target; a
 * scheme-less local-path is a target only when it LOOKS path-shaped (a
 * leading ~ / / / ./ / ../, a drive letter, a `file:` scheme, or any
 * slash). A bare token (`roadmap`) stays a search so ⌘O still fuzzy-finds.
 */
function classifyInput(raw: string): BarMode {
  const trimmed = raw.trim()
  if (!trimmed) return { mode: 'empty' }
  const target = resolveOpenTarget(trimmed)
  if (target.kind !== 'local-path') {
    return { mode: 'target', target, raw: trimmed }
  }
  const pathy =
    /^(~|\/|\.\/|\.\.\/)/.test(trimmed) ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith('file:') ||
    trimmed.includes('/')
  if (pathy) return { mode: 'target', target, raw: trimmed }
  return { mode: 'search', query: trimmed }
}

const KIND_GLYPH: Record<RecentEntry['kind'], string> = {
  local: '📄',
  'github-file': '🐙',
  'github-repo': '📦',
  url: '🔗',
}

export function OpenBar({ open, files, loading, vaultRoot, onOpenTarget, onDismiss }: OpenBarProps) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [recents, setRecents] = useState<RecentEntry[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Reset + load recents on the open-transition. Recents are read live each
  // time the bar opens (pointers — §12), so a target deleted on disk simply
  // stops appearing once the host's record/clear ages it out.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIdx(0)
    void window.electron.recents.list().then(setRecents).catch(() => setRecents([]))
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const classified = useMemo(() => classifyInput(query), [query])

  const searchResults = useMemo(
    () =>
      classified.mode === 'search'
        ? rankVaultFiles(files, classified.query, MAX_ROWS_VISIBLE)
        : [],
    [classified, files]
  )

  // Fire an open + close. Every actionable row routes through here so the
  // host records the recent and we dismiss uniformly.
  const activate = (rawTarget: string) => {
    onOpenTarget(rawTarget)
    onDismiss()
  }

  const onBrowse = async () => {
    try {
      const picked = await window.electron.open.browse()
      if (picked) activate(picked.path)
    } catch {
      // A cancelled / failed picker leaves the bar open so the user can type.
    }
  }

  const clearRecent = async () => {
    try {
      await window.electron.recents.clear()
    } catch {
      // best-effort
    }
    setRecents([])
  }

  // ── Build the body rows for the current mode ──────────────────────────────
  const { rows, hint } = useMemo<{ rows: Row[]; hint: React.ReactNode }>(() => {
    if (classified.mode === 'empty') {
      if (recents.length === 0) {
        return {
          rows: [],
          hint: 'Type a path or a GitHub link, search vault files by name, or Browse… for a file or folder.',
        }
      }
      return {
        rows: recents.map((r) => ({
          key: `recent:${r.target}`,
          onActivate: () => activate(r.target),
          node: (
            <>
              <span className="duo-ob-glyph" aria-hidden="true">{KIND_GLYPH[r.kind]}</span>
              <span className="duo-qs-basename">{r.label}</span>
              <span className="duo-qs-relpath">{r.target}</span>
            </>
          ),
        })),
        hint: null,
      }
    }

    if (classified.mode === 'search') {
      if (!vaultRoot) {
        return {
          rows: [],
          hint: (
            <>Not inside a vault — paste a path or a GitHub link, or Browse…. (⌘O searches files by name only inside a vault.)</>
          ),
        }
      }
      if (loading && files.length === 0) {
        return { rows: [], hint: 'Searching the vault…' }
      }
      if (searchResults.length === 0) {
        return { rows: [], hint: `No vault files match "${classified.query}".` }
      }
      return {
        rows: searchResults.map((f) => ({
          key: f.absPath,
          onActivate: () => activate(f.absPath),
          node: (
            <>
              <span className="duo-qs-basename">{f.basename}</span>
              <span className="duo-qs-relpath">{f.relPath}</span>
            </>
          ),
        })),
        hint: null,
      }
    }

    // mode === 'target'
    const t = classified.target
    if (t.kind === 'url') {
      return {
        rows: [
          {
            key: 'open-url',
            onActivate: () => activate(classified.raw),
            node: (
              <>
                <span className="duo-ob-glyph" aria-hidden="true">🔗</span>
                <span className="duo-qs-basename">Open in browser</span>
                <span className="duo-qs-relpath">{t.url}</span>
              </>
            ),
          },
        ],
        hint: null,
      }
    }
    if (t.kind === 'github-repo') {
      return {
        rows: [
          {
            key: 'clone-repo',
            onActivate: () => activate(classified.raw),
            node: (
              <>
                <span className="duo-ob-glyph" aria-hidden="true">📦</span>
                <span className="duo-qs-basename">Clone {t.owner}/{t.repo}</span>
                <span className="duo-qs-relpath">GitHub repository</span>
              </>
            ),
          },
        ],
        hint: null,
      }
    }
    if (t.kind === 'github-file') {
      // D19 — the file-vs-repo fork. "Just this doc" is the DR-blocked
      // round-trip (disabled "Soon"); "clone the whole repo" is live and
      // routes through the clone flow (App opens the file after cloning).
      return {
        hint: (
          <>
            <span className="duo-ob-ok">✓</span> A file in <code>{t.owner}/{t.repo}</code> @ {t.ref}. How do you want to work with it?
          </>
        ),
        rows: [
          {
            key: 'gh-file-doc',
            disabled: true,
            node: (
              <div className="duo-ob-choice is-disabled">
                <div className="duo-ob-choice-title">
                  📄 Open just this document <span className="duo-ob-soon">Soon</span>
                </div>
                <div className="duo-ob-choice-desc">
                  Pulls only the doc into a hidden working copy and ships edits back as a pull request. (In progress.)
                </div>
              </div>
            ),
          },
          {
            key: 'gh-file-clone',
            onActivate: () => activate(classified.raw),
            node: (
              <div className="duo-ob-choice">
                <div className="duo-ob-choice-title">📦 Clone the whole repo</div>
                <div className="duo-ob-choice-desc">
                  Clone {t.owner}/{t.repo} to a folder you pick, add it to the navigator, and open <code>{t.filePath.split('/').pop()}</code>.
                </div>
              </div>
            ),
          },
        ],
      }
    }
    // local-path — host decides file (viewer) vs folder (navigator root).
    return {
      rows: [
        {
          key: 'open-local',
          onActivate: () => activate(classified.raw),
          node: (
            <>
              <span className="duo-ob-glyph" aria-hidden="true">📂</span>
              <span className="duo-qs-basename">Open {t.path.replace(/\/+$/, '').split('/').pop() || t.path}</span>
              <span className="duo-qs-relpath">{t.path}</span>
            </>
          ),
        },
      ],
      hint: null,
    }
  }, [classified, recents, searchResults, vaultRoot, loading, files.length])

  // Selectable rows = non-disabled, actionable rows. activeIdx indexes these.
  const activatable = useMemo(() => rows.filter((r) => r.onActivate && !r.disabled), [rows])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    if (activeIdx >= activatable.length) {
      setActiveIdx(Math.max(0, activatable.length - 1))
    }
  }, [activatable.length, activeIdx])

  if (!open) return null

  const activeKey = activatable[activeIdx]?.key

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(activatable.length - 1, i + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      activatable[activeIdx]?.onActivate?.()
    }
  }

  return (
    <div
      className="duo-qs-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss() }}
    >
      <div className="duo-qs-shell" role="dialog" aria-label="Open">
        <div className="duo-qs-header duo-ob-header">
          <span className="duo-ob-lead">Open</span>
          <input
            ref={inputRef}
            type="text"
            className="duo-qs-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Paste a path or a GitHub link, or search files…"
            aria-label="Open a path, URL, or vault file"
          />
          <button
            type="button"
            className="duo-ob-browse"
            onMouseDown={(e) => { e.preventDefault(); void onBrowse() }}
          >
            📁 Browse…
          </button>
        </div>

        {hint && <div className="duo-ob-hint">{hint}</div>}

        {rows.length > 0 && (
          <ul className="duo-qs-list" role="listbox" aria-label="Open targets">
            {rows.map((row) => {
              const idx = activatable.findIndex((a) => a.key === row.key)
              const isActive = row.key === activeKey
              return (
                <li
                  key={row.key}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={row.disabled || !row.onActivate}
                  className={[
                    'duo-qs-item',
                    isActive ? 'is-active' : '',
                    row.disabled ? 'is-disabled' : '',
                  ].join(' ')}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    row.onActivate?.()
                  }}
                  onMouseEnter={() => { if (idx >= 0) setActiveIdx(idx) }}
                >
                  {row.node}
                </li>
              )
            })}
          </ul>
        )}

        <div className="duo-qs-footer duo-ob-footer">
          <span>↑↓ navigate · ↵ open · Esc dismiss</span>
          {classified.mode === 'empty' && recents.length > 0 && (
            <button
              type="button"
              className="duo-ob-clear"
              onMouseDown={(e) => { e.preventDefault(); void clearRecent() }}
            >
              Clear recent
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
