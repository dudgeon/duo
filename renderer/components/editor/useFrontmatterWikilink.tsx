// FOLLOWUP-050 — live `[[ ]]` autocomplete + silent-stub creation for the
// frontmatter raw-YAML textarea, at parity with the body gesture.
//
// MAX REUSE: the popover UI (SuggestionPopover), the create-note row
// (withCreateNoteRow), the ranking (rankVaultFiles), and the type-picker +
// stub-creation flow (TypePickerPopover) are all reused verbatim from the
// body editor. Only the textarea-specific glue is new: a string trigger
// matcher (findFmWikilinkMatch), a caret-rect (textareaCaretRect), and
// value-splice inserts in place of ProseMirror transactions.
//
// ENH-266 (2026-07-09) — REVERSES FOLLOWUP-051's mode-agnostic insert. A
// live Obsidian validation found FOLLOWUP-051's premise wrong (see
// okfLinks.ts's ENH-266 header): a title-based `[[Alice Park]]` frontmatter
// value creates an unresolved phantom node in Obsidian when the OKF
// filename is a slug. OKF now writes a QUOTED markdown link
// (`okfFrontmatterLinkInsert`, mirroring the BODY's D3 expand-on-resolve —
// existing-note picks insert the final form directly; a create-note pick
// inserts a `[[name]]` placeholder and the type-picker's `onCreated`
// rewrites that span once the stub's path is known, same two-step shape as
// MarkdownEditor's body `stubPicker`). Obsidian mode is UNCHANGED — still
// inserts a plain `[[basename]]` wikilink, no rewrite.

import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  SuggestionPopover,
  ITEM_LIMIT_VISIBLE,
  type SuggestionItem,
  type SuggestionPopoverHandle,
} from './primitives/SuggestionPopover'
import { TypePickerPopover } from './primitives/TypePickerPopover'
import { withCreateNoteRow, isCreateNoteItem } from './extensions/createNoteRow'
import { rankVaultFiles } from './vaultIndex'
import type { VaultFile } from './wikilinkResolver'
import { findFmWikilinkMatch } from './frontmatterWikilinkMatch'
import { textareaCaretRect } from './textareaCaret'
import { okfFrontmatterLinkInsert, type VaultMode } from './okfLinks'

export interface FrontmatterWikilinkOptions {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** Replace the textarea's value (the FrontmatterPanel's setDraft + live
   *  re-validate), used for programmatic inserts. */
  setValue: (next: string) => void
  /** Vault file list + loading + root — the SAME sources MarkdownEditor
   *  threads into the body WikilinkSuggestion (useVaultIndex). */
  vaultFiles: VaultFile[]
  vaultLoading: boolean
  vaultRoot: string | null
  /** Refresh the vault index after a stub is created (so the new note is
   *  pickable immediately). */
  onVaultRefresh?: () => void
  /** ENH-266 — the active vault's at-rest link mode (D4). OKF writes a
   *  quoted markdown link for a frontmatter pick; Obsidian (default) keeps
   *  the `[[ ]]` wikilink form. */
  vaultMode?: VaultMode
  /** ENH-266 — the open doc's path, the rel-link base in OKF mode. Null
   *  (or Obsidian mode) falls back to the unquoted `[[ ]]` insert. */
  docPath?: string | null
}

export interface FrontmatterWikilink {
  /** Call from the textarea's onChange (after setDraft) to (re)evaluate the
   *  `[[ ]]` trigger at the caret. */
  onInput: () => void
  /** Call from the textarea's onKeyDown BEFORE the panel's own Escape /
   *  Cmd-Enter handling. Returns true when the suggester consumed the key
   *  (caller should not run its own handler). */
  onKeyDown: (e: React.KeyboardEvent) => boolean
  /** The popover + type-picker portals — render anywhere (they portal to
   *  document.body). */
  overlay: ReactNode
  /** True while the suggester popover or type picker is open — the panel's
   *  click-outside-commit must ignore clicks while this is true. */
  isOpen: boolean
}

interface ActiveMatch {
  start: number
  query: string
  rect: DOMRect | null
}

interface TypePickerState {
  name: string
  rect: DOMRect | null
  /** ENH-266 — the inserted placeholder's span in the textarea, so
   *  `onTypeCreated` can rewrite it once the stub's path is known. OKF
   *  mode only; Obsidian's `[[name]]` insert is already final (null). */
  range: { start: number; end: number } | null
}

export function useFrontmatterWikilink(opts: FrontmatterWikilinkOptions): FrontmatterWikilink {
  const {
    textareaRef,
    setValue,
    vaultFiles,
    vaultLoading,
    vaultRoot,
    onVaultRefresh,
    vaultMode = 'obsidian',
    docPath = null,
  } = opts
  const okf = vaultMode === 'okf' && !!docPath
  const [match, setMatch] = useState<ActiveMatch | null>(null)
  const [typePicker, setTypePicker] = useState<TypePickerState | null>(null)
  const popoverRef = useRef<SuggestionPopoverHandle | null>(null)

  const items: SuggestionItem[] = useMemo(() => {
    if (!match) return []
    const ranked = rankVaultFiles(vaultFiles, match.query)
    return withCreateNoteRow(
      ranked,
      vaultFiles,
      match.query,
      !!vaultRoot && !vaultLoading,
      ITEM_LIMIT_VISIBLE,
    ) as SuggestionItem[]
  }, [match, vaultFiles, vaultRoot, vaultLoading])

  // Restore focus + caret after a programmatic insert re-renders the
  // controlled textarea.
  const restoreCaret = (caret: number) => {
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(caret, caret)
    })
  }

  const onInput = () => {
    const ta = textareaRef.current
    if (!ta) return
    const caret = ta.selectionStart ?? ta.value.length
    const m = findFmWikilinkMatch(ta.value, caret)
    if (m) {
      setMatch({ start: m.start, query: m.query, rect: textareaCaretRect(ta, caret) })
    } else if (match) {
      setMatch(null)
    }
  }

  const command = (item: SuggestionItem) => {
    const ta = textareaRef.current
    if (!ta || !match) return
    const caret = ta.selectionStart ?? ta.value.length
    const start = match.start
    const end = caret

    // ENH-266 — a create-note pick always inserts the `[[name]]`
    // PLACEHOLDER first (same shape in both modes — the stub doesn't exist
    // yet, so there's no target path to link to). OKF mode records the
    // placeholder's span; onTypeCreated rewrites it to the quoted
    // markdown-link form once the stub's on-disk path is known. Obsidian
    // leaves the wikilink in place (range: null — nothing to rewrite).
    if (isCreateNoteItem(item)) {
      const name = item.query
      const insert = `[[${name}]]`
      const next = ta.value.slice(0, start) + insert + ta.value.slice(end)
      setValue(next)
      setMatch(null)
      restoreCaret(start + insert.length)
      const rect = textareaCaretRect(ta, start + insert.length)
      setTypePicker({
        name,
        rect,
        range: okf ? { start, end: start + insert.length } : null,
      })
      return
    }

    // VaultFile pick (existing note). ENH-266: OKF writes the quoted
    // markdown-link form directly (the target's path is already known);
    // Obsidian keeps the unquoted `[[basename]]` wikilink (unchanged).
    const vf = item as VaultFile
    const insert = okf
      ? okfFrontmatterLinkInsert(vf.basename, docPath as string, vf.absPath)
      : `[[${vf.basename}]]`
    const next = ta.value.slice(0, start) + insert + ta.value.slice(end)
    setValue(next)
    setMatch(null)
    restoreCaret(start + insert.length)
  }

  const onTypeCreated = (stub: { path: string; absPath: string; type: string; created: boolean }) => {
    const ta = textareaRef.current
    // ENH-266 — OKF: the create row inserted a PLAIN `[[name]]` placeholder;
    // now that the stub's on-disk path is known, rewrite that span to the
    // quoted markdown-link form (mirrors MarkdownEditor's BODY stubPicker
    // rewrite). Obsidian: `range` is null (the `[[ ]]` was already final),
    // so this is a no-op splice-skip.
    if (ta && typePicker?.range && docPath) {
      const { start, end } = typePicker.range
      const link = okfFrontmatterLinkInsert(typePicker.name, docPath, stub.absPath)
      const next = ta.value.slice(0, start) + link + ta.value.slice(end)
      setValue(next)
      setTypePicker(null)
      restoreCaret(start + link.length)
      onVaultRefresh?.()
      return
    }
    setTypePicker(null)
    if (ta) restoreCaret(ta.selectionStart ?? ta.value.length)
    onVaultRefresh?.()
  }

  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    // The type picker focuses its own input and handles its own keys.
    if (typePicker) return false
    if (!match) return false
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setMatch(null)
      return true
    }
    if (popoverRef.current && popoverRef.current.onKeyDown(e.nativeEvent)) {
      e.preventDefault()
      e.stopPropagation()
      return true
    }
    return false
  }

  const overlay = (
    <>
      {match && (
        <SuggestionPopover
          ref={popoverRef}
          items={items}
          command={command}
          clientRect={() => (match ? match.rect : null)}
          loading={vaultLoading}
          visible={true}
        />
      )}
      {typePicker && vaultRoot && (
        <TypePickerPopover
          vaultRoot={vaultRoot}
          name={typePicker.name}
          anchorRect={typePicker.rect}
          onCreated={onTypeCreated}
          onCancel={() => {
            setTypePicker(null)
            const ta = textareaRef.current
            if (ta) restoreCaret(ta.selectionStart ?? ta.value.length)
          }}
        />
      )}
    </>
  )

  return { onInput, onKeyDown, overlay, isOpen: !!match || !!typePicker }
}
