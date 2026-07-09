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
import {
  evaluateBaseDef,
  readCol,
  plainCell,
  sourceHash,
  bucketRows,
  filterErrorLines,
  type BaseDef,
  type EvaluatedView,
} from './render'
import { buildEngineFiles, defaultAsOf, type EngineFile } from './engine'

// ── the builder model ───────────────────────────────────────────────────────

// ENH-259 — `ancestor` = transitive "is under" (any_parent): match if the
// value entity appears anywhere up this property's link chain.
// ENH-262 — `linksto` = the note links the value entity through ANY property
// (or prose): `file.hasLink(v)`. Property-agnostic; `property` carries the
// `'*'` sentinel so the chip/model stay shaped like every other filter.
export type BuilderFilterOp = 'eq' | 'ne' | 'contains' | 'ancestor' | 'linksto' | 'set' | 'notset'

/** ENH-262 — the property sentinel a `linksto` filter carries. */
export const LINKS_TO_PROP = '*'

export interface BuilderFilter {
  property: string
  op: BuilderFilterOp
  /** Present for eq/ne/contains; absent for set/notset. */
  value?: string
}

/** A declared bucket for group level 1 (ENH-255): always renders (even
 *  empty), in declaration order, under `label` (else the raw value). */
export interface BuilderBucket {
  value: string
  label?: string
}

export interface RollupBuilderModel {
  title: string
  /** Entity types rolled up (1+). */
  types: string[]
  /** Ordered group-by levels, outermost first (0..n). */
  groupBy: string[]
  /** Declared buckets for group level 1 (ENH-255); [] = derive from rows. */
  buckets: BuilderBucket[]
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
    case 'contains':
      // ENH-255 — multi-valued membership. list() folds a scalar-or-missing
      // field into an array so the predicate never errors on single-valued
      // notes; the engine's contains matches Link elements by IDENTITY
      // (targetKey fold), so the value names the linked note, not its label.
      return `list(${f.property}).contains(${JSON.stringify(f.value ?? '')})`
    case 'ancestor':
      // ENH-259 — transitive "is under": walk this property's link chain
      // upward and match the value entity anywhere in it (identity-folded by
      // the same contains()). `ancestors("parent").contains("California")`.
      return `ancestors(${JSON.stringify(f.property)}).contains(${JSON.stringify(f.value ?? '')})`
    case 'linksto':
      // ENH-262 — "links to": the note links the value entity through ANY
      // property (or prose) — the union primitive for populations that reach
      // one entity through different fields (owned: parent → track node;
      // monitored: tracks[] → track node). Identity-folded by hasLink.
      return `file.hasLink(${JSON.stringify(f.value ?? '')})`
    case 'set':
      return `file.hasProperty(${JSON.stringify(f.property)})`
    case 'notset':
      return `!file.hasProperty(${JSON.stringify(f.property)})`
  }
}

/** BUG-260 — YAML-safe serialization of an expression as a block-sequence
 *  item. An UNQUOTED expression whose value contains `: ` parses as a YAML
 *  MAPPING (the engine then silently dropped the filter and the note fell to
 *  view-only — the owner's `Track: …` entity names hit this constantly); a
 *  ` #` starts a comment mid-line; a leading `!` is a YAML tag
 *  (`!file.hasProperty(...)` made the whole spec THROW). Single-quote
 *  (doubling internal quotes) whenever a hazard is present; simple
 *  expressions stay bare so existing canonical notes remain byte-identical. */
function yamlSafeExpr(expr: string): string {
  const hazard = /: |\t|\s#/.test(expr) || /^[!&*?|>%@`"'[\]{},-]/.test(expr) || /^\s|[\s:]$/.test(expr)
  return hazard ? `'${expr.replace(/'/g, "''")}'` : expr
}

// D15 (ENH-266d, review follow-up) — every builder-generated base filters by
// `type ==` (single or or-group), which ALSO matches that type's schema
// TEMPLATE (e.g. `templates/milestone.md` carries its own `type: milestone`)
// and renders as a phantom row when opened natively in Obsidian (Bases
// resolves an embedded ```base block the same as a standalone `.base` file —
// see `docs/prd/enh-208-vault.md` D8). Every rollup the GUI Builder produces
// gets this exclusion unconditionally, matching the hygiene pattern in
// `core/vault/scaffold.ts`'s type templates. `parseBuilderBase` below treats
// this exact clause as a known framework line — silently skipped, not
// surfaced as an editable filter — so round-tripping stays clean and legacy
// notes saved before this exclusion existed still parse.
const TEMPLATES_EXCLUSION_EXPR = '!file.inFolder("templates")'

/** Serialize the model to the canonical ```base YAML (D4). Hand-stable:
 *  key order and quoting are fixed so a save → parse → save round-trip is
 *  byte-identical. Level 1 of `groupBy` mirrors into the view's `groupBy:`
 *  (D5); deeper levels live only in the note's `group_by:` frontmatter. */
export function serializeBuilderBase(model: RollupBuilderModel): string {
  const lines: string[] = []
  lines.push('filters:')
  lines.push('  and:')
  if (model.types.length === 1) {
    lines.push(`    - ${yamlSafeExpr(`type == ${JSON.stringify(model.types[0])}`)}`)
  } else {
    lines.push('    - or:')
    for (const t of model.types) lines.push(`        - ${yamlSafeExpr(`type == ${JSON.stringify(t)}`)}`)
  }
  lines.push(`    - ${yamlSafeExpr(TEMPLATES_EXCLUSION_EXPR)}`)
  for (const f of model.filters) lines.push(`    - ${yamlSafeExpr(filterExpr(f))}`)
  lines.push('views:')
  lines.push('  - type: table')
  lines.push(`    name: ${JSON.stringify(model.title)}`)
  lines.push('    order:')
  lines.push('      - file.name')
  for (const c of model.columns) lines.push(`      - ${c}`)
  if (model.groupBy.length > 0) {
    lines.push('    groupBy:')
    lines.push(`      property: ${model.groupBy[0]}`)
    // ENH-255 — declared buckets (level 1): always rendered, in this order,
    // under their labels. A Duo extension; Obsidian ignores unknown view keys.
    if (model.buckets.length > 0) {
      lines.push('    groups:')
      for (const b of model.buckets) {
        lines.push(`      - value: ${JSON.stringify(b.value)}`)
        if (b.label != null) lines.push(`        label: ${JSON.stringify(b.label)}`)
      }
    }
  }
  return lines.join('\n') + '\n'
}

const EXPR_EQ = /^(\w[\w-]*) (==|!=) "(.*)"$/
const EXPR_SET = /^(!?)file\.hasProperty\("([\w-]+)"\)$/
const EXPR_CONTAINS = /^list\((\w[\w-]*)\)\.contains\("(.*)"\)$/
// ENH-259 — the transitive "is under" form: ancestors("<prop>").contains("<v>")
const EXPR_ANCESTOR = /^ancestors\("([\w-]+)"\)\.contains\("(.*)"\)$/
// ENH-262 — the "links to" form: file.hasLink("<entity>")
const EXPR_LINKSTO = /^file\.hasLink\("(.*)"\)$/

function parseFilterExpr(expr: string): BuilderFilter | { type: string } | null {
  // ENH-262 — "links to": property-agnostic, carries the '*' sentinel.
  const lnk = expr.match(EXPR_LINKSTO)
  if (lnk) {
    let value: string
    try {
      value = JSON.parse(`"${lnk[1]}"`)
    } catch {
      value = lnk[1]
    }
    return { property: LINKS_TO_PROP, op: 'linksto', value }
  }
  const anc = expr.match(EXPR_ANCESTOR)
  if (anc) {
    let value: string
    try {
      value = JSON.parse(`"${anc[2]}"`)
    } catch {
      value = anc[2]
    }
    return { property: anc[1], op: 'ancestor', value }
  }
  const has = expr.match(EXPR_CONTAINS)
  if (has) {
    let value: string
    try {
      value = JSON.parse(`"${has[2]}"`)
    } catch {
      value = has[2]
    }
    return { property: has[1], op: 'contains', value }
  }
  const eq = expr.match(EXPR_EQ)
  if (eq) {
    // filterExpr serializes the value via JSON.stringify; eq[3] is only the
    // de-fenced quoted body, so it must go back through JSON.parse to undo
    // that escaping (a raw `\"` would otherwise survive as literal backslash
    // characters instead of a decoded quote).
    let value: string
    try {
      value = JSON.parse(`"${eq[3]}"`)
    } catch {
      value = eq[3]
    }
    if (eq[1] === 'type' && eq[2] === '==') return { type: value }
    return { property: eq[1], op: eq[2] === '==' ? 'eq' : 'ne', value }
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
    // D15 — the templates-folder exclusion `serializeBuilderBase` always
    // emits (review follow-up) is a framework line, not a user filter: skip
    // it silently so it neither pollutes the editable filter list nor (its
    // ABSENCE from) a legacy pre-fix note breaks the canonical-dialect parse.
    if (item === TEMPLATES_EXCLUSION_EXPR) continue
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
    // BUG-260 — a pre-fix note serialized an expression UNQUOTED and its
    // value contained ": ", so YAML parsed the line as a single-pair MAPPING.
    // Reconstruct the original string so the note regains editability; the
    // next save re-serializes it properly quoted (yamlSafeExpr).
    if (item && typeof item === 'object') {
      const keys = Object.keys(item as object)
      const v = keys.length === 1 ? (item as Record<string, unknown>)[keys[0]] : undefined
      if (typeof v === 'string') {
        const parsed = parseFilterExpr(`${keys[0]}: ${v}`)
        if (parsed) {
          if ('type' in parsed && !('property' in parsed)) types.push(parsed.type)
          else filters.push(parsed as BuilderFilter)
          continue
        }
      }
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

  // ENH-255 — declared buckets. Canonical form is {value, label?} entries;
  // a bare-string entry (value only) is accepted too. Anything else — or a
  // groups: declaration with no groupBy — is outside the dialect → view-only.
  // NOTE (review, finding n): the `groups:` shape is also validated in
  // render.ts normalizeDeclaredGroups (lenient) and lint.ts (advisory) —
  // three modes, deliberately not unified; change all three together.
  const buckets: BuilderBucket[] = []
  if (view.groups != null) {
    if (!Array.isArray(view.groups) || groupBy.length === 0) return null
    for (const item of view.groups) {
      if (typeof item === 'string') {
        buckets.push({ value: item })
        continue
      }
      if (!item || typeof item !== 'object') return null
      const o = item as Record<string, unknown>
      if (typeof o.value !== 'string') return null
      for (const k of Object.keys(o)) if (k !== 'value' && k !== 'label') return null
      if (o.label != null && typeof o.label !== 'string') return null
      buckets.push({ value: o.value, ...(typeof o.label === 'string' ? { label: o.label } : {}) })
    }
  }

  const title = typeof view.name === 'string' ? view.name : ''
  if (!title) return null
  return { title, types, groupBy, buckets, filters, columns }
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
  /** ENH-255 — declared level-1 buckets, in declaration order: the header
   *  label + the matched level-1 group key (`rows[].groups[0]`), null when
   *  the bucket is empty (the GUI injects an empty group for it). [] = none
   *  declared. */
  buckets: { label: string; key: string | null }[]
  /** ENH-255 — filter eval-error lines (a broken filter must never read as
   *  a legitimately-empty rollup). */
  warnings: string[]
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

/** ENH-255 review fix (findings l/m/p) — ONE derivation of level-1 grouping
 *  shared by {@link rollupViewData} and {@link modelViewData}:
 *  - `buckets` is the declared-bucket DTO (label + matched canonical group
 *    key, null when empty) — previously duplicated byte-identically in both.
 *  - `groupKeyByPath` maps each row to its CORE-COMPUTED level-1 group key
 *    (bucketRows' canonical key — identity-merged, alias-variant-folded), so
 *    the GUI's `rows[].groups[0]` and `buckets[].key` come from the SAME
 *    computation and the GUI's `label === key` bridge is exact by
 *    construction (never a re-derivation that can drift). Also trims the
 *    redundant per-row readCol for level 1 (bucketRows already computed it). */
function levelOneGrouping(
  view: EvaluatedView,
  formulas: Record<string, unknown>,
  thisFile: EngineFile | null,
  at: Date,
): { buckets: { label: string; key: string | null }[]; groupKeyByPath: Map<string, string> | null } {
  const all = view.groupBy ? bucketRows(view, formulas, thisFile, at) : null
  const groupKeyByPath = all ? new Map<string, string>() : null
  if (all && groupKeyByPath) {
    for (const b of all) for (const f of b.rows) if (!groupKeyByPath.has(f.path)) groupKeyByPath.set(f.path, b.key)
  }
  const buckets = (view.groups?.length ? (all ?? []) : [])
    .filter((b) => b.declared)
    .map((b) => ({ label: b.label, key: b.rows.length > 0 ? b.key : null }))
  return { buckets, groupKeyByPath }
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
      buckets: [],
      warnings: [],
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
  const base: Omit<RollupViewData, 'columns' | 'groupBy' | 'buckets' | 'warnings' | 'rows' | 'model' | 'error'> = {
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
    buckets: [],
    warnings: [],
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
    // ENH-255 — level-1 group keys + declared buckets come from ONE core
    // computation (levelOneGrouping / bucketRows), so alias variants merge
    // identically here and in rendered artifacts, and the GUI's bucket
    // bridge (label === key) can never drift from core.
    const { buckets, groupKeyByPath } = levelOneGrouping(view, evaluated.formulas, thisFile, at)
    const coreLevel1 = view.groupBy?.property === groupBy[0] ? groupKeyByPath : null
    const rows: RollupViewRow[] = view.rows.map((f) => {
      const cells: Record<string, string> = {}
      for (const p of columns) cells[p] = plainCell(readCol(p, f, thisFile, evaluated.formulas, at))
      const groups = groupBy.map((p, i) => {
        if (i === 0 && coreLevel1) return coreLevel1.get(f.path) ?? '—'
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

    return { ...base, columns, groupBy, buckets, warnings: filterErrorLines(view), rows, model, error: null }
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
    const { buckets, groupKeyByPath } = levelOneGrouping(view, evaluated.formulas, null, at)
    const coreLevel1 = view.groupBy?.property === groupBy[0] ? groupKeyByPath : null
    const rows: RollupViewRow[] = view.rows.map((f) => {
      const cells: Record<string, string> = {}
      for (const p of columns) cells[p] = plainCell(readCol(p, f, null, evaluated.formulas, at))
      const groups = groupBy.map((p, i) => {
        if (i === 0 && coreLevel1) return coreLevel1.get(f.path) ?? '—'
        const v = plainCell(readCol(p, f, null, evaluated.formulas, at))
        return v === '' ? '—' : v
      })
      return { path: f.path, absPath: path.resolve(root, f.path), title: f.name, groups, cells }
    })
    return { ...empty, columns, groupBy, buckets, warnings: filterErrorLines(view), rows, model, error: null }
  } catch (e) {
    return {
      ...empty,
      columns: [],
      groupBy: [],
      buckets: [],
      warnings: [],
      rows: [],
      model,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
