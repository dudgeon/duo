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
// transclusion (D9). It reuses `createEntityStub` from filing (which files
// mode-aware: OKF slugs the stem + mints an id, Obsidian keeps the basename).
//
// All rel-path / slug / serialize logic is IMPORTED from the single node-free
// helper (`../markdown/vaultLinks`); this module never reimplements it.

import fs from 'node:fs'
import path from 'node:path'
import { readNotes, parseFile, splitFrontmatter } from './parse'
import { detectVaultMode } from './detect'
import { createEntityStub, safeName } from './filing'
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
 *  stamp. DETERMINISTIC (PR#98 F20): the staleness key is the corpus-derived
 *  `source-hash` — NOT a wall-clock timestamp. A per-invocation `generated
 *  <ISO>` field made every `publish` rewrite the file with new bytes even when
 *  the corpus was unchanged, defeating the byte-equality guard below (and
 *  churning git / bannering an open index.md). Same corpus → same stamp. */
function generatedStamp(root: string, kind: string, dateSource: string): string {
  const hash = sourceHash(root)
  return `<!-- duo:generated ${kind} · source-hash ${hash} · dates from ${dateSource} -->`
}

/** Write `content` to `abs` ONLY when it differs from what's already on disk,
 *  returning true when a write happened (PR#98 F20). An unchanged listing is
 *  left byte-identical so `publish` is idempotent — no spurious filesystem
 *  watcher event, no git churn, no reconcile banner over an open index.md. */
function writeIfChanged(abs: string, content: string): boolean {
  let existing: string | null = null
  try {
    existing = fs.readFileSync(abs, 'utf8')
  } catch {
    existing = null // not on disk yet → a genuine create
  }
  if (existing === content) return false
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return true
}

export interface WriteListingsOptions {
  /** Also write a per-directory `index.md` for each subfolder that holds
   *  notes (default false — only the root index.md + root log.md). */
  perDir?: boolean
  /** Which listing files to (re)write (default `'both'`). `'index'` writes
   *  ONLY index.md (root + per-dir under `perDir`); `'log'` writes ONLY
   *  log.md. The narrowing is honored in the WRITE — a file outside the scope
   *  is left byte-identical (no fresh stamp → no git churn), and `written`
   *  reflects only what was actually written (PR#98 review cluster B). */
  scope?: 'index' | 'log' | 'both'
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

  const scope = opts.scope ?? 'both'
  const wantIndex = scope !== 'log'
  const wantLog = scope !== 'index'
  const written: string[] = []

  // Root index.md — preserve its okf_version frontmatter byte-identically.
  // Skipped entirely under `--log-only` so the file is left byte-identical
  // (no fresh stamp → no git churn); we don't even read it. The byte-guard
  // (writeIfChanged) additionally skips the write when the regenerated listing
  // is identical to what's on disk, so a no-op `publish` writes nothing.
  if (wantIndex) {
    const rootIndexAbs = path.join(root, 'index.md')
    const existing = fs.readFileSync(rootIndexAbs, 'utf8') // OKF root always has it
    const indexBody = generateIndex(root, '')
    const indexStamp = generatedStamp(root, 'index', 'corpus')
    if (writeIfChanged(rootIndexAbs, spliceRootIndex(existing, indexStamp, indexBody))) {
      written.push('index.md')
    }
  }

  // Root log.md — a standalone generated file (no preserved frontmatter).
  // Skipped under `--index-only`.
  if (wantLog) {
    const logAbs = path.join(root, 'log.md')
    const logStamp = generatedStamp(root, 'log', 'file mtimes')
    if (writeIfChanged(logAbs, `${logStamp}\n\n# Log\n\n${generateLog(root)}\n`)) {
      written.push('log.md')
    }
  }

  // Per-dir index.md files are INDEX listings, so they follow the index scope:
  // written under `--index-only` (+ default), suppressed under `--log-only`.
  if (opts.perDir && wantIndex) {
    // Each subfolder that contains notes gets its own index.md.
    const dirs = new Set<string>()
    for (const n of readNotes(root)) {
      if (isGeneratedListing(n.relPath)) continue
      if (n.folder) dirs.add(n.folder)
    }
    for (const dir of [...dirs].sort()) {
      const abs = path.join(root, dir, 'index.md')
      const stamp = generatedStamp(root, 'index', 'corpus')
      if (writeIfChanged(abs, `${stamp}\n\n${generateIndex(root, dir)}\n`)) {
        written.push(`${dir}/index.md`)
      }
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
  const fmode: VaultMode = mode ?? 'obsidian'

  // Create the entity FIRST, mode-aware (PR#98 F4): OKF slugs the stem, mints a
  // stable `id:`, and stamps `title:`; Obsidian keeps the verbatim basename.
  // createEntityStub validates the type and throws BEFORE any write to the
  // source note, so an unknown type leaves the source byte-identical.
  const stub = createEntityStub(root, type, name, {
    body: section.content || undefined,
    mode: fmode,
  })
  // Collision guard (PR#98 review cluster A) — OBSIDIAN ONLY. In Obsidian mode a
  // pre-existing entity makes createEntityStub no-op (created:false) WITHOUT
  // writing the section body; removing the section below would then silently
  // drop the promoted content. REFUSE so the source stays intact. (OKF mode
  // auto-disambiguates with a `-2` stem and always creates, so the content is
  // never lost there — no refuse needed.) The throw precedes any write to
  // noteAbs, so the source is byte-identical on failure. (CLI surfaces via die().)
  if (!stub.created) {
    throw new Error(
      `cannot promote "## ${heading}": an entity already exists at ${stub.path}. ` +
        `Refusing so the section is not lost — rename the existing entity ` +
        `(duo vault mv) or promote under a different heading/name. ` +
        `The source note ${noteRel} was left unchanged.`,
    )
  }

  // Compose the leave-behind link per mode, pointing at the ACTUAL created path
  // (stub.path) — in OKF mode that is the slugged stem (and may be a `-2`
  // disambiguation), NEVER a verbatim-cased name with a space the OKF link
  // parser would truncate.
  const leftLink =
    fmode === 'okf'
      ? serializeOkfLink(noteRel, stub.path, name)
      : serializeWikilink(noteRel, stub.path, name)

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
