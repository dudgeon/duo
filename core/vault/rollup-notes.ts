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
  /** True when the rollup is out of date: never rendered, OR the vault's
   *  current `sourceHash` differs from `last_hash`. */
  stale: boolean
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
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
    const outRel = asString(note.frontmatter.out)
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
    frontmatter,
  }
}

/** YAML-safe double-quoted scalar — survives colons (ISO timestamps), spaces
 *  (paths), and quotes without corrupting the frontmatter block. */
function yamlScalar(v: string): string {
  return JSON.stringify(v)
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
