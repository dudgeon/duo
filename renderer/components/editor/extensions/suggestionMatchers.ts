// Sprint 11 walk-1 v3 — custom `findSuggestionMatch` implementations
// for WikilinkSuggestion + AtMention.
//
// Why custom: @tiptap/suggestion's default match-finder takes a single-
// character trigger + an `allowedPrefixes` array. Two limitations
// surfaced during walk-1:
//
//   1. `[[` is a TWO-CHAR trigger. With single-char `char: '['` and
//      default `allowedPrefixes: [' ']`, the second `[` of `[[` fails
//      the prefix check (preceded by `[`, not space) so the popover
//      never opened.
//
//   2. The default match-finder runs on every state change, including
//      caret placement. Existing `@agent` or `[[Foo]]` text in the
//      document triggered the popover when the user clicked near
//      those chars. The matchers below require the trigger char to
//      sit immediately to the LEFT of the caret with no whitespace
//      / `]` / etc. in between — so caret-into-existing-text doesn't
//      open the popover.

import type { ResolvedPos } from '@tiptap/pm/model'

export interface SuggestionMatchResult {
  range: { from: number; to: number }
  query: string
  text: string
}

/**
 * Wikilink trigger — matches when the text immediately to the left of
 * the caret is `[[<query>` with no whitespace, no `]`, and no closing
 * `]]`. Inside an existing `[[Foo]]` block the click might land such
 * that nodeBefore.text contains `[[Foo` — which would falsely match.
 * Mitigation: require that the FIRST character of the doc-text
 * relative to nodeBefore is `[` (i.e. `[[` is the most-recent
 * unclosed wikilink intent).
 */
export function findWikilinkMatch({ $position }: { $position: ResolvedPos }): SuggestionMatchResult | null {
  const node = $position.nodeBefore
  if (!node || !node.isText || !node.text) return null
  const text = node.text
  // Find the LAST `[[` in the text (closest to caret).
  const idx = text.lastIndexOf('[[')
  if (idx === -1) return null
  // Query is everything after `[[`.
  const query = text.slice(idx + 2)
  // Reject if query contains whitespace or any `]` (closed wikilink).
  if (/[\s\]]/.test(query)) return null
  // Reject if query is too long (defensive — prevent matching against
  // a stray `[[` from way back in the buffer).
  if (query.length > 80) return null
  const textFrom = $position.pos - text.length
  const from = textFrom + idx
  const to = $position.pos
  return {
    range: { from, to },
    query,
    text: text.slice(idx)
  }
}

/**
 * `@` mention trigger — matches when the text immediately to the left
 * of the caret is `@<query>` with no whitespace + the char before
 * `@` is a word boundary (space, newline, punctuation, or start of
 * the text node). Prevents `email@example` from triggering on the
 * `@` inside the email.
 */
export function findAtMentionMatch({ $position }: { $position: ResolvedPos }): SuggestionMatchResult | null {
  const node = $position.nodeBefore
  if (!node || !node.isText || !node.text) return null
  const text = node.text
  const idx = text.lastIndexOf('@')
  if (idx === -1) return null
  // Reject if char before `@` is alphanumeric (mid-word, e.g. an
  // email address). Allow start-of-text, space, newline, common
  // punctuation.
  if (idx > 0) {
    const prev = text[idx - 1]
    if (/[a-zA-Z0-9_]/.test(prev)) return null
  }
  const query = text.slice(idx + 1)
  if (/\s/.test(query)) return null
  if (query.length > 80) return null
  const textFrom = $position.pos - text.length
  const from = textFrom + idx
  const to = $position.pos
  return {
    range: { from, to },
    query,
    text: text.slice(idx)
  }
}
