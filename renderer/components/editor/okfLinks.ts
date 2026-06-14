// ENH-216 OKF Vault Mode (U7) — renderer-side link helpers.
//
// THIN wrappers over the single node-free link helper
// (core/markdown/vaultLinks.ts). This module owns ZERO rel-path / slug
// math — it just adapts the editor's call shapes (a doc path + a target
// path + a display string) onto `serializeOkfLink` / `relLink` and
// re-exports the click-nav resolver. The "one graph model, two
// serializers" rule (D3) lives entirely in vaultLinks.ts; the editor
// reaches it through here.
//
// Why a renderer-local seam instead of importing vaultLinks directly
// everywhere: the editor's three OKF touch-points (the [[ ]] gesture's
// expand-on-resolve, cmd+click nav, the frontmatter [[Name]] commit
// rewrite) each want a slightly editor-shaped signature. Keeping that
// adaptation in one renderer file means the extensions stay free of
// path-math + the import-depth of ../../../core stays in one place.

import {
  serializeOkfLink,
  resolveMarkdownLinkHref,
  type VaultMode,
  type LinkSyntax,
} from '../../../core/markdown/vaultLinks'

// Re-export the click-nav resolver verbatim so consumers (MarkdownEditor's
// handleClickOn) import it from the editor-local seam, not from deep in
// core. Behaviour is unchanged — see vaultLinks.resolveMarkdownLinkHref.
export { resolveMarkdownLinkHref }
export type { VaultMode, LinkSyntax }

/**
 * D3 EXPAND-ON-RESOLVE — build the standard markdown relative link OKF
 * mode writes at rest: `[Display](./rel.md)`.
 *
 * `displayOrBasename` is the link TEXT (D6): the HUMAN name the user
 * typed for a freshly-created stub, or the on-disk SLUG (`item.basename`)
 * when picking an existing note. `docPath` is the SOURCE note (the file
 * being edited); `targetPath` is the link TARGET. Both paths may be
 * absolute or both vault-relative — `relLink` only cares about the
 * relationship between them, and absolute paths sharing the vault root
 * produce the same `../`-anchored result as their vault-relative twins
 * (the shared-prefix drop cancels the common ancestors either way).
 *
 * No double-square-bracket link ever persists in OKF mode — that is the
 * whole point of the verb-driven serializer split.
 */
export function okfLinkInsert(
  displayOrBasename: string,
  docPath: string,
  targetPath: string,
): string {
  return serializeOkfLink(docPath, targetPath, displayOrBasename)
}

// `[[Name]]` / `[[Name|Display]]` inside a frontmatter VALUE. Capture the
// inner text up to the first `|` (alias) or the closing `]]`.
const FM_WIKILINK_RE = /\[\[([^\]]+?)\]\]/g

/**
 * D7 — rewrite any `[[Name]]` gesture inside a frontmatter block to a
 * quoted relative-path STRING, mode-gated to OKF. The FrontmatterPanel is
 * a raw textarea (no live fuzzy-pick), so this runs on COMMIT, not on
 * keystroke — an honest v1 limitation.
 *
 * `resolve(name)` maps a wikilink target (the inner `Name`, alias
 * stripped) to the link target path used for `relLink` — the same
 * abs-or-vault-relative path the autocomplete would feed `okfLinkInsert`.
 * It returns null when the name resolves to no known note; an unresolved
 * `[[Name]]` is left untouched (harmless — the user can fix the name or
 * create the note, then re-commit). The result is the rewritten text plus
 * the count of links actually rewritten (so the caller can skip a no-op
 * write).
 *
 * The replacement is a YAML double-quoted scalar: `"./rel.md"`. Any
 * embedded `"` / `\` in the path is escaped so the emitted YAML stays
 * valid even for pathological note names (slugStem already strips most
 * such characters, but the resolver could hand back any path).
 */
export async function rewriteFrontmatterWikilinks(
  text: string,
  docPath: string,
  resolve: (name: string) => Promise<string | null> | string | null,
): Promise<{ text: string; rewritten: number }> {
  // Collect the matches first (regex + async resolve don't compose inline).
  const matches: { whole: string; index: number; name: string }[] = []
  FM_WIKILINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FM_WIKILINK_RE.exec(text)) !== null) {
    const inner = m[1]
    const pipe = inner.indexOf('|')
    const name = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
    if (!name) continue
    matches.push({ whole: m[0], index: m.index ?? 0, name })
  }
  if (matches.length === 0) return { text, rewritten: 0 }

  // Resolve each unique name once.
  const cache = new Map<string, string | null>()
  for (const match of matches) {
    if (cache.has(match.name)) continue
    const resolved = await resolve(match.name)
    cache.set(match.name, resolved ?? null)
  }

  // Rebuild left-to-right, splicing replacements at the recorded offsets so
  // overlapping note names can't double-substitute.
  let out = ''
  let cursor = 0
  let rewritten = 0
  for (const match of matches) {
    const target = cache.get(match.name) ?? null
    out += text.slice(cursor, match.index)
    if (target) {
      const rel = okfLinkRelTarget(docPath, target)
      out += yamlQuote(rel)
      rewritten++
    } else {
      // Unresolved — leave the gesture verbatim.
      out += match.whole
    }
    cursor = match.index + match.whole.length
  }
  out += text.slice(cursor)
  return { text: out, rewritten }
}

/** The `./rel.md` portion of an OKF link, reusing the serializer so the
 *  path math stays in one place (parse it back out of the `[ ](…)`). */
function okfLinkRelTarget(docPath: string, targetPath: string): string {
  // serializeOkfLink returns `[display](rel)`; the rel is the parenthesized
  // tail. Display is irrelevant here (frontmatter wants a bare path string),
  // so pass an empty display and slice the href out.
  const link = serializeOkfLink(docPath, targetPath, ' ')
  const open = link.lastIndexOf('(')
  const close = link.lastIndexOf(')')
  if (open >= 0 && close > open) return link.slice(open + 1, close)
  return link
}

/** Double-quote a YAML scalar, escaping `\` and `"` so the emitted value
 *  parses even when the path carries quote-ish characters. */
function yamlQuote(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}
