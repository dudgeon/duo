// ENH-208 Vault — shared types for the vault core (Phase 1, PR1).
//
// The vault core is a pure, fs-backed module (no Electron deps) so it
// bundles into the `duo` CLI *and* runs under vitest. Phase 3 will share
// the same module with the renderer (replacing the CLI-spawn path), so
// nothing here may import from `electron` / `renderer`.
//
// Vocabulary (CLAUDE.md glossary + PRD § 2):
//   entity  — a note representing a thing, typed by folder + frontmatter `type:`
//   corpus  — the vault-derived schema (types / entities / aliases / props /
//             enums), a *pure function over frontmatter* (the vault IS the
//             schema). Never cached to disk (no-sidecar rule, CLAUDE.md § 12).

/** A parsed markdown note inside a vault. `basename`/`name` are
 *  extension-less (Obsidian resolves wikilinks by basename). */
export interface VaultFile {
  /** Absolute path on disk. */
  absPath: string
  /** Path relative to the vault root, POSIX-separated. */
  relPath: string
  /** Extension-less file name — the wikilink resolution key. */
  basename: string
  /** Parent folder relative to the vault root (`''` at the root). */
  folder: string
  /** Lowercased extension without the dot (`md`). */
  ext: string
  /** Parsed YAML frontmatter (`{}` when absent or unparseable). */
  frontmatter: Record<string, unknown>
  /** Note body (everything after the frontmatter block). */
  body: string
  /** Deduped wikilink targets found in the body, basename-only
   *  (`[[Foo|bar]]` and `[[Foo#h]]` both resolve to `Foo`). */
  links: string[]
  /** File mtime in epoch-ms (used by stale-inbox processing checks). */
  mtimeMs: number
}

/** A `templates/<type>.md` soft schema (D5). Templates are query-excluded:
 *  they declare what a type expects, they are not entities themselves. */
export interface TypeTemplate {
  /** The `type:` this template defines (also its filename stem). */
  type: string
  /** Destination folder for entities of this type, when declared. */
  folder: string | null
  /** Expected field names (frontmatter keys minus the `type` marker). */
  fields: string[]
  /** Full parsed template frontmatter (authoritative field defaults). */
  frontmatter: Record<string, unknown>
  /** Path relative to the vault root. */
  relPath: string
  /** A template-embedded ```base block (the `… == this` rollup pattern,
   *  D8) so every entity of the type inherits the rollup. Null when none. */
  embeddedBase: string | null
}

/** The L0 corpus — a pure function over vault frontmatter (PRD P2,
 *  `duo vault schema`). Computed live; never persisted. */
export interface Corpus {
  /** Vault root (absolute) the corpus was computed from. */
  root: string
  /** All observed `type:` values, sorted. */
  types: string[]
  /** Every entity note: extension-less name, its declared type (or
   *  null when untyped — a processing work-item), and its rel path. */
  entities: { name: string; type: string | null; path: string }[]
  /** alias → canonical basename (from frontmatter `aliases:`). */
  aliases: Record<string, string>
  /** type → observed frontmatter property names. */
  propsByType: Record<string, string[]>
  /** `${type}.${prop}` → observed scalar (non-link) values — the live
   *  enum domain used by lint's "did you mean" and the type picker. */
  enumsByType: Record<string, string[]>
  /** The type templates (the soft-schema registry, D5). */
  templates: TypeTemplate[]
}

/** A vault detected in the workspace (`duo vault list`). */
export interface VaultInfo {
  /** Absolute vault root (the folder containing `.obsidian/`). */
  root: string
  /** Vault display name (the root folder's basename). */
  name: string
  /** Markdown note count (cheap signal of vault size). */
  noteCount: number
}

/** A full-text search hit (`duo vault search`, ⌘⇧F's CLI twin — D22). */
export interface SearchHit {
  /** Path relative to the vault root. */
  path: string
  /** Absolute path (so the agent can open file-at-line directly). */
  absPath: string
  /** 1-based line number of the match. */
  line: number
  /** The matching line, trimmed for display. */
  excerpt: string
}
