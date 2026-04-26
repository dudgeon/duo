// Stage 15.1 — Send → Duo payload formatter.
//
// Three runtime-configurable formats per PRD G10 / G19:
//
//   'a' — quote block + 1-line provenance (default; readable to humans
//         glancing at the terminal even when no agent is present).
//   'b' — literal selected text only (compact; agent has to call `duo
//         selection` for context).
//   'c' — opaque token like `<<duo-sel-abc123>>` (most compact;
//         requires the agent to expand via `duo selection`).
//
// The PTY write is plain text; we don't append Enter (G11 — user
// confirms by pressing Enter themselves).
//
// `kind: 'browser'` and `kind: 'html-canvas'` selections will use the
// same shapes; this v1 module handles the editor variant. The
// browser-side observer ships in Stage 15.2 with its own provenance
// formatter.

import type { MarkdownSelectionSnapshot, SelectionFormat } from '@shared/types'

/**
 * Pretty-print a path: prefer `~/...` when inside the user's HOME so
 * the provenance line is readable. Falls back to the literal absolute
 * path when HOME isn't a prefix.
 */
function shortenPath(absolute: string): string {
  const home = window.electron?.env?.HOME
  if (home && absolute.startsWith(home + '/')) {
    return '~' + absolute.slice(home.length)
  }
  if (home && absolute === home) return '~'
  return absolute
}

/**
 * Build the provenance segment for an editor selection — file path
 * plus heading trail. Example: `~/projects/foo/prd.md · Risks > Market`.
 * When the heading trail is empty, just the path.
 */
function editorProvenance(snapshot: MarkdownSelectionSnapshot): string {
  const path = shortenPath(snapshot.path)
  if (snapshot.heading_trail.length === 0) return path
  return `${path} · ${snapshot.heading_trail.join(' > ')}`
}

/**
 * Format A — quoted block + 1-line provenance, no Enter. Each line of
 * the selection gets its own `> ` prefix so multi-line selections
 * preserve their structure. Trailing space leaves the cursor parked
 * for the user's verb.
 */
function formatA(snapshot: MarkdownSelectionSnapshot): string {
  const text = snapshot.text || snapshot.paragraph || ''
  const quoted = text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  return `${quoted}\n> (${editorProvenance(snapshot)})\n`
}

/**
 * Format B — literal text only (no provenance, no quoting). The
 * agent reaches for `duo selection` if it needs context.
 */
function formatB(snapshot: MarkdownSelectionSnapshot): string {
  // Trailing space so the user can append a verb without backspacing.
  return (snapshot.text || snapshot.paragraph || '') + ' '
}

/**
 * Format C — opaque token. The renderer's selection cache already
 * holds the live snapshot (Stage 11 D29a); the agent expands by
 * calling `duo selection`. Token is a short random suffix so multiple
 * sends in one session don't collide visually in the user's history.
 */
function formatC(): string {
  // 6 hex chars is plenty — 16M space, only needs to be unique within
  // the user's eyeball-readable terminal scrollback.
  const id = Math.random().toString(16).slice(2, 8)
  return `<<duo-sel-${id}>> `
}

export function formatSendPayload(
  snapshot: MarkdownSelectionSnapshot,
  format: SelectionFormat
): string {
  switch (format) {
    case 'a': return formatA(snapshot)
    case 'b': return formatB(snapshot)
    case 'c': return formatC()
  }
}
