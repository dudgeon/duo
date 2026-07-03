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

import type { LinkRef, VaultMode } from '../markdown/vaultLinks'

/** A vault's at-rest link serialization (ENH-216). ONE graph model, TWO
 *  serializers: `obsidian` (wikilinks, the existing default) and `okf`
 *  (standard markdown relative links). Mode is LIVE-DETECTED from the
 *  in-vault marker (D4) — NEVER cached in a registry / prefs file.
 *  Canonical home is the node-free `core/markdown/vaultLinks.ts` (in both
 *  tsconfigs); re-exported here for the node-only vault tree's consumers. */
export type { VaultMode }

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
  /** ENH-216: every link occurrence (both wikilink + mdlink syntaxes) in
   *  document order, with provenance — the richer companion to `links`
   *  (which stays the deduped basename-key list, used by the graph).
   *  Optional: producers populate it via {@link import('../markdown/vaultLinks').extractLinkRefs};
   *  the legacy `parseFile` walk leaves it undefined until a later stage
   *  wires it through (every extract path flows through `vaultLinks.ts`). */
  linkRefs?: LinkRef[]
  /** File mtime in epoch-ms (used by stale-inbox processing checks). */
  mtimeMs: number
}

/** A `templates/<type>.md` soft schema (D5) + filing rule (D19). Templates
 *  are query-excluded: they declare what a type expects + where its entities
 *  file, but are not entities themselves. The *meta* keys (`type`, `folder`,
 *  `filingParent`, `filingLoose`, `folderNote`) configure the type; the
 *  remaining keys are the entity's expected `fields`. */
export interface TypeTemplate {
  /** The `type:` this template defines (also its filename stem). */
  type: string
  /** For PARENTLESS types (person, theme): the type's registry folder
   *  (`people`, `themes`). Null for parented types (D19). */
  folder: string | null
  /** For PARENTED types (milestone, meeting): the frontmatter attribute
   *  whose value is the filing parent — e.g. milestone → `"initiative"`,
   *  so a milestone files under its initiative's folder (D19). Null for
   *  parentless types. */
  filingParent: string | null
  /** For parented types: true → entities sit loose in the parent's folder;
   *  false → in a per-type subfolder (e.g. `notes/`). Null when N/A. */
  filingLoose: boolean | null
  /** True for a folder-note type (initiative): its entity owns a folder
   *  named after it, and ONLY folder-note types may be filing parents
   *  (D19). */
  folderNote: boolean
  /** Expected entity field names (frontmatter keys minus the meta keys). */
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
  /** ENH-248 R7 — type → live entity count. A template-only type (declared
   *  but unused) counts 0, so the Vault tab's Entities section can still
   *  list it as creatable. */
  countsByType: Record<string, number>
  /** `${type}.${prop}` → observed scalar (non-link) values — the live
   *  enum domain used by lint's "did you mean" and the type picker. */
  enumsByType: Record<string, string[]>
  /** The type templates (the soft-schema registry, D5). */
  templates: TypeTemplate[]
}

/** A vault detected in the workspace (`duo vault list`). */
export interface VaultInfo {
  /** Absolute vault root (the folder containing the in-vault marker). */
  root: string
  /** Vault display name (the root folder's basename). */
  name: string
  /** Markdown note count (cheap signal of vault size). */
  noteCount: number
  /** ENH-216: the vault's at-rest link mode, LIVE-DETECTED from the in-vault
   *  marker (D4) at list time — never cached. */
  mode: VaultMode
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
  /** 0-based occurrence index of this hit within the file's BODY text —
   *  what the editor doc contains after frontmatter is stripped — counting
   *  every non-overlapping occurrence per line; `null` for frontmatter
   *  hits. Lets the ⌘⇧F palette hand the editor the exact occurrence to
   *  jump to (D22) without the two sides counting different things. */
  docMatchIndex: number | null
  /** ENH-214 — true when this hit's file lives under a `templates/` dir. The
   *  ⌘⇧F palette renders an inline "Template" badge for these (search
   *  surfaces templates even though the graph/parse walk excludes them).
   *  Constant across a file's hits. */
  isTemplate: boolean
}
