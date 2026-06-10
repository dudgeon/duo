// Sprint 11 — shared popover used by:
//   - WikilinkSuggestion (ENH-096 B.2 — `[[` trigger)
//   - AtMention (ENH-105 — `@` trigger)
//
// Renders a floating list anchored near the caret. Keyboard nav
// (↑↓ to move, Tab/Enter to select, Esc to dismiss) is handled here;
// the parent suggestion extension forwards keydown events from TipTap.
//
// ENH-208 Phase 2 — items widened from VaultFile-only to a union:
// SmartToken rows (D21 — `@today` etc., rendered with the resolved
// date as subtitle) and the CreateNoteItem row (D4 — the final
// `New: "…" — pick type…` offer on unresolved wikilink queries).
//
// Visual register: same Atelier palette as the toolbar / SaveControl.
// White card with paper-rule border, accent-soft tint on the active
// row. Mounted via React Portal to document.body so absolute
// positioning can escape any clipping ancestor (the editor's
// scrollable inner container would otherwise hide rows pushed past
// the viewport edge).

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { createPortal } from 'react-dom'
import type { VaultFile } from '../wikilinkResolver'
import { isSmartToken, type SmartToken } from '../smartTokens'
import { isCreateNoteItem, type CreateNoteItem } from '../extensions/createNoteRow'

/** Everything a suggester can put in the list. VaultFile rows insert
 *  `[[basename]]`; SmartToken rows insert their resolved plain text;
 *  the CreateNoteItem row inserts the wikilink + opens the type picker. */
export type SuggestionItem = VaultFile | SmartToken | CreateNoteItem

export interface SuggestionPopoverProps {
  items: SuggestionItem[]
  /** Called when the user picks an item (Tab/Enter or click). The
   *  parent suggestion extension uses this to actually insert text
   *  into the document. */
  command: (item: SuggestionItem) => void
  /** clientRect of the trigger position in viewport coords. Used to
   *  anchor the popover. May be null between caret moves. */
  clientRect: (() => DOMRect | null) | null
  /** True when the wrapped vault index is still walking. We render a
   *  small "Searching vault…" hint so the user doesn't perceive the
   *  empty list as "no matches." */
  loading?: boolean
  /** Walk-2 v2 fix — explicit visible flag controlled by the
   *  suggestion lifecycle. Pre-fix, Escape called ReactRenderer.
   *  destroy() but the React tree didn't always unmount in time
   *  (suspected createPortal + React 18 async unmount race). With
   *  this prop the popover RENDERS NULL when visible=false, so the
   *  user sees it dismiss immediately even if the underlying React
   *  tree teardown happens on the next tick. Defaults to true so
   *  callers that don't pass it get the original behavior. */
  visible?: boolean
}

export interface SuggestionPopoverHandle {
  /** Forwarded keydown — parent suggestion extension calls this when
   *  TipTap's onKeyDown fires. Returns true if the popover handled
   *  the key (caller suppresses TipTap's default), false otherwise. */
  onKeyDown: (event: KeyboardEvent) => boolean
}

// Exported so withCreateNoteRow can pin the D4 create row INSIDE the
// rendered window — rows past this slice exist for keyboard-wrap but
// never render, which must not happen to a feature's entry point.
export const ITEM_LIMIT_VISIBLE = 8

export const SuggestionPopover = forwardRef<SuggestionPopoverHandle, SuggestionPopoverProps>(
  function SuggestionPopover({ items, command, clientRect, loading, visible = true }, ref) {
    const [activeIdx, setActiveIdx] = useState(0)

    // Reset to first item when the items list changes (new query or
    // first render). Without this, typing more characters could leave
    // activeIdx pointing at an out-of-range row.
    useEffect(() => {
      setActiveIdx(0)
    }, [items])

    useImperativeHandle(ref, () => ({
      onKeyDown(event) {
        if (event.key === 'ArrowDown') {
          setActiveIdx((i) => (items.length === 0 ? 0 : (i + 1) % items.length))
          return true
        }
        if (event.key === 'ArrowUp') {
          setActiveIdx((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length))
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const picked = items[activeIdx]
          if (picked) {
            command(picked)
            return true
          }
          return false
        }
        // Escape is handled at the suggestion level (TipTap's own
        // onExit), not here — return false so the parent dismisses.
        return false
      }
    }), [items, activeIdx, command])

    // Walk-2 v2 — visible:false forces null render even if the
    // React tree hasn't fully unmounted. Belt-and-braces against
    // ReactRenderer.destroy()'s portal cleanup race.
    if (!visible) return null
    if (!clientRect) return null
    const rect = clientRect()
    if (!rect) return null

    // Empty state: render the "no matches" hint instead of an empty
    // shell. Loading state shows during the initial vault walk.
    const isEmpty = items.length === 0

    return createPortal(
      <div
        // The popover positions itself BELOW the caret by default.
        // If the caret is in the bottom 240px of the viewport, flip
        // to render ABOVE so the list isn't clipped.
        style={positionStyle(rect)}
        className="duo-suggestion-popover"
        role="listbox"
        // Shape-neutral: the list now also carries @today smart tokens
        // (D21) and the New:-row action (D4), not just vault files.
        aria-label="Suggestions"
      >
        {loading && isEmpty && (
          <div className="duo-suggestion-empty">Searching vault…</div>
        )}
        {!loading && isEmpty && (
          <div className="duo-suggestion-empty">No matches</div>
        )}
        {items.slice(0, ITEM_LIMIT_VISIBLE).map((item, idx) => (
          <button
            key={itemKey(item)}
            type="button"
            role="option"
            aria-selected={idx === activeIdx}
            className={[
              'duo-suggestion-item',
              idx === activeIdx ? 'is-active' : ''
            ].join(' ')}
            // Prevent default mousedown so the editor doesn't lose
            // selection focus before our command() runs.
            onMouseDown={(e) => {
              e.preventDefault()
              command(item)
            }}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            {renderItemContent(item)}
          </button>
        ))}
        {items.length > ITEM_LIMIT_VISIBLE && (
          <div className="duo-suggestion-more">
            +{items.length - ITEM_LIMIT_VISIBLE} more — keep typing to narrow
          </div>
        )}
      </div>,
      document.body
    )
  }
)

/** Stable React key across the three row shapes. */
function itemKey(item: SuggestionItem): string {
  if (isSmartToken(item)) return item.id
  if (isCreateNoteItem(item)) return 'duo-create-note'
  return item.absPath
}

/** Row body per item shape. SmartToken rows (D21) carry a small calendar
 *  glyph + the resolved value as the muted subtitle; the CreateNoteItem
 *  row (D4) reuses the muted hint styling so it reads as an action, not
 *  a file. VaultFile rows are unchanged. */
function renderItemContent(item: SuggestionItem) {
  if (isSmartToken(item)) {
    return (
      <>
        <span aria-hidden="true">📅</span>
        <span className="duo-suggestion-basename">{item.label}</span>
        <span className="duo-suggestion-relpath">{item.detail}</span>
      </>
    )
  }
  if (isCreateNoteItem(item)) {
    return (
      <>
        <span className="duo-suggestion-relpath">New:</span>
        <span className="duo-suggestion-basename">&ldquo;{item.query}&rdquo;</span>
        <span className="duo-suggestion-relpath">— pick type…</span>
      </>
    )
  }
  return (
    <>
      <span className="duo-suggestion-basename">{item.basename}</span>
      {item.relPath !== `${item.basename}.${item.ext}` && (
        <span className="duo-suggestion-relpath">{item.relPath}</span>
      )}
    </>
  )
}

/** Exported for the TypePickerPopover (ENH-208 D4), which anchors at the
 *  caret rect with the same below-the-caret / flip-above-when-clipped rule. */
export function positionStyle(rect: DOMRect): React.CSSProperties {
  const POPOVER_HEIGHT_ESTIMATE = 240
  const VIEWPORT_GAP = 8
  const flipAbove = rect.bottom + POPOVER_HEIGHT_ESTIMATE > window.innerHeight - VIEWPORT_GAP
  const top = flipAbove ? rect.top - POPOVER_HEIGHT_ESTIMATE - 4 : rect.bottom + 4
  return {
    position: 'fixed',
    top: `${Math.max(VIEWPORT_GAP, top)}px`,
    left: `${rect.left}px`,
    zIndex: 60
  }
}
