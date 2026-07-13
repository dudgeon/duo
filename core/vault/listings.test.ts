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
import { extractLinkRefs } from '../markdown/vaultLinks'

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

  // BUG-267(a) — a note whose FILENAME has a space produced a literal
  // un-percent-encoded space in the generated bullet's href: invalid
  // navigation in Obsidian ("Folder already exists") and invalid bare-form
  // GFM on github.com. Fix: angle-bracket the href (CommonMark §6.6) only
  // when it needs it.
  it('angle-brackets an href whose target filename has a space', () => {
    makeOkfVault()
    write('notes/weird draft.md', '---\ntype: note\ntitle: Weird Draft\n---\nbody\n')
    const body = generateIndex(root, '')
    expect(body).toContain('* [Weird Draft](<./notes/weird draft.md>)')
    // A space-free href is UNCHANGED (no angle-bracket churn on the common case).
    expect(body).toContain('* [Alice Park](./people/alice.md) - A PM.')
  })

  it('the angle-bracketed href round-trips through extractLinkRefs (BUG-267b)', () => {
    makeOkfVault()
    write('notes/weird draft.md', '---\ntype: note\ntitle: Weird Draft\n---\nbody\n')
    const body = generateIndex(root, '')
    const refs = extractLinkRefs(body)
    const ref = refs.find((r) => r.display === 'Weird Draft')
    expect(ref).toBeDefined()
    // The FULL path is captured — not truncated at the first space.
    expect(ref!.rawTarget).toBe('./notes/weird draft.md')
  })
})

describe('engine-driven index (ENH-230 — `listing:` base spec)', () => {
  /** An OKF vault whose root index.md frontmatter carries a `listing:` base
   *  spec (People as a table, linking each note). */
  function makeOkfVaultWithListing(): void {
    write(
      'index.md',
      [
        '---',
        'okf_version: 1',
        'title: My Vault',
        'type: index',
        'listing:',
        '  views:',
        '    - type: table',
        '      name: People',
        '      order:',
        '        - file.name',
        '        - title',
        '      filters:',
        '        and:',
        '          - type == "person"',
        '---',
        LISTING_FENCE,
        '',
      ].join('\n'),
    )
    write('people/alice.md', '---\ntype: person\ntitle: Alice Park\n---\nAlice.\n')
    write('people/bob.md', '---\ntype: person\ntitle: Bob Lee\n---\nBob.\n')
    write('themes/growth.md', '---\ntype: theme\ntitle: Growth\n---\nGrowth.\n')
  }

  it('drives the index body through the engine when a `listing:` spec is present', () => {
    makeOkfVaultWithListing()
    writeListings(root)
    const idx = read('index.md')
    // Engine output: a `## <title>` section + a `### <view>` heading (the
    // group-by-type default emits neither a `### ` heading nor the title).
    expect(idx).toContain('## My Vault')
    expect(idx).toContain('### People (2)')
    // The theme note is filtered OUT by `type == "person"` (the default would
    // have listed it under `## Theme`).
    expect(idx).not.toContain('Growth')
    expect(idx).not.toContain('## Theme')
    // Rows link the notes they roll up (D5 — rel-md entity links).
    expect(idx).toContain('Alice Park')
    expect(idx).toContain('people/alice.md')
  })

  it('preserves the okf_version + listing frontmatter byte-identically (D2 splice unchanged)', () => {
    makeOkfVaultWithListing()
    const fmBefore = read('index.md').match(/^---\n[\s\S]*?\n---\n/)![0]
    writeListings(root)
    expect(read('index.md').startsWith(fmBefore)).toBe(true)
  })

  it('falls back to the group-by-type default when `listing:` is not a usable spec (D3/D4)', () => {
    makeOkfVault() // no `listing:` key at all
    writeListings(root)
    const idx = read('index.md')
    expect(idx).toContain('## Person') // generateIndex default
    expect(idx).not.toContain('### ') // never the engine's view headings
  })

  it('a `listing:` with no views falls back to the default (D4)', () => {
    write('index.md', `---\nokf_version: 1\ntitle: V\ntype: index\nlisting:\n  filters:\n    - type == "person"\n---\n${LISTING_FENCE}\n`)
    write('people/alice.md', '---\ntype: person\ntitle: Alice Park\n---\nAlice.\n')
    writeListings(root)
    const idx = read('index.md')
    expect(idx).toContain('## Person')
    expect(idx).not.toContain('### ')
  })

  it('a scalar `listing:` value falls back to the default (D4)', () => {
    write('index.md', `---\nokf_version: 1\ntitle: V\ntype: index\nlisting: nonsense\n---\n${LISTING_FENCE}\n`)
    write('people/alice.md', '---\ntype: person\ntitle: Alice Park\n---\nAlice.\n')
    writeListings(root)
    expect(read('index.md')).toContain('## Person')
  })

  it('carries the regenerate hint in the stamp (D6)', () => {
    makeOkfVault()
    writeListings(root)
    expect(read('index.md')).toContain('regenerate: duo vault publish')
  })

  it('is idempotent on the engine path: re-publishing an unchanged listing writes nothing', () => {
    makeOkfVaultWithListing()
    expect(writeListings(root).written).toContain('index.md')
    // The spec carries no time-relative formulas, so the engine output is fully
    // deterministic; the byte-guard (writeIfChanged) writes nothing on the
    // second pass — no git churn / reconcile banner over an open index.md.
    expect(writeListings(root).written).toEqual([])
  })

  it('renders ⚠ cells for a bad formula expression but still publishes — engine warn-and-render (D4)', () => {
    write(
      'index.md',
      [
        '---',
        'okf_version: 1',
        'title: V',
        'type: index',
        'listing:',
        '  formulas:',
        "    boom: '__no_such_fn__()'", // unknown ident → null() → TypeError → trapped to a ⚠ cell
        '  views:',
        '    - type: table',
        '      name: People',
        '      order:',
        '        - file.name',
        '        - formula.boom',
        '      filters:',
        '        and:',
        '          - type == "person"',
        '---',
        LISTING_FENCE,
        '',
      ].join('\n'),
    )
    write('people/alice.md', '---\ntype: person\ntitle: Alice Park\n---\nAlice.\n')
    const r = writeListings(root)
    expect(r.written).toContain('index.md') // publish SUCCEEDED (never threw)
    const idx = read('index.md')
    expect(idx).toContain('### People (1)') // the ENGINE path ran (not the default)
    expect(idx).toContain('⚠') // the bad expression degraded to a warn cell, didn't throw
    // A usable spec with a bad EXPRESSION is not a fallback — it renders, so no
    // publish-level warning is raised (the ⚠ lives in the body).
    expect(r.warnings).toEqual([])
  })

  it('warns (not silently) when an authored `listing:` is unusable, but still publishes (D4)', () => {
    write('index.md', `---\nokf_version: 1\ntitle: V\ntype: index\nlisting: nonsense\n---\n${LISTING_FENCE}\n`)
    write('people/alice.md', '---\ntype: person\ntitle: Alice Park\n---\nAlice.\n')
    const r = writeListings(root)
    expect(read('index.md')).toContain('## Person') // fell back to the default
    expect(r.warnings.length).toBeGreaterThan(0) // ...but NOT silently (the review fix)
    expect(r.warnings[0]).toContain('listing:')
  })

  it('does NOT warn when there is no `listing:` key — silence is correct for the default', () => {
    makeOkfVault() // no `listing:` authored → the common default, not a misconfiguration
    expect(writeListings(root).warnings).toEqual([])
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
    const indexBefore = read('index.md') // the scaffolded marker (empty fence)
    const r = writeListings(root, { scope: 'log' })
    expect(r.written).toEqual(['log.md'])
    expect(read('index.md')).toBe(indexBefore) // never read/written → byte-identical
    expect(read('log.md')).toContain('<!-- duo:generated log')
  })

  it('scope=index writes only index.md and never creates log.md (--index-only)', () => {
    makeOkfVault()
    const r = writeListings(root, { scope: 'index' })
    expect(r.written).toEqual(['index.md'])
    expect(fs.existsSync(path.join(root, 'log.md'))).toBe(false)
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

  // PR#98 F20 — a deterministic stamp + byte-equality guard make `publish`
  // idempotent: re-running on an unchanged corpus writes nothing (no spurious
  // watcher event / git churn / reconcile banner over an open index.md).
  it('is idempotent: re-publishing an unchanged corpus writes nothing', () => {
    makeOkfVault()
    expect(writeListings(root).written.sort()).toEqual(['index.md', 'log.md'])
    const indexAfterFirst = read('index.md')
    const logAfterFirst = read('log.md')
    expect(writeListings(root).written).toEqual([]) // second pass → no change
    expect(read('index.md')).toBe(indexAfterFirst)
    expect(read('log.md')).toBe(logAfterFirst)
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

  it('OKF mode files the entity at a SLUGGED path and leaves a parseable md link (PR#98 F4)', () => {
    makePromotableOkf()
    const r = promoteSection(root, 'notes/braindump.md', 'Dana Wu', 'person')
    expect(r.created).toBe(true)
    // OKF slugs the on-disk stem — NOT the verbatim "Dana Wu.md" (which would
    // give a space-bearing href the OKF link parser truncates).
    expect(r.entityRel).toBe('people/dana-wu.md')
    // A markdown link, NOT a wikilink, NOT an embed.
    expect(r.leftLink).toMatch(/^\[Dana Wu\]\(/)
    expect(r.leftLink).not.toContain('[[')
    expect(r.leftLink).not.toContain('![')
    // The href is space-free and round-trips through the SAME extractor the
    // graph/backlinks/relink use — i.e. it is a real, resolvable edge.
    const refs = extractLinkRefs(r.leftLink)
    expect(refs).toHaveLength(1)
    expect(refs[0].rawTarget).not.toMatch(/\s/)
    expect(refs[0].key).toBe('dana-wu')
    const src = read('notes/braindump.md')
    expect(src).toContain('## Dana Wu')
    expect(src).toContain(r.leftLink)
    // The original prose moved into the new (slugged) entity.
    expect(src).not.toContain('Dana is a designer.')
    expect(read('people/dana-wu.md')).toContain('Dana is a designer.')
    // The new entity carries a title: (the human name) and a minted id:.
    const entity = read('people/dana-wu.md')
    expect(entity).toMatch(/title: Dana Wu/)
    expect(entity).toMatch(/id: \w+/)
    // The following ## Next section is untouched.
    expect(src).toContain('## Next')
    expect(src).toContain('more')
  })

  it('Obsidian mode files the verbatim basename and leaves a wikilink', () => {
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true })
    write('templates/person.md', '---\ntype: person\nfolder: people\nrole:\n---\n')
    write('notes/braindump.md', '---\ntype: note\n---\n## Dana Wu\n\nDana is a designer.\n')
    const r = promoteSection(root, 'notes/braindump.md', 'Dana Wu', 'person')
    expect(r.entityRel).toBe('people/Dana Wu.md')
    expect(r.leftLink).toBe('[[Dana Wu]]')
    expect(read('notes/braindump.md')).toContain('[[Dana Wu]]')
  })

  it('throws when the section heading is not found', () => {
    makePromotableOkf()
    expect(() => promoteSection(root, 'notes/braindump.md', 'Nope', 'person')).toThrow(/not found/)
  })

  // PR#98 review cluster A — a slug/path collision must NOT drop the section.
  // OKF mode auto-disambiguates (createEntityStub appends `-2`), so the content
  // lands in a NEW entity rather than being lost or merged into the existing one.
  it('OKF mode: a slug collision auto-disambiguates to `-2` — content preserved, no data loss', () => {
    makePromotableOkf()
    // Pre-create the SLUGGED target a fresh promote would use.
    write('people/dana-wu.md', '---\ntype: person\ntitle: Dana Wu\nid: preexisting\n---\nUNRELATED.\n')
    const preexisting = read('people/dana-wu.md')

    const r = promoteSection(root, 'notes/braindump.md', 'Dana Wu', 'person')
    expect(r.created).toBe(true)
    expect(r.entityRel).toBe('people/dana-wu-2.md')
    // The promoted prose landed in the NEW entity; the pre-existing one is intact.
    expect(read('people/dana-wu-2.md')).toContain('Dana is a designer.')
    expect(read('people/dana-wu.md')).toBe(preexisting)
    // The source note's leave-behind link points at the disambiguated entity.
    expect(read('notes/braindump.md')).toContain(r.leftLink)
    expect(r.leftLink).toContain('dana-wu-2.md')
  })

  // In OBSIDIAN mode createEntityStub no-ops on an existing basename (no `-2`),
  // so promoting onto it would drop the section — REFUSE to avoid data loss.
  it('Obsidian mode: REFUSES on an existing entity, leaving the source intact (no data loss)', () => {
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true })
    write('templates/person.md', '---\ntype: person\nfolder: people\nrole:\n---\n')
    write('notes/braindump.md', '---\ntype: note\n---\n## Dana Wu\n\nDana is a designer.\n')
    write('people/Dana Wu.md', '---\ntype: person\n---\nPRE-EXISTING content.\n')
    const srcBefore = read('notes/braindump.md')
    const targetBefore = read('people/Dana Wu.md')

    expect(() => promoteSection(root, 'notes/braindump.md', 'Dana Wu', 'person')).toThrow(
      /already exists at people\/Dana Wu\.md/,
    )

    // No data loss: source byte-identical, pre-existing target untouched.
    expect(read('notes/braindump.md')).toBe(srcBefore)
    expect(read('notes/braindump.md')).not.toContain('Moved to')
    expect(read('people/Dana Wu.md')).toBe(targetBefore)
  })
})
