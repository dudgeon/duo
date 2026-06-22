// ENH-224 Phase 2 — D7 prefill ("everything filled, one tap, editable").
//
// Pure derivation of the share-back proposal metadata — branch name, PR title,
// PR body — from the diverged doc. No I/O, fully unit-testable; the confirm
// sheet (UI) and `duo pr create` (CLI) both consume identical defaults, then
// let the user override (D7).
//
//   branch  duo/<doc-slug>-<short>           (OQ-5 naming convention)
//   title   the doc's first `# heading`, else the file name
//   body    a one-line "Proposed via Duo" + the file path

import type { ProposalMeta } from '../../shared/types'

/** Strip a leading YAML frontmatter block (`---\n…\n---`) so the first heading
 *  isn't shadowed by frontmatter. Pure; tolerant of CRLF + missing fence. */
export function stripLeadingFrontmatter(markdown: string): string {
  if (!/^﻿?---\r?\n/.test(markdown)) return markdown
  // Find the closing fence on its own line.
  const m = markdown.match(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/)
  return m ? markdown.slice(m[0].length) : markdown
}

/** The first ATX `# ` heading text (any level), else null. Pure. */
export function firstHeading(markdown: string): string | null {
  const body = stripLeadingFrontmatter(markdown)
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) {
      const text = m[2].trim()
      if (text) return text
    }
  }
  return null
}

/** Lowercase kebab slug: alnum runs joined by single hyphens, trimmed, capped.
 *  Pure. Empty input (or all-punctuation) → 'doc'. */
export function slugify(text: string, maxLen = 40): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')   // drop punctuation/diacritic marks
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '')        // a mid-word cut can leave a trailing hyphen
  return slug || 'doc'
}

/** The share-back branch name: `duo/<slug>-<short>` (OQ-5). `short` is supplied
 *  by the caller (e.g. a baseline-SHA prefix) so this stays pure/deterministic.
 *  Pure. */
export function branchName(slug: string, short: string): string {
  const safeShort = (short || '').replace(/[^\w.-]/g, '').slice(0, 12) || 'duo'
  return `duo/${slug || 'doc'}-${safeShort}`
}

/**
 * Derive the full proposal prefill (D7). `fileName` is the basename used for
 * the slug + the title fallback; `docText` supplies the heading title;
 * `short` disambiguates the branch (caller passes a deterministic token).
 * Pure.
 */
export function deriveProposalMeta(opts: {
  docText: string
  fileName: string
  short: string
}): ProposalMeta {
  const { docText, fileName, short } = opts
  const heading = firstHeading(docText)
  const baseName = fileName.replace(/\.[^.]+$/, '') // drop extension for slug/title
  const title = heading || baseName || fileName || 'Proposed changes'
  const slug = slugify(heading || baseName || 'doc')
  const branch = branchName(slug, short)
  // Single-quoted concat so the markdown code-span backticks around the file
  // name are literal (never terminate a template literal).
  const body = 'Proposed via Duo.\n\nEdits to `' + fileName + '`.'
  return { branch, title, body }
}
