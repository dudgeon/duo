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
import { lintBaseDef } from './lint'
import { buildCorpus } from './corpus'
import { load as yamlLoad } from 'js-yaml'

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

// D15 (ENH-266d, review follow-up) — the GUI Rollup Builder is a third
// write-site for `type ==`-filtered bases (alongside the type templates'
// embedded rollups and bases/processing.base) and was missed by the original
// D15 hygiene pass: every builder-generated base always filters by type, so
// without an exclusion, EVERY GUI-built rollup phantom-rows its own type's
// templates/<type>.md when opened natively in Obsidian.
describe('serializeBuilderBase — D15 templates exclusion (review follow-up)', () => {
  it('always emits the templates-folder exclusion, single-type', () => {
    const yaml = serializeBuilderBase(MODEL)
    expect(yaml).toContain('- \'!file.inFolder("templates")\'')
  })

  it('always emits the templates-folder exclusion, multi-type or-group', () => {
    const m: RollupBuilderModel = { ...MODEL, types: ['task', 'initiative'], groupBy: [], buckets: [], filters: [] }
    const yaml = serializeBuilderBase(m)
    expect(yaml).toContain('- \'!file.inFolder("templates")\'')
  })

  it('round-trips cleanly with the exclusion present (not surfaced as an editable filter)', () => {
    const yaml = serializeBuilderBase(MODEL)
    const parsed = parseBuilderBase(yaml, { group_by: ['status', 'org'] })
    expect(parsed).toEqual(MODEL)
    expect(parsed?.filters.some((f) => JSON.stringify(f).includes('inFolder'))).toBe(false)
  })

  it('still parses a legacy pre-fix note that lacks the exclusion (backward-compatible)', () => {
    const legacy = 'filters:\n  and:\n    - type == "task"\nviews:\n  - type: table\n    name: "Legacy"\n    order:\n      - file.name\n'
    const parsed = parseBuilderBase(legacy, {})
    expect(parsed).not.toBeNull()
    expect(parsed?.types).toEqual(['task'])
  })

  it('duo base lint stays D15-clean on a builder-generated base', () => {
    const model: RollupBuilderModel = { ...MODEL, types: ['milestone'], groupBy: [], buckets: [], filters: [] }
    const yaml = serializeBuilderBase(model)
    const def = yamlLoad(yaml) as Parameters<typeof lintBaseDef>[0]
    const corpus = buildCorpus(v)
    const findings = lintBaseDef(def, corpus)
    expect(findings.some((f) => f.message.includes('D15'))).toBe(false)
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

  // ENH-259 — the transitive "is under" (ancestor) op.
  it('serializes + round-trips an `ancestor` filter', () => {
    const model: RollupBuilderModel = {
      title: 'CA hoods',
      types: ['neighborhood'],
      groupBy: [],
      buckets: [],
      filters: [{ property: 'parent', op: 'ancestor', value: 'California' }],
      columns: [],
    }
    const yaml = serializeBuilderBase(model)
    expect(yaml).toContain('ancestors("parent").contains("California")')
    const parsed = parseBuilderBase(yaml, { type: 'rollup' })
    expect(parsed?.filters).toEqual([{ property: 'parent', op: 'ancestor', value: 'California' }])
  })

  it('matches rows whose ancestor is the value, across intermediate levels', () => {
    write('countries/usa.md', '---\ntype: country\n---\n# USA\n')
    write('states/california.md', '---\ntype: state\nparent: "[USA](../countries/usa.md)"\n---\n# California\n')
    write('states/texas.md', '---\ntype: state\nparent: "[USA](../countries/usa.md)"\n---\n# Texas\n')
    write('cities/sf.md', '---\ntype: city\nparent: "[California](../states/california.md)"\n---\n# SF\n')
    write('cities/austin.md', '---\ntype: city\nparent: "[Texas](../states/texas.md)"\n---\n# Austin\n')
    write('neighborhoods/mission.md', '---\ntype: neighborhood\nparent: "[SF](../cities/sf.md)"\n---\n# Mission\n')
    write('neighborhoods/soma.md', '---\ntype: neighborhood\nparent: "[SF](../cities/sf.md)"\n---\n# SoMa\n')
    write('neighborhoods/downtown.md', '---\ntype: neighborhood\nparent: "[Austin](../cities/austin.md)"\n---\n# Downtown\n')
    const model: RollupBuilderModel = {
      title: 'Under California',
      types: ['neighborhood'],
      groupBy: [],
      buckets: [],
      filters: [{ property: 'parent', op: 'ancestor', value: 'California' }],
      columns: [],
    }
    const data = modelViewData(v, model)
    expect(data.error).toBeNull()
    // Mission + SoMa roll up to California via SF; Downtown (Austin→Texas) does not.
    expect(data.rows.map((r) => r.title).sort()).toEqual(['mission', 'soma'])
  })

  it('ancestor eval is cycle-safe (a↔b parent loop does not hang)', () => {
    write('a.md', '---\ntype: node\nparent: "[b](./b.md)"\n---\n# a\n')
    write('b.md', '---\ntype: node\nparent: "[a](./a.md)"\n---\n# b\n')
    const model: RollupBuilderModel = {
      title: 'under a',
      types: ['node'],
      groupBy: [],
      buckets: [],
      filters: [{ property: 'parent', op: 'ancestor', value: 'a' }],
      columns: [],
    }
    const data = modelViewData(v, model) // must terminate
    expect(data.error).toBeNull()
    // b's chain reaches a; a's own chain reaches a (via b) too.
    expect(data.rows.map((r) => r.title).sort()).toEqual(['a', 'b'])
  })

  // ── BUG-260 / ENH-261 / ENH-262 — the owner's knowledge-base shape ────────
  // Entity names carry ": " (Track: Context…); populations reach the track
  // node through DIFFERENT properties (owned: parent, monitored: tracks[]).
  const seedKb = () => {
    write('goals/aipm.md', '---\ntype: goal\n---\n# AIPM Force Multiplier\n')
    write('goals/aipm/share.md', '---\ntype: initiative\nengagement: own\nparent: "[AIPM Force Multiplier](../aipm.md)"\n---\n# Share\n')
    write(
      'goals/aipm/share/track-context-and-agent-resources.md',
      '---\ntype: initiative\nengagement: own\nparent: "[Share](../share.md)"\n---\n# Track: Context and Agent Resources\n',
    )
    write(
      'goals/aipm/share/track-context-and-agent-resources/starter-kit.md',
      '---\ntype: initiative\nengagement: own\nparent: "[Track: Context and Agent Resources](../track-context-and-agent-resources.md)"\n---\n# Starter Kit\n',
    )
    write('orgs/card.md', '---\ntype: organization\n---\n# Card\n')
    write(
      'orgs/card/fraud-kb.md',
      '---\ntype: initiative\nengagement: monitor\nparent: "[Card](../card.md)"\ntracks:\n  - "[Track: Context and Agent Resources](../../goals/aipm/share/track-context-and-agent-resources.md)"\n---\n# Fraud KB\n',
    )
  }

  it('BUG-260 — a filter value containing ": " serializes YAML-safe, matches, and round-trips', () => {
    seedKb()
    const model: RollupBuilderModel = {
      title: 'Tagged to track',
      types: ['initiative'],
      groupBy: [],
      buckets: [],
      filters: [{ property: 'tracks', op: 'contains', value: 'Track: Context and Agent Resources' }],
      columns: [],
    }
    // The emitted line must be a quoted YAML scalar — an unquoted one parses
    // as a MAPPING and the filter is silently dropped (the pre-fix failure).
    const yaml = serializeBuilderBase(model)
    expect(yaml).toContain(`- 'list(tracks).contains("Track: Context and Agent Resources")'`)
    const parsed = parseBuilderBase(yaml, { type: 'rollup' })
    expect(parsed?.filters).toEqual(model.filters)
    // And it MATCHES (display name folds to the slug-named note — the
    // punctuation leniency): only the cross-tagged monitored initiative.
    const data = modelViewData(v, model)
    expect(data.error).toBeNull()
    expect(data.rows.map((r) => r.title)).toEqual(['fraud-kb'])
  })

  it('BUG-260 — the notset op (leading `!`) no longer breaks the spec YAML', () => {
    seedKb()
    const model: RollupBuilderModel = {
      title: 'No themes',
      types: ['initiative'],
      groupBy: [],
      buckets: [],
      filters: [{ property: 'themes', op: 'notset' }],
      columns: [],
    }
    const yaml = serializeBuilderBase(model)
    expect(yaml).toContain(`- '!file.hasProperty("themes")'`)
    const data = modelViewData(v, model)
    expect(data.error).toBeNull()
    expect(data.rows.length).toBe(4) // every initiative (none has themes)
    expect(parseBuilderBase(yaml, { type: 'rollup' })?.filters).toEqual(model.filters)
  })

  it('BUG-260 — a PRE-FIX note (unquoted colon line → YAML mapping) recovers: renders right + stays editable', () => {
    seedKb()
    // Hand-write the broken shape the old serializer produced.
    write(
      'rollups/legacy.md',
      '---\ntype: rollup\ntitle: Legacy\nformat: html\n---\n\n```base\nfilters:\n  and:\n    - type == "initiative"\n    - list(tracks).contains("Track: Context and Agent Resources")\nviews:\n  - type: table\n    name: Legacy\n    order:\n      - file.name\n```\n',
    )
    const data = rollupViewData(v, 'rollups/legacy.md')
    expect(data.error).toBeNull()
    // The mangled clause is reconstructed — filter APPLIES (1 row, not all 5)…
    expect(data.rows.map((r) => r.title)).toEqual(['fraud-kb'])
    // …and the note is editable again (model non-null), so the next GUI save
    // re-serializes it quoted.
    expect(data.model?.filters).toEqual([
      { property: 'tracks', op: 'contains', value: 'Track: Context and Agent Resources' },
    ])
  })

  it('ENH-261 — the `ancestor:<prop>:<type>` group token groups rows by their goal ancestor', () => {
    seedKb()
    const model: RollupBuilderModel = {
      title: 'By goal',
      types: ['initiative'],
      groupBy: ['ancestor:parent:goal'],
      buckets: [],
      filters: [],
      columns: [],
    }
    const yaml = serializeBuilderBase(model)
    expect(yaml).toContain('property: ancestor:parent:goal')
    expect(parseBuilderBase(yaml, { type: 'rollup', group_by: ['ancestor:parent:goal'] })?.groupBy).toEqual([
      'ancestor:parent:goal',
    ])
    const data = modelViewData(v, model)
    expect(data.error).toBeNull()
    // Owned chain (share → track → starter-kit) groups under the goal;
    // the monitored initiative (parent chain = orgs, no goal) groups under —.
    const byGroup = new Map<string, string[]>()
    for (const r of data.rows) {
      const g = r.groups[0]
      byGroup.set(g, [...(byGroup.get(g) ?? []), r.title])
    }
    expect(byGroup.get('AIPM Force Multiplier')?.sort()).toEqual(['share', 'starter-kit', 'track-context-and-agent-resources'])
    expect(byGroup.get('—')).toEqual(['fraud-kb'])
  })

  it('ENH-262 — a `linksto` filter unions populations that reach one entity via different properties', () => {
    seedKb()
    const model: RollupBuilderModel = {
      title: 'Context track initiatives',
      types: ['initiative'],
      groupBy: ['engagement'],
      buckets: [],
      filters: [{ property: '*', op: 'linksto', value: 'Track: Context and Agent Resources' }],
      columns: [],
    }
    const yaml = serializeBuilderBase(model)
    expect(yaml).toContain(`- 'file.hasLink("Track: Context and Agent Resources")'`)
    expect(parseBuilderBase(yaml, { type: 'rollup', group_by: ['engagement'] })?.filters).toEqual(model.filters)
    const data = modelViewData(v, model)
    expect(data.error).toBeNull()
    // Owned child links the track via parent:, monitored links it via
    // tracks[] — ONE predicate catches both (the owner's exact target rollup).
    const byGroup = new Map<string, string[]>()
    for (const r of data.rows) {
      const g = r.groups[0]
      byGroup.set(g, [...(byGroup.get(g) ?? []), r.title])
    }
    expect(byGroup.get('own')).toEqual(['starter-kit'])
    expect(byGroup.get('monitor')).toEqual(['fraud-kb'])
  })
})
