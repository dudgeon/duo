// FOLLOWUP-050 — live `[[ ]]` autocomplete + silent-stub creation for the
// frontmatter raw-YAML textarea, at parity with the body gesture.
//
// MAX REUSE: the popover UI (SuggestionPopover), the create-note row
// (withCreateNoteRow), the ranking (rankVaultFiles), the type-picker +
// stub-creation flow (TypePickerPopover), and the at-rest serializer
// (okfFrontmatterValue) are all reused verbatim from the body editor. Only
// the textarea-specific glue is new: a string trigger matcher
// (findFmWikilinkMatch), a caret-rect (textareaCaretRect), and value-splice
// inserts in place of ProseMirror transactions.
//
// Expand-on-resolve (D3/D7): on pick, the FINAL at-rest form is inserted —
// in OKF mode a YAML-quoted relative path `"./rel.md"` (a markdown link
// can't live in a YAML value), in Obsidian mode `[[basename]]`. No `[[ ]]`
// gesture persists in an OKF frontmatter value.

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
import { okfFrontmatterValue } from './okfLinks'
import { findFmWikilinkMatch } from './frontmatterWikilinkMatch'
import { textareaCaretRect } from './textareaCaret'
import type { VaultMode } from '../../../core/markdown/vaultLinks'

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
  /** Active vault dialect (D4). OKF inserts a quoted rel-path; Obsidian the
   *  `[[basename]]` wikilink. */
  mode: VaultMode
  /** The SOURCE note path — the rel-link base for OKF inserts. */
  docPath?: string
  /** Refresh the vault index after a stub is created (so the new note is
   *  pickable immediately). */
  onVaultRefresh?: () => void
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
  /** The placeholder range to rewrite once the stub is created (OKF mode).
   *  null in Obsidian mode — the `[[name]]` is already final. */
  rewrite: { start: number; end: number } | null
}

export function useFrontmatterWikilink(opts: FrontmatterWikilinkOptions): FrontmatterWikilink {
  const { textareaRef, setValue, vaultFiles, vaultLoading, vaultRoot, mode, docPath, onVaultRefresh } = opts
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

    if (isCreateNoteItem(item)) {
      const name = item.query
      if (mode === 'okf' && docPath) {
        // Insert a plain-text placeholder (the typed name); rewrite it to the
        // quoted rel-path once the stub's on-disk path is known.
        const next = ta.value.slice(0, start) + name + ta.value.slice(end)
        setValue(next)
        setMatch(null)
        restoreCaret(start + name.length)
        const rect = textareaCaretRect(ta, start + name.length)
        setTypePicker({ name, rect, rewrite: { start, end: start + name.length } })
      } else {
        // Obsidian — `[[name]]` is already the final form; just create the stub.
        const insert = `[[${name}]]`
        const next = ta.value.slice(0, start) + insert + ta.value.slice(end)
        setValue(next)
        setMatch(null)
        restoreCaret(start + insert.length)
        const rect = textareaCaretRect(ta, start + insert.length)
        setTypePicker({ name, rect, rewrite: null })
      }
      return
    }

    // VaultFile pick (no SmartTokens in `[[`): insert the final at-rest form.
    const vf = item as VaultFile
    const insert = mode === 'okf' && docPath
      ? okfFrontmatterValue(docPath, vf.absPath)
      : `[[${vf.basename}]]`
    const next = ta.value.slice(0, start) + insert + ta.value.slice(end)
    setValue(next)
    setMatch(null)
    restoreCaret(start + insert.length)
  }

  const onTypeCreated = (stub: { path: string; absPath: string; type: string; created: boolean }) => {
    const ta = textareaRef.current
    const tp = typePicker
    setTypePicker(null)
    if (ta && tp && tp.rewrite && mode === 'okf' && docPath) {
      const insert = okfFrontmatterValue(docPath, stub.absPath)
      const next = ta.value.slice(0, tp.rewrite.start) + insert + ta.value.slice(tp.rewrite.end)
      setValue(next)
      restoreCaret(tp.rewrite.start + insert.length)
    } else if (ta) {
      restoreCaret(ta.selectionStart ?? ta.value.length)
    }
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
