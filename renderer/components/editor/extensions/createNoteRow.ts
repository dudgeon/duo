// ENH-208 Phase 2 (D4) — the silent-stub create row for WikilinkSuggestion.
//
// When the user types `[[Some Name` and no vault file's basename equals the
// query, the popover appends ONE synthetic final row ("New: …— pick type…").
// Picking it inserts the wikilink like a normal pick, then hands off to the
// TypePickerPopover (MarkdownEditor owns that flow). The append decision is
// pure so the gating rules — non-empty query, known vault root, no exact
// basename match — are testable without TipTap.

/** The synthetic final row. Discriminated by `kind` so the popover and the
 *  suggestion command can branch it apart from VaultFile / SmartToken. */
export interface CreateNoteItem {
  kind: 'create-note'
  /** The typed query — becomes the wikilink target / stub entity name. */
  query: string
}

/** Type guard for the popover render + the suggestion `command` branch. */
export function isCreateNoteItem(item: unknown): item is CreateNoteItem {
  return (
    !!item &&
    typeof item === 'object' &&
    (item as CreateNoteItem).kind === 'create-note' &&
    typeof (item as CreateNoteItem).query === 'string'
  )
}

/**
 * Append the create row to the ranked list when:
 *   - the typed query is non-empty (a bare `[[` offers files only), AND
 *   - the editor's vault root is known (no root → nowhere to stub), AND
 *   - no file in the FULL index has a basename equal to the query
 *     (case-insensitive — an exact match means the note exists; the
 *     ranked list already surfaces it first).
 * The equality check runs against `all`, not `ranked`: ranking caps at a
 * limit, and the create offer must not depend on where the cap fell.
 */
export function withCreateNoteRow<F extends { basename: string }>(
  ranked: F[],
  all: F[],
  query: string,
  vaultRootKnown: boolean,
): (F | CreateNoteItem)[] {
  const trimmed = query.trim()
  if (!trimmed || !vaultRootKnown) return ranked
  const q = trimmed.toLowerCase()
  if (all.some((f) => f.basename.toLowerCase() === q)) return ranked
  return [...ranked, { kind: 'create-note', query: trimmed }]
}
