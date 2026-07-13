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
// everywhere: the editor's two OKF touch-points (the BODY [[ ]] gesture's
// expand-on-resolve and cmd+click nav) each want a slightly editor-shaped
// signature. Keeping that adaptation in one renderer file means the
// extensions stay free of path-math + the import-depth of ../../../core
// stays in one place.
//
// ENH-266 (2026-07-09) — REVERSES FOLLOWUP-051. A live Obsidian validation
// found the FOLLOWUP-051 premise wrong: OKF filenames are SLUGS, and
// Obsidian's frontmatter-wikilink resolver matches by FILENAME only (not
// title, not aliases) — so a title-based `owner: "[[Alice Park]]"` value
// creates an UNRESOLVED PHANTOM NODE in Obsidian's graph instead of linking
// the real `alice-park.md` note. A standard markdown link value
// `owner: "[Alice Park](../people/alice-park.md)"` (same syntax prose
// already uses) resolves CORRECTLY in Obsidian AND reads with zero code
// changes through Duo's own `extractLinkRefs`/`engineEntityRefs` (both
// already accept either syntax). So OKF frontmatter entity references are
// now QUOTED markdown links, via `okfFrontmatterLinkInsert` below. Obsidian
// mode is UNCHANGED — frontmatter there still keeps `[[Title]]` (Obsidian
// filenames ARE the titles in that mode, so basename resolution works).

import {
  serializeOkfLink,
  serializeOkfFrontmatterLink,
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
 * mode writes at rest for a BODY link: `[Display](./rel.md)`.
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
 * No double-square-bracket link ever persists in an OKF mode BODY — that is
 * the whole point of the verb-driven serializer split. (Frontmatter is the
 * exception: a frontmatter `[[ ]]` stays `[[ ]]` per FOLLOWUP-051, because a
 * bare rel-path there isn't a graph edge in Duo or Obsidian.)
 */
export function okfLinkInsert(
  displayOrBasename: string,
  docPath: string,
  targetPath: string,
): string {
  return serializeOkfLink(docPath, targetPath, displayOrBasename)
}

/**
 * ENH-266 — build the QUOTED markdown-link value OKF mode writes for a
 * FRONTMATTER entity-reference field: `"[Display](./rel.md)"`. Same
 * relative-path math as {@link okfLinkInsert}, plus the YAML-safe quoting a
 * frontmatter VALUE needs (a bare `[` would otherwise open a YAML flow
 * sequence). Never use `okfLinkInsert` for a frontmatter value — only for
 * the BODY, where no quoting applies.
 */
export function okfFrontmatterLinkInsert(
  displayOrBasename: string,
  docPath: string,
  targetPath: string,
): string {
  return serializeOkfFrontmatterLink(docPath, targetPath, displayOrBasename)
}
