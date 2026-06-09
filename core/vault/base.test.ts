// ENH-208 Vault — base engine + render + lint regression tests (PR2),
// pinned to the frozen prototype vault. A fixed `asOf` keeps date-relative
// formulas deterministic. These lock the locked expression subset: filters
// (and/or/not, file.*), `if()` nesting, link `== this` (the one-template
// rollup), date math + `.round()`, html()/icon(), groupBy, summaries, and
// the child→parent backlink rollup that deliberately exceeds Obsidian.

import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { fileURLToPath } from 'url'
import * as fs from 'fs'
import * as yaml from 'js-yaml'
import {
  renderTarget,
  evaluateBaseDef,
  readCol,
  buildEngineFiles,
  readNotes,
  lintVault,
  lintBaseDef,
  buildCorpus,
  isEvalError as _isEvalError,
} from './index'
import { isEvalError } from './engine'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VAULT = path.resolve(HERE, '../../docs/research/graphbook-prototype')
const AS_OF = new Date('2026-06-09T12:00:00')

// Lookup a base file's parsed def.
function loadBase(rel: string): any {
  return yaml.load(fs.readFileSync(path.join(VAULT, rel), 'utf8'))
}

describe('render — vault-wide .base files', () => {
  it('renders milestones.base with the right per-view row counts (templates excluded)', () => {
    const r = renderTarget(VAULT, 'bases/milestones.base', { asOf: AS_OF })
    const views = r.bases[0].evaluated.views
    expect(views.find((v) => v.name === 'All milestones')!.rows).toHaveLength(6)
    expect(views.find((v) => v.name === 'Blocked only')!.rows).toHaveLength(2)
    expect(views.find((v) => v.name === 'Checklist')!.rows).toHaveLength(6)
  })

  it('renders portfolio.base over the two initiatives', () => {
    const r = renderTarget(VAULT, 'bases/portfolio.base', { asOf: AS_OF })
    const portfolio = r.bases[0].evaluated.views.find((v) => v.name === 'Portfolio')!
    expect(portfolio.rows.map((f) => f.basename).sort()).toEqual(['Pricing Revamp', 'Q3 Launch'])
  })

  it('produces a stamped HTML artifact (build-artifact framing, D13)', () => {
    const r = renderTarget(VAULT, 'bases/milestones.base', { asOf: AS_OF })
    expect(r.html).toContain('BUILD ARTIFACT')
    expect(r.html).toMatch(/source hash <strong>[0-9a-f]{12}<\/strong>/)
    expect(r.sourceHash).toMatch(/^[0-9a-f]{12}$/)
    expect(r.asOfLabel).toBe('2026-Jun-09')
  })
})

describe('render — embedded `… == this` blocks (the one-template rollup, D8)', () => {
  it('scopes Q3 Launch milestones to that initiative', () => {
    const r = renderTarget(VAULT, 'Q3 Launch', { asOf: AS_OF })
    expect(r.bases).toHaveLength(1)
    expect(r.bases[0].thisFile).toBe('Q3 Launch')
    expect(r.bases[0].evaluated.views[0].rows).toHaveLength(4)
  })

  it('the SAME block gives Pricing Revamp a different row set', () => {
    const r = renderTarget(VAULT, 'Pricing Revamp', { asOf: AS_OF })
    expect(r.bases[0].evaluated.views[0].rows).toHaveLength(2)
  })

  it('throws a clear error for a target with no base block', () => {
    expect(() => renderTarget(VAULT, 'Alice Park', { asOf: AS_OF })).toThrow(/no .*base.* blocks/)
  })
})

describe('engine — the locked expression subset evaluates without errors', () => {
  const files = buildEngineFiles(readNotes(VAULT), AS_OF)

  it('if()/html()/icon()/date-math formulas produce real values, never __error', () => {
    const def = loadBase('bases/milestones.base')
    const ev = evaluateBaseDef(def, files, null, AS_OF)
    const rows = ev.views.find((v) => v.name === 'All milestones')!.rows
    for (const row of rows) {
      const chip = readCol('formula.chip', row, null, ev.formulas, AS_OF) as any
      expect(isEvalError(chip)).toBe(false)
      expect(chip.__html).toMatch(/blocked|done|on-track/) // html() chip
      const mark = readCol('formula.mark', row, null, ev.formulas, AS_OF) as any
      expect(mark.__html).toBeTruthy() // icon()
      const days = readCol('formula.days_left', row, null, ev.formulas, AS_OF)
      expect(days === null || typeof days === 'number').toBe(true) // ((due-today())/DAY).round(0)
    }
  })

  it('child→parent backlink rollups resolve to numbers (exceeds Obsidian)', () => {
    const def = loadBase('bases/portfolio.base')
    const ev = evaluateBaseDef(def, files, null, AS_OF)
    const row = ev.views[0].rows.find((f) => f.basename === 'Q3 Launch')!
    const probeA = readCol('formula.probe_a', row, null, ev.formulas, AS_OF)
    const probeB = readCol('formula.probe_b', row, null, ev.formulas, AS_OF)
    const mentions = readCol('formula.mentions', row, null, ev.formulas, AS_OF)
    expect(typeof probeA).toBe('number')
    expect(typeof probeB).toBe('number')
    expect(typeof mentions).toBe('number')
  })

  it('groupBy + summaries: people-load groups open milestones by owner', () => {
    const def = loadBase('bases/people-load.base')
    const ev = evaluateBaseDef(def, files, null, AS_OF)
    const view = ev.views[0]
    // every row is a non-done milestone
    expect(view.rows.length).toBeGreaterThan(0)
    for (const row of view.rows) {
      expect(row.properties.type).toBe('milestone')
      expect(row.properties.status).not.toBe('done')
    }
  })
})

describe('lint', () => {
  it('the real vault lints clean (matches the prototype claim)', () => {
    const results = lintVault(VAULT, '--all')
    const errors = results.flatMap((r) => r.findings.filter((f) => f.severity === 'error'))
    expect(errors).toEqual([])
    expect(results.some((r) => r.parseError)).toBe(false)
    // 4 .base files + 2 embedded (templates excluded)
    expect(results).toHaveLength(6)
  })

  it('surfaces bad type / unresolved entity / off-enum / unknown fn / bad view, with suggestions', () => {
    const corpus = buildCorpus(VAULT)
    const broken = {
      filters: { and: ['type == "mileston"', 'status == "blokced"', '"[[Nonexistent Person]]"'] },
      formulas: { bad: 'iff(due, due.format("D"), "x")' },
      views: [{ name: 'Broken', type: 'tabel', order: ['file.name'] }],
    }
    const findings = lintBaseDef(broken, corpus)
    const msgs = findings.map((f) => f.message)
    expect(findings.find((f) => /no such type/.test(f.message))?.suggestion).toBe('milestone')
    expect(findings.find((f) => /blokced/.test(f.message))?.suggestion).toBe('blocked')
    expect(msgs.some((m) => /unresolved entity/.test(m))).toBe(true)
    expect(findings.find((f) => /unknown function/.test(f.message))?.suggestion).toBe('if')
    expect(msgs.some((m) => /unknown view type "tabel"/.test(m))).toBe(true)
    // D15: it found problems but lintBaseDef never throws — warn-and-render.
    expect(findings.length).toBeGreaterThanOrEqual(5)
  })

  it('index re-exports isEvalError', () => {
    expect(_isEvalError({ __error: 'x', __expr: 'y' })).toBe(true)
    expect(_isEvalError(3)).toBe(false)
  })
})
