// ENH-228 Vault view — the `type: rollup` lifecycle layer.
//
// ENH-228 D1 promotes a rollup from "a rendered file somewhere" to a
// first-class TYPED NOTE that owns its spec + its render provenance. A rollup
// note (`templates/rollup.md` → `type: rollup`) lives in `rollups/<slug>.md`
// and carries:
//   - its SPEC — either an embedded ```base block (the note body) or a
//     `spec:` frontmatter pointer to a `.base` file;
//   - `format:` (html by default — D2, owner is HTML-first);
//   - `out:` — the rendered artifact's vault-relative path;
//   - render PROVENANCE — `last_generated`, `last_hash` (the source hash at
//     render time), stamped back surgically on each render.
//
// Discovery is then a type query (`listRollups`), not a fragile artifact
// scan and not a sidecar manifest (§D9-clean — the note records its OWN build).
//
// Where the note vs the artifact lives. The note is `rollups/<slug>.md`; the
// HTML artifact is `rollups/<slug>.html` (different extension — no collision).
// The GENERAL corpus walk (parse.ts SKIP_DIRS) skips `rollups/` so rendered
// artifacts never pollute the corpus / sourceHash; so `listRollups` scopes its
// `type == rollup` query to the `rollups/` folder. The `type: rollup` filter
// drops any rendered `.md` artifact there (artifacts carry no `type:`), and
// `.html` artifacts are excluded by the `.md`-only read — both invariants hold.

import fs from 'node:fs'
import path from 'node:path'
import { parseFile, splitFrontmatter } from './parse'
import { sourceHash } from './render'

const ROLLUPS_DIR = 'rollups'

/** One rollup, as the Vault view / `duo rollup list` consume it. */
export interface RollupListing {
  /** Vault-relative POSIX path to the rollup NOTE. */
  note: string
  /** Absolute path to the rollup note. */
  absPath: string
  /** Display title: frontmatter `title:`, else the extension-less filename. */
  title: string
  /** Vault-relative artifact path (`out:`), or null when never set / rendered. */
  out: string | null
  /** Output format — `html` (default) or `md`. */
  format: string
  /** ISO timestamp of the last render, or null when never rendered. */
  last_generated: string | null
  /** Source hash at the last render, or null when never rendered. */
  last_hash: string | null
  /** True when the rollup is NOT up to date — i.e. never rendered (`last_hash`
   *  is null) OR the vault's current `sourceHash` differs from `last_hash`.
   *  This deliberately conflates two states: a consumer wanting to distinguish
   *  "never rendered" from "rendered but out of date" checks `last_hash == null`
   *  (the Vault view's RollupRow does exactly this for its freshness chip). */
  stale: boolean
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** A vault-relative `out:` confined to the vault. Returns null when the value is
 *  absent OR resolves OUTSIDE `root` (a `..` / absolute escape) — the Vault view
 *  then hides "View" rather than opening a file outside the vault from a
 *  malformed `out:` (review #2). A well-formed in-vault path passes unchanged. */
function containedOut(outRel: string | null, root: string): string | null {
  if (!outRel) return null
  const abs = path.resolve(root, outRel)
  const rootAbs = path.resolve(root)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null
  return outRel
}

/** Read a frontmatter `format:` into the html|md domain (html default — D2). */
function normalizeFormat(v: unknown, outRel: string | null): 'html' | 'md' {
  const f = asString(v)
  if (f === 'md') return 'md'
  if (f === 'html') return 'html'
  // No explicit format: infer from the artifact extension, else default HTML.
  if (outRel && outRel.toLowerCase().endsWith('.md')) return 'md'
  return 'html'
}

/** List a vault's rollups — every `type: rollup` note in `rollups/`, with its
 *  render provenance + a freshness flag. No filesystem scan of artifacts, no
 *  sidecar (D1). Missing `rollups/` → `[]`. The current source hash is computed
 *  ONCE for the whole list (it's vault-wide). */
export function listRollups(root: string): RollupListing[] {
  const dir = path.join(root, ROLLUPS_DIR)
  let names: string[]
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }

  const current = sourceHash(root)
  const out: RollupListing[] = []
  for (const name of names) {
    const abs = path.join(dir, name)
    let note
    try {
      note = parseFile(abs, root)
    } catch {
      continue
    }
    // The `type: rollup` filter is what makes this a TYPE query, not a folder
    // scan — it drops any rendered `.md` artifact that shares the folder
    // (artifacts carry no `type:`).
    if (note.frontmatter.type !== 'rollup') continue
    const outRel = containedOut(asString(note.frontmatter.out), root)
    const lastHash = asString(note.frontmatter.last_hash)
    out.push({
      note: note.relPath,
      absPath: abs,
      title: asString(note.frontmatter.title) ?? note.basename,
      out: outRel,
      format: normalizeFormat(note.frontmatter.format, outRel),
      last_generated: asString(note.frontmatter.last_generated),
      last_hash: lastHash,
      stale: lastHash == null || lastHash !== current,
    })
  }
  out.sort((a, b) => a.title.localeCompare(b.title))
  return out
}

/** A `type: rollup` note resolved for rendering. */
export interface ResolvedRollupNote {
  /** Absolute path to the rollup note. */
  noteAbs: string
  /** Vault-relative POSIX path to the rollup note. */
  noteRel: string
  /** Extension-less filename (the artifact stem). */
  slug: string
  /** Display title. */
  title: string
  /** The note's declared format (html default — D2). A `--md`/`--html` flag
   *  overrides this at the call site. */
  format: 'html' | 'md'
  /** The note's declared artifact path (`out:`), vault-relative, or null. */
  outRel: string | null
  /** A `.base` path to render (from `spec:`), or null = render the note's own
   *  embedded ```base blocks. Vault-relative or absolute as authored. */
  specPath: string | null
  /** ENH-248 R8 — the note's declared entity-link mode (`links:` frontmatter,
   *  GUI-owned like `group_by:`): 'github' renders entity links as GitHub
   *  blob URLs (when the vault's repo probe succeeds); default 'relative'. */
  links: 'github' | 'relative'
  frontmatter: Record<string, unknown>
}

/** Resolve a render target to a `type: rollup` note, or null when it isn't one.
 *  Accepts a vault-relative / absolute path, a bare slug (resolved under
 *  `rollups/`), or a slug with `.md`. Returns null (not throws) for a missing
 *  file or a non-rollup target — the CLI then falls back to the legacy
 *  `renderTarget` path (a bare `.base` / non-rollup note). */
export function resolveRollupNote(root: string, target: string): ResolvedRollupNote | null {
  const candidates: string[] = []
  const direct = path.isAbsolute(target) ? target : path.resolve(root, target)
  if (target.endsWith('.md')) candidates.push(direct)
  // Bare slug or a non-.md path → also try it under rollups/ as `<slug>.md`.
  const slug = path.basename(target).replace(/\.(base|md)$/i, '')
  candidates.push(path.join(root, ROLLUPS_DIR, `${slug}.md`))
  if (!target.endsWith('.md') && !target.endsWith('.base')) candidates.push(`${direct}.md`)

  let abs: string | null = null
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      abs = c
      break
    }
  }
  if (!abs) return null

  const { frontmatter } = splitFrontmatter(fs.readFileSync(abs, 'utf8'))
  if (frontmatter.type !== 'rollup') return null

  const outRel = asString(frontmatter.out)
  return {
    noteAbs: abs,
    noteRel: path.relative(root, abs).split(path.sep).join('/'),
    slug: path.basename(abs, '.md'),
    title: asString(frontmatter.title) ?? path.basename(abs, '.md'),
    format: normalizeFormat(frontmatter.format, outRel),
    outRel,
    specPath: asString(frontmatter.spec),
    links: frontmatter.links === 'github' ? 'github' : 'relative',
    frontmatter,
  }
}

// ── lifecycle (ENH-248 R6) ───────────────────────────────────────────────────

export interface DeleteRollupResult {
  ok: boolean
  /** Vault-relative paths actually removed (note first, then artifact). */
  deleted: string[]
  error: string | null
}

/** Delete a rollup: the definition note plus its rendered artifact (the
 *  `out:` target, only when it resolves INSIDE the vault). File history
 *  (ENH-221) remains the undo net for the note; the artifact is rebuildable
 *  from nothing, so its removal is safe by construction. */
export function deleteRollup(root: string, target: string): DeleteRollupResult {
  const resolved = resolveRollupNote(root, target)
  if (!resolved) return { ok: false, deleted: [], error: `not a \`type: rollup\` note: ${target}` }
  const deleted: string[] = []
  try {
    const artifactRel = containedOut(resolved.outRel, root)
    fs.rmSync(resolved.noteAbs)
    deleted.push(resolved.noteRel)
    if (artifactRel) {
      const artifactAbs = path.resolve(root, artifactRel)
      if (fs.existsSync(artifactAbs)) {
        fs.rmSync(artifactAbs)
        deleted.push(artifactRel)
      }
    }
    return { ok: true, deleted, error: null }
  } catch (e) {
    return { ok: deleted.length > 0, deleted, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface DuplicateRollupResult {
  ok: boolean
  /** Vault-relative path of the new note. */
  note: string | null
  absPath: string | null
  error: string | null
}

/** Duplicate a rollup note as `<slug>-copy.md` (uniqued) with "<Title>
 *  (copy)". Provenance keys (out/last_generated/last_hash) are STRIPPED —
 *  the copy has no artifact yet and must not point at the original's; the
 *  next render/save stamps its own. Works for hand-authored notes too (raw
 *  content copy — no model round-trip required). */
export function duplicateRollup(root: string, target: string): DuplicateRollupResult {
  const resolved = resolveRollupNote(root, target)
  if (!resolved) return { ok: false, note: null, absPath: null, error: `not a \`type: rollup\` note: ${target}` }
  try {
    const dir = path.join(root, ROLLUPS_DIR)
    const stem = `${resolved.slug}-copy`
    let slug = stem
    for (let n = 2; fs.existsSync(path.join(dir, `${slug}.md`)); n++) slug = `${stem}-${n}`
    const raw = fs.readFileSync(resolved.noteAbs, 'utf8')
    const abs = path.join(dir, `${slug}.md`)
    fs.writeFileSync(abs, raw)
    // Surgical field edits on the COPY: new title, no inherited provenance
    // (null = delete the key — same line-level discipline as the stamp).
    editFrontmatterLines(abs, {
      title: yamlScalar(`${resolved.title} (copy)`),
      out: null,
      last_generated: null,
      last_hash: null,
    })
    return { ok: true, note: `${ROLLUPS_DIR}/${slug}.md`, absPath: abs, error: null }
  } catch (e) {
    return { ok: false, note: null, absPath: null, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── artifact introspection (ENH-248 R2) ─────────────────────────────────────

export interface RollupArtifactInfo {
  vaultRoot: string
  /** Vault-relative note path of the rollup this artifact renders. */
  note: string
  title: string
  lastGenerated: string | null
  /** `last_hash` vs the corpus hash right now (same rule as the chip). */
  stale: boolean
}

/** Given any absolute file path (e.g. the browser pane's current file:// URL),
 *  decide whether it is a rendered rollup artifact: walk up to the nearest
 *  enclosing vault root, then match the path against every rollup's `out:`.
 *  Returns null for anything else — the caller shows no chrome. Pure live
 *  read (no-sidecar §D9): worst case one listRollups scan per navigation. */
export function rollupArtifactInfo(absPath: string, isRoot: (dir: string) => boolean): RollupArtifactInfo | null {
  const target = path.resolve(absPath)
  let root: string | null = null
  for (let d = path.dirname(target); ; ) {
    if (isRoot(d)) {
      root = d
      break
    }
    const parent = path.dirname(d)
    if (parent === d) break
    d = parent
  }
  if (!root) return null
  for (const l of listRollups(root)) {
    if (l.out && path.resolve(root, l.out) === target) {
      return {
        vaultRoot: root,
        note: l.note,
        title: l.title,
        lastGenerated: l.last_generated ?? null,
        stale: l.stale,
      }
    }
  }
  return null
}

/** YAML-safe double-quoted scalar — survives colons (ISO timestamps), spaces
 *  (paths), and quotes without corrupting the frontmatter block. */
function yamlScalar(v: string): string {
  return JSON.stringify(v)
}

/** Line-level frontmatter edit: set a key to a PRE-SERIALIZED value, or
 *  delete it with null. Same discipline as {@link stampRollupProvenance}
 *  (only touched lines change), generalized with delete support for
 *  {@link duplicateRollup}. */
function editFrontmatterLines(noteAbs: string, updates: Record<string, string | null>): void {
  const raw = fs.readFileSync(noteAbs, 'utf8')
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return
  const remaining = { ...updates }
  const lines: string[] = []
  for (const line of m[1].split('\n')) {
    const key = line.match(/^([A-Za-z0-9_-]+)\s*:/)?.[1]
    if (key && key in remaining) {
      const v = remaining[key]
      delete remaining[key]
      if (v === null) continue
      lines.push(`${key}: ${v}`)
    } else {
      lines.push(line)
    }
  }
  for (const [k, v] of Object.entries(remaining)) if (v !== null) lines.push(`${k}: ${v}`)
  const body = raw.slice(m[0].length)
  fs.writeFileSync(noteAbs, `---\n${lines.join('\n')}\n---\n${body}`)
}

/** Surgically stamp render provenance into a rollup note's frontmatter —
 *  updating ONLY `last_generated`, `last_hash`, and `out`, leaving every other
 *  frontmatter key AND the entire body byte-untouched. Idempotent: re-stamping
 *  the same values rewrites the same lines, appends nothing. A note without a
 *  frontmatter block gets one minted (defensive — rollup notes always have one).
 *
 *  D1 / §D9-clean: this is the note recording its OWN build (the same principle
 *  as the ENH-229 artifact stamp), not a sidecar mirroring derivable state. */
export function stampRollupProvenance(
  noteAbs: string,
  fields: { last_generated: string; last_hash: string; out: string },
): void {
  const updates: Record<string, string> = {
    last_generated: yamlScalar(fields.last_generated),
    last_hash: yamlScalar(fields.last_hash),
    out: yamlScalar(fields.out),
  }
  const raw = fs.readFileSync(noteAbs, 'utf8')
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)

  if (!m) {
    // No frontmatter — mint a minimal block (defensive; rollup notes carry one).
    const block = Object.entries(updates).map(([k, v]) => `${k}: ${v}`).join('\n')
    fs.writeFileSync(noteAbs, `---\n${block}\n---\n\n${raw}`)
    return
  }

  const lines = m[1].split('\n')
  const remaining = { ...updates }
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].match(/^([A-Za-z0-9_-]+)\s*:/)?.[1]
    if (key && key in remaining) {
      lines[i] = `${key}: ${remaining[key]}`
      delete remaining[key]
    }
  }
  for (const [k, v] of Object.entries(remaining)) lines.push(`${k}: ${v}`)
  const body = raw.slice(m[0].length)
  fs.writeFileSync(noteAbs, `---\n${lines.join('\n')}\n---\n${body}`)
}

/** Decide what a render should stamp back into a rollup note. Provenance
 *  (`out` / `last_generated` / `last_hash`) is recorded ONLY when the render
 *  produced the note's CANONICAL artifact — the rendered format equals the
 *  note's declared `format:`. An ad-hoc `--md` / `--html` override renders a
 *  SIDE artifact, so it must NOT repoint `out:` (which would then mismatch the
 *  declared `format:` on the next default render — writing, say, HTML bytes into
 *  a `.md` path) nor mark the note fresh while the canonical artifact is stale
 *  (review #1). Returns null when the caller should skip the stamp entirely. */
export function provenanceStamp(
  note: { format: 'html' | 'md' },
  rendered: { format: 'html' | 'md'; outRel: string; generatedAt: string; sourceHash: string },
): { last_generated: string; last_hash: string; out: string } | null {
  if (rendered.format !== note.format) return null
  return { last_generated: rendered.generatedAt, last_hash: rendered.sourceHash, out: rendered.outRel }
}
