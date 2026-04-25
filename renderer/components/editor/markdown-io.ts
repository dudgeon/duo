// Stage 11 — markdown ↔ disk bridging helpers.
//
// The editor model operates on the *body* markdown only; YAML frontmatter is
// preserved verbatim and stitched back on save. The frontmatter properties
// panel (PRD D15) will later render a typed UI over the same raw YAML.

export interface FrontmatterSplit {
  /** Raw YAML between the `---` fences, newlines preserved, no fences. */
  frontmatter: string | null
  /** Body markdown — what the editor renders. */
  body: string
  /** Characters used for the closing fence newline (\n or \r\n). */
  eol: '\n' | '\r\n'
}

const FENCE_RE = /^---\s*\r?\n/
const CLOSE_RE = /(^|\n)---\s*(\r?\n|$)/

export function splitFrontmatter(md: string): FrontmatterSplit {
  const eol: '\n' | '\r\n' = md.includes('\r\n') ? '\r\n' : '\n'
  const openMatch = md.match(FENCE_RE)
  if (!openMatch) return { frontmatter: null, body: md, eol }

  const afterOpen = md.slice(openMatch[0].length)
  const closeMatch = afterOpen.match(CLOSE_RE)
  if (!closeMatch || closeMatch.index === undefined) {
    return { frontmatter: null, body: md, eol }
  }

  // closeMatch.index points at the `\n` or string start that precedes `---`.
  const closeStart = closeMatch.index + (closeMatch[1].length)
  const closeLen = closeMatch[0].length - closeMatch[1].length
  const frontmatter = afterOpen.slice(0, closeStart).replace(/\r?\n$/, '')
  const body = afterOpen.slice(closeStart + closeLen).replace(/^\r?\n+/, '')

  return { frontmatter, body, eol }
}

export function joinFrontmatter(
  frontmatter: string | null,
  body: string,
  eol: '\n' | '\r\n' = '\n'
): string {
  if (frontmatter === null) return body
  return `---${eol}${frontmatter}${eol}---${eol}${eol}${body}`
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}
