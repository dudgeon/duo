// ENH-208 Vault — the L0 corpus (PR1). "The vault IS the schema": types,
// entities, aliases, properties-per-type, and observed enum values are a
// pure function over frontmatter. Ported from the prototype's
// `lint.mjs buildCorpus`, with one deliberate correctness fix over the
// loose prototype: `templates/` is query-excluded (D5), so template files
// are NOT counted as entities — they are read separately as the soft-schema
// registry. (The prototype walked templates into the corpus, which also
// leaked a phantom `templates/milestone.md` row into milestone rollups.)

import fs from 'node:fs'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import type { Corpus, TypeTemplate, VaultFile } from './types'
import type { LinkRef } from '../markdown/vaultLinks'
import { readNotes, splitFrontmatter } from './parse'
import { extractLinkRefs, targetKey } from '../markdown/vaultLinks'

/** ENH-258 — the entity references the ENGINE folds to a `Link` (engine.ts
 *  `parseLinkish`): a wikilink, OR a rel-md link whose target is a `.md` note.
 *  `extractLinkRefs` is broader (it also matches a rel link to a NON-note
 *  file, e.g. `[Cover](./cover.png)`), but the engine keeps such a value a
 *  plain STRING — so it must NOT be offered as an entity operand (the GUI's
 *  `contains` would never resolve). Narrowing here keeps the corpus's
 *  classification in lock-step with the engine: `.md`/wikilink → entity ref
 *  (identity-matched via `contains`); anything else → a scalar string that
 *  `enumsByType` covers and `==` string-matches. */
function engineEntityRefs(value: string): LinkRef[] {
  return extractLinkRefs(value).filter((r) => r.syntax === 'wikilink' || /\.md$/i.test(r.rawTarget))
}

/** Read `templates/<type>.md` files as the soft-schema registry (D5). Each
 *  declares its `type`, optional filing `folder`, expected `fields`, and an
 *  optional embedded ```base rollup block. Absent `templates/` → []. */
export function loadTemplates(root: string): TypeTemplate[] {
  const dir = path.join(root, 'templates')
  let entries: string[]
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
  // Meta keys configure the TYPE (kept out of an entity's `fields`).
  const META_KEYS = new Set(['type', 'folder', 'filingParent', 'filingLoose', 'folderNote'])
  const out: TypeTemplate[] = []
  for (const f of entries.sort()) {
    const abs = path.join(dir, f)
    const raw = fs.readFileSync(abs, 'utf8')
    const { frontmatter, body } = splitFrontmatter(raw)
    const type = typeof frontmatter.type === 'string' ? frontmatter.type : path.basename(f, '.md')
    const folder = typeof frontmatter.folder === 'string' ? frontmatter.folder : null
    const filingParent = typeof frontmatter.filingParent === 'string' ? frontmatter.filingParent : null
    const filingLoose = typeof frontmatter.filingLoose === 'boolean' ? frontmatter.filingLoose : null
    const folderNote = frontmatter.folderNote === true
    const fields = Object.keys(frontmatter).filter((k) => !META_KEYS.has(k))
    const block = body.match(/```base\n([\s\S]*?)```/)
    out.push({
      type,
      folder,
      filingParent,
      filingLoose,
      folderNote,
      fields,
      frontmatter,
      relPath: `templates/${f}`,
      embeddedBase: block ? block[1] : null,
    })
  }
  return out
}

/** Build the corpus for a vault root. Walks entity notes (templates/out/
 *  internal dirs excluded), then folds in the template registry so a type
 *  declared only by its template still appears in `types`. */
export function buildCorpus(root: string): Corpus {
  const notes = readNotes(root)
  const types = new Set<string>()
  const entities: Corpus['entities'] = []
  const aliases: Record<string, string> = {}
  const propsByType = new Map<string, Set<string>>()
  const enumsByType = new Map<string, Set<string>>()
  // ENH-258 — entity-reference values per link-valued property (`${type}.${prop}`
  // → slug → display name, deduped by slug). A property lands here iff its
  // values are entity links (wikilink or OKF rel-md); those are kept OUT of
  // enumsByType, whose raw link strings are un-matchable filter operands.
  const entityRefsByType = new Map<string, Map<string, string>>()
  const countsByType = new Map<string, number>()

  for (const note of notes) {
    const fm = note.frontmatter
    const t = typeof fm.type === 'string' ? fm.type : null
    entities.push({ name: note.basename, type: t, path: note.relPath })

    const aliasList = Array.isArray(fm.aliases) ? fm.aliases : []
    for (const a of aliasList) aliases[String(a)] = note.basename

    if (t) {
      types.add(t)
      countsByType.set(t, (countsByType.get(t) ?? 0) + 1)
      if (!propsByType.has(t)) propsByType.set(t, new Set())
      for (const [k, v] of Object.entries(fm)) {
        propsByType.get(t)!.add(k)
        const key = `${t}.${k}`
        // ENH-258 — an ENTITY-valued property (any string value, scalar OR
        // array element, the engine folds to a Link) contributes its
        // {slug → display} to entityRefsByType and is NOT a scalar enum.
        // `engineEntityRefs` runs ONCE per value here; the scalar-enum guard
        // below reuses `scalarIsLink` rather than re-scanning (an array value
        // is never an enum candidate, matching the pre-ENH-258 behavior).
        let scalarIsLink = false
        for (const el of Array.isArray(v) ? v : [v]) {
          if (typeof el !== 'string') continue
          const refs = engineEntityRefs(el)
          if (el === v && refs.length > 0) scalarIsLink = true
          for (const ref of refs) {
            if (!entityRefsByType.has(key)) entityRefsByType.set(key, new Map())
            // First display wins for a given identity (stable label).
            if (!entityRefsByType.get(key)!.has(ref.key)) entityRefsByType.get(key)!.set(ref.key, ref.display)
          }
        }
        // Scalar, non-entity string → an enum candidate (status, team… AND a
        // rel link the engine keeps a plain string, e.g. a non-`.md` target,
        // which `==` string-matches). A wikilink / `.md` rel link is an entity
        // (above), never a raw-string enum operand — the ENH-258 fix.
        if (typeof v === 'string' && !scalarIsLink) {
          if (!enumsByType.has(key)) enumsByType.set(key, new Set())
          enumsByType.get(key)!.add(v)
        }
      }
    }
  }

  // ENH-259 — the TRANSITIVE ancestor closure per link-valued property, for
  // the builder's "is under" (any_parent) value picker: filtering
  // neighborhood.parent must offer States/Countries (reachable up the chain),
  // not just the direct Cities in entityRefsByType. For each note, walk its
  // link-prop chain following the SAME property name upward and collect every
  // ancestor entity (display name carried from each link; cycle-guarded).
  const byKey = new Map<string, VaultFile>()
  for (const n of notes) if (!byKey.has(targetKey(n.basename, 'wikilink'))) byKey.set(targetKey(n.basename, 'wikilink'), n)
  const directRefs = (note: VaultFile, prop: string): { slug: string; name: string }[] => {
    const v = note.frontmatter[prop]
    const out: { slug: string; name: string }[] = []
    for (const el of Array.isArray(v) ? v : [v]) {
      if (typeof el !== 'string') continue
      for (const ref of engineEntityRefs(el)) out.push({ slug: ref.key, name: ref.display })
    }
    return out
  }
  const ancestorRefsByType = new Map<string, Map<string, string>>()
  for (const note of notes) {
    const t = typeof note.frontmatter.type === 'string' ? note.frontmatter.type : null
    if (!t) continue
    for (const prop of Object.keys(note.frontmatter)) {
      const key = `${t}.${prop}`
      if (!entityRefsByType.has(key)) continue // only link-valued props have ancestors
      const seen = new Set<string>()
      const stack = directRefs(note, prop)
      while (stack.length) {
        const { slug, name } = stack.pop()!
        if (seen.has(slug)) continue
        seen.add(slug)
        if (!ancestorRefsByType.has(key)) ancestorRefsByType.set(key, new Map())
        if (!ancestorRefsByType.get(key)!.has(slug)) ancestorRefsByType.get(key)!.set(slug, name)
        const anc = byKey.get(slug)
        if (anc) for (const nxt of directRefs(anc, prop)) stack.push(nxt)
      }
    }
  }

  // ENH-262 — every entity a TYPE's notes link (ANY property, prose too —
  // the same edge set `file.hasLink` probes): the "links to" filter's value
  // options. Resolved against real corpus notes (an unresolvable slug can't
  // be offered as a pickable entity).
  const linkTargetsByType = new Map<string, Map<string, string>>()
  for (const note of notes) {
    const t = typeof note.frontmatter.type === 'string' ? note.frontmatter.type : null
    if (!t) continue
    for (const slug of note.links) {
      const target = byKey.get(slug)
      if (!target) continue
      if (!linkTargetsByType.has(t)) linkTargetsByType.set(t, new Map())
      if (!linkTargetsByType.get(t)!.has(slug)) linkTargetsByType.get(t)!.set(slug, target.basename)
    }
  }

  const templates = loadTemplates(root)
  for (const tpl of templates) types.add(tpl.type)

  const sortedRecord = (m: Map<string, Set<string>>): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    for (const k of [...m.keys()].sort()) out[k] = [...m.get(k)!].sort()
    return out
  }

  // ENH-258 — {slug → name} maps → sorted {name, slug, type}[] (by display
  // name). ENH-261 annotates each ref with its target note's `type` (null
  // when the slug doesn't resolve to a corpus note), so the GUI can offer
  // "goal (via parent)" ancestor group options and type-filtered pickers.
  const typeOf = (slug: string): string | null => {
    const n = byKey.get(slug)
    const t = n && typeof n.frontmatter.type === 'string' ? n.frontmatter.type : null
    return t
  }
  const sortedRefs = (
    m: Map<string, Map<string, string>>,
  ): Record<string, { name: string; slug: string; type: string | null }[]> => {
    const out: Record<string, { name: string; slug: string; type: string | null }[]> = {}
    for (const k of [...m.keys()].sort()) {
      out[k] = [...m.get(k)!.entries()]
        .map(([slug, name]) => ({ name, slug, type: typeOf(slug) }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    return out
  }

  // Template-only types count 0 (declared, unused) — R7 lists them anyway.
  const counts: Record<string, number> = {}
  for (const t of [...types].sort()) counts[t] = countsByType.get(t) ?? 0

  return {
    root,
    types: [...types].sort(),
    entities: entities.sort((a, b) => a.name.localeCompare(b.name)),
    aliases,
    propsByType: sortedRecord(propsByType),
    countsByType: counts,
    enumsByType: sortedRecord(enumsByType),
    entityRefsByType: sortedRefs(entityRefsByType),
    ancestorRefsByType: sortedRefs(ancestorRefsByType),
    linkTargetsByType: sortedRefs(linkTargetsByType),
    templates,
  }
}

/** Parse a `.base` file's YAML (used by lint/render in PR2 and exported
 *  here so corpus consumers share one parse path). Returns `null` on
 *  malformed YAML (caller decides how to surface it). */
export function parseBaseYaml(raw: string): Record<string, unknown> | null {
  try {
    const def = yamlLoad(raw)
    return def && typeof def === 'object' ? (def as Record<string, unknown>) : null
  } catch {
    return null
  }
}
