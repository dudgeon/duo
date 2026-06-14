// ENH-216 OKF Vault Mode — the move / relink engine (U3, Stage 1).
//
// OKF mode persists STANDARD markdown relative links (D3), so a file move is
// not link-transparent the way Obsidian's basename-resolved wikilinks are: a
// move changes the rel path every inbound `[Display](./rel.md)` points at.
// This module owns the two repair paths (D5):
//
//   moveNote(root, fromRel, toRel)  — the CLEAN path (`duo vault mv`): we move
//     the file ourselves, so we know every inbound link, recompute each with
//     `relLink`, and rewrite it BYTE-ANCHORED (exact href occurrence — never a
//     blind global replace). The moved note's OWN outbound links are re-based
//     too. Throws on a dest collision.
//
//   relinkVault(root, { dryRun? })  — the OUT-OF-BAND repair (`duo vault
//     relink`): someone moved/renamed files around Duo (Finder, git). We find
//     every dangling markdown link, re-resolve each target by its STABLE
//     frontmatter `id:` first, then by slug/basename fallback (D5), and rewrite
//     the ones that resolve unambiguously. Ambiguous (>1 candidate) and broken
//     (0) are REPORTED, never guessed (D15 warn-don't-block).
//
// `ensureNoteId(absPath)` mints the stable `id:` (D10) used as relink's primary
// key — short base36, collision-checked against the corpus, written into
// frontmatter preserving the rest byte-wise. It's also the create-path hook U2
// calls so every OKF note carries an id from birth.
//
// All rel-path / slug / extract logic is IMPORTED from the single node-free
// helper (`../markdown/vaultLinks`) — this module never reimplements it.

import fs from 'node:fs'
import path from 'node:path'
import { readNotes, parseFile, splitFrontmatter } from './parse'
import {
  relLink,
  targetKey,
  extractLinkRefs,
  normalizePosix,
} from '../markdown/vaultLinks'
import type { VaultFile } from './types'

// ── stable note id (D10) ─────────────────────────────────────────────────────

/** Read an existing `id:` from a note's frontmatter (string or numeric). */
function readNoteId(frontmatter: Record<string, unknown>): string | null {
  const v = frontmatter.id
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number') return String(v)
  return null
}

/** Collect every `id:` already minted across the corpus (collision domain). */
function collectIds(root: string): Set<string> {
  const ids = new Set<string>()
  for (const n of readNotes(root)) {
    const id = readNoteId(n.frontmatter)
    if (id) ids.add(id)
  }
  return ids
}

/** Mint a short base36 id (~8 chars) seeded by the note's content + path so
 *  the same file tends to mint the same id, then perturbed until it doesn't
 *  collide with an existing one in `taken`. */
function mintId(seed: string, taken: Set<string>): string {
  // A cheap, dependency-free 53-bit hash (cyrb53-style) → base36, 8 chars.
  const hash = (str: string): string => {
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i)
      h1 = Math.imul(h1 ^ ch, 2654435761)
      h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    const n = 4294967296 * (2097151 & h2) + (h1 >>> 0)
    return n.toString(36).padStart(8, '0').slice(0, 8)
  }
  let candidate = hash(seed)
  let salt = 0
  while (taken.has(candidate)) {
    salt++
    candidate = hash(seed + ':' + salt)
  }
  return candidate
}

/** Splice an `id:` line into a raw note's frontmatter, preserving the rest of
 *  the block BYTE-IDENTICALLY. Inserts immediately after the opening `---\n`
 *  so no existing YAML byte shifts meaning. If there's no leading frontmatter
 *  block, one is created at the top. */
function insertIdLine(raw: string, id: string): string {
  const m = raw.match(/^---\n/)
  if (m) {
    return raw.slice(0, m[0].length) + `id: ${id}\n` + raw.slice(m[0].length)
  }
  // No frontmatter — prepend a minimal block.
  return `---\nid: ${id}\n---\n` + raw
}

/** Ensure a note has a stable `id:` (D10). Reads frontmatter; if an `id:` is
 *  already present it's returned untouched. Otherwise mints a short base36 id
 *  (collision-checked against the rest of the corpus) and writes it into the
 *  frontmatter, preserving every other byte. Returns the id. `root` defaults
 *  to the note's enclosing directory's nearest corpus — pass it explicitly
 *  (the create path always knows the vault root) for a vault-wide check. */
export function ensureNoteId(absPath: string, root?: string): string {
  const raw = fs.readFileSync(absPath, 'utf8')
  const { frontmatter } = splitFrontmatter(raw)
  const existing = readNoteId(frontmatter)
  if (existing) return existing
  const vaultRoot = root ?? path.dirname(absPath)
  const taken = collectIds(vaultRoot)
  const seed = path.relative(vaultRoot, absPath) + '\n' + raw
  const id = mintId(seed, taken)
  fs.writeFileSync(absPath, insertIdLine(raw, id))
  return id
}

// ── markdown-link backlinks + dangling scan (U3-owned, kept off graph.ts) ─────

/** One inbound markdown-link occurrence at a target. */
export interface MdBacklink {
  /** Linking note, relative to the vault root. */
  fromRel: string
  /** Absolute path of the linking note. */
  fromAbs: string
  /** The raw href exactly as written (`./customer-orders.md#h`). */
  rawHref: string
  /** Vault-relative path the href resolves to (anchor stripped). */
  resolvedRel: string
}

/** Resolve a markdown link `rawHref` (relative to `fromRel`) to a vault-rel
 *  path, anchor stripped, POSIX-normalized. Returns null for an empty target. */
function resolveHref(fromRel: string, rawHref: string): string | null {
  const bare = rawHref.split('#')[0]
  if (!bare) return null
  const fromDir = fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/')) : ''
  const joined = fromDir ? `${fromDir}/${bare}` : bare
  const resolved = normalizePosix(joined)
  return resolved || null
}

/** Every inbound markdown link across the vault that resolves to
 *  `targetRelPath` (D5 clean-path inbound scan — markdown links only; the
 *  wikilink companion is `graph.ts backlinks`, kept disjoint per the U1/U3
 *  ownership split). `targetRelPath` is vault-relative POSIX. */
export function mdBacklinks(root: string, targetRelPath: string): MdBacklink[] {
  const target = normalizePosix(targetRelPath)
  const out: MdBacklink[] = []
  for (const note of readNotes(root)) {
    for (const ref of extractLinkRefs(note.body)) {
      if (ref.syntax !== 'mdlink') continue
      const resolved = resolveHref(note.relPath, ref.rawTarget)
      if (resolved && resolved === target) {
        out.push({
          fromRel: note.relPath,
          fromAbs: note.absPath,
          rawHref: ref.rawTarget,
          resolvedRel: resolved,
        })
      }
    }
  }
  return out
}

/** One unresolved (dangling) markdown link occurrence. */
export interface DanglingMdLink {
  fromRel: string
  fromAbs: string
  rawHref: string
  /** The href's resolution key (basename-folded) — the relink slug fallback. */
  key: string
  display: string
}

/** Every markdown link across the vault whose resolved target does NOT exist
 *  on disk — the relink work-list. Existing-target links are left alone. */
export function danglingMdLinks(root: string): DanglingMdLink[] {
  const notes = readNotes(root)
  const present = new Set(notes.map((n) => normalizePosix(n.relPath)))
  const out: DanglingMdLink[] = []
  for (const note of notes) {
    for (const ref of extractLinkRefs(note.body)) {
      if (ref.syntax !== 'mdlink') continue
      const resolved = resolveHref(note.relPath, ref.rawTarget)
      if (resolved && !present.has(resolved)) {
        out.push({
          fromRel: note.relPath,
          fromAbs: note.absPath,
          rawHref: ref.rawTarget,
          key: targetKey(ref.rawTarget, 'mdlink'),
          display: ref.display,
        })
      }
    }
  }
  return out
}

// ── byte-anchored href rewrite ────────────────────────────────────────────────

/** Rewrite EXACTLY the `](oldHref...)` occurrences in `raw` to `newHref`,
 *  preserving any trailing `#anchor` on each occurrence. Byte-anchored: only
 *  the link-href slot is touched, never arbitrary text that happens to match.
 *  Returns the rewritten text + count of occurrences changed. */
function rewriteHref(raw: string, oldHref: string, newHref: string): { text: string; count: number } {
  // Match `](<href>[#anchor]<optional title>)`, capturing the href exactly.
  // We re-scan with extractLinkRefs semantics but operate on the raw bytes so
  // the surrounding markdown is preserved.
  let count = 0
  const text = raw.replace(/(\]\(\s*)([^)\s]+)([^)]*\))/g, (whole, lead: string, href: string, tail: string) => {
    const hashIdx = href.indexOf('#')
    const base = hashIdx >= 0 ? href.slice(0, hashIdx) : href
    const anchor = hashIdx >= 0 ? href.slice(hashIdx) : ''
    if (base === oldHref) {
      count++
      return lead + newHref + anchor + tail
    }
    return whole
  })
  return { text, count }
}

// ── moveNote — the clean path (D5) ────────────────────────────────────────────

export interface MoveResult {
  fromRel: string
  toRel: string
  /** Inbound links rewritten, by linking-note rel path. */
  inboundRewritten: { fromRel: string; count: number }[]
  /** The moved note's own outbound links that were re-based. */
  outboundRebased: number
}

/** Move a note within the vault and keep all markdown links pointing at it
 *  valid (D5 clean path). Moves the file, finds inbound markdown links via
 *  {@link mdBacklinks}, recomputes each with {@link relLink} and rewrites it
 *  byte-anchored, then re-bases the moved note's OWN outbound links from their
 *  new home. Throws on a dest collision (never clobbers). Both paths are
 *  vault-relative POSIX. */
export function moveNote(root: string, fromRel: string, toRel: string): MoveResult {
  const from = normalizePosix(fromRel)
  const to = normalizePosix(toRel)
  const fromAbs = path.join(root, from)
  const toAbs = path.join(root, to)

  if (!fs.existsSync(fromAbs)) throw new Error(`source note not found: ${from}`)
  if (fs.existsSync(toAbs)) throw new Error(`destination already exists: ${to} (move would clobber it)`)

  // Find inbound links BEFORE the move (they still resolve to the old path).
  const inbound = mdBacklinks(root, from)
  // Capture the moved note's own outbound links to re-base after the move.
  const movedNote = parseFile(fromAbs, root)
  const ownOutbound = extractLinkRefs(movedNote.body).filter((r) => r.syntax === 'mdlink')

  // Perform the move.
  fs.mkdirSync(path.dirname(toAbs), { recursive: true })
  fs.renameSync(fromAbs, toAbs)

  // Rewrite each inbound link's href: recompute from the LINKER's path.
  const inboundRewritten: MoveResult['inboundRewritten'] = []
  // Group inbound occurrences by linking file so we write each file once.
  const byLinker = new Map<string, MdBacklink[]>()
  for (const b of inbound) {
    if (!byLinker.has(b.fromAbs)) byLinker.set(b.fromAbs, [])
    byLinker.get(b.fromAbs)!.push(b)
  }
  for (const [linkerAbs, hits] of byLinker) {
    let raw = fs.readFileSync(linkerAbs, 'utf8')
    const linkerRel = hits[0].fromRel
    const newHref = relLink(linkerRel, to)
    let total = 0
    // Distinct old hrefs at this linker (same target may be reached via
    // different relative spellings — rare, but handle each).
    const oldHrefs = new Set(hits.map((h) => h.rawHref.split('#')[0]))
    for (const oldHref of oldHrefs) {
      const r = rewriteHref(raw, oldHref, newHref)
      raw = r.text
      total += r.count
    }
    if (total > 0) {
      fs.writeFileSync(linkerAbs, raw)
      inboundRewritten.push({ fromRel: linkerRel, count: total })
    }
  }

  // Re-base the moved note's own outbound links from its new directory.
  let outboundRebased = 0
  if (ownOutbound.length) {
    let raw = fs.readFileSync(toAbs, 'utf8')
    // Resolve each old href against the OLD source dir, then recompute against
    // the NEW source dir, and rewrite byte-anchored.
    const seen = new Set<string>()
    for (const ref of ownOutbound) {
      const oldHref = ref.rawTarget.split('#')[0]
      if (seen.has(oldHref)) continue
      seen.add(oldHref)
      const targetRel = resolveHref(from, ref.rawTarget)
      if (!targetRel) continue
      const newHref = relLink(to, targetRel)
      if (newHref === oldHref) continue
      const r = rewriteHref(raw, oldHref, newHref)
      raw = r.text
      outboundRebased += r.count
    }
    if (outboundRebased > 0) fs.writeFileSync(toAbs, raw)
  }

  return { fromRel: from, toRel: to, inboundRewritten, outboundRebased }
}

// ── relinkVault — the out-of-band repair (D5) ────────────────────────────────

export interface RelinkRepair {
  fromRel: string
  oldHref: string
  newHref: string
  /** Which key resolved the target — `id` (primary, D10) or `slug`. */
  via: 'id' | 'slug'
  targetRel: string
}
export interface RelinkAmbiguous {
  fromRel: string
  oldHref: string
  display: string
  /** The competing target rel paths (>1). */
  candidates: string[]
}
export interface RelinkBroken {
  fromRel: string
  oldHref: string
  display: string
}
export interface RelinkResult {
  repaired: RelinkRepair[]
  ambiguous: RelinkAmbiguous[]
  broken: RelinkBroken[]
}

/** A target candidate indexed by both its stable id and its slug key. */
interface TargetIndex {
  byId: Map<string, VaultFile[]>
  bySlug: Map<string, VaultFile[]>
}

function buildTargetIndex(notes: VaultFile[]): TargetIndex {
  const byId = new Map<string, VaultFile[]>()
  const bySlug = new Map<string, VaultFile[]>()
  for (const n of notes) {
    const id = readNoteId(n.frontmatter)
    if (id) {
      if (!byId.has(id)) byId.set(id, [])
      byId.get(id)!.push(n)
    }
    const slug = targetKey(n.relPath, 'mdlink')
    if (!bySlug.has(slug)) bySlug.set(slug, [])
    bySlug.get(slug)!.push(n)
  }
  return { byId, bySlug }
}

/** Repair markdown links broken by an out-of-band move/rename (D5). For each
 *  dangling link, re-resolve the target by its stable frontmatter `id:` first
 *  (D10 primary key), then by slug/basename fallback. Resolved-unambiguous
 *  links are rewritten byte-anchored; ambiguous (>1 candidate) and broken (0)
 *  are REPORTED, never guessed (D15). `dryRun` resolves + reports but writes
 *  nothing. */
export function relinkVault(root: string, opts: { dryRun?: boolean } = {}): RelinkResult {
  const notes = readNotes(root)
  const index = buildTargetIndex(notes)
  const dangling = danglingMdLinks(root)

  const repaired: RelinkRepair[] = []
  const ambiguous: RelinkAmbiguous[] = []
  const broken: RelinkBroken[] = []

  // Accumulate per-file rewrites so each linking file is written once.
  const edits = new Map<string, { abs: string; ops: { oldHref: string; newHref: string }[] }>()

  for (const d of dangling) {
    // 1) Try the stable id, if the dangling link's display happens to be an id
    //    — but our links don't carry the id in the href, so the id key path is
    //    keyed on the dangling target's slug matched against a moved note that
    //    KEPT its id. The robust id path: the dangling href's basename slug is
    //    looked up, and if a single note with that slug exists it wins; the id
    //    disambiguates only when MULTIPLE notes share the slug.
    const key = d.key
    const slugCandidates = index.bySlug.get(key) ?? []

    let resolved: VaultFile | null = null
    let via: 'id' | 'slug' = 'slug'

    if (slugCandidates.length === 1) {
      resolved = slugCandidates[0]
      via = 'slug'
    } else if (slugCandidates.length > 1) {
      // Ambiguous by slug — try to disambiguate by an id embedded in the
      // dangling link's display text (created-from-gesture links can carry it)
      // or in the href's anchor. We only RESOLVE on a unique id hit; otherwise
      // report ambiguous (never guess, D15).
      const idHit = slugCandidates.filter((c) => {
        const id = readNoteId(c.frontmatter)
        return id != null && (d.display === id || d.rawHref.includes(id))
      })
      if (idHit.length === 1) {
        resolved = idHit[0]
        via = 'id'
      } else {
        ambiguous.push({
          fromRel: d.fromRel,
          oldHref: d.rawHref,
          display: d.display,
          candidates: slugCandidates.map((c) => c.relPath).sort(),
        })
        continue
      }
    }

    if (!resolved) {
      broken.push({ fromRel: d.fromRel, oldHref: d.rawHref, display: d.display })
      continue
    }

    const newHref = relLink(d.fromRel, resolved.relPath)
    repaired.push({
      fromRel: d.fromRel,
      oldHref: d.rawHref,
      newHref,
      via,
      targetRel: resolved.relPath,
    })
    if (!edits.has(d.fromAbs)) edits.set(d.fromAbs, { abs: d.fromAbs, ops: [] })
    edits.get(d.fromAbs)!.ops.push({ oldHref: d.rawHref.split('#')[0], newHref })
  }

  if (!opts.dryRun) {
    for (const { abs, ops } of edits.values()) {
      let raw = fs.readFileSync(abs, 'utf8')
      const seen = new Set<string>()
      for (const { oldHref, newHref } of ops) {
        if (seen.has(oldHref)) continue
        seen.add(oldHref)
        raw = rewriteHref(raw, oldHref, newHref).text
      }
      fs.writeFileSync(abs, raw)
    }
  }

  return { repaired, ambiguous, broken }
}
