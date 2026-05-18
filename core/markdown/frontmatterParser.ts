// BUG-139 — defensive YAML-frontmatter parser. Wraps `js-yaml` with
// a non-throwing surface so a malformed YAML block doesn't take down
// the editor's render. Returns a discriminated result so callers can
// branch on the parse outcome (valid → render structured rows;
// invalid → surface the error inline + keep showing the raw textarea).
//
// Why a separate module: the renderer's FrontmatterPanel uses this
// on every keystroke in the raw-YAML edit mode (to highlight parse
// errors live), and Phase 2+ may add a similar reader path for
// other surfaces (e.g. canvas-side property panel). Keeping the
// shape canonical here avoids drift.

import yaml from 'js-yaml'

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue }

export interface FrontmatterParseResult {
  valid: boolean
  /** Top-level object when parse succeeds AND root is a mapping;
   *  null when the YAML parses but isn't an object (e.g. a bare list
   *  or scalar — uncommon for frontmatter); also null on parse
   *  failure. */
  parsed: Record<string, FrontmatterValue> | null
  /** Human-readable error string when parse failed. Empty on success. */
  error: string
  /** True when the input is empty or whitespace-only. valid stays
   *  true (an empty frontmatter is a degenerate-but-legal state). */
  empty: boolean
}

/**
 * Parse a YAML frontmatter string. Never throws; always returns a
 * shape callers can render. The parser is configured for safe
 * defaults — no custom tags, no class instantiation.
 *
 * Empty / whitespace-only input is treated as valid + empty (the
 * "no properties yet" case). YAML that parses to a non-object root
 * (e.g. a top-level list) is treated as invalid for frontmatter
 * purposes since the Properties panel needs key:value rows.
 */
export function parseFrontmatter(raw: string | null): FrontmatterParseResult {
  if (raw === null || raw.trim().length === 0) {
    return { valid: true, parsed: {}, error: '', empty: true }
  }
  try {
    const result = yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as unknown
    if (result === null || result === undefined) {
      return { valid: true, parsed: {}, error: '', empty: true }
    }
    if (typeof result !== 'object' || Array.isArray(result)) {
      return {
        valid: false,
        parsed: null,
        error: 'Frontmatter must be a YAML mapping (key: value pairs)',
        empty: false
      }
    }
    return {
      valid: true,
      parsed: result as Record<string, FrontmatterValue>,
      error: '',
      empty: false
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { valid: false, parsed: null, error: message, empty: false }
  }
}

/**
 * Format a parsed frontmatter value back to YAML string. Used when
 * the structured panel commits an edit (single-property change → re-
 * emit the whole block). Configured with sensible defaults that
 * round-trip cleanly through `parseFrontmatter`.
 */
export function serializeFrontmatter(parsed: Record<string, FrontmatterValue>): string {
  if (!parsed || Object.keys(parsed).length === 0) return ''
  try {
    // `noRefs` avoids YAML anchors/aliases for repeated values (more
    // readable for hand-editing). `lineWidth: -1` disables line
    // wrapping (we control formatting via the source view).
    return yaml.dump(parsed, {
      schema: yaml.JSON_SCHEMA,
      noRefs: true,
      lineWidth: -1
    }).replace(/\n$/, '')  // strip trailing newline; joinFrontmatter adds one
  } catch {
    return ''
  }
}

/**
 * Render a single value for display in the structured rows view.
 * Strings are unquoted, booleans / numbers / null render verbatim,
 * arrays and objects render compactly via JSON.stringify (v1 — the
 * Properties panel doesn't yet have a typed editor for complex
 * values; raw-YAML mode is the escape hatch).
 */
export function displayValue(value: FrontmatterValue): string {
  if (value === null || value === undefined) return '∅'
  if (typeof value === 'string') return value
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  // Arrays + objects → compact JSON.
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
