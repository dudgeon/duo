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
  serializeOkfFrontmatterLink,
  serializeOkfLink,
  slugStem,
} from '../markdown/vaultLinks'
import { detectVaultMode } from './detect'
import { isGeneratedListingBasename } from './okf-filenames'
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
/** BUG-267 — angle-bracket the href ONLY when it needs it (whitespace, or a
 *  literal `<`/`>` — CommonMark §6.6). Mirrors `listings.ts`'s `safeHref`;
 *  kept local since this module's rewrite path (moveNote/relinkVault) is a
 *  different write site than the generated-listings one. */
function wrapHrefIfNeeded(href: string): string {
  return /[\s<>]/.test(href) ? `<${href}>` : href
}

function rewriteHref(raw: string, oldHref: string, newHref: string): { text: string; count: number } {
  // Match `](<href>[#anchor]<optional title>)`, capturing the href exactly.
  // We re-scan with extractLinkRefs semantics but operate on the raw bytes so
  // the surrounding markdown is preserved. BUG-267 — also matches an ANGLE-
  // BRACKETED destination `(<href with a space>)` (group 2), not just the
  // bare space-free form (group 3): a bare-only match silently 0-counted
  // (never found, never rewrote) any old href a space-containing filename
  // produced — a false "resolved" report followed by a no-op write.
  let count = 0
  const text = raw.replace(
    /(\]\(\s*)(?:<([^>]*)>|([^)\s]+))([^)]*\))/g,
    (whole, lead: string, angleHref: string | undefined, bareHref: string | undefined, tail: string) => {
      const href = angleHref !== undefined ? angleHref : (bareHref as string)
      const hashIdx = href.indexOf('#')
      const base = hashIdx >= 0 ? href.slice(0, hashIdx) : href
      const anchor = hashIdx >= 0 ? href.slice(hashIdx) : ''
      if (base === oldHref) {
        count++
        return lead + wrapHrefIfNeeded(newHref + anchor) + tail
      }
      return whole
    },
  )
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

  // Carry the note's sidecar (`<file>.md.duo.json`) so its comments /
  // properties / recent-edits travel with the note (PR#98 F3 — otherwise a
  // `vault mv` orphans them and the editor at the new path reads no metadata).
  const fromSidecar = fromAbs + '.duo.json'
  if (fs.existsSync(fromSidecar)) {
    try {
      fs.renameSync(fromSidecar, toAbs + '.duo.json')
    } catch {
      /* best-effort — never fail the move over the sidecar */
    }
  }

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

/** Shared id-then-slug resolution (D5/D10): slug-unambiguous wins outright;
 *  a slug collision (>1 candidate) is disambiguated ONLY by a unique id hit
 *  in the dangling reference's display/raw text; anything else is reported
 *  (ambiguous or broken), never guessed. Factored out of {@link relinkVault}
 *  so {@link migrateFrontmatterLinks} (ENH-266) reuses the identical
 *  resolution instead of reimplementing it. */
function resolveDanglingTarget(
  index: TargetIndex,
  key: string,
  display: string,
  rawText: string,
): { kind: 'resolved'; note: VaultFile; via: 'id' | 'slug' } | { kind: 'ambiguous'; candidates: string[] } | { kind: 'broken' } {
  const slugCandidates = index.bySlug.get(key) ?? []
  if (slugCandidates.length === 1) {
    return { kind: 'resolved', note: slugCandidates[0], via: 'slug' }
  }
  if (slugCandidates.length > 1) {
    const idHit = slugCandidates.filter((c) => {
      const id = readNoteId(c.frontmatter)
      return id != null && (display === id || rawText.includes(id))
    })
    if (idHit.length === 1) {
      return { kind: 'resolved', note: idHit[0], via: 'id' }
    }
    return { kind: 'ambiguous', candidates: slugCandidates.map((c) => c.relPath).sort() }
  }
  return { kind: 'broken' }
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
    // 1) Try the stable id — our links don't carry the id in the href, so the
    //    id key path is keyed on the dangling target's slug matched against a
    //    moved note that KEPT its id. The robust id path: the dangling href's
    //    basename slug is looked up, and if a single note with that slug
    //    exists it wins; the id disambiguates only when MULTIPLE notes share
    //    the slug (shared with migrateFrontmatterLinks, ENH-266).
    const outcome = resolveDanglingTarget(index, d.key, d.display, d.rawHref)
    if (outcome.kind === 'ambiguous') {
      ambiguous.push({ fromRel: d.fromRel, oldHref: d.rawHref, display: d.display, candidates: outcome.candidates })
      continue
    }
    if (outcome.kind === 'broken') {
      broken.push({ fromRel: d.fromRel, oldHref: d.rawHref, display: d.display })
      continue
    }

    const newHref = relLink(d.fromRel, outcome.note.relPath)
    repaired.push({
      fromRel: d.fromRel,
      oldHref: d.rawHref,
      newHref,
      via: outcome.via,
      targetRel: outcome.note.relPath,
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

// ── migrateFrontmatterLinks — the ENH-266 one-time migration (D5-adjacent) ────
//
// `duo vault relink --frontmatter` (explicit, opt-in ONLY — never reachable
// from the ENH-216 auto-relink-on-vault-open hook). Four independent repair
// categories over an OKF vault, each REPORTED with counts; ambiguous (>1
// candidate) or unresolvable targets are left untouched and reported, never
// guessed (D15):
//
//   (a) frontmatter WIKILINK values (`owner: "[[Alice Park]]"`, quoted or
//       not, scalar or list) → the quoted markdown-link form.
//   (b) frontmatter BARE unbracketed rel-path values (`owner: "./people/
//       alice-park.md"` — invisible to every link parser) → the quoted
//       markdown-link form, ONLY when the path resolves to a real file.
//   (c) prose-BODY wikilinks (someone edited the vault in Obsidian with
//       factory-default wikilink settings) → markdown links, reusing the
//       SAME id-then-slug resolution as (a) and the moveNote/relinkVault
//       repair (resolveDanglingTarget) — no separate resolution logic.
//   (d) alias backfill — an entity whose `title:` differs from its slug
//       filename gets that title appended to `aliases:` (if not already
//       present), so a stray body/frontmatter reference by title still
//       resolves via the corpus alias map.

/** One resolved frontmatter-value repair (categories a/b). */
export interface FmValueRepair {
  fromRel: string
  field: string
  oldValue: string
  newValue: string
  via: 'id' | 'slug'
  targetRel: string
}
export interface FmValueAmbiguous {
  fromRel: string
  field: string
  oldValue: string
  candidates: string[]
}
export interface FmValueBroken {
  fromRel: string
  field: string
  oldValue: string
}
export interface FmValueCategoryResult {
  repaired: FmValueRepair[]
  ambiguous: FmValueAmbiguous[]
  broken: FmValueBroken[]
}

/** One resolved prose-BODY wikilink repair (category c). */
export interface BodyWikilinkRepair {
  fromRel: string
  oldValue: string
  newValue: string
  via: 'id' | 'slug'
  targetRel: string
}
export interface BodyWikilinkAmbiguous {
  fromRel: string
  oldValue: string
  candidates: string[]
}
export interface BodyWikilinkBroken {
  fromRel: string
  oldValue: string
}
export interface BodyWikilinkCategoryResult {
  repaired: BodyWikilinkRepair[]
  ambiguous: BodyWikilinkAmbiguous[]
  broken: BodyWikilinkBroken[]
}

/** One applied alias backfill (category d). */
export interface AliasBackfill {
  fromRel: string
  title: string
}

export interface MigrateFrontmatterLinksResult {
  frontmatterWikilinks: FmValueCategoryResult
  frontmatterBarePaths: FmValueCategoryResult
  bodyWikilinks: BodyWikilinkCategoryResult
  aliasBackfills: AliasBackfill[]
}

/** Strip a single matching leading/trailing quote (`"` or `'`) from a
 *  trimmed YAML scalar token. Returns the inner text (quotes stripped) and
 *  which quote char was present (`''` when unquoted). */
function stripYamlQuote(token: string): { inner: string; quoted: boolean } {
  const t = token.trim()
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return { inner: t.slice(1, -1), quoted: true }
  }
  return { inner: t, quoted: false }
}

/** Split a YAML flow-array's inner content (`"a", "b"`) into its raw
 *  (quote-inclusive) item tokens. Domain-scoped (names/paths never contain a
 *  literal comma), so a simple quote-aware scan is sufficient — never a full
 *  YAML flow-sequence parser. */
function splitFlowArrayItems(inner: string): string[] {
  const items: string[] = []
  let cur = ''
  let q: string | null = null
  for (const ch of inner) {
    if (q) {
      cur += ch
      if (ch === q) q = null
      continue
    }
    if (ch === '"' || ch === "'") {
      q = ch
      cur += ch
      continue
    }
    if (ch === ',') {
      items.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) items.push(cur)
  return items.map((s) => s.trim()).filter(Boolean)
}

const FM_WIKILINK_VALUE_RE = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/
const FM_BARE_MD_PATH_RE = /^\.{1,2}\/[^\s'"[\]]+\.md$/i

interface FmScanHit {
  field: string
  /** Offsets within the FULL raw file text (frontmatter value token,
   *  quote-inclusive when quoted). */
  start: number
  end: number
  inner: string
}

/** Scan a note's frontmatter block (offsets relative to the FULL raw file
 *  text) for candidate VALUE tokens — scalar `key: value`, block-list `-
 *  value` items (tracked against their owning `key:` line), and flow-array
 *  `key: [a, b]` items. Classification (wikilink-shaped / bare-path-shaped /
 *  neither) is the caller's job; this only locates + isolates tokens so an
 *  edit can be byte-anchored. Line-based (not a full YAML parser) — matches
 *  the byte-anchored-regex style the rest of this module uses. */
function scanFrontmatterValues(raw: string): FmScanHit[] {
  const fence = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!fence) return []
  const fmText = fence[1]
  const fmOffset = fence[0].indexOf(fmText) // === 4, the length of "---\n"
  const hits: FmScanHit[] = []
  const lines = fmText.split('\n')
  let offset = fmOffset
  let currentField: string | null = null
  let currentFieldIndent = 0

  for (const line of lines) {
    const lineStart = offset
    offset += line.length + 1

    const scalarMatch = line.match(/^(\s*)([A-Za-z0-9_.-]+):(.*)$/)
    if (scalarMatch) {
      const indent = scalarMatch[1].length
      const field = scalarMatch[2]
      const rest = scalarMatch[3]
      const restTrimmed = rest.trim()
      if (restTrimmed === '') {
        // `field:` alone — opens a block-list; subsequent deeper-indented
        // `- ` lines belong to it.
        currentField = field
        currentFieldIndent = indent
        continue
      }
      currentField = null // a same-or-shallower key line ends any prior list
      const leadingWs = rest.length - rest.trimStart().length
      const valueStartInLine = line.length - rest.length + leadingWs
      // A flow array `[a, b]` — but NOT a bare wikilink value, which also
      // starts with `[` and ends with `]` (it's `[[Name]]`, double-bracketed).
      if (restTrimmed.startsWith('[') && !restTrimmed.startsWith('[[') && restTrimmed.endsWith(']')) {
        const items = splitFlowArrayItems(restTrimmed.slice(1, -1))
        let searchFrom = valueStartInLine + 1
        for (const itemToken of items) {
          const idx = line.indexOf(itemToken, searchFrom)
          if (idx === -1) continue
          const { inner } = stripYamlQuote(itemToken)
          hits.push({ field, start: lineStart + idx, end: lineStart + idx + itemToken.length, inner })
          searchFrom = idx + itemToken.length
        }
      } else {
        const { inner } = stripYamlQuote(restTrimmed)
        hits.push({
          field,
          start: lineStart + valueStartInLine,
          end: lineStart + valueStartInLine + restTrimmed.length,
          inner,
        })
      }
      continue
    }

    const listMatch = line.match(/^(\s*)-\s?(.*)$/)
    if (listMatch && currentField) {
      const indent = listMatch[1].length
      if (indent <= currentFieldIndent) {
        currentField = null
        continue
      }
      const rest = listMatch[2]
      const restTrimmed = rest.trim()
      if (!restTrimmed) continue
      const leadingWs = rest.length - rest.trimStart().length
      const valueStartInLine = line.length - rest.length + leadingWs
      const { inner } = stripYamlQuote(restTrimmed)
      hits.push({
        field: currentField,
        start: lineStart + valueStartInLine,
        end: lineStart + valueStartInLine + restTrimmed.length,
        inner,
      })
    }
  }
  return hits
}

/** Scan raw BODY text (post-frontmatter) for `[[...]]` occurrences with
 *  their byte positions — {@link extractLinkRefs} classifies syntax but
 *  doesn't expose positions, and a byte-anchored rewrite needs them. Mirrors
 *  `vaultLinks.ts`'s WIKILINK_RE exactly (extraction mechanics only — target
 *  RESOLUTION still goes through {@link resolveDanglingTarget}, never
 *  reimplemented here). */
function scanBodyWikilinks(body: string): { start: number; end: number; rawTarget: string; display: string }[] {
  const hits: { start: number; end: number; rawTarget: string; display: string }[] = []
  const re = /\[\[([^\]]+?)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const inner = m[1]
    const pipe = inner.indexOf('|')
    const rawTarget = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
    if (!rawTarget) continue
    const display = (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim()
    hits.push({ start: m.index, end: m.index + m[0].length, rawTarget, display })
  }
  return hits
}

/** A byte-span edit against a single file's raw text. Applied in descending
 *  `start` order so earlier spans' offsets stay valid. */
interface SpanEdit {
  start: number
  end: number
  replacement: string
}

function applySpanEdits(raw: string, edits: SpanEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start)
  let out = raw
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
  }
  return out
}

/** ENH-266 — the explicit, opt-in migration `duo vault relink --frontmatter`
 *  runs. OKF-mode only (throws otherwise — Obsidian frontmatter is
 *  unaffected by this ticket). See the module-header comment above for the
 *  four categories. `dryRun` resolves + reports every category but writes
 *  nothing. NEVER wired into the auto-relink-on-vault-open hook
 *  (electron/main.ts) — explicit CLI verb only. */
export function migrateFrontmatterLinks(root: string, opts: { dryRun?: boolean } = {}): MigrateFrontmatterLinksResult {
  const mode = detectVaultMode(root)
  if (mode !== 'okf') {
    throw new Error(
      `migrateFrontmatterLinks is OKF-mode only (ENH-266): vault mode is ${mode ?? 'not-a-vault'}. ` +
        `Obsidian-mode frontmatter keeps [[wikilinks]] — this migration does not apply.`,
    )
  }

  const notes = readNotes(root)
  const index = buildTargetIndex(notes)
  const byRelPath = new Map(notes.map((n) => [normalizePosix(n.relPath), n]))

  const frontmatterWikilinks: FmValueCategoryResult = { repaired: [], ambiguous: [], broken: [] }
  const frontmatterBarePaths: FmValueCategoryResult = { repaired: [], ambiguous: [], broken: [] }
  const bodyWikilinks: BodyWikilinkCategoryResult = { repaired: [], ambiguous: [], broken: [] }
  const aliasBackfills: AliasBackfill[] = []

  for (const note of notes) {
    // The generated-listing marker files (root/dir `_index.md`/`index.md`,
    // `_log.md`/`log.md`) carry frontmatter that MUST stay byte-preserved
    // (the D4 OKF marker + the listings generator's source-hash staleness
    // key — `generateIndex`/`generateLog` apply the SAME exclusion). Never
    // touch their frontmatter or body here.
    const noteBasename = note.relPath.includes('/') ? note.relPath.slice(note.relPath.lastIndexOf('/') + 1) : note.relPath
    if (isGeneratedListingBasename(noteBasename)) continue

    const abs = note.absPath
    const raw = fs.readFileSync(abs, 'utf8')
    const spanEdits: SpanEdit[] = []

    // (a) + (b) — frontmatter value tokens.
    for (const hit of scanFrontmatterValues(raw)) {
      const wiki = hit.inner.match(FM_WIKILINK_VALUE_RE)
      if (wiki) {
        const rawTarget = wiki[1].trim()
        const display = (wiki[2] ?? rawTarget).trim()
        const key = targetKey(rawTarget, 'wikilink')
        const outcome = resolveDanglingTarget(index, key, display, hit.inner)
        const oldValue = raw.slice(hit.start, hit.end)
        if (outcome.kind === 'ambiguous') {
          frontmatterWikilinks.ambiguous.push({ fromRel: note.relPath, field: hit.field, oldValue, candidates: outcome.candidates })
        } else if (outcome.kind === 'broken') {
          frontmatterWikilinks.broken.push({ fromRel: note.relPath, field: hit.field, oldValue })
        } else {
          const newValue = serializeOkfFrontmatterLink(note.relPath, outcome.note.relPath, display)
          frontmatterWikilinks.repaired.push({
            fromRel: note.relPath,
            field: hit.field,
            oldValue,
            newValue,
            via: outcome.via,
            targetRel: outcome.note.relPath,
          })
          spanEdits.push({ start: hit.start, end: hit.end, replacement: newValue })
        }
        continue
      }
      if (FM_BARE_MD_PATH_RE.test(hit.inner)) {
        const oldValue = raw.slice(hit.start, hit.end)
        const targetRel = resolveHref(note.relPath, hit.inner)
        const target = targetRel ? byRelPath.get(normalizePosix(targetRel)) : undefined
        if (!target) {
          frontmatterBarePaths.broken.push({ fromRel: note.relPath, field: hit.field, oldValue })
          continue
        }
        const display = typeof target.frontmatter.title === 'string' ? target.frontmatter.title : undefined
        const newValue = serializeOkfFrontmatterLink(note.relPath, target.relPath, display)
        frontmatterBarePaths.repaired.push({
          fromRel: note.relPath,
          field: hit.field,
          oldValue,
          newValue,
          via: 'slug',
          targetRel: target.relPath,
        })
        spanEdits.push({ start: hit.start, end: hit.end, replacement: newValue })
      }
    }

    // (c) — prose-BODY wikilinks. Positions are relative to `note.body`;
    // offset them into the FULL raw file (body starts right after the
    // frontmatter fence this SAME `raw` read produced).
    const fence = raw.match(/^---\n[\s\S]*?\n---\n?/)
    const bodyOffset = fence ? fence[0].length : 0
    for (const hit of scanBodyWikilinks(raw.slice(bodyOffset))) {
      const key = targetKey(hit.rawTarget, 'wikilink')
      const rawOccurrence = raw.slice(bodyOffset + hit.start, bodyOffset + hit.end)
      const outcome = resolveDanglingTarget(index, key, hit.display, rawOccurrence)
      if (outcome.kind === 'ambiguous') {
        bodyWikilinks.ambiguous.push({ fromRel: note.relPath, oldValue: rawOccurrence, candidates: outcome.candidates })
        continue
      }
      if (outcome.kind === 'broken') {
        bodyWikilinks.broken.push({ fromRel: note.relPath, oldValue: rawOccurrence })
        continue
      }
      const newValue = serializeOkfLink(note.relPath, outcome.note.relPath, hit.display || undefined)
      bodyWikilinks.repaired.push({
        fromRel: note.relPath,
        oldValue: rawOccurrence,
        newValue,
        via: outcome.via,
        targetRel: outcome.note.relPath,
      })
      spanEdits.push({ start: bodyOffset + hit.start, end: bodyOffset + hit.end, replacement: newValue })
    }

    // (d) — alias backfill: title differs from the slug filename and isn't
    // already an alias. Applied as ONE more span edit against the SAME raw
    // text so it composes with (a)/(b)/(c) in a single write.
    const title = typeof note.frontmatter.title === 'string' ? note.frontmatter.title.trim() : ''
    if (title && slugStem(title) !== note.basename) {
      const aliasList = Array.isArray(note.frontmatter.aliases) ? note.frontmatter.aliases.map(String) : []
      if (!aliasList.includes(title)) {
        const aliasEdit = buildAliasBackfillEdit(raw, title)
        if (aliasEdit) {
          spanEdits.push(aliasEdit)
          aliasBackfills.push({ fromRel: note.relPath, title })
        }
      }
    }

    if (spanEdits.length && !opts.dryRun) {
      fs.writeFileSync(abs, applySpanEdits(raw, spanEdits))
    }
  }

  return { frontmatterWikilinks, frontmatterBarePaths, bodyWikilinks, aliasBackfills }
}

/** Build the ONE span edit that backfills `title` onto a note's `aliases:`
 *  field (category d). Handles the three on-disk shapes seedFrontmatterLines
 *  produces / a human might type: an empty flow array (`aliases: []`), a
 *  non-empty flow array (`aliases: ["Foo"]`), and a block list (`aliases:\n
 *  - Foo`). No `aliases:` field at all → inserts a fresh one right after the
 *  opening fence (mirrors `insertIdLine`'s byte-preserving insert). Returns
 *  null when the shape isn't one of these (never guesses at a hand-rolled
 *  structure — the note is left untouched and NOT counted as backfilled). */
function buildAliasBackfillEdit(raw: string, title: string): SpanEdit | null {
  const fence = raw.match(/^---\n/)
  if (!fence) return null
  const fmEnd = raw.indexOf('\n---', fence[0].length)
  if (fmEnd === -1) return null
  const quoted = `"${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

  // Flow array (empty or populated) on one line.
  const flowMatch = raw.slice(0, fmEnd).match(/^aliases:[ \t]*\[(.*)\][ \t]*$/m)
  if (flowMatch) {
    const lineStart = raw.lastIndexOf('\n', flowMatch.index! + 'aliases:'.length) + 1
    const bracketOpen = raw.indexOf('[', lineStart)
    const bracketClose = raw.indexOf(']', bracketOpen)
    const inner = flowMatch[1].trim()
    const replacement = inner ? `[${inner}, ${quoted}]` : `[${quoted}]`
    return { start: bracketOpen, end: bracketClose + 1, replacement }
  }

  // Block-list form: `aliases:` alone, followed by indented `- ` items.
  const blockMatch = raw.slice(0, fmEnd).match(/^aliases:[ \t]*$/m)
  if (blockMatch) {
    const keyLineEnd = blockMatch.index! + blockMatch[0].length
    // Find the end of the existing list — the last consecutive indented
    // `- ` line right after the `aliases:` line.
    const rest = raw.slice(keyLineEnd, fmEnd)
    const itemRe = /\n( +)-[^\n]*/g
    let lastEnd = keyLineEnd
    let indent = '  '
    let m: RegExpExecArray | null
    let sawItem = false
    while ((m = itemRe.exec(rest))) {
      if (sawItem && m[1].length !== indent.length) break // indent changed — stop at the list boundary
      indent = m[1]
      lastEnd = keyLineEnd + m.index + m[0].length
      sawItem = true
    }
    const insertion = `\n${indent}- ${quoted}`
    return { start: lastEnd, end: lastEnd, replacement: insertion }
  }

  // No `aliases:` field at all — insert a fresh one right after the opening
  // fence (byte-preserving insert, same pattern as `insertIdLine`).
  return { start: fence[0].length, end: fence[0].length, replacement: `aliases: [${quoted}]\n` }
}
