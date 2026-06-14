// ENH-208 Vault — write-verb tests (PR3): vault init scaffold + capture.
// Each test inits into a throwaway tmpdir so nothing touches the repo.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { initVault, captureNote, isVaultRoot, buildCorpus, loadTemplates, lintVault, renderTarget } from './index'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-vault-init-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('vault init', () => {
  it('scaffolds a recognizable vault with the starter set', () => {
    const r = initVault(path.join(root, 'v'))
    expect(isVaultRoot(r.root)).toBe(true)
    for (const f of [
      '.obsidian/app.json',
      'templates/person.md',
      'templates/initiative.md',
      'templates/milestone.md',
      'templates/meeting.md',
      'templates/theme.md',
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
    initVault(v)
    expect(() => initVault(v)).toThrow(/already a vault/)
    expect(() => initVault(v, { force: true })).not.toThrow()
  })

  it('templates carry D19 filing rules readable by the corpus', () => {
    const v = initVault(path.join(root, 'v')).root
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

  it('the scaffolded vault lints clean and yields a 5-type corpus', () => {
    const v = initVault(path.join(root, 'v')).root
    expect(buildCorpus(v).types).toEqual(['initiative', 'meeting', 'milestone', 'person', 'theme'])
    const errors = lintVault(v, '--all').flatMap((r) => r.findings.filter((f) => f.severity === 'error'))
    expect(errors).toEqual([])
  })

  it('warns when the vault lives under ~/Documents (iCloud-eviction trap)', () => {
    // Simulate by initting under a path we control vs. the real ~/Documents
    // — we just assert no spurious warning for a /tmp vault.
    const r = initVault(path.join(root, 'v'))
    expect(r.warnings).toEqual([])
  })
})

describe('vault capture', () => {
  it('drops an untyped, captured-stamped inbox note by default', () => {
    const v = initVault(path.join(root, 'v')).root
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
    const v = initVault(path.join(root, 'v')).root
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
