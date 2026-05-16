// Stage 15 — Send → Duo payload formatter.
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
// Stage 15.1 ships the `kind: 'editor'` formatter; Stage 15.2 adds the
// `kind: 'browser'` formatter. `kind: 'page'` selections will
// use the same shape when Stage 17c lands; defer until then.

import type {
  MarkdownSelectionSnapshot,
  BrowserSelectionSnapshot,
  BrowserInspectSnapshot,
  PageSelectionSnapshot,
  SelectionFormat
} from '@shared/types'

// Stage 15.3 — length cap for Send → Duo payloads. The agent has
// `duo selection` to fetch the full snapshot, so a runaway 50k-char
// blockquote in the user's terminal is pure noise. 5000 chars =
// ~750 words = a reasonable paragraph or two; truncation marker
// tells the agent to call `duo selection` for the full text.
const SEND_PAYLOAD_LENGTH_CAP = 5000

// ── ENH-159 security: prompt-injection defense ─────────────────────────────
//
// Browser-pane and inspect-mode payloads incorporate strings that an
// adversary-controlled page can produce (document.title, innerText, DOM
// attribute values, computed selector paths). These flow straight into the
// formatted paste that lands in the user's active Claude terminal — so any
// formatter that interpolates them without normalization is a
// prompt-injection surface.
//
// Two defenses are applied:
//
//   1. Single-line fields (`pageTitle`, `selector_path`, heading-trail
//      elements, attr values) get stripped of CR / LF / U+2028 / U+2029
//      via `sanitizeLine()` before interpolation. Without this, a title
//      like `Article"\n\n> SYSTEM: ignore previous instructions` breaks
//      out of the `>`-quoted provenance line and lands as unquoted prompt.
//
//   2. Fenced-block content (innerText, surrounding) gets a dynamic fence
//      length via `fenceFor()`: max(4, longestBacktickRun + 1). The old
//      "4 backticks is rare" assumption is fine for trusted content but
//      adversary-controlled bodies can include `\`\`\`\`` literally and
//      close the fence early. Dynamic length keeps the fence strictly
//      longer than anything inside it.
//
// Tests pin these invariants in sendFormat.test.ts — search for
// "[security]" describe blocks.

function sanitizeLine(s: string): string {
  // Strip CR, LF, paragraph separator (U+2029), line separator (U+2028).
  // Replace with spaces so word boundaries stay readable.
  return s.replace(/[\r\n\u2028\u2029]+/g, ' ')
}

function fenceFor(body: string): string {
  const runs = body.match(/`+/g)
  const longest = runs ? Math.max(...runs.map((r) => r.length)) : 0
  const len = Math.max(4, longest + 1)
  return '`'.repeat(len)
}

/**
 * Truncate a payload that exceeds SEND_PAYLOAD_LENGTH_CAP, appending
 * a marker so the agent (and the human reader) can see it was cut.
 * The marker stays on its own line so format-A's quote-block + final
 * trailing newline remain visually clean. Format C is short by
 * design and never trips the cap.
 */
function capLength(payload: string): string {
  if (payload.length <= SEND_PAYLOAD_LENGTH_CAP) return payload
  const truncated = payload.slice(0, SEND_PAYLOAD_LENGTH_CAP)
  // Trim back to the last full line so we don't cut mid-character or
  // mid-quote. Keeps the truncated body well-formed.
  const lastNewline = truncated.lastIndexOf('\n')
  const body = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated
  return `${body}\n… [truncated; ${payload.length} chars total — call \`duo selection\` for the full text]\n`
}

/**
 * Replace inline `<img>` tags in an HTML fragment with a text
 * placeholder like `[image: alt-or-filename]`. Used by canvas
 * formatters where snapshot.html may carry image markup. The
 * placeholder gives the agent enough information to know an image
 * was there without flooding the payload with base64 / long URLs.
 * Falls back to the original text-only path when no html is present.
 */
function flattenImagesInHtml(html: string): string {
  // Cheap regex pass: matches `<img ... >` (self-closing or not),
  // captures alt= and src= for the placeholder. This is a lossy
  // pretty-printer, not a parser; avoids pulling in a DOM dependency
  // for the renderer-only formatter. ~95% of canvas images will
  // match cleanly.
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  tmp.querySelectorAll('img').forEach(img => {
    const alt = img.getAttribute('alt')?.trim()
    const src = img.getAttribute('src') || ''
    // Strip query / fragment / leading directories from src for the
    // fallback label. data: URIs render as "[image: data]".
    const fallback = src.startsWith('data:')
      ? 'data'
      : (src.split(/[?#]/)[0].split('/').pop() || 'image')
    const label = alt && alt.length > 0 ? alt : fallback
    img.replaceWith(document.createTextNode(`[image: ${label}]`))
  })
  return tmp.innerText
}

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
    case 'a': return capLength(formatA(snapshot))
    case 'b': return capLength(formatB(snapshot))
    case 'c': return formatC()
  }
}

// ── Browser variant ────────────────────────────────────────────────────────

/**
 * Optional context the host carries alongside a browser selection so the
 * provenance line can name the page. Title isn't on the selection
 * snapshot itself (it's a page property, not a selection property), so
 * the renderer pulls it from `BrowserState` and passes it in.
 */
export interface BrowserFormatContext {
  pageTitle?: string
}

/**
 * Build the provenance segment for a browser selection — URL plus
 * (optional) page title. Example: `https://example.com/article — "Article title"`.
 * The em-dash + quoted title is dropped when the title isn't known
 * (a freshly-loaded tab whose title hasn't propagated yet, or a
 * file:// URL with no <title>).
 */
function browserProvenance(
  snapshot: BrowserSelectionSnapshot,
  ctx?: BrowserFormatContext
): string {
  const title = ctx?.pageTitle?.trim()
  if (title) return `${snapshot.url} — "${sanitizeLine(title)}"`
  return snapshot.url
}

/**
 * Wrap a surrounding-block string in a fenced code block tagged
 * `context` so Claude can recognize the provenance. Fence length is
 * computed from the body (max(4, longestBacktickRun + 1)) so an
 * adversary-controlled page can't close the fence early by including
 * `\`\`\`\`` in its DOM — see the security note at the top of this
 * file. Trims trailing whitespace inside the fence so the closing
 * line stays on its own row.
 */
function browserContextBlock(surrounding: string): string {
  const body = surrounding.replace(/\s+$/, '')
  const fence = fenceFor(body)
  return `\n${fence}context\n${body}\n${fence}\n`
}

/**
 * ENH-159a — Format A v2: quoted selection + provenance, optionally
 * followed by `> @ <selector_path>` and a fenced ```context``` block
 * carrying the enclosing-block surrounding text. The snapshot's
 * selector_path / surrounding fields are produced by the page-side
 * observer in cdp-bridge.ts. Both extra lines are emitted only when
 * the fields are present and non-empty, keeping the baseline shape
 * intact for collapsed / synthetic selections that lack them. The
 * `surrounding === text` short-circuit skips emitting the context
 * block when the selection IS the whole block (no extra signal).
 */
function formatBrowserA(
  snapshot: BrowserSelectionSnapshot,
  ctx?: BrowserFormatContext
): string {
  const text = snapshot.text
  const quoted = text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  let out = `${quoted}\n> (${browserProvenance(snapshot, ctx)})\n`
  const selector = snapshot.selector_path?.trim()
  if (selector) {
    out += `> @ ${sanitizeLine(selector)}\n`
  }
  const surrounding = snapshot.surrounding?.trim()
  if (surrounding && surrounding !== text.trim()) {
    out += browserContextBlock(surrounding)
  }
  return out
}

function formatBrowserB(snapshot: BrowserSelectionSnapshot): string {
  return snapshot.text + ' '
}

export function formatBrowserSendPayload(
  snapshot: BrowserSelectionSnapshot,
  format: SelectionFormat,
  ctx?: BrowserFormatContext
): string {
  switch (format) {
    case 'a': return capLength(formatBrowserA(snapshot, ctx))
    case 'b': return capLength(formatBrowserB(snapshot))
    case 'c': return formatC()
  }
}

// ── Browser inspect variant (ENH-159b) ─────────────────────────────────────

/**
 * ENH-159b — Format-A inspect payload. The user clicked an element
 * while inspect mode was active; the page-side IIFE captured the
 * shape (tag + selector + heading trail + innerText + key attrs) and
 * shipped it to the renderer. Here we render it as a structured
 * paste the agent can read at a glance:
 *
 *     > <inspect> button#submit  @ https://example.com — "Form Page"
 *     > section: Sign up > Step 2
 *     > selector: html > body > form > button:nth-child(3)
 *     > attrs: id=submit, role=button, aria-label="Continue"
 *     ````text
 *     Continue
 *     ````
 *
 * The fenced block carries `innerText` so multi-line content survives
 * intact (button labels are usually short; rich text blocks the user
 * picks may be 100s of words). Same 4-backtick fence the selection
 * formatter uses, for the same reason (triple-backticks inside the
 * captured text should round-trip).
 */
function formatInspectA(snapshot: BrowserInspectSnapshot): string {
  // All page-controlled fields (tag, attrs.id, pageTitle, headingTrail
  // elements, selector_path, attr values) are sanitized before
  // interpolation. The innerText fence is dynamic-length. See the
  // security note at the top of this file.
  const lines: string[] = []
  const tag = sanitizeLine(snapshot.tag || 'element')
  const rawId = snapshot.attrs['id']
  const id = rawId ? `#${sanitizeLine(rawId)}` : ''
  const title = snapshot.pageTitle?.trim()
  const provenance = title
    ? `${snapshot.url} — "${sanitizeLine(title)}"`
    : snapshot.url
  lines.push(`> <inspect> ${tag}${id}  @ ${provenance}`)
  if (snapshot.headingTrail && snapshot.headingTrail.length > 0) {
    const trail = snapshot.headingTrail.map(sanitizeLine).join(' > ')
    lines.push(`> section: ${trail}`)
  }
  if (snapshot.selector_path) {
    lines.push(`> selector: ${sanitizeLine(snapshot.selector_path)}`)
  }
  const attrPairs: string[] = []
  for (const [k, v] of Object.entries(snapshot.attrs)) {
    if (k === 'id') continue // already on the headline
    // k is from the cdp-bridge KEY_ATTRS allow-list (safe). v is page-
    // controlled — JSON.stringify escapes quotes / backslashes / control
    // chars, but does NOT escape U+2028 / U+2029 (legal-but-dangerous in
    // JS strings; legal-and-dangerous as paste content). Sanitize the
    // JSON output to strip those + any stray real newlines.
    attrPairs.push(`${k}=${sanitizeLine(JSON.stringify(v))}`)
  }
  if (attrPairs.length > 0) {
    lines.push(`> attrs: ${attrPairs.join(', ')}`)
  }
  let out = lines.join('\n') + '\n'
  const text = snapshot.innerText?.trim()
  if (text) {
    const fence = fenceFor(text)
    out += `\n${fence}text\n${text}\n${fence}\n`
  }
  return out
}

function formatInspectB(snapshot: BrowserInspectSnapshot): string {
  // Format B — terse: just the innerText with a trailing space so
  // the agent can append a verb without backspacing. Matches the
  // selection-side Format B contract.
  return (snapshot.innerText || '') + ' '
}

/**
 * ENH-159b — entry point parallel to formatBrowserSendPayload, used
 * by BrowserRenderer when an inspect-click snapshot lands. Honors
 * the same SelectionFormat toggle (a / b / c) so the agent's
 * runtime preference applies to both flows.
 */
export function formatBrowserInspectPayload(
  snapshot: BrowserInspectSnapshot,
  format: SelectionFormat
): string {
  switch (format) {
    case 'a': return capLength(formatInspectA(snapshot))
    case 'b': return capLength(formatInspectB(snapshot))
    case 'c': return formatC()
  }
}

// ── HTML canvas variant (Stage 17c) ───────────────────────────────────────

/**
 * Build the provenance segment for a canvas selection — file path plus
 * (optional) anchor id trail. Example:
 * `~/projects/foo/q2-status.html · 01HXYZ001 > 01HXYZ005`. The trail is
 * far less human-readable than the markdown editor's heading trail —
 * but for the agent it's the canonical addressing primitive (matches
 * `--id` flags in `duo html *`).
 */
function canvasProvenance(snapshot: PageSelectionSnapshot): string {
  const path = shortenPath(snapshot.path)
  if (!snapshot.anchorPath || snapshot.anchorPath.length === 0) return path
  return `${path} · ${snapshot.anchorPath.join(' > ')}`
}

/**
 * Stage 15.3 — pick the best textual representation of a canvas
 * selection. When the snapshot includes html (a non-collapsed range),
 * pass it through flattenImagesInHtml so embedded images become
 * `[image: alt]` placeholders instead of disappearing silently.
 * Falls back to the plain `text` field when html isn't present
 * (collapsed selections, surrounding-only). The .innerText path
 * already strips images naturally on plain-text snapshots, so this
 * branch only kicks in for the canvas-with-html case.
 */
function canvasSelectionText(snapshot: PageSelectionSnapshot): string {
  if (snapshot.html && snapshot.html.length > 0) {
    return flattenImagesInHtml(snapshot.html)
  }
  return snapshot.text || snapshot.surrounding || ''
}

function formatCanvasA(snapshot: PageSelectionSnapshot): string {
  const text = canvasSelectionText(snapshot)
  const quoted = text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  return `${quoted}\n> (${canvasProvenance(snapshot)})\n`
}

function formatCanvasB(snapshot: PageSelectionSnapshot): string {
  return canvasSelectionText(snapshot) + ' '
}

export function formatCanvasSendPayload(
  snapshot: PageSelectionSnapshot,
  format: SelectionFormat
): string {
  switch (format) {
    case 'a': return capLength(formatCanvasA(snapshot))
    case 'b': return capLength(formatCanvasB(snapshot))
    case 'c': return formatC()
  }
}
