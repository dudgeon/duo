// ENH-243 — the Rollups tab's builder layer. Three jobs:
//
//   1. The BUILDER MODEL — a structured, GUI-shaped description of a rollup
//      (types → ordered group-by levels → filters → columns) that serializes
//      to a CANONICAL embedded ```base block inside the `type: rollup` note
//      (D4: the note IS the config; no new format, no sidecar). Reading back
//      is best-effort: a canonical block round-trips into the model; a
//      hand-authored spec that doesn't parse into the model stays VIEW-ONLY
//      (rendered fine, builder disabled); a spec that fails to parse at all
//      is the doctor's case.
//
//   2. VIEW DATA — evaluate a rollup's spec against the live corpus via the
//      shared engine (evaluateBaseDef — the one-engine rule, D10) and return
//      JSON-safe rows for the renderer: plain cells + per-level group values
//      + each row's vault-relative path (hover/click affordance, D6).
//      Multi-depth grouping is GUI-side in v1 (D5): the ordered level list
//      lives in the note's `group_by:` frontmatter (GUI-owned; the engine
//      ignores it) and level 1 mirrors into the block's `groupBy:` so
//      `duo rollup render` artifacts stay valid.
//
//   3. FRONTMATTER FLIPS — a surgical field writer for the inspector's flip
//      subpane (D2: instant apply + undo): only the touched keys change,
//      the body stays byte-untouched (stampRollupProvenance's discipline,
//      generalized), plus the typed attribute panel (bool/enum/text kinds
//      derived from the live corpus schema — the corpus IS the schema).

import fs from 'node:fs'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import { parseFile, readNotes, splitFrontmatter } from './parse'
import { buildCorpus } from './corpus'
import { safeName } from './filing'
import { resolveRollupNote } from './rollup-notes'
import { evaluateBaseDef, readCol, plainCell, sourceHash, type BaseDef } from './render'
import { buildEngineFiles, defaultAsOf } from './engine'

// ── the builder model ───────────────────────────────────────────────────────

export type BuilderFilterOp = 'eq' | 'ne' | 'set' | 'notset'

export interface BuilderFilter {
  property: string
  op: BuilderFilterOp
  /** Present for eq/ne; absent for set/notset. */
  value?: string
}

export interface RollupBuilderModel {
  title: string
  /** Entity types rolled up (1+). */
  types: string[]
  /** Ordered group-by levels, outermost first (0..n). */
  groupBy: string[]
  /** AND-combined filters (D8 vocabulary). */
  filters: BuilderFilter[]
  /** Frontmatter columns shown after the leading title column. */
  columns: string[]
}

const MANAGED_COMMENT =
  '<!-- Managed by the Duo Rollups tab (ENH-243). Reshape it there or via' +
  ' `duo rollup set`; hand-edits may drop it to view-only in the GUI. -->'

function filterExpr(f: BuilderFilter): string {
  switch (f.op) {
    case 'eq':
      return `${f.property} == ${JSON.stringify(f.value ?? '')}`
    case 'ne':
      return `${f.property} != ${JSON.stringify(f.value ?? '')}`
    case 'set':
      return `file.hasProperty(${JSON.stringify(f.property)})`
    case 'notset':
      return `!file.hasProperty(${JSON.stringify(f.property)})`
  }
}

/** Serialize the model to the canonical ```base YAML (D4). Hand-stable:
 *  key order and quoting are fixed so a save → parse → save round-trip is
 *  byte-identical. Level 1 of `groupBy` mirrors into the view's `groupBy:`
 *  (D5); deeper levels live only in the note's `group_by:` frontmatter. */
export function serializeBuilderBase(model: RollupBuilderModel): string {
  const lines: string[] = []
  lines.push('filters:')
  lines.push('  and:')
  if (model.types.length === 1) {
    lines.push(`    - type == ${JSON.stringify(model.types[0])}`)
  } else {
    lines.push('    - or:')
    for (const t of model.types) lines.push(`        - type == ${JSON.stringify(t)}`)
  }
  for (const f of model.filters) lines.push(`    - ${filterExpr(f)}`)
  lines.push('views:')
  lines.push('  - type: table')
  lines.push(`    name: ${JSON.stringify(model.title)}`)
  lines.push('    order:')
  lines.push('      - file.name')
  for (const c of model.columns) lines.push(`      - ${c}`)
  if (model.groupBy.length > 0) {
    lines.push('    groupBy:')
    lines.push(`      property: ${model.groupBy[0]}`)
  }
  return lines.join('\n') + '\n'
}

const EXPR_EQ = /^(\w[\w-]*) (==|!=) "(.*)"$/
const EXPR_SET = /^(!?)file\.hasProperty\("([\w-]+)"\)$/

function parseFilterExpr(expr: string): BuilderFilter | { type: string } | null {
  const eq = expr.match(EXPR_EQ)
  if (eq) {
    if (eq[1] === 'type' && eq[2] === '==') return { type: eq[3] }
    return { property: eq[1], op: eq[2] === '==' ? 'eq' : 'ne', value: eq[3] }
  }
  const set = expr.match(EXPR_SET)
  if (set) return { property: set[2], op: set[1] ? 'notset' : 'set' }
  return null
}

/** Best-effort parse of a base block back into the builder model. Returns
 *  null for anything outside the canonical dialect (hand-authored formulas,
 *  OR-groups beyond the type list, multiple views, view-level filters…) —
 *  the caller then treats the rollup as view-only (D4). */
export function parseBuilderBase(
  raw: string,
  fm: Record<string, unknown>,
): RollupBuilderModel | null {
  let def: Record<string, unknown> | null
  try {
    const parsed = yamlLoad(raw)
    def = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
  if (!def) return null
  if (def.formulas || def.properties) return null

  const views = Array.isArray(def.views) ? def.views : []
  if (views.length !== 1) return null
  const view = views[0] as Record<string, unknown>
  if (view.type !== 'table' || view.filters || view.summaries) return null

  const filtersRoot = def.filters as Record<string, unknown> | undefined
  const and = filtersRoot && Array.isArray(filtersRoot.and) ? filtersRoot.and : null
  if (!and || Object.keys(filtersRoot!).length !== 1) return null

  const types: string[] = []
  const filters: BuilderFilter[] = []
  for (const item of and) {
    if (typeof item === 'string') {
      const parsed = parseFilterExpr(item)
      if (!parsed) return null
      if ('type' in parsed && !('property' in parsed)) types.push(parsed.type)
      else filters.push(parsed as BuilderFilter)
      continue
    }
    // The multi-type or-group: every branch must be a `type == "…"` string.
    if (item && typeof item === 'object' && Array.isArray((item as Record<string, unknown>).or)) {
      for (const branch of (item as { or: unknown[] }).or) {
        if (typeof branch !== 'string') return null
        const parsed = parseFilterExpr(branch)
        if (!parsed || !('type' in parsed) || 'property' in parsed) return null
        types.push((parsed as { type: string }).type)
      }
      continue
    }
    return null
  }
  if (types.length === 0) return null

  const order = Array.isArray(view.order) ? view.order.map(String) : []
  if (order[0] !== 'file.name') return null
  const columns = order.slice(1)

  // Effective levels: the GUI-owned frontmatter list wins; else the block's
  // single-level groupBy; else none. The block level must agree with level 1
  // when both exist — a mismatch means someone hand-edited one side.
  const gb = view.groupBy as { property?: unknown } | undefined
  const blockLevel = gb && typeof gb.property === 'string' ? gb.property : null
  const fmLevels = Array.isArray(fm.group_by) ? fm.group_by.filter((x): x is string => typeof x === 'string') : null
  let groupBy: string[]
  if (fmLevels && fmLevels.length > 0) {
    if (blockLevel !== fmLevels[0]) return null
    groupBy = fmLevels
  } else {
    groupBy = blockLevel ? [blockLevel] : []
  }

  const title = typeof view.name === 'string' ? view.name : ''
  if (!title) return null
  return { title, types, groupBy, filters, columns }
}

// ── note create / update ────────────────────────────────────────────────────

const ROLLUPS_DIR = 'rollups'

function yamlScalar(v: string): string {
  return JSON.stringify(v)
}

/** The full canonical note content for a builder-owned rollup. `extraFm`
 *  carries preserved keys (provenance, format…) on update. */
function builderNoteContent(model: RollupBuilderModel, extraFm: Record<string, unknown>): string {
  const fm: string[] = []
  fm.push('type: rollup')
  fm.push(`title: ${yamlScalar(model.title)}`)
  const format = typeof extraFm.format === 'string' ? extraFm.format : 'html'
  fm.push(`format: ${format}`)
  if (model.groupBy.length > 0) {
    fm.push(`group_by: [${model.groupBy.join(', ')}]`)
  }
  for (const [k, v] of Object.entries(extraFm)) {
    if (['type', 'title', 'format', 'group_by', 'spec'].includes(k)) continue
    if (typeof v === 'string') fm.push(`${k}: ${yamlScalar(v)}`)
    else if (typeof v === 'number' || typeof v === 'boolean') fm.push(`${k}: ${String(v)}`)
  }
  return `---\n${fm.join('\n')}\n---\n\n${MANAGED_COMMENT}\n\n\`\`\`base\n${serializeBuilderBase(model)}\`\`\`\n`
}

export interface CreateRollupResult {
  noteRel: string
  absPath: string
}

/** Create `rollups/<slug>.md` from the model (slug from the title, uniqued). */
export function createRollupNote(root: string, model: RollupBuilderModel): CreateRollupResult {
  const dir = path.join(root, ROLLUPS_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const stem = safeName(model.title).toLowerCase().replace(/\s+/g, '-') || 'rollup'
  let slug = stem
  for (let n = 2; fs.existsSync(path.join(dir, `${slug}.md`)); n++) slug = `${stem}-${n}`
  const abs = path.join(dir, `${slug}.md`)
  fs.writeFileSync(abs, builderNoteContent(model, {}))
  return { noteRel: `${ROLLUPS_DIR}/${slug}.md`, absPath: abs }
}

/** Rewrite a builder-owned rollup note from the model, preserving provenance
 *  + any unrecognized frontmatter keys. Only call after parseBuilderBase
 *  succeeded for this note (the GUI's edit gate); a view-only note is never
 *  rewritten. */
export function updateRollupNote(noteAbs: string, model: RollupBuilderModel): void {
  const { frontmatter } = splitFrontmatter(fs.readFileSync(noteAbs, 'utf8'))
  fs.writeFileSync(noteAbs, builderNoteContent(model, frontmatter))
}

// ── frontmatter flips (D2) ──────────────────────────────────────────────────

/** Surgically set (or with null, delete) top-level frontmatter fields —
 *  ONLY the touched keys change; every other line and the body stay
 *  byte-untouched. stampRollupProvenance's discipline, generalized to
 *  arbitrary scalar values. */
export function setFrontmatterFields(
  noteAbs: string,
  updates: Record<string, string | number | boolean | null>,
): void {
  const serialize = (v: string | number | boolean): string =>
    typeof v === 'string' ? yamlScalar(v) : String(v)
  const raw = fs.readFileSync(noteAbs, 'utf8')
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) {
    const block = Object.entries(updates)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}: ${serialize(v!)}`)
      .join('\n')
    fs.writeFileSync(noteAbs, `---\n${block}\n---\n\n${raw}`)
    return
  }
  const remaining: Record<string, string | number | boolean | null> = { ...updates }
  const lines: string[] = []
  for (const line of m[1].split('\n')) {
    const key = line.match(/^([A-Za-z0-9_-]+)\s*:/)?.[1]
    if (key && key in remaining) {
      const v = remaining[key]
      delete remaining[key]
      if (v === null) continue
      lines.push(`${key}: ${serialize(v)}`)
    } else {
      lines.push(line)
    }
  }
  for (const [k, v] of Object.entries(remaining)) {
    if (v !== null) lines.push(`${k}: ${serialize(v)}`)
  }
  const body = raw.slice(m[0].length)
  fs.writeFileSync(noteAbs, `---\n${lines.join('\n')}\n---\n${body}`)
}

// ── the typed attribute panel (flip subpane data) ───────────────────────────

export type FieldKind = 'bool' | 'enum' | 'number' | 'text'

export interface EntityField {
  key: string
  kind: FieldKind
  /** Current value, plain-rendered. Empty string when unset. */
  value: string
  /** Observed enum values for enum-kind fields (corpus-derived). */
  options?: string[]
}

export interface EntityPanel {
  /** Vault-relative note path. */
  note: string
  absPath: string
  title: string
  type: string | null
  fields: EntityField[]
}

/** Keys the flip panel never offers — identity/machine-owned. */
const PROTECTED_KEYS = new Set(['type', 'id', 'aliases', 'last_generated', 'last_hash', 'out', 'spec', 'group_by'])

/** Read one entity's typed attribute panel: current frontmatter scalars +
 *  the flip affordance each supports, derived from the LIVE corpus schema
 *  (bool → toggle; a key with 2+ observed values → enum picker; else text).
 *  Union of the note's own keys and the type's observed props, so an unset
 *  prop can be set from the panel. */
export function entityPanel(root: string, notePath: string): EntityPanel {
  const abs = path.isAbsolute(notePath) ? notePath : path.resolve(root, notePath)
  const note = parseFile(abs, root)
  const t = typeof note.frontmatter.type === 'string' ? note.frontmatter.type : null
  const corpus = buildCorpus(root)

  const keys: string[] = []
  const seen = new Set<string>()
  const push = (k: string) => {
    if (!seen.has(k) && !PROTECTED_KEYS.has(k)) {
      seen.add(k)
      keys.push(k)
    }
  }
  for (const k of Object.keys(note.frontmatter)) push(k)
  if (t) for (const k of corpus.propsByType[t] ?? []) push(k)

  const fields: EntityField[] = []
  for (const key of keys) {
    const v = note.frontmatter[key]
    // v1 flips scalars only — arrays/objects stay in the editor.
    if (Array.isArray(v) || (typeof v === 'object' && v !== null)) continue
    const options = t ? corpus.enumsByType[`${t}.${key}`] : undefined
    let kind: FieldKind
    if (typeof v === 'boolean') kind = 'bool'
    else if (options && options.length >= 2) kind = 'enum'
    else if (typeof v === 'number') kind = 'number'
    else kind = 'text'
    const field: EntityField = {
      key,
      kind,
      value: v == null ? '' : String(v),
    }
    if (kind === 'enum') field.options = options
    fields.push(field)
  }

  return {
    note: note.relPath,
    absPath: abs,
    title:
      typeof note.frontmatter.title === 'string' && note.frontmatter.title.trim()
        ? note.frontmatter.title
        : note.basename,
    type: t,
    fields,
  }
}

// ── view data (D10) ─────────────────────────────────────────────────────────

export interface RollupViewRow {
  /** Vault-relative path — the hover tooltip + click-open target (D6). */
  path: string
  absPath: string
  title: string
  /** Plain-rendered group value per effective level ('—' when unset). */
  groups: string[]
  /** Plain-rendered cell per column (keyed by the order entry). */
  cells: Record<string, string>
}

export interface RollupViewData {
  note: string
  noteAbs: string
  title: string
  /** Column order (the view's `order`, including the leading file.name). */
  columns: string[]
  /** Effective group levels (frontmatter `group_by:` list, else the block's). */
  groupBy: string[]
  rows: RollupViewRow[]
  /** The parsed builder model, or null → view-only (hand-authored spec). */
  model: RollupBuilderModel | null
  /** Set when the spec failed to parse/evaluate — the doctor's case. */
  error: string | null
  /** ENH-248 — the artifact's vault-relative path (`out:`), null when never
   *  rendered. Powers the editor's under-title artifact link. */
  out: string | null
  /** Artifact freshness (`last_hash` vs the corpus hash now — the chip's
   *  rule); null when never rendered. Drives R4's grey-out. */
  stale: boolean | null
  lastGenerated: string | null
  /** R8 — the note's entity-link mode for artifact renders. */
  links: 'github' | 'relative'
}

/** Evaluate one rollup live for the Rollups tab. Never throws for a spec
 *  problem — that lands in `error` so the GUI can render the doctor card. */
export function rollupViewData(root: string, target: string, asOf?: Date): RollupViewData {
  const at = asOf ?? defaultAsOf()
  const resolved = resolveRollupNote(root, target)
  if (!resolved) {
    return {
      note: target,
      noteAbs: '',
      title: target,
      columns: [],
      groupBy: [],
      rows: [],
      model: null,
      error: `not a \`type: rollup\` note: ${target}`,
      out: null,
      stale: null,
      lastGenerated: null,
      links: 'relative',
    }
  }
  // Artifact provenance for the under-title link + R4 freshness. One extra
  // sourceHash walk per view fetch — same cost class as the evaluate below.
  const lastHash = typeof resolved.frontmatter.last_hash === 'string' ? resolved.frontmatter.last_hash : null
  const base: Omit<RollupViewData, 'columns' | 'groupBy' | 'rows' | 'model' | 'error'> = {
    note: resolved.noteRel,
    noteAbs: resolved.noteAbs,
    title: resolved.title,
    out: resolved.outRel,
    stale: lastHash == null ? null : lastHash !== sourceHash(root),
    lastGenerated:
      typeof resolved.frontmatter.last_generated === 'string' ? resolved.frontmatter.last_generated : null,
    links: resolved.links,
  }
  const fail = (error: string): RollupViewData => ({
    ...base,
    columns: [],
    groupBy: [],
    rows: [],
    model: null,
    error,
  })

  // The spec: an embedded ```base block (canonical), else the `spec:` .base.
  let specRaw: string | null = null
  let fm: Record<string, unknown> = resolved.frontmatter
  try {
    if (resolved.specPath) {
      const specAbs = path.isAbsolute(resolved.specPath)
        ? resolved.specPath
        : path.resolve(root, resolved.specPath)
      specRaw = fs.readFileSync(specAbs, 'utf8')
    } else {
      const body = fs.readFileSync(resolved.noteAbs, 'utf8')
      const block = body.match(/```base\n([\s\S]*?)```/)
      specRaw = block ? block[1] : null
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
  if (!specRaw) return fail(`no \`\`\`base block (and no spec: pointer) in ${resolved.noteRel}`)

  let def: BaseDef | null
  try {
    const parsed = yamlLoad(specRaw)
    def = parsed && typeof parsed === 'object' ? (parsed as BaseDef) : null
  } catch (e) {
    return fail(`base spec is not valid YAML: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!def || !Array.isArray(def.views) || def.views.length === 0) {
    return fail('base spec has no views')
  }

  // A spec: pointer is outside the canonical dialect → view-only (D4), but a
  // canonical embedded block round-trips into the editable model.
  const model = resolved.specPath ? null : parseBuilderBase(specRaw, fm)

  try {
    const notes = readNotes(root)
    const files = buildEngineFiles(notes, at)
    const thisFile = files.find((f) => f.path === resolved.noteRel) ?? null
    const evaluated = evaluateBaseDef(def, files, thisFile, at)
    const view = evaluated.views[0]

    const fmLevels = Array.isArray(fm.group_by)
      ? fm.group_by.filter((x): x is string => typeof x === 'string')
      : []
    const groupBy = fmLevels.length > 0 ? fmLevels : view.groupBy ? [view.groupBy.property] : []

    const columns = view.order
    const rows: RollupViewRow[] = view.rows.map((f) => {
      const cells: Record<string, string> = {}
      for (const p of columns) cells[p] = plainCell(readCol(p, f, thisFile, evaluated.formulas, at))
      const groups = groupBy.map((p) => {
        const v = plainCell(readCol(p, f, thisFile, evaluated.formulas, at))
        return v === '' ? '—' : v
      })
      return {
        path: f.path,
        absPath: path.resolve(root, f.path),
        title: f.name,
        groups,
        cells,
      }
    })

    return { ...base, columns, groupBy, rows, model, error: null }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

/** ENH-248 R7 — evaluate an AD-HOC builder model with no note behind it: the
 *  Vault tab's Entities section clicks through to an instant, unsaved view
 *  over one type. Same engine, same row shape as {@link rollupViewData};
 *  `note`/`noteAbs`/`out` stay empty so the GUI knows it's ephemeral (its
 *  "Save as rollup" affordance calls createRollupNote with this model). */
export function modelViewData(root: string, model: RollupBuilderModel, asOf?: Date): RollupViewData {
  const at = asOf ?? defaultAsOf()
  const empty = {
    note: '',
    noteAbs: '',
    title: model.title,
    out: null,
    stale: null,
    lastGenerated: null,
    links: 'relative' as const,
  }
  try {
    const def = yamlLoad(serializeBuilderBase(model)) as BaseDef
    const notes = readNotes(root)
    const files = buildEngineFiles(notes, at)
    const evaluated = evaluateBaseDef(def, files, null, at)
    const view = evaluated.views[0]
    const groupBy = model.groupBy
    const columns = view.order
    const rows: RollupViewRow[] = view.rows.map((f) => {
      const cells: Record<string, string> = {}
      for (const p of columns) cells[p] = plainCell(readCol(p, f, null, evaluated.formulas, at))
      const groups = groupBy.map((p) => {
        const v = plainCell(readCol(p, f, null, evaluated.formulas, at))
        return v === '' ? '—' : v
      })
      return { path: f.path, absPath: path.resolve(root, f.path), title: f.name, groups, cells }
    })
    return { ...empty, columns, groupBy, rows, model, error: null }
  } catch (e) {
    return {
      ...empty,
      columns: [],
      groupBy: [],
      rows: [],
      model,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
