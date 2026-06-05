// ENH-195 — pure plain-text surgical replace for `duo doc edit`.
// Sibling to docEdit.ts, but with the opposite intent: this produces a
// literal edited body with NO CriticMarkup tokens — the find text is
// replaced outright, not wrapped in `{~~old~>new~~}`. Use docEdit.ts
// when the change should land as a tracked suggestion; use this when
// the agent is making a direct, accepted edit to the raw markdown.
//
// Everything here is literal (non-regex) string matching. No file IO,
// no editor, no DOM — testable in isolation.
//
// Scope:
//   - Default: the whole body.
//   - opts.atLine (1-indexed): only the single line at that position
//     (split on `\n`). The replace runs within that line; the body is
//     reconstructed by rejoining the (possibly multi-result) line back
//     into the surrounding lines.
//
// Disambiguation (matches the `duo doc *` family's occurrence model):
//   - opts.all          → replace every occurrence.
//   - opts.occurrence N → replace only the Nth (1-indexed).
//   - neither, 1 match  → replace it.
//   - neither, >1 match → refuse (ambiguous) and tell the caller to
//     pass --occurrence or --all.

export interface PlainEditResult {
  /** The body after the replace. Equal to the input on a no-op. */
  body: string
  /** Whether the body actually changed. False indicates a no-op
   *  (e.g. find not found, ambiguous, out-of-range). */
  changed: boolean
  /** How many occurrences were replaced. 0 on any no-op. */
  replacements: number
  /** Human-readable description of the no-op reason, when applicable.
   *  Empty string on success. */
  reason: string
}

export interface PlainReplaceOpts {
  /** When the find text appears more than once, pick the Nth occurrence
   *  (1-indexed). Ignored when `all` is set. */
  occurrence?: number
  /** Replace every occurrence in scope. Takes precedence over
   *  `occurrence`. */
  all?: boolean
  /** Restrict the replace to the single line at this 1-indexed position
   *  (split on `\n`). When unset, the scope is the whole body. */
  atLine?: number
}

/** Count literal (non-overlapping) occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let pos = 0
  for (;;) {
    const idx = haystack.indexOf(needle, pos)
    if (idx < 0) break
    count++
    pos = idx + needle.length
  }
  return count
}

/** Replace the Nth (1-indexed) literal occurrence of `needle`. Returns the
 *  original string unchanged when `occurrence` is out of range. */
function replaceNth(
  haystack: string,
  needle: string,
  replacement: string,
  occurrence: number
): string {
  let pos = 0
  for (let i = 1; ; i++) {
    const idx = haystack.indexOf(needle, pos)
    if (idx < 0) return haystack
    if (i === occurrence) {
      return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length)
    }
    pos = idx + needle.length
  }
}

/** Replace every literal occurrence of `needle`. */
function replaceAll(haystack: string, needle: string, replacement: string): string {
  let out = ''
  let pos = 0
  for (;;) {
    const idx = haystack.indexOf(needle, pos)
    if (idx < 0) {
      out += haystack.slice(pos)
      break
    }
    out += haystack.slice(pos, idx) + replacement
    pos = idx + needle.length
  }
  return out
}

export function plainReplace(
  body: string,
  find: string,
  replace: string,
  opts: PlainReplaceOpts = {}
): PlainEditResult {
  if (find === '') {
    return { body, changed: false, replacements: 0, reason: 'find text is empty' }
  }

  // Resolve the scope: the whole body, or a single line. For the
  // line-scoped case we operate on `scope`, then splice the edited line
  // back into the surrounding lines to rebuild the body.
  let scope = body
  let lines: string[] | null = null
  let lineIdx = -1
  if (opts.atLine !== undefined) {
    lines = body.split('\n')
    lineIdx = opts.atLine - 1
    if (lineIdx < 0 || lineIdx >= lines.length) {
      return {
        body,
        changed: false,
        replacements: 0,
        reason: `line ${opts.atLine} out of range (${lines.length} lines)`
      }
    }
    scope = lines[lineIdx]
  }

  const count = countOccurrences(scope, find)
  if (count === 0) {
    return { body, changed: false, replacements: 0, reason: 'find text not found' }
  }

  let edited: string
  let replacements: number
  if (opts.all) {
    edited = replaceAll(scope, find, replace)
    replacements = count
  } else if (opts.occurrence !== undefined) {
    if (opts.occurrence < 1 || opts.occurrence > count) {
      return {
        body,
        changed: false,
        replacements: 0,
        reason: `occurrence ${opts.occurrence} of ${count} not found`
      }
    }
    edited = replaceNth(scope, find, replace, opts.occurrence)
    replacements = 1
  } else if (count === 1) {
    edited = replaceNth(scope, find, replace, 1)
    replacements = 1
  } else {
    return {
      body,
      changed: false,
      replacements: 0,
      reason: `ambiguous: ${count} matches — pass --occurrence N or --all`
    }
  }

  // Rebuild the body. For line-scoped edits, splice the edited line back
  // into place and rejoin; otherwise the edited scope IS the new body.
  let newBody: string
  if (lines !== null) {
    lines[lineIdx] = edited
    newBody = lines.join('\n')
  } else {
    newBody = edited
  }

  return { body: newBody, changed: true, replacements, reason: '' }
}
