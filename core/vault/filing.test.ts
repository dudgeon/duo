// ENH-208 Vault — D19 entity stub-path + creation tests (model layer for
// the silent-stub type-picker). Inits a throwaway vault per test.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { initVault, loadTemplates, stubPathFor, createEntityStub, createType, safeName } from './index'

let root: string
beforeEach(() => {
  root = initVault(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'duo-filing-')), 'v')).root
})
afterEach(() => {
  fs.rmSync(path.dirname(root), { recursive: true, force: true })
})

const AS_OF = new Date('2026-06-09T10:00:00')
const tpl = (root: string, type: string) => loadTemplates(root).find((t) => t.type === type)!

describe('safeName', () => {
  it('strips path-unsafe characters but keeps spaces', () => {
    expect(safeName('Jordan Lee')).toBe('Jordan Lee')
    expect(safeName('Q3/Q4: Launch?')).toBe('Q3Q4 Launch')
  })
})

describe('stubPathFor (D19)', () => {
  it('parentless registry types file in their folder (person → people/)', () => {
    expect(stubPathFor(tpl(root, 'person'), 'Jordan Lee', AS_OF)).toBe('people/Jordan Lee.md')
    expect(stubPathFor(tpl(root, 'theme'), 'Pricing', AS_OF)).toBe('themes/Pricing.md')
  })

  it('a folder-note type owns a folder (initiative → initiatives/<name>/<name>.md)', () => {
    expect(stubPathFor(tpl(root, 'initiative'), 'Q3 Launch', AS_OF)).toBe('initiatives/Q3 Launch/Q3 Launch.md')
  })

  it('a parented type with no parent yet lands in the time-bucket residue', () => {
    expect(stubPathFor(tpl(root, 'milestone'), 'Legal review', AS_OF)).toBe('notes/2026/06/Legal review.md')
    expect(stubPathFor(tpl(root, 'meeting'), 'Kickoff', AS_OF)).toBe('notes/2026/06/Kickoff.md')
  })
})

describe('createEntityStub', () => {
  it('writes a stub with the type stamped + fields seeded', () => {
    const r = createEntityStub(root, 'person', 'Jordan Lee', { asOf: AS_OF })
    expect(r.created).toBe(true)
    expect(r.path).toBe('people/Jordan Lee.md')
    const content = fs.readFileSync(r.absPath, 'utf8')
    expect(content).toContain('type: person')
    expect(content).toContain('role:')
    expect(content).toContain('aliases: []') // array field seeded as []
  })

  it('is idempotent — never clobbers an existing note (created: false)', () => {
    const first = createEntityStub(root, 'person', 'Jordan Lee', { asOf: AS_OF })
    fs.writeFileSync(first.absPath, '---\ntype: person\nrole: PM\n---\nReal content.\n')
    const second = createEntityStub(root, 'person', 'Jordan Lee', { asOf: AS_OF })
    expect(second.created).toBe(false)
    expect(fs.readFileSync(second.absPath, 'utf8')).toContain('Real content.') // untouched
  })

  it('the created stub is a real entity the corpus picks up', () => {
    createEntityStub(root, 'theme', 'Compliance', { asOf: AS_OF })
    // re-resolve: a freshly stubbed theme resolves as a vault note
    const r = createEntityStub(root, 'theme', 'Compliance', { asOf: AS_OF })
    expect(r.created).toBe(false) // second call sees the first
  })

  it('throws a clear error for an unknown type', () => {
    expect(() => createEntityStub(root, 'nope', 'X', { asOf: AS_OF })).toThrow(/unknown type "nope"/)
  })
})

describe('createType (the silent-stub New: row, via VAULT_CREATE_TYPE)', () => {
  it('normalizes to the canonical name and writes the template', () => {
    const r = createType(root, 'Decision Log')
    expect(r.type).toBe('decision log')
    expect(r.path).toBe('templates/decision log.md')
    const content = fs.readFileSync(path.join(root, r.path), 'utf8')
    expect(content).toContain('type: decision log')
  })

  it('the returned canonical name stubs; the raw input would not', () => {
    const r = createType(root, 'Decision Log')
    // The contract the IPC comment pins: stub with the RESULT's type…
    const stub = createEntityStub(root, r.type, 'Q3 pricing call', { asOf: AS_OF })
    expect(stub.created).toBe(true)
    expect(stub.path).toBe('notes/2026/06/Q3 pricing call.md') // no folder → D19 residue
    // …because the raw filter text dead-ends on strict type matching.
    expect(() => createEntityStub(root, 'Decision Log', 'Another call', { asOf: AS_OF })).toThrow(
      /unknown type "Decision Log"/,
    )
  })

  it('is idempotent — an existing template is left untouched', () => {
    const first = createType(root, 'ritual')
    fs.writeFileSync(path.join(root, first.path), '---\ntype: ritual\ncadence:\n---\n')
    const second = createType(root, 'Ritual') // normalizes to the same stem
    expect(second).toEqual(first)
    expect(fs.readFileSync(path.join(root, first.path), 'utf8')).toContain('cadence:')
  })

  it('throws when the name normalizes to nothing', () => {
    expect(() => createType(root, '???')).toThrow(/empty type name/)
  })
})
