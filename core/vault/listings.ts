// ENH-216 OKF Vault Mode — generated listings (U3, Stage 1).
//
// OKF mode (D8) ships STATIC, regenerable listing files derived from the
// corpus — no live query engine at rest, just plain markdown an editor or
// agent can read:
//
//   index.md  — OKF section-6: a heading per Type (or folder Group) then
//               bullets `* [Title](rel) - description`. The ROOT index.md is
//               ALSO the OKF mode marker (its `okf_version` frontmatter, D4),
//               so its frontmatter block is preserved BYTE-IDENTICALLY — we
//               regex-replace ONLY the body after the closing `---`, between
//               the shared `<!-- duo:listing -->` fence (co-owned with U2's
//               scaffold, which writes the frontmatter + the empty fence).
//   log.md    — OKF section-7: `## YYYY-MM-DD` groups, newest first, each note
//               a bullet. Dates come from file mtimes (cheap + offline; git
//               authorship would need a spawn — noted in the stamp).
//
// Every write is OKF-mode-GATED (`detectVaultMode`; throws in Obsidian mode —
// Obsidian stays byte-identical, the frozen-fixture invariant). Each generated
// file carries an HTML-comment stamp with the source hash so staleness is
// detectable, exactly like the rollup render artifact.
//
// `promoteSection` splits a `## section` of a note into its own entity, leaving
// a markdown LINK in OKF mode (a wikilink in Obsidian) — NEVER an embed-
// transclusion (D9). It reuses `createEntityStub` / `stubPathFor` from filing.
//
// All rel-path / slug / serialize logic is IMPORTED from the single node-free
// helper (`../markdown/vaultLinks`); this module never reimplements it.

import fs from 'node:fs'
import path from 'node:path'
import { readNotes, parseFile, splitFrontmatter } from './parse'
import { detectVaultMode } from './detect'
import { loadTemplates } from './corpus'
import { stubPathFor, createEntityStub, safeName } from './filing'
import { sourceHash } from './render'
import { relLink, serializeOkfLink, serializeWikilink } from '../markdown/vaultLinks'
import type { VaultFile, VaultMode } from './types'

// ── frontmatter readers (display/description) ─────────────────────────────────

/** A note's human title for a listing: `title:` frontmatter (D6 — the human
 *  name lives there), else the basename. */
function noteTitle(note: VaultFile): string {
  const t = note.frontmatter.title
  if (typeof t === 'string' && t.trim()) return t.trim()
  return note.basename
}

/** A note's one-line description for a listing bullet: `description:` →
 *  `summary:` → `''`. */
function noteDescription(note: VaultFile): string {
  for (const key of ['description', 'summary']) {
    const v = note.frontmatter[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/** A note's group label for index.md sectioning: its `type:` (capitalized),
 *  else its top-level folder, else `Other`. */
function groupLabel(note: VaultFile): string {
  const t = note.frontmatter.type
  if (typeof t === 'string' && t.trim()) {
    return t.trim().replace(/^[a-z]/, (c) => c.toUpperCase())
  }
  const top = note.folder ? note.folder.split('/')[0] : ''
  return top || 'Other'
}

// ── index.md (OKF section-6) ──────────────────────────────────────────────────

/** Should a note be excluded from listings entirely? The generated listing
 *  files themselves, and anything under the always-skipped dirs the walk
 *  already drops. (`readNotes` already skips templates/out/.obsidian/.trash.) */
function isGeneratedListing(relPath: string): boolean {
  const base = relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath
  return base === 'index.md' || base === 'log.md'
}

/** Generate the OKF section-6 listing body (no frontmatter, no stamp) for the
 *  notes under `dir` (vault-relative; `''` / undefined → the whole vault).
 *  A heading per Type/Group, then `* [Title](rel) - description` bullets,
 *  links relative to the index file that will hold this body. */
export function generateIndex(root: string, dir = ''): string {
  const dirNorm = dir.replace(/^\/+|\/+$/g, '')
  // The index file these links are relative TO: <dir>/index.md.
  const indexRel = dirNorm ? `${dirNorm}/index.md` : 'index.md'

  const notes = readNotes(root)
    .filter((n) => !isGeneratedListing(n.relPath))
    .filter((n) => {
      if (!dirNorm) return true
      return n.folder === dirNorm || n.folder.startsWith(dirNorm + '/')
    })

  // Group by label, each group's notes sorted by title.
  const groups = new Map<string, VaultFile[]>()
  for (const n of notes) {
    const g = groupLabel(n)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(n)
  }

  const sections: string[] = []
  for (const label of [...groups.keys()].sort()) {
    const rows = groups.get(label)!.sort((a, b) => noteTitle(a).localeCompare(noteTitle(b)))
    const lines = [`## ${label}`, '']
    for (const n of rows) {
      const href = relLink(indexRel, n.relPath)
      const desc = noteDescription(n)
      lines.push(`* [${noteTitle(n)}](${href})${desc ? ` - ${desc}` : ''}`)
    }
    sections.push(lines.join('\n'))
  }

  if (!sections.length) return '_No notes yet._'
  return sections.join('\n\n')
}

// ── log.md (OKF section-7) ────────────────────────────────────────────────────

function ymd(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Generate the OKF section-7 log body (no frontmatter, no stamp): `## YYYY-
 *  MM-DD` day groups, newest first, each note a `* [Title](rel)` bullet.
 *  Dates come from file mtimes (offline-cheap; the stamp records the source). */
export function generateLog(root: string): string {
  const logRel = 'log.md'
  const notes = readNotes(root).filter((n) => !isGeneratedListing(n.relPath))

  const byDay = new Map<string, VaultFile[]>()
  for (const n of notes) {
    const day = ymd(n.mtimeMs)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(n)
  }

  const days = [...byDay.keys()].sort().reverse() // newest first
  if (!days.length) return '_No notes yet._'

  const sections: string[] = []
  for (const day of days) {
    const rows = byDay.get(day)!.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const lines = [`## ${day}`, '']
    for (const n of rows) {
      lines.push(`* [${noteTitle(n)}](${relLink(logRel, n.relPath)})`)
    }
    sections.push(lines.join('\n'))
  }
  return sections.join('\n\n')
}

// ── stamping + write ──────────────────────────────────────────────────────────

/** The shared body fence (co-owned with U2's scaffold). U2 writes the
 *  frontmatter block + an EMPTY fence; U3 regex-replaces ONLY between the two
 *  fence markers, leaving the frontmatter byte-identical. */
export const LISTING_FENCE = '<!-- duo:listing -->'

/** The generated-stamp comment carrying the source hash (staleness key) +
 *  the date source, mirroring the rollup render artifact's BUILD ARTIFACT
 *  stamp. */
function generatedStamp(root: string, kind: string, dateSource: string): string {
  const hash = sourceHash(root)
  const at = new Date().toISOString()
  return `<!-- duo:generated ${kind} · generated ${at} · source-hash ${hash} · dates from ${dateSource} -->`
}

export interface WriteListingsOptions {
  /** Also write a per-directory `index.md` for each subfolder that holds
   *  notes (default false — only the root index.md + root log.md). */
  perDir?: boolean
}

export interface WriteListingsResult {
  mode: VaultMode
  /** Vault-relative paths written. */
  written: string[]
}

/** Splice a freshly generated body into a ROOT index.md, preserving the
 *  existing `okf_version` frontmatter BYTE-IDENTICALLY (D4 — it's the OKF
 *  marker). The body AFTER the closing `---` is replaced wholesale; the
 *  shared `<!-- duo:listing -->` fence opens the generated region. Returns the
 *  new full file content. */
function spliceRootIndex(existingRaw: string, stamp: string, body: string): string {
  const m = existingRaw.match(/^---\n[\s\S]*?\n---\n?/)
  if (!m) {
    // No frontmatter to preserve (shouldn't happen for an OKF root, but be
    // safe): write a bare body region.
    return `${LISTING_FENCE}\n${stamp}\n\n${body}\n`
  }
  const frontmatterBlock = m[0] // byte-preserved verbatim
  const region = `${LISTING_FENCE}\n${stamp}\n\n${body}\n`
  return frontmatterBlock + region
}

/** Generate + write the OKF static listings (D8). OKF-mode-GATED: throws in
 *  Obsidian mode (Obsidian stays byte-identical — the frozen-fixture
 *  invariant). Writes the root `index.md` (frontmatter byte-preserved) + the
 *  root `log.md`; with `perDir`, also a per-subfolder `index.md`. Each file
 *  carries a `<!-- duo:generated … source-hash … -->` stamp. */
export function writeListings(root: string, opts: WriteListingsOptions = {}): WriteListingsResult {
  const mode = detectVaultMode(root)
  if (mode !== 'okf') {
    throw new Error(
      `writeListings is OKF-mode only (D8): vault mode is ${mode ?? 'not-a-vault'}. ` +
        `Obsidian-mode vaults stay byte-identical (no generated listings).`,
    )
  }

  const written: string[] = []

  // Root index.md — preserve its okf_version frontmatter byte-identically.
  const rootIndexAbs = path.join(root, 'index.md')
  const existing = fs.readFileSync(rootIndexAbs, 'utf8') // OKF root always has it
  const indexBody = generateIndex(root, '')
  const indexStamp = generatedStamp(root, 'index', 'corpus')
  fs.writeFileSync(rootIndexAbs, spliceRootIndex(existing, indexStamp, indexBody))
  written.push('index.md')

  // Root log.md — a standalone generated file (no preserved frontmatter).
  const logAbs = path.join(root, 'log.md')
  const logStamp = generatedStamp(root, 'log', 'file mtimes')
  fs.writeFileSync(logAbs, `${logStamp}\n\n# Log\n\n${generateLog(root)}\n`)
  written.push('log.md')

  if (opts.perDir) {
    // Each subfolder that contains notes gets its own index.md.
    const dirs = new Set<string>()
    for (const n of readNotes(root)) {
      if (isGeneratedListing(n.relPath)) continue
      if (n.folder) dirs.add(n.folder)
    }
    for (const dir of [...dirs].sort()) {
      const abs = path.join(root, dir, 'index.md')
      const stamp = generatedStamp(root, 'index', 'corpus')
      fs.writeFileSync(abs, `${stamp}\n\n${generateIndex(root, dir)}\n`)
      written.push(`${dir}/index.md`)
    }
  }

  return { mode, written }
}

// ── promoteSection (D9) ───────────────────────────────────────────────────────

export interface PromoteResult {
  /** The created/targeted entity's rel path. */
  entityRel: string
  /** The link spelling left behind in the source note. */
  leftLink: string
  /** False when an entity already existed at the target (left untouched). */
  created: boolean
}

/** Find a `## heading` section in a note's body and return its `[start,end)`
 *  byte range (inclusive of the heading line, up to the next same-or-higher
 *  heading or EOF). Returns null when the heading isn't found. */
function findSection(body: string, heading: string): { start: number; end: number; content: string } | null {
  const lines = body.split('\n')
  const want = heading.trim().toLowerCase()
  let startLine = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/)
    if (m && m[2].trim().toLowerCase() === want) {
      startLine = i
      level = m[1].length
      break
    }
  }
  if (startLine < 0) return null
  let endLine = lines.length
  for (let i = startLine + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/)
    if (m && m[1].length <= level) {
      endLine = i
      break
    }
  }
  // Byte offsets in the original body.
  const start = lines.slice(0, startLine).reduce((acc, l) => acc + l.length + 1, 0)
  const end = lines.slice(0, endLine).reduce((acc, l) => acc + l.length + 1, 0)
  // The section content WITHOUT its heading line (the body of the new entity).
  const content = lines.slice(startLine + 1, endLine).join('\n').replace(/^\n+|\n+$/g, '')
  return { start, end: Math.min(end, body.length), content }
}

/** Promote a `## section` of a note into its own entity of `type` (D9). Splits
 *  the section out: creates the entity (via {@link createEntityStub}, seeding
 *  its body with the section content), removes the section from the source
 *  note, and leaves a LINK where it was — a markdown link in OKF mode, a
 *  wikilink in Obsidian — NEVER an embed-transclusion. `heading` is matched
 *  case-insensitively. */
export function promoteSection(
  root: string,
  noteRel: string,
  heading: string,
  type: string,
): PromoteResult {
  const mode = detectVaultMode(root)
  const noteAbs = path.join(root, noteRel)
  const note = parseFile(noteAbs, root)
  const section = findSection(note.body, heading)
  if (!section) throw new Error(`section "## ${heading}" not found in ${noteRel}`)

  const name = heading.trim()
  // Where the entity WILL file (so we can compute the leave-behind link even
  // when createEntityStub no-ops on an existing entity).
  const template = loadTemplates(root).find((t) => t.type === type)
  if (!template) {
    const known = loadTemplates(root).map((t) => t.type).join(', ')
    throw new Error(`unknown type "${type}" (known: ${known || 'none'})`)
  }
  const entityRel = stubPathFor(template, name)

  const stub = createEntityStub(root, type, name, { body: section.content || undefined })

  // Compose the leave-behind link per mode.
  let leftLink: string
  if (mode === 'okf') {
    leftLink = serializeOkfLink(noteRel, entityRel, name)
  } else {
    leftLink = serializeWikilink(noteRel, entityRel, name)
  }

  // Replace the section in the source body with a heading + the link (NEVER an
  // embed: no `![[…]]` / `![](…)`).
  const headingLine = `## ${name}`
  const replacement = `${headingLine}\n\nMoved to ${leftLink}\n`
  const newBody = note.body.slice(0, section.start) + replacement + note.body.slice(section.end)

  // Reassemble the note: original frontmatter block (byte-preserved) + body.
  const raw = fs.readFileSync(noteAbs, 'utf8')
  const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n?/)
  const frontmatterBlock = fmMatch ? fmMatch[0] : ''
  fs.writeFileSync(noteAbs, frontmatterBlock + newBody)

  return { entityRel: stub.path, leftLink, created: stub.created }
}

// Re-export for tests / consumers that build on the splitFrontmatter path.
export { splitFrontmatter, safeName }
