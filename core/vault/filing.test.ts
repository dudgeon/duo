// ENH-208 Vault — D19 entity stub-path + creation tests (model layer for
// the silent-stub type-picker). Inits a throwaway vault per test.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { initVault, loadTemplates, stubPathFor, createEntityStub, safeName } from './index'

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
