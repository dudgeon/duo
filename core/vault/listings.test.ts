// ENH-216 OKF Vault Mode — generated-listings + promote tests (U3, Stage 1).
// Builds throwaway OKF / Obsidian vaults in a tmpdir (just enough scaffold for
// detectVaultMode + filing to work) so nothing touches the repo fixtures.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  generateIndex,
  generateLog,
  writeListings,
  promoteSection,
  LISTING_FENCE,
} from './listings'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-vault-listings-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function write(rel: string, content: string): void {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}
function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

/** A minimal OKF vault: root index.md with okf_version frontmatter + the
 *  shared listing fence, and a couple of typed notes. */
function makeOkfVault(): void {
  write('index.md', `---\nokf_version: 1\ntitle: My Vault\ntype: index\n---\n${LISTING_FENCE}\n`)
  write('people/alice.md', '---\ntype: person\ntitle: Alice Park\ndescription: A PM.\n---\nAlice.\n')
  write('people/bob.md', '---\ntype: person\ntitle: Bob Lee\n---\nBob.\n')
  write('themes/growth.md', '---\ntype: theme\ntitle: Growth\nsummary: The growth theme.\n---\nGrowth.\n')
}

/** A minimal Obsidian vault (the default mode): a `.obsidian/` dir. */
function makeObsidianVault(): void {
  fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true })
  write('people/alice.md', '---\ntype: person\n---\nAlice.\n')
}

describe('generateIndex (OKF section-6, D8)', () => {
  it('groups by type with title + description bullets', () => {
    makeOkfVault()
    const body = generateIndex(root, '')
    expect(body).toContain('## Person')
    expect(body).toContain('## Theme')
    expect(body).toContain('* [Alice Park](./people/alice.md) - A PM.')
    expect(body).toContain('* [Bob Lee](./people/bob.md)')
    expect(body).toContain('* [Growth](./themes/growth.md) - The growth theme.')
  })

  it('orders groups and bullets deterministically (sorted)', () => {
    makeOkfVault()
    const body = generateIndex(root, '')
    // Person sorts before Theme; Alice before Bob within Person.
    expect(body.indexOf('## Person')).toBeLessThan(body.indexOf('## Theme'))
    expect(body.indexOf('Alice Park')).toBeLessThan(body.indexOf('Bob Lee'))
  })

  it('excludes the generated index.md / log.md from its own listing', () => {
    makeOkfVault()
    write('log.md', 'stale log\n')
    const body = generateIndex(root, '')
    expect(body).not.toContain('index.md)')
    expect(body).not.toContain('log.md)')
  })

  it('scopes to a subdirectory and links relative to that dir index', () => {
    makeOkfVault()
    const body = generateIndex(root, 'people')
    // Links are relative to people/index.md → ./alice.md, not ./people/alice.md.
    expect(body).toContain('* [Alice Park](./alice.md) - A PM.')
    expect(body).not.toContain('themes')
  })
})

describe('generateLog (OKF section-7, D8)', () => {
  it('groups by day, newest first', () => {
    makeOkfVault()
    // Force distinct mtimes.
    const old = new Date('2026-01-01T10:00:00')
    const recent = new Date('2026-06-10T10:00:00')
    fs.utimesSync(path.join(root, 'people/alice.md'), old, old)
    fs.utimesSync(path.join(root, 'people/bob.md'), recent, recent)
    const body = generateLog(root)
    expect(body).toContain('## 2026-06-10')
    expect(body).toContain('## 2026-01-01')
    expect(body.indexOf('## 2026-06-10')).toBeLessThan(body.indexOf('## 2026-01-01'))
  })
})

describe('writeListings — OKF-mode-gated (D8)', () => {
  it('throws in Obsidian mode (Obsidian stays byte-identical)', () => {
    makeObsidianVault()
    expect(() => writeListings(root)).toThrow(/OKF-mode only/)
  })

  it('writes root index.md + log.md with generated stamps', () => {
    makeOkfVault()
    const r = writeListings(root)
    expect(r.mode).toBe('okf')
    expect(r.written).toContain('index.md')
    expect(r.written).toContain('log.md')
    expect(read('index.md')).toContain('<!-- duo:generated index')
    expect(read('index.md')).toMatch(/source-hash [0-9a-f]{12}/)
    expect(read('log.md')).toContain('<!-- duo:generated log')
  })

  it('preserves the root index.md okf_version frontmatter BYTE-IDENTICALLY', () => {
    makeOkfVault()
    const before = read('index.md')
    const frontmatterBefore = before.match(/^---\n[\s\S]*?\n---\n/)![0]
    writeListings(root)
    const after = read('index.md')
    // The frontmatter prefix is unchanged byte-for-byte.
    expect(after.startsWith(frontmatterBefore)).toBe(true)
    // Body region is the regenerated listing under the shared fence.
    const body = after.slice(frontmatterBefore.length)
    expect(body.startsWith(LISTING_FENCE)).toBe(true)
    expect(body).toContain('## Person')
  })

  it('re-running is stable on the frontmatter (no re-serialize drift)', () => {
    makeOkfVault()
    writeListings(root)
    const first = read('index.md').match(/^---\n[\s\S]*?\n---\n/)![0]
    writeListings(root)
    const second = read('index.md').match(/^---\n[\s\S]*?\n---\n/)![0]
    expect(second).toBe(first)
  })

  it('writes per-dir index.md when opts.perDir is set', () => {
    makeOkfVault()
    const r = writeListings(root, { perDir: true })
    expect(r.written).toContain('people/index.md')
    expect(r.written).toContain('themes/index.md')
    expect(read('people/index.md')).toContain('* [Alice Park](./alice.md)')
  })

  // PR#98 review cluster B — `--index-only` / `--log-only` narrow the WRITE,
  // not just the reported set, so the out-of-scope file is left byte-identical
  // (no fresh stamp → no git churn).
  it('scope=log writes only log.md and leaves index.md byte-identical (--log-only)', () => {
    makeOkfVault()
    writeListings(root) // seed both so index.md has a generated body to compare
    const indexBefore = read('index.md')
    const r = writeListings(root, { scope: 'log' })
    expect(r.written).toEqual(['log.md'])
    expect(read('index.md')).toBe(indexBefore) // untouched → no churn
    expect(read('log.md')).toContain('<!-- duo:generated log')
  })

  it('scope=index writes only index.md and leaves log.md byte-identical (--index-only)', () => {
    makeOkfVault()
    writeListings(root) // seed both
    const logBefore = read('log.md')
    const r = writeListings(root, { scope: 'index' })
    expect(r.written).toEqual(['index.md'])
    expect(read('log.md')).toBe(logBefore)
    expect(read('index.md')).toContain('<!-- duo:generated index')
  })

  it('scope=log with perDir writes NO index files (per-dir index follows index scope)', () => {
    makeOkfVault()
    const r = writeListings(root, { perDir: true, scope: 'log' })
    expect(r.written).toEqual(['log.md'])
    expect(r.written.some((p) => p.endsWith('index.md'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'people/index.md'))).toBe(false)
  })

  it('scope=index with perDir writes root + per-dir index.md but not log.md', () => {
    makeOkfVault()
    const r = writeListings(root, { perDir: true, scope: 'index' })
    expect(r.written).toContain('index.md')
    expect(r.written).toContain('people/index.md')
    expect(r.written).toContain('themes/index.md')
    expect(r.written).not.toContain('log.md')
    expect(fs.existsSync(path.join(root, 'log.md'))).toBe(false)
  })

  it('default scope (both) still writes index.md + log.md (regression)', () => {
    makeOkfVault()
    const r = writeListings(root)
    expect(r.written).toContain('index.md')
    expect(r.written).toContain('log.md')
  })
})

describe('promoteSection (D9 — link, never an embed)', () => {
  /** OKF vault with a person template (so createEntityStub can file it) +
   *  a source note carrying a ## section to promote. */
  function makePromotableOkf(): void {
    write('index.md', `---\nokf_version: 1\ntitle: V\ntype: index\n---\n${LISTING_FENCE}\n`)
    write('templates/person.md', '---\ntype: person\nfolder: people\nrole:\n---\n')
    write(
      'notes/braindump.md',
      '---\ntype: note\n---\nIntro.\n\n## Dana Wu\n\nDana is a designer.\n\n## Next\n\nmore\n',
    )
  }

  it('OKF mode leaves a markdown link (not a wikilink, never an embed)', () => {
    makePromotableOkf()
    const r = promoteSection(root, 'notes/braindump.md', 'Dana Wu', 'person')
    expect(r.created).toBe(true)
    expect(r.entityRel).toBe('people/Dana Wu.md')
    // OKF: a markdown link, NOT a wikilink, NOT an embed.
    expect(r.leftLink).toMatch(/^\[Dana Wu\]\(/)
    expect(r.leftLink).not.toContain('[[')
    expect(r.leftLink).not.toContain('![')
    const src = read('notes/braindump.md')
    expect(src).toContain('## Dana Wu')
    expect(src).toContain(r.leftLink)
    // The original prose moved into the new entity.
    expect(src).not.toContain('Dana is a designer.')
    expect(read('people/Dana Wu.md')).toContain('Dana is a designer.')
    // The following ## Next section is untouched.
    expect(src).toContain('## Next')
    expect(src).toContain('more')
  })

  it('Obsidian mode leaves a wikilink', () => {
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true })
    write('templates/person.md', '---\ntype: person\nfolder: people\nrole:\n---\n')
    write('notes/braindump.md', '---\ntype: note\n---\n## Dana Wu\n\nDana is a designer.\n')
    const r = promoteSection(root, 'notes/braindump.md', 'Dana Wu', 'person')
    expect(r.leftLink).toBe('[[Dana Wu]]')
    expect(read('notes/braindump.md')).toContain('[[Dana Wu]]')
  })

  it('throws when the section heading is not found', () => {
    makePromotableOkf()
    expect(() => promoteSection(root, 'notes/braindump.md', 'Nope', 'person')).toThrow(/not found/)
  })

  // PR#98 review cluster A — a slug/path collision must NOT drop the section.
  it('REFUSES (leaves the source intact) when an entity already exists at the target — no data loss', () => {
    makePromotableOkf()
    // Pre-create the target the section would promote into. promoteSection
    // files the stub with the obsidian stem rule (verbatim name) even in an
    // OKF vault, so the colliding path is people/Dana Wu.md.
    write('people/Dana Wu.md', '---\ntype: person\ntitle: Dana Wu\n---\nPRE-EXISTING content.\n')
    const srcBefore = read('notes/braindump.md')
    const targetBefore = read('people/Dana Wu.md')

    // It refuses by throwing, naming the colliding path — BEFORE any write.
    expect(() => promoteSection(root, 'notes/braindump.md', 'Dana Wu', 'person')).toThrow(
      /already exists at people\/Dana Wu\.md/,
    )

    // No data loss: the source note is byte-identical (prose still there, no
    // "Moved to" stub spliced in) ...
    const srcAfter = read('notes/braindump.md')
    expect(srcAfter).toBe(srcBefore)
    expect(srcAfter).toContain('Dana is a designer.')
    expect(srcAfter).not.toContain('Moved to')
    // ... and the pre-existing target was left untouched (not clobbered).
    expect(read('people/Dana Wu.md')).toBe(targetBefore)
  })
})
