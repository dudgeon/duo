// ENH-208 Vault — D19 entity stub creation (model layer for the silent-stub
// type-picker, and reusable by capture / processing).
//
// `stubPathFor` is the PURE path rule for a FRESH stub — when an entity is
// first created from a `[[New Name]]` mention with no parent context yet:
//   - folder-note type (initiative): owns a folder → <folder>/<Name>/<Name>.md
//   - parentless registry type (person/theme): <folder>/<Name>.md
//   - parented type (milestone/meeting), parent not yet known: a time-bucket
//     residue notes/YYYY/MM/<Name>.md — processing re-files it under the
//     parent once one resolves (D19). (The under-parent subfolder rule for
//     a KNOWN parent is a processing concern, not a fresh-stub concern, so it
//     lives with the processing op — kept out of here deliberately.)

import fs from 'node:fs'
import path from 'node:path'
import type { TypeTemplate } from './types'
import { loadTemplates } from './corpus'
import { seedFrontmatterLines } from './scaffold'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Strip path-unsafe characters from an entity name to form a filename
 *  stem (the wikilink basename is preserved as-is in links; this only
 *  guards the on-disk name). */
export function safeName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').slice(0, 80)
}

/** The relative path a fresh stub of `template`'s type files at (D19). */
export function stubPathFor(template: TypeTemplate, name: string, asOf: Date = new Date()): string {
  const stem = safeName(name)
  if (template.folderNote) {
    const folder = template.folder ?? `${template.type}s`
    return `${folder}/${stem}/${stem}.md`
  }
  if (template.folder) {
    return `${template.folder}/${stem}.md`
  }
  // Parented type, no parent context yet → time-bucket residue.
  return `notes/${asOf.getFullYear()}/${pad(asOf.getMonth() + 1)}/${stem}.md`
}

export interface CreateTypeResult {
  /** `templates/<stem>.md`, relative to the vault root. */
  path: string
  /** The CANONICAL type name (the normalized stem) — what stubs must use. */
  type: string
}

/**
 * Create a new soft-schema type: writes `templates/<stem>.md` with the type
 * stamped (minimal — no folder/filingParent, so fresh stubs of the type
 * land in the notes/YYYY/MM time-bucket, the D19 residue). Idempotent like
 * createEntityStub: an existing template is left untouched.
 *
 * Returns the CANONICAL type name — callers must stub with `type` from the
 * result, not their raw input: createEntityStub matches template types
 * strictly, so a raw "Decision Log" against the normalized "decision log"
 * template would dead-end on `unknown type` forever. Throws when the name
 * normalizes to nothing.
 */
export function createType(root: string, type: string): CreateTypeResult {
  const stem = safeName(type).toLowerCase()
  if (!stem) throw new Error('empty type name')
  const rel = `templates/${stem}.md`
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) {
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, `---\ntype: ${stem}\n---\n`)
  }
  return { path: rel, type: stem }
}

export interface StubResult {
  /** Path relative to the vault root. */
  path: string
  /** Absolute path. */
  absPath: string
  /** The type stamped. */
  type: string
  /** False when a note already existed at the target (left untouched). */
  created: boolean
}

/**
 * Create an entity stub of `type` named `name` from its template, filed by
 * the D19 rule. Idempotent: if a note already exists at the target it is
 * left untouched (`created: false`) — the silent-stub flow only creates on
 * an unresolved link, so a re-trigger must never clobber. Throws on an
 * unknown type. `body` seeds optional initial prose.
 */
export function createEntityStub(
  root: string,
  type: string,
  name: string,
  opts: { asOf?: Date; body?: string } = {},
): StubResult {
  const template = loadTemplates(root).find((t) => t.type === type)
  if (!template) {
    const known = loadTemplates(root).map((t) => t.type).join(', ')
    throw new Error(`unknown type "${type}" (known: ${known || 'none'})`)
  }
  const rel = stubPathFor(template, name, opts.asOf)
  const abs = path.join(root, rel)
  if (fs.existsSync(abs)) {
    return { path: rel, absPath: abs, type, created: false }
  }
  const fm = ['---', ...seedFrontmatterLines(template), '---', '']
  const body = opts.body ? opts.body + '\n' : ''
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, fm.join('\n') + '\n' + body)
  return { path: rel, absPath: abs, type, created: true }
}
