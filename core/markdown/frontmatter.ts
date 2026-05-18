// Pure YAML-frontmatter split / join helpers. Mirror of the renderer
// helper at `renderer/components/editor/markdown-io.ts` but in core/
// so non-renderer code (socket-server's doc-edit case) can use it
// without an upward import.
//
// Kept in sync with the renderer copy. If the two diverge a regression
// test should catch it (both follow the same `--- … ---\n\n` fence
// pattern; the split is deterministic).

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
