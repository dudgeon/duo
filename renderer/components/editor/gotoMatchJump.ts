// ENH-208 Phase 2 (D22) — the editor-side jump for the vault-search
// palette's "open at line". See vaultGotoMatch.ts for why the request is
// "Nth occurrence of the query", not a disk line number: frontmatter is
// stripped into the Properties panel, so disk lines ≠ doc positions.
//
// The scan reuses FindHighlight's findAllMatches — the same
// case-insensitive-substring semantics as core/vault search, with the
// per-character offset mapping that survives inline non-text nodes.
// Fallbacks (the disk hit may have been inside frontmatter, which the
// doc doesn't contain): fewer doc matches than matchIndex → FIRST
// match; no matches at all → top-of-doc.

import type { Editor } from '@tiptap/core'
import { findAllMatches, type FindMatch } from './extensions/FindHighlight'

/** Pure picker — Nth match, first-match fallback, null when none. */
export function pickGotoTarget(matches: FindMatch[], matchIndex: number): FindMatch | null {
  return matches[matchIndex] ?? matches[0] ?? null
}

/**
 * Select + reveal the target occurrence. Returns true when a match was
 * selected, false on the top-of-doc fallback. The chain mirrors the
 * ENH-022 v2 onDocGoto shape (selection + scrollIntoView on ONE
 * transaction); the caller adds the RAF native-scroll belt-and-braces
 * because PM's scrollIntoView can miss the editor's real scroll
 * container (BUG-043 family).
 */
export function jumpToMatch(editor: Editor, req: { query: string; matchIndex: number }): boolean {
  const matches = findAllMatches(editor.state.doc, req.query, false)
  const target = pickGotoTarget(matches, req.matchIndex)
  if (!target) {
    editor.chain().focus('start').scrollIntoView().run()
    return false
  }
  editor
    .chain()
    .focus()
    .setTextSelection({ from: target.from, to: target.to })
    .scrollIntoView()
    .run()
  return true
}
