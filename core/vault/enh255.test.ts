// ENH-255 — per-track initiative rollups: membership filters on multi-valued
// fields (Link identity, not display text), filter-error SURFACING (a broken
// filter must never read as a legitimately-empty rollup), and declared
// buckets (`groups:`) that always render — even empty — in declaration order
// under human labels. Plus the builder round-trip (`contains` op + buckets).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initVault } from './scaffold'
import { readNotes } from './parse'
import { buildEngineFiles, memberEq, Link, evalExpr } from './engine'
import { evaluateBaseDef, renderTarget, bucketRows, type BaseDef } from './render'
import {
  serializeBuilderBase,
  parseBuilderBase,
  createRollupNote,
  rollupViewData,
  type RollupBuilderModel,
} from './builder'
import { lintBaseDef } from './lint'
import { buildCorpus } from './corpus'

const AS_OF = new Date('2026-07-06T12:00:00')

let root: string
let v: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-enh255-'))
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

/** The requester's shape: initiatives with a MULTI-VALUED `tracks` list of
 *  wikilinks, labeled inconsistently across notes (alias vs bare). */
function seedInitiatives(): void {
  write('tracks/context-agent-resources.md', '---\ntype: track\ntitle: Context & Agent Resources\n---\n\nbody\n')
  write(
    'initiatives/alpha.md',
    '---\ntype: initiative\nrelationship: monitored\ntracks:\n  - "[[context-agent-resources|Context & Agent Resources]]"\n  - "[[ops]]"\nparent: "[[Portfolio North]]"\n---\n\nbody\n',
  )
  write(
    'initiatives/beta.md',
    '---\ntype: initiative\nrelationship: monitored\ntracks:\n  - "[[Context-Agent-Resources]]"\n---\n\nbody\n',
  )
  write('initiatives/gamma.md', '---\ntype: initiative\nrelationship: monitored\ntracks:\n  - "[[ops]]"\n---\n\nbody\n')
}

describe('engine — membership predicates (ENH-255)', () => {
  it('memberEq folds Link identity through targetKey, ignoring display aliases', () => {
    expect(memberEq(new Link('context-agent-resources', 'Context & Agent Resources'), 'Context-Agent-Resources')).toBe(true)
    expect(memberEq(new Link('q3-launch'), new Link('Q3 Launch'))).toBe(true)
    expect(memberEq(new Link('q3-launch'), 'ops')).toBe(false)
    expect(memberEq('3', 3)).toBe(true)
  })

  it('list.contains() matches a multi-valued link field by note identity across label variants', () => {
    seedInitiatives()
    const files = buildEngineFiles(readNotes(v), AS_OF)
    const hits = files.filter(
      (f) =>
        f.properties.type === 'initiative' &&
        evalExpr('list(tracks).contains("context-agent-resources")', f, null, {}, AS_OF) === true,
    )
    expect(hits.map((f) => f.name).sort()).toEqual(['alpha', 'beta'])
  })

  it('containsAny / containsAll / string contains evaluate', () => {
    seedInitiatives()
    const files = buildEngineFiles(readNotes(v), AS_OF)
    const alpha = files.find((f) => f.name === 'alpha')!
    expect(evalExpr('list(tracks).containsAny("nope", "ops")', alpha, null, {}, AS_OF)).toBe(true)
    expect(evalExpr('list(tracks).containsAll("ops", "context-agent-resources")', alpha, null, {}, AS_OF)).toBe(true)
    expect(evalExpr('list(tracks).containsAll("ops", "nope")', alpha, null, {}, AS_OF)).toBe(false)
    expect(evalExpr('"monitored work".contains("monitor")', alpha, null, {}, AS_OF)).toBe(true)
  })
})

describe('filter-error surfacing (ENH-255 — never a silent empty view)', () => {
  const brokenDef: BaseDef = {
    filters: { and: ['type == "initiative"', 'note.tracks.bogusFn("x")'] },
    views: [{ name: 'Broken', type: 'table', order: ['file.name'] }],
  }

  it('evaluateBaseDef reports the broken filter with a failed-row count', () => {
    seedInitiatives()
    const files = buildEngineFiles(readNotes(v), AS_OF)
    const view = evaluateBaseDef(brokenDef, files, null, AS_OF).views[0]
    expect(view.rows).toHaveLength(0)
    expect(view.filterErrors).toHaveLength(1)
    expect(view.filterErrors[0].expr).toBe('note.tracks.bogusFn("x")')
    expect(view.filterErrors[0].count).toBe(3)
  })

  it('the ⚠ warning lands in BOTH rendered artifacts', () => {
    seedInitiatives()
    write('bases/broken.base', 'filters:\n  and:\n    - type == "initiative"\n    - note.tracks.bogusFn("x")\nviews:\n  - type: table\n    name: Broken\n    order:\n      - file.name\n')
    const r = renderTarget(v, 'bases/broken.base', { asOf: AS_OF })
    expect(r.html).toContain('filter-warn')
    expect(r.html).toContain('bogusFn')
    expect(r.md).toMatch(/> ⚠ .*bogusFn/)
  })

  it('a healthy filter reports no errors', () => {
    seedInitiatives()
    const def: BaseDef = {
      filters: { and: ['type == "initiative"', 'list(tracks).contains("ops")'] },
      views: [{ name: 'Ops', type: 'table', order: ['file.name'] }],
    }
    const files = buildEngineFiles(readNotes(v), AS_OF)
    const view = evaluateBaseDef(def, files, null, AS_OF).views[0]
    expect(view.filterErrors).toHaveLength(0)
    expect(view.rows.map((f) => f.name).sort()).toEqual(['alpha', 'gamma'])
  })
})

describe('declared buckets (ENH-255 — groups: render even empty, in order, labeled)', () => {
  const TRACK_BASE =
    'filters:\n' +
    '  and:\n' +
    '    - type == "initiative"\n' +
    '    - list(tracks).contains("context-agent-resources")\n' +
    'views:\n' +
    '  - type: table\n' +
    '    name: Track rollup\n' +
    '    order:\n' +
    '      - file.name\n' +
    '      - parent\n' +
    '    groupBy:\n' +
    '      property: relationship\n' +
    '    groups:\n' +
    '      - value: primary\n' +
    '        label: Primary track activity\n' +
    '      - value: monitored\n' +
    '        label: Monitored activity\n'

  it('bucketRows: declared order + labels, the empty primary bucket present', () => {
    seedInitiatives()
    write('bases/track.base', TRACK_BASE)
    const files = buildEngineFiles(readNotes(v), AS_OF)
    const def = renderTarget(v, 'bases/track.base', { asOf: AS_OF }).bases[0].evaluated
    const buckets = bucketRows(def.views[0], def.formulas, null, AS_OF)!
    expect(buckets.map((b) => b.label)).toEqual(['Primary track activity', 'Monitored activity'])
    expect(buckets[0].rows).toHaveLength(0)
    expect(buckets[0].declared).toBe(true)
    expect(buckets[1].rows.map((f) => f.name).sort()).toEqual(['alpha', 'beta'])
    expect(files.length).toBeGreaterThan(0)
  })

  it('the empty bucket renders as a placeholder in HTML and Markdown', () => {
    seedInitiatives()
    write('bases/track.base', TRACK_BASE)
    const r = renderTarget(v, 'bases/track.base', { asOf: AS_OF })
    expect(r.html).toContain('Primary track activity')
    expect(r.html).toContain('— none —')
    const primaryAt = r.md.indexOf('#### Primary track activity (0)')
    const monitoredAt = r.md.indexOf('#### Monitored activity (2)')
    expect(primaryAt).toBeGreaterThan(-1)
    expect(monitoredAt).toBeGreaterThan(primaryAt)
    expect(r.md).toContain('_— none —_')
  })

  it('a declared LINK-valued bucket matches by identity; undeclared groups trail alphabetically', () => {
    seedInitiatives()
    write(
      'initiatives/delta.md',
      '---\ntype: initiative\nrelationship: monitored\nowner: "[[Alice Park|Alice]]"\n---\n\nbody\n',
    )
    write('initiatives/echo.md', '---\ntype: initiative\nrelationship: monitored\nowner: "[[zed]]"\n---\n\nbody\n')
    write(
      'bases/owner.base',
      'filters:\n  and:\n    - type == "initiative"\nviews:\n  - type: table\n    name: By owner\n    order:\n      - file.name\n    groupBy:\n      property: owner\n    groups:\n      - value: alice-park\n        label: Alice’s work\n',
    )
    const def = renderTarget(v, 'bases/owner.base', { asOf: AS_OF }).bases[0].evaluated
    const buckets = bucketRows(def.views[0], def.formulas, null, AS_OF)!
    expect(buckets[0].label).toBe('Alice’s work')
    expect(buckets[0].rows.map((f) => f.name)).toEqual(['delta'])
    // undeclared groups keep the legacy alpha order after the declared ones
    expect(buckets.slice(1).map((b) => b.declared)).toEqual([false, false])
  })

  it('lint warns on groups: without groupBy and on a malformed entry', () => {
    seedInitiatives()
    const corpus = buildCorpus(v)
    const findings = lintBaseDef(
      { views: [{ name: 'X', type: 'table', groups: [{ label: 'no value' }] }] },
      corpus,
    )
    expect(findings.some((f) => f.message.includes('without groupBy'))).toBe(true)
    expect(findings.some((f) => f.severity === 'error' && f.message.includes('needs a string value'))).toBe(true)
  })
})

describe('builder round-trip (ENH-255 — contains op + buckets stay GUI-editable)', () => {
  const MODEL: RollupBuilderModel = {
    title: 'Context track',
    types: ['initiative'],
    groupBy: ['relationship'],
    buckets: [
      { value: 'primary', label: 'Primary track activity' },
      { value: 'monitored', label: 'Monitored activity' },
    ],
    filters: [{ property: 'tracks', op: 'contains', value: 'context-agent-resources' }],
    columns: ['parent'],
  }

  it('serialize ⇄ parse round-trips contains + buckets byte-stably', () => {
    const yaml = serializeBuilderBase(MODEL)
    expect(yaml).toContain('list(tracks).contains("context-agent-resources")')
    expect(yaml).toContain('groups:')
    const parsed = parseBuilderBase(yaml, { group_by: ['relationship'] })
    expect(parsed).toEqual(MODEL)
    expect(serializeBuilderBase(parsed!)).toBe(yaml)
  })

  it('groups: without groupBy is outside the canonical dialect (view-only)', () => {
    const yaml =
      'filters:\n  and:\n    - type == "initiative"\nviews:\n  - type: table\n    name: X\n    order:\n      - file.name\n    groups:\n      - value: primary\n'
    expect(parseBuilderBase(yaml, {})).toBeNull()
  })

  it('rollupViewData surfaces buckets (empty ⇒ key:null) + membership rows + warnings', () => {
    seedInitiatives()
    const created = createRollupNote(v, MODEL)
    const data = rollupViewData(v, created.noteRel, AS_OF)
    expect(data.error).toBeNull()
    expect(data.model).toEqual(MODEL)
    expect(data.rows.map((r) => r.title).sort()).toEqual(['alpha', 'beta'])
    expect(data.buckets).toEqual([
      { label: 'Primary track activity', key: null },
      { label: 'Monitored activity', key: 'monitored' },
    ])
    expect(data.warnings).toEqual([])
  })
})
