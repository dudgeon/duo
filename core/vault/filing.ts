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
import type { TypeTemplate, VaultMode } from './types'
import { loadTemplates } from './corpus'
import { seedFrontmatterLines } from './scaffold'
import { slugStem } from '../markdown/vaultLinks'
import { ensureNoteId } from './move'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Strip path-unsafe characters from an entity name to form a filename
 *  stem (the wikilink basename is preserved as-is in links; this only
 *  guards the on-disk name). */
export function safeName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').slice(0, 80)
}

/** The relative path a fresh stub of `template`'s type files at (D19).
 *
 *  ENH-216: `mode` (default `obsidian`) picks the on-disk stem rule. In
 *  `obsidian` mode the stem is the human name verbatim (minus path-unsafe
 *  chars) — Obsidian resolves wikilinks by that basename. In `okf` mode the
 *  stem is SLUGGED (`Customer Orders` → `customer-orders`, D6), with a
 *  lowercased-safeName fallback for the degenerate empty-slug case. */
export function stubPathFor(
  template: TypeTemplate,
  name: string,
  asOf: Date = new Date(),
  mode: VaultMode = 'obsidian',
): string {
  const stem = mode === 'okf' ? slugStem(name) || safeName(name).toLowerCase() : safeName(name)
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
 *
 * ENH-216: `mode` (default `obsidian`) picks the stem rule for the template
 * filename AND its canonical `type:` value. Obsidian normalizes to a
 * lowercased safeName (`Decision Log` → `decision log`); OKF slugs it
 * (`decision-log`, D6). The empty-name guard keys on the obsidian normal form
 * so both modes reject a name that normalizes to nothing.
 */
export function createType(root: string, type: string, mode: VaultMode = 'obsidian'): CreateTypeResult {
  const normal = safeName(type).toLowerCase()
  if (!normal) throw new Error('empty type name')
  const stem = mode === 'okf' ? slugStem(type) || normal : normal
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
 * the D19 rule. Throws on an unknown type. `body` seeds optional initial
 * prose.
 *
 * ENH-216: `mode` (default `obsidian`) shapes both the on-disk stem and the
 * frontmatter:
 *  - OBSIDIAN — unchanged. Idempotent: if a note already exists at the target
 *    it's left untouched (`created: false`) — the silent-stub flow only
 *    creates on an unresolved wikilink, so a re-trigger must never clobber.
 *  - OKF — the stem is slugged (D6) so genuinely-different human names can
 *    slug-collide; rather than clobber, a collision guard appends `-2`, `-3`,
 *    … (like `captureNote`) and always creates. The human `name` is stamped
 *    into `title:` (D6: link text is the slug, the human name lives in
 *    frontmatter), and a stable `id:` is minted + stamped at create time
 *    (`ensureNoteId`, D10 — the D5 primary relink key).
 */
export function createEntityStub(
  root: string,
  type: string,
  name: string,
  opts: { asOf?: Date; body?: string; mode?: VaultMode } = {},
): StubResult {
  const mode: VaultMode = opts.mode ?? 'obsidian'
  const template = loadTemplates(root).find((t) => t.type === type)
  if (!template) {
    const known = loadTemplates(root).map((t) => t.type).join(', ')
    throw new Error(`unknown type "${type}" (known: ${known || 'none'})`)
  }
  const rel = stubPathFor(template, name, opts.asOf, mode)
  const body = opts.body ? opts.body + '\n' : ''

  if (mode === 'obsidian') {
    const abs = path.join(root, rel)
    // Idempotent — a re-triggered same-name link must never clobber.
    if (fs.existsSync(abs)) {
      return { path: rel, absPath: abs, type, created: false }
    }
    const fm = ['---', ...seedFrontmatterLines(template), '---', '']
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, fm.join('\n') + '\n' + body)
    return { path: rel, absPath: abs, type, created: true }
  }

  // OKF — slug-collision guard: a slugged stem can collide where the human
  // names differ, so disambiguate with a `-2`/`-3` suffix rather than
  // clobber (like `captureNote`). The stem is the final path segment.
  let target = rel
  if (fs.existsSync(path.join(root, target))) {
    const dot = rel.lastIndexOf('.')
    const stemPath = dot >= 0 ? rel.slice(0, dot) : rel
    const ext = dot >= 0 ? rel.slice(dot) : ''
    for (let n = 2; fs.existsSync(path.join(root, target)); n++) {
      target = `${stemPath}-${n}${ext}`
    }
  }
  const abs = path.join(root, target)
  // type: + title: (the human name, D6) + seeded fields.
  const fm = ['---', ...seedFrontmatterLines(template, { mode, title: name }), '---', '']
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, fm.join('\n') + '\n' + body)
  // D10: mint + stamp a stable id (the D5 primary relink key). `ensureNoteId`
  // splices it into the just-written frontmatter byte-preservingly.
  ensureNoteId(abs, root)
  return { path: target, absPath: abs, type, created: true }
}
