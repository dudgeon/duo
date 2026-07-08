// ENH-208 Vault core — regression tests pinned to the frozen prototype
// vault (`docs/research/graphbook-prototype/`), the PRD's reference
// implementation. These lock the corpus shape, graph queries, detection,
// and search so future engine work can't silently drift.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import {
  buildCorpus,
  loadTemplates,
  findVaultRoot,
  isVaultRoot,
  listVaults,
  resolveVault,
  detectVaultMode,
  readOkfVersion,
  backlinks,
  orphans,
  search,
  splitFrontmatter,
  extractWikilinks,
} from './index'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// core/vault/ → repo root → the frozen fixture vault.
const VAULT = path.resolve(HERE, '../../docs/research/graphbook-prototype')

describe('detection', () => {
  it('recognizes the prototype as a vault root', () => {
    expect(isVaultRoot(VAULT)).toBe(true)
  })

  it('detects the frozen prototype as an Obsidian-mode vault (it has .obsidian/)', () => {
    // The frozen fixture is the legacy Obsidian shape — its mode must stay
    // obsidian (the byte-identical regression invariant, ENH-216).
    expect(detectVaultMode(VAULT)).toBe('obsidian')
    expect(readOkfVersion(VAULT)).toBeNull()
  })

  it('walks up to the vault root from a nested note', () => {
    const nested = path.join(VAULT, 'initiatives', 'Q3 Launch', 'Q3 Launch.md')
    expect(findVaultRoot(nested)).toBe(VAULT)
  })

  it('returns null outside any vault', () => {
    expect(findVaultRoot('/tmp')).toBeNull()
  })

  it('lists the vault when scanning from inside it', () => {
    const vaults = listVaults(VAULT)
    expect(vaults.map((v) => v.root)).toContain(VAULT)
    const v = vaults.find((x) => x.root === VAULT)!
    expect(v.name).toBe('graphbook-prototype')
    expect(v.noteCount).toBeGreaterThan(0)
  })

  it('resolveVault honors an explicit path and rejects non-vaults', () => {
    expect(resolveVault('/tmp', VAULT)).toBe(VAULT)
    expect(() => resolveVault('/tmp', '/tmp')).toThrow(/not a vault/)
    expect(() => resolveVault('/tmp')).toThrow(/no vault found/)
  })
})

describe('corpus (the L0 schema)', () => {
  const corpus = buildCorpus(VAULT)

  it('derives all five types from frontmatter + templates', () => {
    expect(corpus.types).toEqual(['initiative', 'meeting', 'milestone', 'person', 'theme'])
  })

  it('excludes templates/ from entities (D5 query-exclusion)', () => {
    // The loose prototype counted templates as entities (a phantom
    // milestone row). The real corpus must not.
    expect(corpus.entities.every((e) => !e.path.startsWith('templates/'))).toBe(true)
    expect(corpus.entities).toHaveLength(17)
  })

  it('resolves aliases to canonical basenames', () => {
    expect(corpus.aliases).toMatchObject({
      Alice: 'Alice Park',
      Jordan: 'Jordan Lee',
      Sam: 'Sam Rivera',
    })
  })

  it('observes the live status enum domain', () => {
    expect(corpus.enumsByType['milestone.status']).toEqual(['blocked', 'done', 'on-track'])
  })

  it('records properties per type', () => {
    expect(corpus.propsByType.milestone).toEqual(['due', 'initiative', 'owner', 'status', 'type'])
  })

  it('reads templates as the soft-schema registry with embedded rollups', () => {
    const templates = loadTemplates(VAULT)
    const init = templates.find((t) => t.type === 'initiative')!
    expect(init.fields).toContain('owner')
    expect(init.embeddedBase).toContain('initiative == this') // the one-template rollup pattern
    const person = templates.find((t) => t.type === 'person')!
    expect(person.embeddedBase).toBeNull()
  })
})

describe('graph queries', () => {
  it('finds backlinks across both body and frontmatter links', () => {
    const links = backlinks(VAULT, 'Alice Park')
    const paths = links.map((l) => l.path)
    // body mention (inbox note) + frontmatter owner (initiatives)
    expect(paths).toContain('inbox/2026-06-09 alice pricing sync.md')
    expect(paths).toContain('initiatives/Q3 Launch/Q3 Launch.md')
    expect(links).toHaveLength(8)
    // each hit carries a real 1-based line + excerpt
    for (const l of links) {
      expect(l.line).toBeGreaterThan(0)
      expect(l.excerpt.length).toBeGreaterThan(0)
    }
  })

  it('resolves a wikilink target by basename (move-proof)', () => {
    // Alice is linked as [[Alice Park]] from notes in several folders.
    const byPathPrefix = backlinks(VAULT, 'Alice Park').some((l) =>
      l.path.startsWith('initiatives/Pricing Revamp/'),
    )
    expect(byPathPrefix).toBe(true)
  })

  it('lists orphans (no inbound and no outbound links)', () => {
    expect(orphans(VAULT)).toEqual([
      'inbox/2026-06-01 stale capture.md',
      'themes/Compliance.md',
    ])
  })
})

describe('search', () => {
  it('finds full-text hits with file + line + excerpt', () => {
    const hits = search(VAULT, 'pricing')
    expect(hits.length).toBeGreaterThan(10)
    const hit = hits.find((h) => h.path === 'inbox/2026-06-09 alice pricing sync.md')
    expect(hit).toBeTruthy()
    expect(hit!.line).toBeGreaterThan(0)
  })

  it('is case-insensitive', () => {
    expect(search(VAULT, 'PRICING').length).toBe(search(VAULT, 'pricing').length)
  })

  it('returns nothing for an empty query', () => {
    expect(search(VAULT, '')).toEqual([])
  })
})

describe('parse helpers', () => {
  it('splits frontmatter from body', () => {
    const { frontmatter, body } = splitFrontmatter('---\ntype: person\nrole: PM\n---\nHello [[X]]')
    expect(frontmatter).toEqual({ type: 'person', role: 'PM' })
    expect(body).toBe('Hello [[X]]')
  })

  it('tolerates a missing frontmatter block', () => {
    const { frontmatter, body } = splitFrontmatter('no frontmatter here')
    expect(frontmatter).toEqual({})
    expect(body).toBe('no frontmatter here')
  })

  it('extracts deduped basename-only wikilinks', () => {
    expect(extractWikilinks('see [[Foo|bar]] and [[Foo#h]] and [[Baz]]')).toEqual(['Foo', 'Baz'])
  })
})

// ENH-216 OKF detection — throwaway tmpdir vaults (the frozen prototype is
// Obsidian-mode and is NEVER mutated; OKF coverage lives here on its own
// fixtures).
describe('ENH-258 — entity-reference props (link-valued) split from scalar enums', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-vault-enh258-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const write = (rel: string, body: string) => {
    const abs = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body)
  }

  it('OKF: a rel-md link prop is an entity ref (not a scalar enum); a scalar stays an enum', () => {
    write('_index.md', '---\nokf_version: "1.0"\ntype: index\n---\n')
    write('goals/reduce-churn.md', '---\ntype: goal\n---\n# Reduce Churn\n')
    write('themes/growth.md', '---\ntype: theme\n---\n# Growth\n')
    write(
      'initiatives/onboarding.md',
      '---\ntype: initiative\nstatus: active\nparent: "[Reduce Churn](../goals/reduce-churn.md)"\ninitiative_theme: "[Growth](../themes/growth.md)"\n---\n# Onboarding\n',
    )
    const c = buildCorpus(tmp)
    // The link props are entity refs, keyed by targetKey identity slug…
    expect(c.entityRefsByType['initiative.parent']).toEqual([{ name: 'Reduce Churn', slug: 'reduce-churn' }])
    expect(c.entityRefsByType['initiative.initiative_theme']).toEqual([{ name: 'Growth', slug: 'growth' }])
    // …and are NOT polluting enumsByType with un-matchable raw-link strings.
    expect(c.enumsByType['initiative.parent']).toBeUndefined()
    expect(c.enumsByType['initiative.initiative_theme']).toBeUndefined()
    // A genuine scalar prop is still a scalar enum, unchanged.
    expect(c.enumsByType['initiative.status']).toEqual(['active'])
    expect(c.entityRefsByType['initiative.status']).toBeUndefined()
  })

  it('a rel link to a NON-note file is a plain string enum, not an entity ref', () => {
    // The engine (parseLinkish) only folds `.md` rel links to a Link — a
    // `.png` rel link stays a plain STRING. So it must NOT be offered as an
    // entity operand (a `contains` on it would never resolve); it belongs in
    // enumsByType as its raw string, which `==` string-matches.
    write('_index.md', '---\nokf_version: "1.0"\ntype: index\n---\n')
    write('initiatives/a.md', '---\ntype: initiative\ncover: "[Cover](./images/cover.png)"\n---\n# A\n')
    const c = buildCorpus(tmp)
    expect(c.entityRefsByType['initiative.cover']).toBeUndefined()
    expect(c.enumsByType['initiative.cover']).toEqual(['[Cover](./images/cover.png)'])
  })

  it('Obsidian: a wikilink prop is an entity ref (previously absent from enums entirely)', () => {
    fs.mkdirSync(path.join(tmp, '.obsidian'), { recursive: true })
    write('themes/Growth.md', '---\ntype: theme\n---\n# Growth\n')
    write('initiatives/Onboarding.md', '---\ntype: initiative\ninitiative_theme: "[[Growth]]"\n---\n# Onboarding\n')
    const c = buildCorpus(tmp)
    expect(c.entityRefsByType['initiative.initiative_theme']).toEqual([{ name: 'Growth', slug: 'growth' }])
    expect(c.enumsByType['initiative.initiative_theme']).toBeUndefined()
  })

  it('array-valued link prop surfaces every entity, deduped by identity slug', () => {
    fs.mkdirSync(path.join(tmp, '.obsidian'), { recursive: true })
    write('a.md', '---\ntype: initiative\ntracks: ["[[Q3 Launch]]", "[[Growth]]"]\n---\n')
    // A second note re-uses one track (alias-cased) — must fold to one slug.
    write('b.md', '---\ntype: initiative\ntracks: ["[[q3-launch|Growth push]]"]\n---\n')
    const c = buildCorpus(tmp)
    const refs = c.entityRefsByType['initiative.tracks']
    expect(refs.map((r) => r.slug).sort()).toEqual(['growth', 'q3-launch'])
    // First display wins for a given identity (stable label).
    expect(refs.find((r) => r.slug === 'q3-launch')!.name).toBe('Q3 Launch')
  })
})

describe('OKF detection (ENH-216 D4)', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-vault-okf-detect-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('a root index.md with okf_version detects as okf', () => {
    fs.writeFileSync(path.join(tmp, 'index.md'), '---\nokf_version: "0.1"\ntype: index\n---\n')
    expect(detectVaultMode(tmp)).toBe('okf')
    expect(readOkfVersion(tmp)).toBe('0.1')
    expect(isVaultRoot(tmp)).toBe(true)
  })

  it('okf_version wins over a co-present .obsidian/ (the D4 tie-break)', () => {
    fs.mkdirSync(path.join(tmp, '.obsidian'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'index.md'), '---\nokf_version: 2\ntype: index\n---\n')
    expect(detectVaultMode(tmp)).toBe('okf')
  })

  it('an index.md without okf_version is not a marker (null when no .obsidian/)', () => {
    fs.writeFileSync(path.join(tmp, 'index.md'), '---\ntitle: just notes\n---\nbody\n')
    expect(detectVaultMode(tmp)).toBeNull()
    expect(isVaultRoot(tmp)).toBe(false)
  })

  it('findVaultRoot walks up to an OKF root from a nested note', () => {
    fs.writeFileSync(path.join(tmp, 'index.md'), '---\nokf_version: 1\ntype: index\n---\n')
    const nested = path.join(tmp, 'people', 'alice.md')
    fs.mkdirSync(path.dirname(nested), { recursive: true })
    fs.writeFileSync(nested, '---\ntype: person\n---\n')
    expect(findVaultRoot(nested)).toBe(path.resolve(tmp))
  })
})
