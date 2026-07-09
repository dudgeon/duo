// ENH-216 OKF Vault Mode — move / relink engine tests (U3, Stage 1).
// Each test builds a throwaway OKF-shaped vault in a tmpdir (just the bits the
// engine reads: notes with markdown links + frontmatter ids) so nothing
// touches the repo fixtures.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ensureNoteId,
  mdBacklinks,
  danglingMdLinks,
  moveNote,
  relinkVault,
  migrateFrontmatterLinks,
} from './move'
import { isForeignVault } from './detect'
import { splitFrontmatter } from './parse'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-vault-move-'))
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

describe('ensureNoteId (D10)', () => {
  it('mints a stable ~8-char base36 id into frontmatter, preserving the rest', () => {
    write('people/alice.md', '---\ntype: person\ntitle: Alice\nrole: PM\n---\n\nbody text\n')
    const id = ensureNoteId(path.join(root, 'people/alice.md'), root)
    expect(id).toMatch(/^[0-9a-z]{8}$/)
    const after = read('people/alice.md')
    // id is spliced right after the opening fence; the rest is byte-preserved.
    expect(after).toBe(`---\nid: ${id}\ntype: person\ntitle: Alice\nrole: PM\n---\n\nbody text\n`)
  })

  it('is idempotent — an existing id is returned untouched', () => {
    write('people/bob.md', '---\nid: abc12345\ntype: person\n---\n\nbody\n')
    const before = read('people/bob.md')
    const id = ensureNoteId(path.join(root, 'people/bob.md'), root)
    expect(id).toBe('abc12345')
    expect(read('people/bob.md')).toBe(before)
  })

  it('mints distinct ids across the corpus (collision-checked)', () => {
    write('a.md', '---\ntype: note\n---\nshared body\n')
    write('b.md', '---\ntype: note\n---\nshared body\n')
    const ida = ensureNoteId(path.join(root, 'a.md'), root)
    const idb = ensureNoteId(path.join(root, 'b.md'), root)
    expect(ida).not.toBe(idb)
  })
})

describe('mdBacklinks + danglingMdLinks', () => {
  it('finds inbound markdown links resolving to a target (ignores wikilinks)', () => {
    write('people/alice.md', '---\ntype: person\n---\nAlice.\n')
    write(
      'meetings/sync.md',
      '---\ntype: meeting\n---\nWith [Alice](../people/alice.md) and [[Bob]].\n',
    )
    write('meetings/other.md', '---\ntype: meeting\n---\nSee [Alice again](../people/alice.md#notes).\n')
    const bl = mdBacklinks(root, 'people/alice.md')
    expect(bl.map((b) => b.fromRel).sort()).toEqual(['meetings/other.md', 'meetings/sync.md'])
  })

  it('flags markdown links whose target is missing', () => {
    write('a.md', '---\ntype: note\n---\nGone: [X](./nope.md). Here: [Y](./b.md).\n')
    write('b.md', '---\ntype: note\n---\nb\n')
    const dangling = danglingMdLinks(root)
    expect(dangling).toHaveLength(1)
    expect(dangling[0].rawHref).toBe('./nope.md')
    expect(dangling[0].key).toBe('nope')
  })
})

describe('moveNote — the clean path (D5)', () => {
  it('moves the file and rewrites inbound links byte-anchored', () => {
    write('people/alice.md', '---\ntype: person\ntitle: Alice\n---\nAlice.\n')
    write('meetings/sync.md', '---\ntype: meeting\n---\nWith [Alice](../people/alice.md).\n')
    const r = moveNote(root, 'people/alice.md', 'team/alice-park.md')
    expect(fs.existsSync(path.join(root, 'team/alice-park.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'people/alice.md'))).toBe(false)
    expect(r.inboundRewritten).toEqual([{ fromRel: 'meetings/sync.md', count: 1 }])
    // The inbound link now points at the new location.
    expect(read('meetings/sync.md')).toContain('[Alice](../team/alice-park.md)')
  })

  it('preserves a trailing anchor when rewriting an inbound href', () => {
    write('people/alice.md', '---\ntype: person\n---\nAlice.\n')
    write('m.md', '---\ntype: meeting\n---\n[Notes](./people/alice.md#decisions)\n')
    moveNote(root, 'people/alice.md', 'team/alice.md')
    expect(read('m.md')).toContain('[Notes](./team/alice.md#decisions)')
  })

  it('re-bases the moved note own outbound links from its new home', () => {
    write('people/alice.md', '---\ntype: person\n---\nReports to [Boss](./bob.md).\n')
    write('people/bob.md', '---\ntype: person\n---\nBob.\n')
    const r = moveNote(root, 'people/alice.md', 'team/leads/alice.md')
    expect(r.outboundRebased).toBe(1)
    // From team/leads/, bob is at ../../people/bob.md.
    expect(read('team/leads/alice.md')).toContain('[Boss](../../people/bob.md)')
  })

  it('throws on a dest collision (never clobbers)', () => {
    write('a.md', '---\ntype: note\n---\na\n')
    write('b.md', '---\ntype: note\n---\nb\n')
    expect(() => moveNote(root, 'a.md', 'b.md')).toThrow(/already exists/)
    // b is untouched.
    expect(read('b.md')).toContain('b')
  })

  it('throws when the source is missing', () => {
    expect(() => moveNote(root, 'nope.md', 'x.md')).toThrow(/source note not found/)
  })

  // PR#98 F3 — the note's `<file>.md.duo.json` sidecar (comments / properties /
  // recent-edits) must travel with it, not be orphaned at the old path.
  it('carries the .duo.json sidecar with the note', () => {
    write('people/alice.md', '---\ntype: person\n---\nAlice.\n')
    write('people/alice.md.duo.json', '{"version":1,"comments":[{"id":"c1"}]}')
    moveNote(root, 'people/alice.md', 'team/alice.md')
    // Sidecar moved alongside; nothing left orphaned at the old path.
    expect(fs.existsSync(path.join(root, 'team/alice.md.duo.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'people/alice.md.duo.json'))).toBe(false)
    expect(read('team/alice.md.duo.json')).toContain('"c1"')
  })

  it('moves a note that has no sidecar without error', () => {
    write('a.md', '---\ntype: note\n---\na\n')
    expect(() => moveNote(root, 'a.md', 'b.md')).not.toThrow()
    expect(fs.existsSync(path.join(root, 'b.md.duo.json'))).toBe(false)
  })
})

describe('relinkVault — out-of-band repair (D5)', () => {
  it('repairs a dangling link by stable id when slug is ambiguous', () => {
    // Two notes share the slug "alice"; the link's display carries the id.
    write('people/alice.md', '---\nid: aaaa1111\ntype: person\n---\nThe real Alice.\n')
    write('archive/alice.md', '---\nid: bbbb2222\ntype: person\n---\nOld Alice.\n')
    // A dangling link (target was at old/alice.md) whose display IS the id.
    write('m.md', '---\ntype: meeting\n---\nSee [aaaa1111](./old/alice.md).\n')
    const r = relinkVault(root)
    expect(r.repaired).toHaveLength(1)
    expect(r.repaired[0].via).toBe('id')
    expect(r.repaired[0].targetRel).toBe('people/alice.md')
    expect(read('m.md')).toContain('[aaaa1111](./people/alice.md)')
  })

  it('repairs a dangling link by slug fallback when unambiguous', () => {
    write('people/customer-orders.md', '---\nid: cccc3333\ntype: note\n---\nOrders.\n')
    // Someone moved customer-orders; the old link path is now dangling.
    write('index-note.md', '---\ntype: note\n---\n[Orders](./docs/customer-orders.md)\n')
    const r = relinkVault(root)
    expect(r.repaired).toHaveLength(1)
    expect(r.repaired[0].via).toBe('slug')
    expect(r.repaired[0].targetRel).toBe('people/customer-orders.md')
    expect(read('index-note.md')).toContain('[Orders](./people/customer-orders.md)')
  })

  it('reports ambiguous (>1 candidate) — never guesses', () => {
    write('people/alice.md', '---\nid: a1\ntype: person\n---\nAlice.\n')
    write('archive/alice.md', '---\nid: a2\ntype: person\n---\nAlice.\n')
    write('m.md', '---\ntype: meeting\n---\n[Alice](./old/alice.md)\n') // no id in display
    const r = relinkVault(root)
    expect(r.repaired).toHaveLength(0)
    expect(r.ambiguous).toHaveLength(1)
    expect(r.ambiguous[0].candidates).toEqual(['archive/alice.md', 'people/alice.md'])
    // Untouched (never guessed).
    expect(read('m.md')).toContain('[Alice](./old/alice.md)')
  })

  it('reports broken (0 candidates)', () => {
    write('m.md', '---\ntype: meeting\n---\n[Ghost](./nobody.md)\n')
    const r = relinkVault(root)
    expect(r.repaired).toHaveLength(0)
    expect(r.broken).toHaveLength(1)
    expect(r.broken[0].oldHref).toBe('./nobody.md')
  })

  // BUG-267(b) — relink used to mis-parse its OWN generated (angle-
  // bracketed) space-containing links, truncating the href at the first
  // space and reporting a well-formed link as broken. This also verifies the
  // WRITE side: a live (non-dry-run) repair must actually rewrite an angle-
  // bracketed old href, not silently 0-count it (rewriteHref had the same
  // truncating regex as the detection path).
  it('resolves (never mis-parses-as-broken) an angle-bracketed space-containing dangling link, and rewrites it', () => {
    write('people/weird target.md', '---\nid: w1\ntype: person\n---\n')
    write('m.md', '---\ntype: meeting\n---\nSee [Weird](<./old/weird target.md>) for more.\n')
    const r = relinkVault(root)
    expect(r.broken).toHaveLength(0)
    expect(r.ambiguous).toHaveLength(0)
    expect(r.repaired).toHaveLength(1)
    expect(r.repaired[0].targetRel).toBe('people/weird target.md')
    // The NEW href also needs angle-bracketing (still has a space) — and the
    // rewrite actually happened (not a false-positive report with a no-op write).
    expect(read('m.md')).toContain('[Weird](<./people/weird target.md>)')
  })

  it('dryRun resolves + reports but writes nothing', () => {
    write('people/customer-orders.md', '---\nid: c1\ntype: note\n---\nOrders.\n')
    write('m.md', '---\ntype: note\n---\n[Orders](./docs/customer-orders.md)\n')
    const before = read('m.md')
    const r = relinkVault(root, { dryRun: true })
    expect(r.repaired).toHaveLength(1)
    expect(read('m.md')).toBe(before) // unchanged
  })
})

describe('D5 — foreign-vault auto-relink guard (isForeignVault)', () => {
  it('flags a vault carrying loop.manifest.json as foreign (a Duo-native OKF vault is not)', () => {
    write('index.md', '---\nokf_version: "0.1"\ntype: index\n---\n')
    expect(isForeignVault(root)).toBe(false) // Duo-native OKF vault
    write('loop.manifest.json', '{ "name": "brainkit", "version": "0.2.0" }')
    expect(isForeignVault(root)).toBe(true) // loopkit/brainkit-family vault
  })

  it('flags a foreign bundle whose links Duo WOULD rewrite, so the boot gate skips the write', () => {
    // A loopkit/brainkit-family OKF bundle with a dangling link relinkVault WOULD repair.
    write('loop.manifest.json', '{ "name": "brainkit", "version": "0.2.0" }')
    write('people/customer-orders.md', '---\nid: c1\ntype: note\n---\nOrders.\n')
    write('m.md', '---\ntype: note\n---\n[Orders](./docs/customer-orders.md)\n')
    // Proof Duo WOULD mutate this bundle if the boot write ran:
    expect(relinkVault(root, { dryRun: true }).repaired).toHaveLength(1)
    // ...but it's foreign, so maybeAutoRelinkVault (electron/main.ts) returns early.
    expect(isForeignVault(root)).toBe(true)
  })
})

// ── migrateFrontmatterLinks (ENH-266) — the 4-category opt-in migration ───────

function okfIndex(): string {
  // `title:` deliberately differs from the marker filename's slug (`_index`)
  // — this is the exact shape that WOULD otherwise qualify for alias
  // backfill; the (d) test below pins that the marker is excluded anyway.
  return '---\nokf_version: "0.1"\ntitle: My Vault\ntype: index\n---\n'
}

describe('migrateFrontmatterLinks (ENH-266) — OKF-mode gate', () => {
  it('throws in a non-OKF (or non-vault) directory', () => {
    expect(() => migrateFrontmatterLinks(root)).toThrow(/OKF-mode only/)
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true })
    expect(() => migrateFrontmatterLinks(root)).toThrow(/OKF-mode only/)
  })
})

describe('migrateFrontmatterLinks (ENH-266) — (a) frontmatter wikilink values', () => {
  beforeEach(() => write('_index.md', okfIndex()))

  it('rewrites a QUOTED scalar wikilink value to a quoted markdown link', () => {
    write('people/alice-park.md', '---\ntype: person\n---\n# Alice Park\n')
    write('initiatives/onboarding.md', '---\ntype: initiative\nowner: "[[Alice Park]]"\n---\nbody\n')
    const r = migrateFrontmatterLinks(root)
    expect(r.frontmatterWikilinks.repaired).toHaveLength(1)
    expect(r.frontmatterWikilinks.repaired[0]).toMatchObject({
      fromRel: 'initiatives/onboarding.md',
      field: 'owner',
      targetRel: 'people/alice-park.md',
      via: 'slug',
    })
    const { frontmatter } = splitFrontmatter(read('initiatives/onboarding.md'))
    expect(frontmatter.owner).toBe('[Alice Park](../people/alice-park.md)')
  })

  it('rewrites an UNQUOTED wikilink value too (the YAML-invisible edge case)', () => {
    write('people/bob.md', '---\ntype: person\n---\n# Bob\n')
    write('a.md', '---\ntype: initiative\nowner: [[Bob]]\n---\nbody\n')
    const r = migrateFrontmatterLinks(root)
    expect(r.frontmatterWikilinks.repaired).toHaveLength(1)
    const { frontmatter } = splitFrontmatter(read('a.md'))
    expect(frontmatter.owner).toBe('[Bob](./people/bob.md)')
  })

  it('rewrites every item in a block-list field', () => {
    write('people/alice.md', '---\ntype: person\n---\n')
    write('people/bob.md', '---\ntype: person\n---\n')
    write(
      'meetings/standup.md',
      '---\ntype: meeting\nattendees:\n  - "[[Alice]]"\n  - "[[Bob]]"\n---\nbody\n',
    )
    const r = migrateFrontmatterLinks(root)
    expect(r.frontmatterWikilinks.repaired).toHaveLength(2)
    const { frontmatter } = splitFrontmatter(read('meetings/standup.md'))
    expect(frontmatter.attendees).toEqual([
      '[Alice](../people/alice.md)',
      '[Bob](../people/bob.md)',
    ])
  })

  it('rewrites every item in a flow-array field', () => {
    write('people/alice.md', '---\ntype: person\n---\n')
    write('people/bob.md', '---\ntype: person\n---\n')
    write(
      'meetings/standup.md',
      '---\ntype: meeting\nattendees: ["[[Alice]]", "[[Bob]]"]\n---\nbody\n',
    )
    const r = migrateFrontmatterLinks(root)
    expect(r.frontmatterWikilinks.repaired).toHaveLength(2)
    const { frontmatter } = splitFrontmatter(read('meetings/standup.md'))
    expect(frontmatter.attendees).toEqual([
      '[Alice](../people/alice.md)',
      '[Bob](../people/bob.md)',
    ])
  })

  it('reports (never guesses) an ambiguous slug — leaves the note untouched', () => {
    write('people/alice.md', '---\ntype: person\n---\n')
    write('themes/alice.md', '---\ntype: theme\n---\n') // slug collision
    write('a.md', '---\ntype: initiative\nowner: "[[Alice]]"\n---\nbody\n')
    const before = read('a.md')
    const r = migrateFrontmatterLinks(root)
    expect(r.frontmatterWikilinks.ambiguous).toHaveLength(1)
    expect(r.frontmatterWikilinks.repaired).toHaveLength(0)
    expect(read('a.md')).toBe(before)
  })

  it('reports (never guesses) a broken (unresolvable) target — leaves the note untouched', () => {
    write('a.md', '---\ntype: initiative\nowner: "[[Nobody]]"\n---\nbody\n')
    const before = read('a.md')
    const r = migrateFrontmatterLinks(root)
    expect(r.frontmatterWikilinks.broken).toHaveLength(1)
    expect(read('a.md')).toBe(before)
  })

  it('dryRun resolves + reports but writes nothing', () => {
    write('people/alice.md', '---\ntype: person\n---\n')
    write('a.md', '---\ntype: initiative\nowner: "[[Alice]]"\n---\nbody\n')
    const before = read('a.md')
    const r = migrateFrontmatterLinks(root, { dryRun: true })
    expect(r.frontmatterWikilinks.repaired).toHaveLength(1)
    expect(read('a.md')).toBe(before)
  })
})

describe('migrateFrontmatterLinks (ENH-266) — (b) bare unbracketed rel-path values', () => {
  beforeEach(() => write('_index.md', okfIndex()))

  it('rewrites a bare rel-path that resolves to a real file', () => {
    write('people/alice-park.md', '---\ntype: person\ntitle: Alice Park\n---\n')
    write('initiatives/onboarding.md', '---\ntype: initiative\nowner: "../people/alice-park.md"\n---\nbody\n')
    const r = migrateFrontmatterLinks(root)
    expect(r.frontmatterBarePaths.repaired).toHaveLength(1)
    const { frontmatter } = splitFrontmatter(read('initiatives/onboarding.md'))
    expect(frontmatter.owner).toBe('[Alice Park](../people/alice-park.md)')
  })

  it('reports (never guesses) a bare path that does not resolve to a real file', () => {
    write('a.md', '---\ntype: initiative\nowner: "./people/ghost.md"\n---\nbody\n')
    const before = read('a.md')
    const r = migrateFrontmatterLinks(root)
    expect(r.frontmatterBarePaths.broken).toHaveLength(1)
    expect(read('a.md')).toBe(before)
  })

  it('leaves an ALREADY-migrated markdown-link value untouched (not a bare path)', () => {
    write('people/alice.md', '---\ntype: person\n---\n')
    write('a.md', '---\ntype: initiative\nowner: "[Alice](./people/alice.md)"\n---\nbody\n')
    const before = read('a.md')
    const r = migrateFrontmatterLinks(root)
    expect(r.frontmatterWikilinks.repaired).toHaveLength(0)
    expect(r.frontmatterBarePaths.repaired).toHaveLength(0)
    expect(read('a.md')).toBe(before)
  })
})

describe('migrateFrontmatterLinks (ENH-266) — (c) prose-BODY wikilinks', () => {
  beforeEach(() => write('_index.md', okfIndex()))

  it('rewrites a leftover body wikilink (e.g. authored in Obsidian) to a markdown link', () => {
    write('people/alice.md', '---\ntype: person\n---\n')
    write('notes/n.md', '---\ntype: note\n---\nSee [[Alice]] for details.\n')
    const r = migrateFrontmatterLinks(root)
    expect(r.bodyWikilinks.repaired).toHaveLength(1)
    expect(read('notes/n.md')).toContain('[Alice](../people/alice.md)')
    expect(read('notes/n.md')).not.toContain('[[')
  })

  it('reports ambiguous/broken body wikilinks without guessing', () => {
    write('people/alice.md', '---\ntype: person\n---\n')
    write('themes/alice.md', '---\ntype: theme\n---\n')
    write('notes/n.md', '---\ntype: note\n---\nSee [[Alice]] and [[Nobody]].\n')
    const before = read('notes/n.md')
    const r = migrateFrontmatterLinks(root)
    expect(r.bodyWikilinks.ambiguous).toHaveLength(1)
    expect(r.bodyWikilinks.broken).toHaveLength(1)
    expect(read('notes/n.md')).toBe(before)
  })
})

describe('migrateFrontmatterLinks (ENH-266) — (d) alias backfill', () => {
  beforeEach(() => write('_index.md', okfIndex()))

  // NOTE: "Alice Park" slugs to "alice-park" — a title/filename SPLIT needs
  // the filename to differ from that slug (simulating the D6 slug-collision
  // `-2` suffix filing.ts appends, or a manual rename), else there's nothing
  // to backfill (the slug already matches).

  it('backfills an empty flow-array aliases field', () => {
    write('people/alice-park-2.md', '---\ntype: person\ntitle: Alice Park\naliases: []\n---\n')
    const r = migrateFrontmatterLinks(root)
    expect(r.aliasBackfills).toEqual([{ fromRel: 'people/alice-park-2.md', title: 'Alice Park' }])
    const { frontmatter } = splitFrontmatter(read('people/alice-park-2.md'))
    expect(frontmatter.aliases).toEqual(['Alice Park'])
  })

  it('backfills a non-empty flow-array aliases field (appends)', () => {
    write('people/alice-park-2.md', '---\ntype: person\ntitle: Alice Park\naliases: ["AP"]\n---\n')
    migrateFrontmatterLinks(root)
    const { frontmatter } = splitFrontmatter(read('people/alice-park-2.md'))
    expect(frontmatter.aliases).toEqual(['AP', 'Alice Park'])
  })

  it('backfills a block-list aliases field (appends a new item)', () => {
    write('people/alice-park-2.md', '---\ntype: person\ntitle: Alice Park\naliases:\n  - "AP"\n---\n')
    migrateFrontmatterLinks(root)
    const { frontmatter } = splitFrontmatter(read('people/alice-park-2.md'))
    expect(frontmatter.aliases).toEqual(['AP', 'Alice Park'])
  })

  it('inserts a fresh aliases field when none exists', () => {
    write('people/alice-park-2.md', '---\ntype: person\ntitle: Alice Park\n---\n')
    migrateFrontmatterLinks(root)
    const { frontmatter } = splitFrontmatter(read('people/alice-park-2.md'))
    expect(frontmatter.aliases).toEqual(['Alice Park'])
  })

  it('does NOT backfill when the title already matches the slug filename', () => {
    write('people/alice-park.md', '---\ntype: person\ntitle: Alice Park\n---\n') // slug matches
    // "Alice Park" slugs to "alice-park" which IS the basename — no backfill needed.
    const r = migrateFrontmatterLinks(root)
    expect(r.aliasBackfills).toEqual([])
  })

  it('does NOT re-add a title already present in aliases', () => {
    write('people/alice-park-2.md', '---\ntype: person\ntitle: Alice Park\naliases: ["Alice Park"]\n---\n')
    const r = migrateFrontmatterLinks(root)
    expect(r.aliasBackfills).toEqual([])
  })

  it('NEVER touches the root OKF marker file, even when its title/slug split qualifies', () => {
    // The root index's title ("My Vault") differs from its slug/basename
    // ("_index") — this WOULD qualify for alias backfill by the plain rule,
    // but the marker's frontmatter must stay byte-preserved (the D4 marker +
    // the listings generator's source-hash staleness key).
    const before = read('_index.md')
    const r = migrateFrontmatterLinks(root)
    expect(r.aliasBackfills.some((a) => a.fromRel === '_index.md')).toBe(false)
    expect(read('_index.md')).toBe(before)
  })
})
