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
import type { Corpus, TypeTemplate } from './types'
import { readNotes, splitFrontmatter } from './parse'

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
  const out: TypeTemplate[] = []
  for (const f of entries.sort()) {
    const abs = path.join(dir, f)
    const raw = fs.readFileSync(abs, 'utf8')
    const { frontmatter, body } = splitFrontmatter(raw)
    const type = typeof frontmatter.type === 'string' ? frontmatter.type : path.basename(f, '.md')
    const folder = typeof frontmatter.folder === 'string' ? frontmatter.folder : null
    // Expected fields = declared frontmatter keys other than the meta keys
    // (`type`/`folder`), in declaration order.
    const fields = Object.keys(frontmatter).filter((k) => k !== 'type' && k !== 'folder')
    const block = body.match(/```base\n([\s\S]*?)```/)
    out.push({
      type,
      folder,
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

  for (const note of notes) {
    const fm = note.frontmatter
    const t = typeof fm.type === 'string' ? fm.type : null
    entities.push({ name: note.basename, type: t, path: note.relPath })

    const aliasList = Array.isArray(fm.aliases) ? fm.aliases : []
    for (const a of aliasList) aliases[String(a)] = note.basename

    if (t) {
      types.add(t)
      if (!propsByType.has(t)) propsByType.set(t, new Set())
      for (const [k, v] of Object.entries(fm)) {
        propsByType.get(t)!.add(k)
        // Scalar, non-wikilink string → an enum candidate (status, team…).
        if (typeof v === 'string' && !/^\[\[/.test(v)) {
          const key = `${t}.${k}`
          if (!enumsByType.has(key)) enumsByType.set(key, new Set())
          enumsByType.get(key)!.add(v)
        }
      }
    }
  }

  const templates = loadTemplates(root)
  for (const tpl of templates) types.add(tpl.type)

  const sortedRecord = (m: Map<string, Set<string>>): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    for (const k of [...m.keys()].sort()) out[k] = [...m.get(k)!].sort()
    return out
  }

  return {
    root,
    types: [...types].sort(),
    entities: entities.sort((a, b) => a.name.localeCompare(b.name)),
    aliases,
    propsByType: sortedRecord(propsByType),
    enumsByType: sortedRecord(enumsByType),
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
