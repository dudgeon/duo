// FOLLOWUP-050 — string-based `[[ ]]` trigger matcher for the frontmatter
// raw-YAML textarea. The body editor's matcher (suggestionMatchers.ts
// findWikilinkMatch) keys off a ProseMirror ResolvedPos; a textarea has only
// `value` + `selectionStart`, so this mirrors the SAME rules on a plain
// string — kept pure (no DOM / React) so the trigger logic is unit-tested.
//
// Rule parity with the body: match `[[<query>` immediately left of the caret
// with no whitespace and no `]` in the query (an open, unclosed wikilink
// intent), and a defensive length cap so a stray `[[` far back in the buffer
// doesn't match.

export interface FmWikilinkMatch {
  /** Index of the FIRST `[` of the `[[` trigger — the replace range is
   *  [start, caret]. */
  start: number
  /** Everything typed after `[[` (the autocomplete query / entity name). */
  query: string
}

export function findFmWikilinkMatch(value: string, caret: number): FmWikilinkMatch | null {
  if (caret < 0 || caret > value.length) return null
  const left = value.slice(0, caret)
  // The `[[` closest to the caret.
  const idx = left.lastIndexOf('[[')
  if (idx === -1) return null
  const query = left.slice(idx + 2)
  // Reject whitespace or any `]` (a closed / closing wikilink) in the query.
  if (/[\s\]]/.test(query)) return null
  // Defensive cap — prevents matching against a stray `[[` from way back.
  if (query.length > 80) return null
  return { start: idx, query }
}
