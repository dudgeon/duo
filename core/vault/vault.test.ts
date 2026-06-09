// ENH-208 Vault core — regression tests pinned to the frozen prototype
// vault (`docs/research/graphbook-prototype/`), the PRD's reference
// implementation. These lock the corpus shape, graph queries, detection,
// and search so future engine work can't silently drift.

import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { fileURLToPath } from 'url'
import {
  buildCorpus,
  loadTemplates,
  findVaultRoot,
  isVaultRoot,
  listVaults,
  resolveVault,
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
