// ENH-110 — JSON / YAML format helpers for JsonView.
//
// Format is implicit from the path extension (owner pick during 2026-05-10
// decision gate: single tab kind + format discriminator). Parsing /
// serialization route through these helpers so JsonView itself stays
// format-agnostic.

import * as yaml from 'js-yaml'

export type JsonFormat = 'json' | 'yaml'

/** Pick the format from a file path. Default 'json' — caller routes
 *  via fileClassifier so unknown extensions never reach this. */
export function formatFromPath(path: string): JsonFormat {
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''
  return ext === 'yml' || ext === 'yaml' ? 'yaml' : 'json'
}

/** Parse a string into a JS value. Throws with the parser's native
 *  message on failure; caller surfaces the message in the error UI. */
export function parseSource(text: string, format: JsonFormat): unknown {
  if (format === 'yaml') {
    return yaml.load(text)
  }
  // .jsonl is one JSON value per line. Treat it as an array for tree
  // viewing — each line becomes one element. Empty lines + leading/
  // trailing whitespace are skipped.
  return JSON.parse(text)
}

/** Serialize a JS value back to source text. Always appends a trailing
 *  newline (POSIX-friendly + matches markdown editor's normalization
 *  contract from BUG-107). */
export function serializeSource(value: unknown, format: JsonFormat): string {
  if (format === 'yaml') {
    // Owner-relevant trade-off (documented in skill/SKILL.md): YAML
    // round-trip strips comments + anchor names. Pure-content YAML is
    // preserved exactly; structural YAML may diverge.
    return yaml.dump(value, { indent: 2, lineWidth: 100, noRefs: true })
  }
  return JSON.stringify(value, null, 2) + '\n'
}

/** Empty-document seed for ⌘N. JSON gets `{}`; YAML gets a comment-
 *  only doc so the user has somewhere to start typing. */
export function emptySeed(format: JsonFormat): string {
  return format === 'yaml' ? '# YAML document\n' : '{}\n'
}

/** Walk-5 fix (ENH-110) — humanize a parser error so the user gets
 *  guidance, not just the raw V8 / js-yaml message. Returns
 *  `{ summary, hint, raw }`:
 *    - summary: short headline ("Cannot parse as JSON")
 *    - hint: one-sentence what-to-check, based on the message
 *      pattern. Empty string if no useful hint applies.
 *    - raw: the original error text (with line/col when present),
 *      shown as the technical detail beneath the hint.
 */
export interface ParserErrorDisplay {
  summary: string
  hint: string
  raw: string
}

export function humanizeParseError(err: unknown, format: JsonFormat): ParserErrorDisplay {
  const raw = err instanceof Error ? err.message : String(err)
  const summary = `Cannot parse as ${format === 'yaml' ? 'YAML' : 'JSON'}`

  if (format === 'yaml') {
    if (/bad indentation/i.test(raw)) {
      return { summary, hint: 'YAML uses spaces (not tabs) for indent. Make sure each child key indents the same amount under its parent.', raw }
    }
    if (/mapping values are not allowed/i.test(raw)) {
      return { summary, hint: 'A line has a `:` without a key context. Often: missing space after the colon, or an unquoted special character (try wrapping the value in quotes).', raw }
    }
    if (/duplicated mapping key/i.test(raw)) {
      return { summary, hint: 'The same key appears twice in the same map. Rename one or remove the duplicate.', raw }
    }
    if (/unexpected end/i.test(raw)) {
      return { summary, hint: 'The document ended mid-value. Check that the last line has a complete value (no dangling key with no value, no unclosed quoted string).', raw }
    }
    return { summary, hint: '', raw }
  }

  // JSON
  if (/Unexpected end of JSON input/i.test(raw)) {
    return { summary, hint: 'The document ended too early. Check for a missing closing `}`, `]`, or `"` on the last line.', raw }
  }
  if (/Bad control character in string literal/i.test(raw)) {
    return { summary, hint: 'A string contains a literal control character (newline, tab, backslash). Inside JSON strings, escape these as `\\n`, `\\t`, or `\\\\`.', raw }
  }
  if (/Unterminated string/i.test(raw)) {
    return { summary, hint: 'A string opened with `"` was never closed. Look for a missing `"` on the line indicated.', raw }
  }
  if (/Unexpected token/i.test(raw)) {
    return { summary, hint: 'A character appeared where it didn\'t belong. Common causes: missing comma between items, trailing comma after the last item, unquoted property name, single-quoted string (JSON requires double quotes).', raw }
  }
  if (/Expected property name or '\}'/i.test(raw)) {
    return { summary, hint: 'A property name was expected but something else appeared. Property names must be wrapped in double quotes (e.g. `"name":` not `name:`).', raw }
  }
  return { summary, hint: '', raw }
}
