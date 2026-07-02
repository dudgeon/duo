// ENH-208 Vault — write-verb tests (PR3): vault init scaffold + capture.
// Each test inits into a throwaway tmpdir so nothing touches the repo.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  initVault,
  captureNote,
  createEntityStub,
  isVaultRoot,
  buildCorpus,
  loadTemplates,
  lintVault,
  renderTarget,
} from './index'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-vault-init-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('vault init (Obsidian — the legacy scaffold, byte-identical regression guard)', () => {
  // ENH-216 D2 flipped initVault's DEFAULT to okf, so these legacy
  // assertions (`.obsidian/` marker, `bases/`, README, embedded `.base`
  // rollups) explicitly pass `{ format: 'obsidian' }`. The parallel OKF
  // describe below covers the new default.
  it('scaffolds a recognizable vault with the starter set', () => {
    const r = initVault(path.join(root, 'v'), { format: 'obsidian' })
    expect(isVaultRoot(r.root)).toBe(true)
    for (const f of [
      '.obsidian/app.json',
      'templates/person.md',
      'templates/initiative.md',
      'templates/milestone.md',
      'templates/meeting.md',
      'templates/theme.md',
      'templates/rollup.md',
      'bases/processing.base',
      'README.md',
    ]) {
      expect(fs.existsSync(path.join(r.root, f))).toBe(true)
    }
    for (const d of ['inbox', 'people', 'themes', 'initiatives', 'notes', 'bases']) {
      expect(fs.statSync(path.join(r.root, d)).isDirectory()).toBe(true)
    }
  })

  it('refuses to clobber an existing vault unless --force', () => {
    const v = path.join(root, 'v')
    initVault(v, { format: 'obsidian' })
    expect(() => initVault(v, { format: 'obsidian' })).toThrow(/already a vault/)
    expect(() => initVault(v, { format: 'obsidian', force: true })).not.toThrow()
  })

  it('templates carry D19 filing rules readable by the corpus', () => {
    const v = initVault(path.join(root, 'v'), { format: 'obsidian' }).root
    const templates = loadTemplates(v)
    const initiative = templates.find((t) => t.type === 'initiative')!
    expect(initiative.folder).toBe('initiatives')
    expect(initiative.folderNote).toBe(true)
    expect(initiative.embeddedBase).toContain('initiative == this')
    const milestone = templates.find((t) => t.type === 'milestone')!
    expect(milestone.filingParent).toBe('initiative')
    expect(milestone.filingLoose).toBe(true)
    expect(milestone.folder).toBeNull()
    const person = templates.find((t) => t.type === 'person')!
    expect(person.folder).toBe('people')
    expect(person.filingParent).toBeNull()
    // meta keys are NOT leaked into the entity field list
    expect(initiative.fields).not.toContain('folderNote')
    expect(milestone.fields).not.toContain('filingParent')
  })

  it('the scaffolded vault lints clean and yields a 6-type corpus (incl. rollup, ENH-228)', () => {
    const v = initVault(path.join(root, 'v'), { format: 'obsidian' }).root
    expect(buildCorpus(v).types).toEqual(['initiative', 'meeting', 'milestone', 'person', 'rollup', 'theme'])
    const errors = lintVault(v, '--all').flatMap((r) => r.findings.filter((f) => f.severity === 'error'))
    expect(errors).toEqual([])
  })

  it('warns when the vault lives under ~/Documents (iCloud-eviction trap)', () => {
    // Simulate by initting under a path we control vs. the real ~/Documents
    // — we just assert no spurious warning for a /tmp vault.
    const r = initVault(path.join(root, 'v'), { format: 'obsidian' })
    expect(r.warnings).toEqual([])
  })
})

describe('vault init (OKF — the new default, ENH-216 D2)', () => {
  it('initVault defaults to OKF (the dialog default; the CLI requires --format)', () => {
    const r = initVault(path.join(root, 'v'))
    expect(r.mode).toBe('okf')
    expect(isVaultRoot(r.root)).toBe(true)
  })

  it('scaffolds an OKF marker (root _index.md w/ okf_version + type:index), NO .obsidian/ / README / bases', () => {
    const v = initVault(path.join(root, 'v')).root
    expect(fs.existsSync(path.join(v, '.obsidian'))).toBe(false)
    expect(fs.existsSync(path.join(v, 'README.md'))).toBe(false)
    expect(fs.existsSync(path.join(v, 'bases'))).toBe(false)
    expect(fs.existsSync(path.join(v, 'index.md'))).toBe(false) // ENH-243: not the legacy name
    const idx = fs.readFileSync(path.join(v, '_index.md'), 'utf8')
    expect(idx).toContain('okf_version:')
    expect(idx).toContain('type: index')
    // the co-owned listing fence seed (U2 writes it; U3 fills the body)
    expect(idx).toContain('<!-- duo:listing -->')
  })

  it('templates are the SAME 6-type set as Obsidian (the initiative minus its embedded .base)', () => {
    const okf = initVault(path.join(root, 'okf')).root
    const obs = initVault(path.join(root, 'obs'), { format: 'obsidian' }).root
    const types = (r: string) => loadTemplates(r).map((t) => t.type).sort()
    // ENH-228 added the `rollup` type to both scaffolds.
    const SIX = ['initiative', 'meeting', 'milestone', 'person', 'rollup', 'theme']
    expect(types(okf)).toEqual(SIX)
    expect(types(obs)).toEqual(SIX)
    // OKF's initiative template carries NO embedded `.base` rollup (D8 — OKF
    // listings are static markdown), unlike Obsidian's.
    expect(loadTemplates(okf).find((t) => t.type === 'initiative')!.embeddedBase).toBeNull()
    expect(loadTemplates(obs).find((t) => t.type === 'initiative')!.embeddedBase).toContain(
      'initiative == this',
    )
  })

  it('buildCorpus surfaces the 6 template types + the root index entity (D10 type-stamp-everything)', () => {
    const v = initVault(path.join(root, 'v')).root
    // The root index.md is itself type:index (D10), so the entity-derived
    // corpus carries `index` on top of the 6 template types (ENH-228 rollup).
    expect(buildCorpus(v).types).toEqual([
      'index',
      'initiative',
      'meeting',
      'milestone',
      'person',
      'rollup',
      'theme',
    ])
  })

  it('the OKF scaffold lints clean', () => {
    const v = initVault(path.join(root, 'v')).root
    const errors = lintVault(v, '--all').flatMap((r) => r.findings.filter((f) => f.severity === 'error'))
    expect(errors).toEqual([])
  })
})

describe('vault init (ENH-242 D4 — OKF index.md collision guard)', () => {
  it('refuses to OKF-init a folder that already holds a plain index.md', () => {
    const v = path.join(root, 'has-index')
    fs.mkdirSync(v, { recursive: true })
    fs.writeFileSync(path.join(v, 'index.md'), '# my notes\n')
    expect(() => initVault(v, { format: 'okf' })).toThrow(/already contains a index\.md file/)
    // the user's file is untouched …
    expect(fs.readFileSync(path.join(v, 'index.md'), 'utf8')).toBe('# my notes\n')
    // … and the folder did NOT become a vault (the bug this guards: a silent
    // skip that left the folder un-marked, then setDefaultVault threw).
    expect(isVaultRoot(v)).toBe(false)
  })

  it('--force overrides the collision guard (overwrites index.md with the OKF marker)', () => {
    const v = path.join(root, 'has-index-force')
    fs.mkdirSync(v, { recursive: true })
    fs.writeFileSync(path.join(v, 'index.md'), '# my notes\n')
    expect(() => initVault(v, { format: 'okf', force: true })).not.toThrow()
    expect(isVaultRoot(v)).toBe(true)
  })

  it('Obsidian init is unaffected by an existing index.md (never writes index.md)', () => {
    const v = path.join(root, 'has-index-obsidian')
    fs.mkdirSync(v, { recursive: true })
    fs.writeFileSync(path.join(v, 'index.md'), '# my notes\n')
    expect(() => initVault(v, { format: 'obsidian' })).not.toThrow()
    expect(isVaultRoot(v)).toBe(true)
    expect(fs.readFileSync(path.join(v, 'index.md'), 'utf8')).toBe('# my notes\n')
  })

  it('refuses to initialize when the target exists but is a file (clear error, not ENOTDIR)', () => {
    const f = path.join(root, 'a-file')
    fs.writeFileSync(f, 'not a directory')
    expect(() => initVault(f, { format: 'okf' })).toThrow(/not a directory/)
  })
})

describe('vault capture', () => {
  it('drops an untyped, captured-stamped inbox note by default (Obsidian)', () => {
    // OBSIDIAN capture is untyped-by-default. (PR#98 F4: captureNote now
    // auto-detects the vault mode, so an OKF vault would stamp `type: note` +
    // mint an id — that OKF path is covered by the OKF capture test below.)
    const v = initVault(path.join(root, 'v'), { format: 'obsidian' }).root
    const c = captureNote(v, { text: 'a quick thought', date: new Date('2026-06-09T14:32:05') })
    // YYYY-MM-DD-HHMMSS — date+time hyphen-joined so an untitled capture has
    // no space in its name (owner ask 2026-06-12).
    expect(c.path).toMatch(/^inbox\/2026-06-09-143205\.md$/)
    expect(c.type).toBeNull()
    const content = fs.readFileSync(c.absPath, 'utf8')
    expect(content).toContain('captured: 2026-06-09')
    expect(content).not.toContain('type:')
    expect(content).toContain('a quick thought')
  })

  it('stamps the type + expected fields when --template is given', () => {
    const v = initVault(path.join(root, 'v')).root
    const c = captureNote(v, { template: 'meeting', title: 'kickoff sync', date: new Date('2026-06-09T14:32:00') })
    expect(c.type).toBe('meeting')
    expect(c.path).toContain('kickoff sync')
    const content = fs.readFileSync(c.absPath, 'utf8')
    expect(content).toContain('type: meeting')
    expect(content).toContain('attendees: []') // array field seeded empty
    expect(content).toContain('initiative:')
  })

  it('throws a clear error for an unknown template', () => {
    const v = initVault(path.join(root, 'v')).root
    expect(() => captureNote(v, { template: 'nope' })).toThrow(/unknown template "nope"/)
  })

  it('never overwrites a same-second / same-title capture (collision guard)', () => {
    const v = initVault(path.join(root, 'v')).root
    const when = new Date('2026-06-09T14:32:05')
    const a = captureNote(v, { text: 'FIRST', title: 'sync', date: when })
    const b = captureNote(v, { text: 'SECOND', title: 'sync', date: when })
    const c = captureNote(v, { text: 'THIRD', title: 'sync', date: when })
    // three distinct files, all on disk, none clobbered
    expect(new Set([a.path, b.path, c.path]).size).toBe(3)
    expect(b.path).toMatch(/ 2\.md$/)
    expect(c.path).toMatch(/ 3\.md$/)
    expect(fs.readFileSync(a.absPath, 'utf8')).toContain('FIRST')
    expect(fs.readFileSync(b.absPath, 'utf8')).toContain('SECOND')
    expect(fs.readFileSync(c.absPath, 'utf8')).toContain('THIRD')
  })

  it('end-to-end: a captured-then-filed note renders in its parent rollup', () => {
    // The rollup render path is Obsidian-only (it reads the template's
    // embedded `.base` block, which OKF omits, D8) — scaffold in obsidian.
    const v = initVault(path.join(root, 'v'), { format: 'obsidian' }).root
    // Seed an initiative folder-note (with the embedded rollup) + a milestone.
    const initDir = path.join(v, 'initiatives', 'Q4 Roadmap')
    fs.mkdirSync(initDir, { recursive: true })
    const tplBody = fs.readFileSync(path.join(v, 'templates', 'initiative.md'), 'utf8').split('---').slice(2).join('---')
    fs.writeFileSync(
      path.join(initDir, 'Q4 Roadmap.md'),
      '---\ntype: initiative\nowner: "[[Dana Wu]]"\nstatus: active\n---\n' + tplBody,
    )
    fs.writeFileSync(
      path.join(initDir, 'Draft deck.md'),
      '---\ntype: milestone\ninitiative: "[[Q4 Roadmap]]"\nstatus: on-track\ndue: 2026-09-15\n---\n',
    )
    const r = renderTarget(v, 'Q4 Roadmap', { asOf: new Date('2026-06-09') })
    expect(r.bases[0].evaluated.views[0].rows).toHaveLength(1)
  })
})

describe('vault capture (OKF mode — type-stamp-everything + id, ENH-216 D10)', () => {
  it('an untemplated OKF capture stamps type:note (not untyped) + a minted id', () => {
    const v = initVault(path.join(root, 'v')).root
    const c = captureNote(v, { text: 'a quick thought', mode: 'okf', date: new Date('2026-06-09T14:32:05') })
    expect(c.type).toBe('note')
    const content = fs.readFileSync(c.absPath, 'utf8')
    expect(content).toMatch(/^---\nid: [0-9a-z]{8}\n/) // id spliced after the fence
    expect(content).toContain('type: note')
    expect(content).toContain('a quick thought')
  })

  // PR#98 F4 — the regression guard: an OKF vault must shape the capture
  // correctly even when the caller (the ⇧⌘N IPC handler / `duo vault capture`)
  // passes NO mode. captureNote auto-detects the vault mode.
  it('AUTO-DETECTS okf when no mode is passed (the IPC/CLI path) — type:note + id', () => {
    const v = initVault(path.join(root, 'v')).root // default → OKF
    const c = captureNote(v, { text: 'a quick thought', date: new Date('2026-06-09T14:32:05') })
    expect(c.type).toBe('note')
    const content = fs.readFileSync(c.absPath, 'utf8')
    expect(content).toMatch(/^---\nid: [0-9a-z]{8}\n/)
    expect(content).toContain('type: note')
  })

  it('a templated OKF capture stamps the type + its fields + an id', () => {
    const v = initVault(path.join(root, 'v')).root
    const c = captureNote(v, { template: 'meeting', mode: 'okf', date: new Date('2026-06-09T14:32:00') })
    expect(c.type).toBe('meeting')
    const content = fs.readFileSync(c.absPath, 'utf8')
    expect(content).toMatch(/^---\nid: [0-9a-z]{8}\n/)
    expect(content).toContain('type: meeting')
    expect(content).toContain('attendees: []')
  })

  it('an OKF entity stub slugs the stem (D6) and stamps title + id (D6/D10)', () => {
    const v = initVault(path.join(root, 'v')).root
    const stub = createEntityStub(v, 'person', 'Customer Orders', { mode: 'okf' })
    // D6: the on-disk stem is slugged; the human name lives in title:.
    expect(stub.path).toBe('people/customer-orders.md')
    const content = fs.readFileSync(stub.absPath, 'utf8')
    expect(content).toMatch(/^---\nid: [0-9a-z]{8}\n/)
    expect(content).toContain('type: person')
    expect(content).toContain('title: Customer Orders')
  })
})
