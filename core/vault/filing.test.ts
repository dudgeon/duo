// ENH-208 Vault — D19 entity stub-path + creation tests (model layer for
// the silent-stub type-picker). Inits a throwaway vault per test.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { initVault, loadTemplates, stubPathFor, createEntityStub, createType, safeName } from './index'

let root: string
beforeEach(() => {
  // These exercise the OBSIDIAN filing path (verbatim basename, idempotent
  // never-clobber). initVault's DEFAULT flipped to OKF (ENH-216 D2) and
  // createEntityStub/createType now auto-detect the vault mode (PR#98 F4), so
  // pin obsidian explicitly. The OKF filing path is covered separately below
  // (the `mode: 'okf'` tests).
  root = initVault(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'duo-filing-')), 'v'), {
    format: 'obsidian',
  }).root
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

describe('OKF mode (ENH-216 D6/D10) — slugged stems, title + id stamped', () => {
  it('stubPathFor slugs the on-disk stem (Customer Orders → customer-orders.md)', () => {
    // parentless registry type → <folder>/<slug>.md
    expect(stubPathFor(tpl(root, 'person'), 'Customer Orders', AS_OF, 'okf')).toBe(
      'people/customer-orders.md',
    )
    // folder-note type → <folder>/<slug>/<slug>.md
    expect(stubPathFor(tpl(root, 'initiative'), 'Q3 Launch', AS_OF, 'okf')).toBe(
      'initiatives/q3-launch/q3-launch.md',
    )
    // parented type, no parent yet → slugged time-bucket residue
    expect(stubPathFor(tpl(root, 'milestone'), 'Legal Review', AS_OF, 'okf')).toBe(
      'notes/2026/06/legal-review.md',
    )
  })

  it('createEntityStub slugs the stem, stamps title: (the human name, D6) + a stable id: (D10)', () => {
    const r = createEntityStub(root, 'person', 'Customer Orders', { asOf: AS_OF, mode: 'okf' })
    expect(r.created).toBe(true)
    expect(r.path).toBe('people/customer-orders.md')
    const content = fs.readFileSync(r.absPath, 'utf8')
    // id is spliced right after the opening fence (D10 primary relink key).
    expect(content).toMatch(/^---\nid: [0-9a-z]{8}\n/)
    expect(content).toContain('type: person')
    // D6: the human name lives in title:, not in the slugged on-disk stem.
    expect(content).toContain('title: Customer Orders')
    expect(content).toContain('role:') // template field still seeded
  })

  it('slug-collision guard: differing human names that slug-collide disambiguate, never clobber', () => {
    const a = createEntityStub(root, 'person', 'Customer Orders', { asOf: AS_OF, mode: 'okf' })
    const b = createEntityStub(root, 'person', 'customer orders', { asOf: AS_OF, mode: 'okf' })
    expect(a.path).toBe('people/customer-orders.md')
    expect(b.path).toBe('people/customer-orders-2.md') // -2 suffix, both created
    expect(a.created).toBe(true)
    expect(b.created).toBe(true)
  })

  // PR#98 F4 — the regression guard: in a real OKF vault, the silent-stub IPC
  // handler / `duo vault stub` pass NO mode; createEntityStub must auto-detect
  // okf and slug + stamp title/id rather than write an Obsidian-shaped stub.
  it('AUTO-DETECTS okf when no mode is passed (the IPC/CLI path) — slug + title + id', () => {
    const okfRoot = initVault(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'duo-filing-okf-')), 'v'), {
      format: 'okf',
    }).root
    const r = createEntityStub(okfRoot, 'person', 'Customer Orders', { asOf: AS_OF })
    expect(r.path).toBe('people/customer-orders.md')
    const content = fs.readFileSync(r.absPath, 'utf8')
    expect(content).toMatch(/^---\nid: [0-9a-z]{8}\n/)
    expect(content).toContain('title: Customer Orders')
    fs.rmSync(path.dirname(okfRoot), { recursive: true, force: true })
  })

  it('createType slugs the template stem + canonical type in OKF mode', () => {
    const r = createType(root, 'Decision Log', 'okf')
    expect(r.type).toBe('decision-log')
    expect(r.path).toBe('templates/decision-log.md')
    expect(fs.readFileSync(path.join(root, r.path), 'utf8')).toContain('type: decision-log')
  })
})

describe('ENH-266e — alias auto-seed (title differs from OKF slug stem)', () => {
  it('extends a template-declared `aliases: []` field with the human title', () => {
    // person's template already declares `aliases: []` (scaffold.ts PERSON_TPL).
    const r = createEntityStub(root, 'person', 'Customer Orders', { asOf: AS_OF, mode: 'okf' })
    const content = fs.readFileSync(r.absPath, 'utf8')
    expect(content).toContain('aliases:\n  - Customer Orders')
    expect(content).not.toContain('aliases: []') // the empty seed was replaced, not left dangling
  })

  it('appends a brand-new `aliases:` field for a type whose template has none', () => {
    // milestone's template has no `aliases:` field at all.
    const r = createEntityStub(root, 'milestone', 'Legal Review', { asOf: AS_OF, mode: 'okf' })
    const content = fs.readFileSync(r.absPath, 'utf8')
    expect(content).toContain('aliases:\n  - Legal Review')
  })

  it('is a no-op when the title already equals its own slug (nothing to alias)', () => {
    const r = createEntityStub(root, 'person', 'alice', { asOf: AS_OF, mode: 'okf' })
    expect(r.path).toBe('people/alice.md')
    const content = fs.readFileSync(r.absPath, 'utf8')
    expect(content).toContain('aliases: []') // template's empty seed, untouched
    expect(content).not.toContain('aliases:\n  - alice')
  })

  it('is a no-op in Obsidian mode (the on-disk stem already IS the title, D6)', () => {
    const r = createEntityStub(root, 'person', 'Customer Orders', { asOf: AS_OF })
    const content = fs.readFileSync(r.absPath, 'utf8')
    expect(content).toContain('aliases: []')
    expect(content).not.toContain('aliases:\n  -')
    expect(content).not.toContain('title:')
  })

  it('aliases the FINAL on-disk stem, including a slug-collision suffix', () => {
    createEntityStub(root, 'person', 'Customer Orders', { asOf: AS_OF, mode: 'okf' })
    const b = createEntityStub(root, 'person', 'customer orders', { asOf: AS_OF, mode: 'okf' })
    expect(b.path).toBe('people/customer-orders-2.md')
    const content = fs.readFileSync(b.absPath, 'utf8')
    expect(content).toContain('aliases:\n  - customer orders')
  })
})
