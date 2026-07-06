// ENH-208 Phase 2 (D4) — the silent-stub type picker.
//
// Opens after WikilinkSuggestion's create row inserts `[[<name>]]`,
// anchored at the post-insert caret rect (same positionStyle as the
// SuggestionPopover). The user filters the vault's template types,
// picks one (↑↓ + Enter, or click), and the stub is created via the
// SAME main-process code path as `duo vault stub` — then the popover
// closes SILENTLY: no tab opens (that is the point of D4), the host
// refreshes its vault index, and focus returns to the editor at the
// preserved caret. Esc cancels without creating anything (an
// unresolved wikilink is harmless / Obsidian-compatible).
//
// When the filter names no existing type, a trailing
// `+ new type "<filter>"…` row creates `templates/<filter>.md` first
// (window.electron.vault.createType), then stubs with it. IPC errors
// render inline (small red line) and keep the popover open.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { positionStyle } from './SuggestionPopover'
import { buildTypeChoices, type TypeChoice } from './typePickerModel'

export interface TypePickerPopoverProps {
  /** The vault the stub files into — the host's useVaultIndex root. */
  vaultRoot: string
  /** The wikilink target, i.e. the stub's entity name. */
  name: string
  /** Post-insert caret rect from the suggestion command. Null falls
   *  back to a fixed top-center anchor so the picker is never lost. */
  anchorRect: DOMRect | null
  /** Stub created (or already existed — idempotent is fine). Host
   *  closes the picker, refreshes the vault index, refocuses the
   *  editor. ENH-216 (U7) — the stub result is passed through so the
   *  host can compute the OKF markdown relative link (the placeholder
   *  rewrite uses `stub.absPath`); `created:false` means the note was
   *  already on disk (still a valid link target). */
  onCreated: (stub: { path: string; absPath: string; type: string; created: boolean }) => void
  /** Esc / click-outside — close without creating. Host refocuses
   *  the editor. */
  onCancel: () => void
}

export function TypePickerPopover({ vaultRoot, name, anchorRect, onCreated, onCancel }: TypePickerPopoverProps) {
  const [filter, setFilter] = useState('')
  // null = registry still loading (one IPC on mount).
  const [types, setTypes] = useState<string[] | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // The pick handler is invoked from a keydown closure; route through a
  // ref so the closure always sees the latest choices/busy state.
  const busyRef = useRef(busy)
  busyRef.current = busy
  // BUG-254 — Enter/Tab pressed before `types` resolves used to be silently
  // dropped (no pick, no feedback) and left the popover open, quietly
  // capturing every keystroke typed afterward as a type filter. Queue it
  // here instead; the effect after `pick` below fires it the instant the
  // registry loads.
  const pendingConfirmRef = useRef(false)

  // Load the vault's template registry once. {ok:false} renders the
  // error but keeps the picker open — the new-type row still works
  // against an empty list.
  useEffect(() => {
    let cancelled = false
    void window.electron.vault.types({ vaultRoot }).then(
      (res) => {
        if (cancelled) return
        if (res.ok) {
          setTypes(res.types)
        } else {
          setTypes([])
          setError(res.error)
        }
      },
      (err) => {
        if (cancelled) return
        setTypes([])
        setError(err instanceof Error ? err.message : String(err))
      }
    )
    return () => { cancelled = true }
  }, [vaultRoot])

  // Autofocus the filter input on mount. The editor keeps its PM
  // selection (caret after `]]`) even while DOM focus sits here.
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const choices = useMemo(() => buildTypeChoices(types ?? [], filter), [types, filter])

  // Clamp the active row when the filtered list shrinks.
  useEffect(() => {
    setActiveIdx((i) => Math.min(i, Math.max(0, choices.length - 1)))
  }, [choices.length])

  // Click-outside cancels (mousedown, capture — before the editor
  // swallows the event), mirroring Esc: nothing is created.
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return
      onCancel()
    }
    document.addEventListener('mousedown', onDocMouseDown, true)
    return () => document.removeEventListener('mousedown', onDocMouseDown, true)
  }, [onCancel])

  const pick = async (choice: TypeChoice) => {
    if (busyRef.current) return
    setBusy(true)
    setError(null)
    try {
      let stubType = choice.type
      if (choice.kind === 'new') {
        const created = await window.electron.vault.createType({ vaultRoot, type: choice.type })
        if (!created.ok) {
          setError(created.error)
          setBusy(false)
          return
        }
        // Stub with the handler's CANONICAL name (safeName + lowercase),
        // not the raw filter text — createEntityStub matches template
        // types strictly, so "Meeting Note" against the normalized
        // "meeting note" template would dead-end on `unknown type`.
        stubType = created.type
      }
      // Same code path as `duo vault stub <type> <name>` — idempotent,
      // so created:false (note already on disk) closes silently too.
      const res = await window.electron.vault.stub({ vaultRoot, type: stubType, name })
      if (!res.ok) {
        setError(res.error)
        setBusy(false)
        return
      }
      // ENH-216 (U7) — pass the stub's on-disk paths through so the host
      // can rewrite an OKF placeholder to a markdown relative link.
      onCreated({ path: res.path, absPath: res.absPath, type: res.type, created: res.created })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  // BUG-254 — fires a queued Enter/Tab (see pendingConfirmRef above) the
  // instant the registry resolves, against whatever's filtered/highlighted
  // at THAT moment. Only runs on the loading→loaded transition (the `types`
  // dep); `choices`/`activeIdx` are read fresh from this render's closure,
  // which is what we want — the pick reflects the latest filter, not a
  // stale snapshot from when Enter was first pressed.
  useEffect(() => {
    if (types === null || !pendingConfirmRef.current) return
    pendingConfirmRef.current = false
    const picked = choices[activeIdx]
    if (picked) void pick(picked)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => (choices.length === 0 ? 0 : (i + 1) % choices.length))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => (choices.length === 0 ? 0 : (i - 1 + choices.length) % choices.length))
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      // Tab picks like Enter (SuggestionPopover convention) — and must
      // never tab focus out of the open popover into the editor below.
      e.preventDefault()
      e.stopPropagation()
      if (types === null) {
        // BUG-254 — registry not loaded yet (a fast double-Enter right
        // after the wikilink create-row routinely beats this IPC). Queue
        // instead of silently dropping it — see the effect above.
        pendingConfirmRef.current = true
        return
      }
      const picked = choices[activeIdx]
      if (picked) void pick(picked)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
      return
    }
  }

  // Off-caret fallback anchor (coordsAtPos threw): top-center so the
  // picker is visible rather than silently skipped.
  const rect = anchorRect ?? new DOMRect(Math.max(8, window.innerWidth / 2 - 130), 96, 0, 16)

  return createPortal(
    <div
      ref={rootRef}
      style={positionStyle(rect)}
      className="duo-suggestion-popover"
      role="dialog"
      aria-label={`Pick a type for "${name}"`}
    >
      <div className="duo-suggestion-empty">New note &ldquo;{name}&rdquo; — pick a type</div>
      <div className="px-2 pb-1">
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Filter types…"
          aria-label="Filter types"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="w-full px-2 py-0.5 text-[12px] bg-paper border border-paper-rule rounded text-ink placeholder-ink-ghost outline-none focus:border-accent"
        />
      </div>
      {/* role=option requires a listbox context (same structure as
          SuggestionPopover / VaultQuickSwitcher). */}
      <div role="listbox" aria-label="Note types">
        {types === null && (
          <div className="duo-suggestion-empty">Loading types…</div>
        )}
        {types !== null && choices.length === 0 && (
          <div className="duo-suggestion-empty">No types yet — type a name to create one</div>
        )}
        {choices.map((choice, idx) => (
          <button
            key={`${choice.kind}:${choice.type}`}
            type="button"
            role="option"
            aria-selected={idx === activeIdx}
            disabled={busy}
            className={[
              'duo-suggestion-item',
              idx === activeIdx ? 'is-active' : ''
            ].join(' ')}
            // preventDefault keeps the filter input focused through the
            // click (same convention as SuggestionPopover rows).
            onMouseDown={(e) => {
              e.preventDefault()
              void pick(choice)
            }}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            {choice.kind === 'new' ? (
              <>
                <span className="duo-suggestion-relpath">+ new type</span>
                <span className="duo-suggestion-basename">&ldquo;{choice.type}&rdquo;…</span>
              </>
            ) : (
              <span className="duo-suggestion-basename">{choice.type}</span>
            )}
          </button>
        ))}
      </div>
      {/* BUG-254 (H2) — a "+ new type" template has no folder/folderNote
          (createType() writes a minimal templates/<type>.md), so its
          entities always residue to notes/YYYY/MM until someone edits the
          template. Surface that up front rather than let it be a silent
          surprise. */}
      {choices.some((c) => c.kind === 'new') && (
        <div className="duo-suggestion-more">
          New types start without a folder — their notes file under notes/YYYY/MM until you add one to templates/&lt;type&gt;.md.
        </div>
      )}
      {error && (
        <div className="px-3 py-1.5 text-[11px] text-red-500">{error}</div>
      )}
    </div>,
    document.body
  )
}
