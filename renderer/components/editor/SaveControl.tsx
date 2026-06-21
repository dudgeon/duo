// Sprint 10 anchor (ENH-103 + ENH-104) — paired Save status / Save
// action / autosave toggle in a single pill control. Replaces the
// prior "Saving…/Unsaved/Saved" text span + separate Save button.
// Four mutually-exclusive states drive label + style; the autosave
// toggle is a hover-reveal sibling so the SaveControl owns the
// entire save concept (no separate View menu entry, no per-tab
// affordance).

import type { CSSProperties } from 'react'

export type SaveControlState = 'saved' | 'unsaved' | 'saving' | 'failed'

/** Pure state-derivation helper extracted for unit testability. The
 *  priority order — failed > saving > unsaved > saved — locks in the
 *  UX intent: "Failed — retry" must beat "Saving…" if the saving
 *  flag is somehow still true post-failure (otherwise the user sees
 *  a misleading spinner and never gets the retry affordance). */
export function deriveSaveControlState(input: {
  dirty: boolean
  saving: boolean
  saveError: string | null
}): SaveControlState {
  if (input.saveError) return 'failed'
  if (input.saving) return 'saving'
  if (input.dirty) return 'unsaved'
  return 'saved'
}

interface Props {
  dirty: boolean
  saving: boolean
  /** When non-null, the most recent save attempt failed with this
   *  message. Pill flips to the "Failed — retry" state; click fires
   *  `onSave` to retry. Cleared by the host on next edit / next
   *  successful save. */
  saveError: string | null
  /** Current autosave preference (single global, persisted by host
   *  via `localStorage[duo.autosave.v1]`). When off, the host
   *  suppresses the 800ms debounce; ⌘S + Save-button still write. */
  autosaveOn: boolean
  onToggleAutosave: () => void
  onSave: () => void
}

export function SaveControl({
  dirty, saving, saveError, autosaveOn, onToggleAutosave, onSave
}: Props) {
  const state: SaveControlState = deriveSaveControlState({ dirty, saving, saveError })

  const label =
    state === 'saved' ? 'Saved'
    : state === 'unsaved' ? 'Save'
    : state === 'saving' ? 'Saving…'
    : 'Failed — retry'

  // Owner-locked palette (Sprint 10 AUQ 2026-05-07):
  //   Saved  — muted gray text, button looks inert (no hover)
  //   Save   — solid bg-accent + white text, action-y
  //   Saving — disabled state with spinner
  //   Failed — red text on muted bg, hover lifts to retry intent
  const pillClass = {
    saved:   'bg-transparent text-zinc-500',
    unsaved: 'bg-accent text-white hover:brightness-110 active:brightness-95 cursor-pointer',
    saving:  'bg-surface-2 text-zinc-400',
    failed:  'duo-banner-error cursor-pointer'
  }[state]

  const clickable = state === 'unsaved' || state === 'failed'
  const buttonTitle =
    state === 'saved' ? 'No unsaved changes'
    : state === 'unsaved' ? 'Save (⌘S)'
    : state === 'saving' ? 'Saving…'
    : `Save failed — click to retry${saveError ? ` · ${saveError}` : ''}`

  return (
    <div
      // `group` enables `group-hover:` + `group-focus-within:` on the
      // adjacent autosave toggle — keyboard users can tab to it even
      // without hovering.
      className="group flex items-center gap-2 pr-1"
    >
      <button
        type="button"
        onClick={clickable ? onSave : undefined}
        disabled={!clickable}
        title={buttonTitle}
        aria-live="polite"
        className={[
          'h-6 px-2.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 transition-colors',
          'disabled:cursor-default',
          pillClass
        ].join(' ')}
        style={{ minWidth: '4.5rem', justifyContent: 'center' } as CSSProperties}
      >
        {state === 'saving' && <Spinner />}
        <span>{label}</span>
      </button>

      {/* Hover-reveal autosave toggle. Owner-locked Sprint 10:
          adjacent to the pill, no separate View menu, no per-tab
          override. opacity-0 by default so the toolbar stays clean;
          revealed on group hover or when the toggle itself is
          focused (tab-from-keyboard a11y). */}
      <button
        type="button"
        onClick={onToggleAutosave}
        title={`Autosave is ${autosaveOn ? 'on' : 'off'} — click to ${autosaveOn ? 'turn off' : 'turn on'}`}
        className={[
          // Walk-1 polish (Sprint 10) — `whitespace-nowrap` prevents
          // the two-word label ("Autosave: on/off") from wrapping into
          // a tall, double-spaced stack on narrow toolbars. The toggle
          // is hover-revealed so brief horizontal overflow under the
          // cursor is acceptable.
          'text-[11px] tracking-tight whitespace-nowrap transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100',
          autosaveOn ? 'text-zinc-500 hover:text-zinc-300' : 'text-amber-400/70 hover:text-amber-300'
        ].join(' ')}
      >
        {`Autosave: ${autosaveOn ? 'on' : 'off'}`}
      </button>
    </div>
  )
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
