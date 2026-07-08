// ENH-243 — the Rollups tab's builder layer: canonical serialize ⇄ parse
// round-trip, note create/update, surgical frontmatter flips, the typed
// attribute panel, and live view data (multi-depth grouping inputs).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initVault } from './scaffold'
import {
  serializeBuilderBase,
  parseBuilderBase,
  createRollupNote,
  updateRollupNote,
  setFrontmatterFields,
  entityPanel,
  rollupViewData,
  modelViewData,
  type RollupBuilderModel,
} from './builder'
import { splitFrontmatter } from './parse'
import { listRollups } from './rollup-notes'

let root: string
let v: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-builder-'))
  v = initVault(path.join(root, 'v')).root
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function write(rel: string, content: string): string {
  const abs = path.join(v, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}

function task(rel: string, fm: string): void {
  write(rel, `---\ntype: task\n${fm}\n---\n\nbody\n`)
}

const MODEL: RollupBuilderModel = {
  title: 'Open tasks',
  types: ['task'],
  groupBy: ['status', 'org'],
  buckets: [],
  filters: [
    { property: 'status', op: 'ne', value: 'done' },
    { property: 'owner', op: 'set' },
  ],
  columns: ['owner', 'due'],
}

describe('serializeBuilderBase ⇄ parseBuilderBase (D4 canonical dialect)', () => {
  it('round-trips a single-type model (group levels via frontmatter)', () => {
    const yaml = serializeBuilderBase(MODEL)
    const parsed = parseBuilderBase(yaml, { group_by: ['status', 'org'] })
    expect(parsed).toEqual(MODEL)
  })

  it('round-trips a multi-type model via the or-group', () => {
    const m: RollupBuilderModel = { ...MODEL, types: ['task', 'initiative'], groupBy: [], buckets: [], filters: [] }
    const parsed = parseBuilderBase(serializeBuilderBase(m), {})
    expect(parsed).toEqual(m)
  })

  it('falls back to the block groupBy when no frontmatter levels exist', () => {
    const parsed = parseBuilderBase(serializeBuilderBase(MODEL), {})
    expect(parsed?.groupBy).toEqual(['status'])
  })

  it('returns null (view-only) for hand-authored dialects', () => {
    // formulas, multiple views, view-level filters, non-type or-groups
    expect(parseBuilderBase('formulas:\n  x: 1\nviews:\n  - type: table\n    name: "t"\n    order: [file.name]\n', {})).toBeNull()
    expect(parseBuilderBase('filters:\n  and:\n    - type == "task"\nviews:\n  - type: table\n    name: "a"\n    order: [file.name]\n  - type: table\n    name: "b"\n    order: [file.name]\n', {})).toBeNull()
    expect(parseBuilderBase('filters:\n  and:\n    - captured < today() - "1 week"\n    - type == "task"\nviews:\n  - type: table\n    name: "t"\n    order: [file.name]\n', {})).toBeNull()
  })

  it('returns null when frontmatter level 1 disagrees with the block groupBy', () => {
    expect(parseBuilderBase(serializeBuilderBase(MODEL), { group_by: ['org', 'status'] })).toBeNull()
  })

  it('round-trips a filter value containing a quote and a backslash', () => {
    const m: RollupBuilderModel = {
      ...MODEL,
      groupBy: [],
      buckets: [],
      filters: [{ property: 'title', op: 'eq', value: 'He said "hi" \\o/' }],
    }
    const parsed = parseBuilderBase(serializeBuilderBase(m), {})
    expect(parsed?.filters).toEqual(m.filters)
  })
})

describe('createRollupNote / updateRollupNote', () => {
  it('creates rollups/<slug>.md discoverable by listRollups, uniqued on collision', () => {
    const a = createRollupNote(v, MODEL)
    const b = createRollupNote(v, MODEL)
    expect(a.noteRel).toBe('rollups/open-tasks.md')
    expect(b.noteRel).toBe('rollups/open-tasks-2.md')
    const listed = listRollups(v).map((r) => r.note)
    expect(listed).toContain(a.noteRel)
    expect(listed).toContain(b.noteRel)
  })

  it('update preserves provenance + unknown frontmatter keys', () => {
    const { absPath } = createRollupNote(v, MODEL)
    setFrontmatterFields(absPath, { last_hash: 'abc123', custom: 'kept' })
    updateRollupNote(absPath, { ...MODEL, title: 'Renamed', groupBy: ['org'] })
    const { frontmatter } = splitFrontmatter(fs.readFileSync(absPath, 'utf8'))
    expect(frontmatter.title).toBe('Renamed')
    expect(frontmatter.group_by).toEqual(['org'])
    expect(frontmatter.last_hash).toBe('abc123')
    expect(frontmatter.custom).toBe('kept')
    expect(frontmatter.type).toBe('rollup')
  })
})

describe('setFrontmatterFields (D2 — surgical flips)', () => {
  it('changes only the touched key; body byte-untouched; null deletes', () => {
    const abs = write('tasks/a.md', '---\ntype: task\nstatus: open\nblocked: false\n---\n\nbody stays\n')
    setFrontmatterFields(abs, { status: 'done', blocked: true, extra: 'x' })
    const raw = fs.readFileSync(abs, 'utf8')
    expect(raw).toContain('status: "done"')
    expect(raw).toContain('blocked: true')
    expect(raw).toContain('extra: "x"')
    expect(raw.endsWith('\nbody stays\n')).toBe(true)
    setFrontmatterFields(abs, { extra: null })
    expect(fs.readFileSync(abs, 'utf8')).not.toContain('extra:')
  })
})

describe('entityPanel (flip subpane data)', () => {
  it('types fields from the live corpus: bool / enum / text; unions type props', () => {
    task('tasks/a.md', 'status: open\nblocked: false\nowner: geoff')
    task('tasks/b.md', 'status: done\nowner: sam\ndue: 2026-07-10')
    const panel = entityPanel(v, 'tasks/a.md')
    expect(panel.type).toBe('task')
    const byKey = Object.fromEntries(panel.fields.map((f) => [f.key, f]))
    expect(byKey.blocked.kind).toBe('bool')
    expect(byKey.status.kind).toBe('enum')
    expect(byKey.status.options).toEqual(['done', 'open'])
    // `due` is unset on a but observed on the type → offered as settable.
    expect(byKey.due).toBeDefined()
    expect(byKey.due.value).toBe('')
    // protected keys never offered
    expect(byKey.type).toBeUndefined()
  })
})

describe('rollupViewData (D10 — structured rows, D5 — multi-level groups)', () => {
  it('evaluates a canonical rollup: rows, cells, per-level groups, model', () => {
    task('tasks/a.md', 'status: open\norg: platform\nowner: geoff')
    task('tasks/b.md', 'status: open\norg: growth\nowner: sam')
    task('tasks/c.md', 'status: done\norg: platform\nowner: geoff')
    const { noteRel } = createRollupNote(v, { ...MODEL, filters: [] })
    const data = rollupViewData(v, noteRel)
    expect(data.error).toBeNull()
    expect(data.model?.title).toBe('Open tasks')
    expect(data.groupBy).toEqual(['status', 'org'])
    expect(data.rows).toHaveLength(3)
    const a = data.rows.find((r) => r.path === 'tasks/a.md')!
    expect(a.groups).toEqual(['open', 'platform'])
    expect(a.cells.owner).toBe('geoff')
    expect(a.absPath).toBe(path.join(v, 'tasks/a.md'))
  })

  it('applies eq/ne/set filters', () => {
    task('tasks/a.md', 'status: open\nowner: geoff')
    task('tasks/b.md', 'status: done\nowner: sam')
    task('tasks/c.md', 'status: open')
    const { noteRel } = createRollupNote(v, MODEL)
    const data = rollupViewData(v, noteRel)
    expect(data.rows.map((r) => r.path)).toEqual(['tasks/a.md'])
  })

  it('hand-authored spec renders but is view-only (model null)', () => {
    task('tasks/a.md', 'status: open')
    write(
      'rollups/hand.md',
      '---\ntype: rollup\ntitle: Hand\n---\n\n```base\nfilters:\n  and:\n    - type == "task"\nformulas:\n  age: today() - file.mtime\nviews:\n  - type: table\n    name: Hand\n    order:\n      - file.name\n      - formula.age\n```\n',
    )
    const data = rollupViewData(v, 'rollups/hand.md')
    expect(data.error).toBeNull()
    expect(data.model).toBeNull()
    expect(data.rows).toHaveLength(1)
  })

  it('broken YAML → error (the doctor case), never a throw', () => {
    write('rollups/broken.md', '---\ntype: rollup\ntitle: Broken\n---\n\n```base\nfilters: [unclosed\n```\n')
    const data = rollupViewData(v, 'rollups/broken.md')
    expect(data.error).toMatch(/YAML|views/)
    expect(data.rows).toEqual([])
  })

  // ENH-258 — a filter on an ENTITY-valued property matches by identity. The
  // builder emits `contains` with the entity's display name; the engine folds
  // it to the linked note's targetKey, so a rel-md link value matches. Before
  // the fix the GUI fed the raw `[Growth](./…md)` string and matched 0 rows.
  it('a `contains` filter on a link-valued prop matches rows by entity identity', () => {
    write('themes/growth.md', '---\ntype: theme\n---\n# Growth\n')
    write('initiatives/a.md', '---\ntype: initiative\ninitiative_theme: "[Growth](../themes/growth.md)"\n---\n# A\n')
    write('initiatives/b.md', '---\ntype: initiative\ninitiative_theme: "[Growth](../themes/growth.md)"\n---\n# B\n')
    write('initiatives/c.md', '---\ntype: initiative\n---\n# C (no theme)\n')
    const model: RollupBuilderModel = {
      title: 'Growth inits',
      types: ['initiative'],
      groupBy: [],
      buckets: [],
      filters: [{ property: 'initiative_theme', op: 'contains', value: 'Growth' }],
      columns: [],
    }
    const data = modelViewData(v, model)
    expect(data.error).toBeNull()
    expect(data.warnings).toEqual([])
    expect(data.rows.map((r) => r.title).sort()).toEqual(['a', 'b'])
  })

  // ENH-258 — a declared bucket keyed by an entity NAME absorbs the rows whose
  // link-valued group prop points at that entity (identity match via memberEq).
  it('a declared bucket keyed by an entity name captures its link-grouped rows', () => {
    write('goals/reduce-churn.md', '---\ntype: goal\n---\n# Reduce Churn\n')
    write('initiatives/x.md', '---\ntype: initiative\nparent: "[Reduce Churn](../goals/reduce-churn.md)"\n---\n# X\n')
    const model: RollupBuilderModel = {
      title: 'By goal',
      types: ['initiative'],
      groupBy: ['parent'],
      buckets: [{ value: 'Reduce Churn' }],
      filters: [],
      columns: [],
    }
    const data = modelViewData(v, model)
    expect(data.error).toBeNull()
    // The declared bucket matched (non-null key) rather than rendering empty.
    expect(data.buckets).toEqual([{ label: 'Reduce Churn', key: 'Reduce Churn' }])
  })
})
