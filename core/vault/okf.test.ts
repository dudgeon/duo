// ENH-216 OKF Vault Mode — the headline matrix (U9).
//
// One consolidated, end-to-end-flavored suite that pins the OKF contract a
// reviewer (or a regression) is most likely to break: the node-free link
// helper (slug / rel-link / extract / serialize round-trip), mode detection
// (the in-vault marker, the okf-wins tie-break), the OKF scaffold (marker +
// listing fence + type-stamp + id + okf-default), the move/relink engine
// (clean-path inbound rewrite, out-of-band repair by id-then-slug), the
// static listings (section-6 bullets + byte-identical frontmatter on regen),
// promote (link, never an embed), and — the LOCK — the gesture-equivalent
// create: an OKF note ends up with a markdown link and ZERO double-open
// square brackets, ever (D3).
//
// Every fixture is an mkdtempSync throwaway; the frozen prototype vault
// (docs/research/graphbook-prototype) is NEVER mutated — its Obsidian-mode
// regression coverage lives in vault.test.ts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  slugStem,
  targetKey,
  relLink,
  serializeOkfLink,
  serializeWikilink,
  extractLinkRefs,
  extractLinkKeys,
} from '../markdown/vaultLinks'
import { detectVaultMode, isVaultRoot, readOkfVersion } from './detect'
import {
  initVault,
  captureNote,
  buildCorpus,
  loadTemplates,
  createEntityStub,
} from './index'
import { moveNote, relinkVault, ensureNoteId } from './move'
import { generateIndex, writeListings, promoteSection, LISTING_FENCE } from './listings'

// `[[` — built from char codes so this source file itself carries ZERO
// double-open-square-bracket literals (the very sequence the lock forbids in
// OKF output; keeping it out of the test source too means a crude grep for it
// across the OKF surface stays clean).
const WIKI_OPEN = String.fromCharCode(91, 91)

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-okf-'))
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

// ── slug ──────────────────────────────────────────────────────────────────

describe('slugStem (D6) — on-disk stem from a human name', () => {
  it('slugs spaces + casing to a path-safe hyphenated stem', () => {
    expect(slugStem('Customer Orders')).toBe('customer-orders')
  })

  it('is idempotent — slugging an already-slugged stem is a no-op', () => {
    const once = slugStem('Customer Orders')
    expect(slugStem(once)).toBe(once)
  })

  it('strips diacritics + folds underscores (char-strip parity with the key fold)', () => {
    expect(slugStem('Café_Notes Draft')).toBe('cafe-notes-draft')
  })

  it('caps to ~80 chars with no trailing hyphen', () => {
    const slug = slugStem('word '.repeat(40))
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('-')).toBe(false)
  })

  it('falls back to "note" for an empty / punctuation-only name', () => {
    expect(slugStem('')).toBe('note')
    expect(slugStem('::: !!!')).toBe('note')
  })
})

// ── rel-link + OKF serializer round-trip ─────────────────────────────────────

describe('relLink + serializeOkfLink (D3) — POSIX, ./-anchored, round-trips', () => {
  it('same-folder target is ./-anchored', () => {
    expect(relLink('notes/a.md', 'notes/b.md')).toBe('./b.md')
  })

  it('sibling folder climbs with ../', () => {
    expect(relLink('initiatives/q3.md', 'people/alice.md')).toBe('../people/alice.md')
  })

  it('descends into a nested folder with ./', () => {
    expect(relLink('index.md', 'people/team/alice.md')).toBe('./people/team/alice.md')
  })

  it('serializes a STANDARD markdown link with human display text, never a wikilink', () => {
    const link = serializeOkfLink('initiatives/q3.md', 'people/alice.md', 'Alice Park')
    expect(link).toBe('[Alice Park](../people/alice.md)')
    expect(link).not.toContain(WIKI_OPEN)
  })

  it('round-trips: serialize then extractLinkRefs yields a key matching the target slug', () => {
    const link = serializeOkfLink('initiatives/q3/plan.md', 'people/alice-park.md', 'Alice')
    const [ref] = extractLinkRefs(link)
    expect(ref.syntax).toBe('mdlink')
    expect(ref.key).toBe('alice-park')
    expect(ref.key).toBe(targetKey('people/alice-park.md', 'mdlink'))
  })
})

// ── extraction ──────────────────────────────────────────────────────────────

describe('extractLinkRefs — mixed syntax, drops, anchors, dedup', () => {
  it('yields a wikilink ref + an mdlink ref from a mixed string, in order', () => {
    const refs = extractLinkRefs(`See ${WIKI_OPEN}Customer Orders]] then [Alice](./people/alice.md).`)
    expect(refs.map((r) => r.syntax)).toEqual(['wikilink', 'mdlink'])
    expect(refs[0].key).toBe('customer-orders')
    expect(refs[1].key).toBe('alice')
  })

  it('drops external / image / pure-anchor links, keeps the in-vault one', () => {
    const text = [
      '[ext](https://example.com)',
      '[mail](mailto:a@b.com)',
      '[anchor](#sec)',
      '![img](./pic.png)',
      '[keep](./real.md)',
    ].join(' ')
    const refs = extractLinkRefs(text)
    expect(refs).toHaveLength(1)
    expect(refs[0].rawTarget).toBe('./real.md')
  })

  it('strips a #anchor before keying, and leaves %20 literal (no percent-decoding)', () => {
    // The #anchor is dropped from the key…
    const [ref] = extractLinkRefs('[X](./people/alice.md#decisions)')
    expect(ref.key).toBe('alice')
    // …but the key is pure string math (no URL-decode): a %20 stays literal,
    // so an href must already be slug-spelled (which our serializer guarantees)
    // to fold to the human-name key. This pins that contract.
    expect(targetKey('./customer%20orders.md#h', 'mdlink')).toBe('customer%20orders')
    expect(targetKey('./customer-orders.md#h', 'mdlink')).toBe('customer-orders')
  })

  it('dedups by key across syntaxes for extractLinkKeys (occurrences kept in extractLinkRefs)', () => {
    const text = `${WIKI_OPEN}Customer Orders]] [also](./customer-orders.md) ${WIKI_OPEN}Alice]]`
    expect(extractLinkKeys(text)).toEqual(['customer-orders', 'alice'])
    expect(extractLinkRefs(text)).toHaveLength(3) // no dedup here
  })
})

// ── mode detection (D4) ──────────────────────────────────────────────────────

describe('detectVaultMode (D4) — in-vault marker is the source of truth', () => {
  it('okf-only: a root index.md with okf_version → okf', () => {
    write('index.md', '---\nokf_version: "0.1"\ntype: index\n---\n')
    expect(detectVaultMode(root)).toBe('okf')
    expect(readOkfVersion(root)).toBe('0.1')
  })

  it('obsidian-only: a .obsidian/ dir → obsidian', () => {
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true })
    expect(detectVaultMode(root)).toBe('obsidian')
  })

  it('BOTH markers present → okf wins (the tie-break)', () => {
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true })
    write('index.md', '---\nokf_version: 1\ntype: index\n---\n')
    expect(detectVaultMode(root)).toBe('okf')
  })

  it('neither marker → null', () => {
    write('index.md', '---\ntitle: just a note\n---\nno okf_version here\n')
    expect(detectVaultMode(root)).toBeNull()
  })

  it('isVaultRoot widens to EITHER mode', () => {
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true })
    expect(isVaultRoot(root)).toBe(true)
    fs.rmSync(path.join(root, '.obsidian'), { recursive: true })
    write('index.md', '---\nokf_version: 2\ntype: index\n---\n')
    expect(isVaultRoot(root)).toBe(true)
  })

  it('the marker wins over any registry/prefs claim (mode is never cached)', () => {
    // A vault.json claiming a mode is irrelevant — detection reads the
    // in-vault marker live (D4). We assert by NOT consulting any registry:
    // an okf marker resolves okf regardless of what a sibling file says.
    write('vault.json', JSON.stringify({ mode: 'obsidian' }))
    write('index.md', '---\nokf_version: "0.1"\ntype: index\n---\n')
    expect(detectVaultMode(root)).toBe('okf')
  })
})

// ── OKF scaffold (D2/D4/D8/D10) ───────────────────────────────────────────────

describe('initVault — OKF scaffold + the D2 default flip', () => {
  it('defaults to okf (D2 — the dialog default; the CLI requires --format)', () => {
    const r = initVault(path.join(root, 'v'))
    expect(r.mode).toBe('okf')
    expect(detectVaultMode(r.root)).toBe('okf')
  })

  it('writes a root _index.md marker with okf_version + type:index + the listing fence, and NO README/bases', () => {
    const v = initVault(path.join(root, 'v')).root
    expect(fs.existsSync(path.join(v, 'README.md'))).toBe(false)
    expect(fs.existsSync(path.join(v, 'bases'))).toBe(false)
    expect(fs.existsSync(path.join(v, 'index.md'))).toBe(false) // ENH-245: not the legacy name
    const idx = fs.readFileSync(path.join(v, '_index.md'), 'utf8')
    expect(idx).toContain('okf_version:')
    expect(idx).toContain('type: index')
    expect(idx).toContain(LISTING_FENCE)
  })

  // ENH-266c — OKF mode now DOES carry a `.obsidian/` dir, but ONLY the
  // app.json Obsidian-compat seed (see obsidian-compat.test.ts for the
  // dedicated seed/respect/foreign-skip coverage).
  it('ENH-266c: OKF init seeds .obsidian/app.json with the two Obsidian-compat keys', () => {
    const v = initVault(path.join(root, 'v')).root
    expect(fs.readdirSync(path.join(v, '.obsidian'))).toEqual(['app.json'])
    expect(JSON.parse(fs.readFileSync(path.join(v, '.obsidian', 'app.json'), 'utf8'))).toEqual({
      useMarkdownLinks: true,
      newLinkFormat: 'relative',
    })
  })

  it('templates are type-stamped (the 6-type set, incl. rollup) and the corpus surfaces index too (D10)', () => {
    const v = initVault(path.join(root, 'v')).root
    expect(loadTemplates(v).map((t) => t.type).sort()).toEqual([
      'initiative',
      'meeting',
      'milestone',
      'person',
      'rollup',
      'theme',
    ])
    // The root index.md is itself an entity stamped type:index (D10), so the
    // entity-derived corpus carries it on top of the 6 template types (ENH-228).
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

  it('an OKF-mode capture stamps type:note + an id (D10)', () => {
    const v = initVault(path.join(root, 'v')).root
    const c = captureNote(v, { text: 'a thought', mode: 'okf', date: new Date('2026-06-09T14:32:05') })
    expect(c.type).toBe('note')
    const content = fs.readFileSync(c.absPath, 'utf8')
    expect(content).toMatch(/^---\nid: [0-9a-z]{8}\n/)
    expect(content).toContain('type: note')
  })

  it('an OKF-mode entity stub slugs the stem, stamps title + id (D6/D10)', () => {
    const v = initVault(path.join(root, 'v')).root
    const stub = createEntityStub(v, 'person', 'Customer Orders', { mode: 'okf' })
    expect(stub.path).toBe('people/customer-orders.md')
    const content = fs.readFileSync(stub.absPath, 'utf8')
    expect(content).toMatch(/^---\nid: [0-9a-z]{8}\n/)
    expect(content).toContain('type: person')
    expect(content).toContain('title: Customer Orders')
  })
})

// ── move + relink (D5/D10) ────────────────────────────────────────────────────

describe('moveNote — clean path (D5)', () => {
  function seed(): void {
    write('index.md', '---\nokf_version: 1\ntype: index\n---\n')
    write('people/alice.md', '---\nid: aaaa1111\ntype: person\n---\nReports to [Bob](./bob.md).\n')
    write('people/bob.md', '---\nid: bbbb2222\ntype: person\n---\nBob.\n')
    write('meetings/sync.md', '---\ntype: meeting\n---\nWith [Alice](../people/alice.md#notes).\n')
  }

  it('rewrites a sibling inbound link, byte-anchored, preserving the anchor', () => {
    seed()
    const r = moveNote(root, 'people/alice.md', 'team/alice-park.md')
    expect(r.inboundRewritten).toEqual([{ fromRel: 'meetings/sync.md', count: 1 }])
    expect(read('meetings/sync.md')).toContain('[Alice](../team/alice-park.md#notes)')
  })

  it("re-bases the moved note's own outbound links from its new home", () => {
    seed()
    const r = moveNote(root, 'people/alice.md', 'team/leads/alice.md')
    expect(r.outboundRebased).toBe(1)
    expect(read('team/leads/alice.md')).toContain('[Bob](../../people/bob.md)')
  })

  it('throws on a dest collision and never clobbers', () => {
    seed()
    expect(() => moveNote(root, 'people/alice.md', 'people/bob.md')).toThrow(/already exists/)
    expect(read('people/bob.md')).toContain('Bob.')
  })
})

describe('relinkVault — out-of-band repair (D5), id-then-slug', () => {
  it('repairs by stable id when the slug is ambiguous (id is the primary key, D10)', () => {
    write('index.md', '---\nokf_version: 1\ntype: index\n---\n')
    write('people/alice.md', '---\nid: aaaa1111\ntype: person\n---\nReal Alice.\n')
    write('archive/alice.md', '---\nid: bbbb2222\ntype: person\n---\nOld Alice.\n')
    write('m.md', '---\ntype: meeting\n---\nSee [aaaa1111](./old/alice.md).\n')
    const r = relinkVault(root)
    expect(r.repaired).toHaveLength(1)
    expect(r.repaired[0].via).toBe('id')
    expect(r.repaired[0].targetRel).toBe('people/alice.md')
  })

  it('repairs by slug fallback when unambiguous', () => {
    write('index.md', '---\nokf_version: 1\ntype: index\n---\n')
    write('people/customer-orders.md', '---\nid: cccc3333\ntype: note\n---\nOrders.\n')
    write('n.md', '---\ntype: note\n---\n[Orders](./docs/customer-orders.md)\n')
    const r = relinkVault(root)
    expect(r.repaired).toHaveLength(1)
    expect(r.repaired[0].via).toBe('slug')
    expect(read('n.md')).toContain('[Orders](./people/customer-orders.md)')
  })

  it('reports ambiguous (>1 candidate) and broken (0) without guessing', () => {
    write('index.md', '---\nokf_version: 1\ntype: index\n---\n')
    write('people/alice.md', '---\nid: a1\ntype: person\n---\nAlice.\n')
    write('archive/alice.md', '---\nid: a2\ntype: person\n---\nAlice.\n')
    write('m.md', '---\ntype: meeting\n---\n[Alice](./old/alice.md) and [Ghost](./nobody.md)\n')
    const r = relinkVault(root)
    expect(r.repaired).toHaveLength(0)
    expect(r.ambiguous).toHaveLength(1)
    expect(r.ambiguous[0].candidates).toEqual(['archive/alice.md', 'people/alice.md'])
    expect(r.broken).toHaveLength(1)
    expect(r.broken[0].oldHref).toBe('./nobody.md')
    expect(read('m.md')).toContain('[Alice](./old/alice.md)') // untouched
  })

  it('dryRun resolves + reports but writes nothing', () => {
    write('index.md', '---\nokf_version: 1\ntype: index\n---\n')
    write('people/customer-orders.md', '---\nid: c1\ntype: note\n---\nOrders.\n')
    write('m.md', '---\ntype: note\n---\n[Orders](./docs/customer-orders.md)\n')
    const before = read('m.md')
    const r = relinkVault(root, { dryRun: true })
    expect(r.repaired).toHaveLength(1)
    expect(read('m.md')).toBe(before)
  })

  it('ensureNoteId mints a stable ~8-char id, preserving the rest byte-wise, idempotently', () => {
    write('people/alice.md', '---\ntype: person\ntitle: Alice\n---\nbody\n')
    const abs = path.join(root, 'people/alice.md')
    const id = ensureNoteId(abs, root)
    expect(id).toMatch(/^[0-9a-z]{8}$/)
    expect(read('people/alice.md')).toBe(`---\nid: ${id}\ntype: person\ntitle: Alice\n---\nbody\n`)
    expect(ensureNoteId(abs, root)).toBe(id) // idempotent
  })
})

// ── static listings (D8) ──────────────────────────────────────────────────────

describe('generateIndex + writeListings (D8) — section-6 bullets, byte-identical frontmatter', () => {
  function makeOkf(): void {
    write('index.md', `---\nokf_version: 1\ntitle: My Vault\ntype: index\n---\n${LISTING_FENCE}\n`)
    write('people/alice.md', '---\ntype: person\ntitle: Alice Park\ndescription: A PM.\n---\nAlice.\n')
    write('themes/growth.md', '---\ntype: theme\ntitle: Growth\nsummary: The growth theme.\n---\nGrowth.\n')
  }

  it('groups by type into section-6 bullets with title + description', () => {
    makeOkf()
    const body = generateIndex(root, '')
    expect(body).toContain('## Person')
    expect(body).toContain('## Theme')
    expect(body).toContain('* [Alice Park](./people/alice.md) - A PM.')
    expect(body).toContain('* [Growth](./themes/growth.md) - The growth theme.')
  })

  it('regen body is idempotent', () => {
    makeOkf()
    expect(generateIndex(root, '')).toBe(generateIndex(root, ''))
  })

  it('writeListings preserves the okf_version frontmatter BYTE-IDENTICALLY on regen', () => {
    makeOkf()
    const fmBefore = read('index.md').match(/^---\n[\s\S]*?\n---\n/)![0]
    writeListings(root)
    const fmAfter1 = read('index.md').match(/^---\n[\s\S]*?\n---\n/)![0]
    writeListings(root)
    const fmAfter2 = read('index.md').match(/^---\n[\s\S]*?\n---\n/)![0]
    expect(fmAfter1).toBe(fmBefore) // marker bytes untouched
    expect(fmAfter2).toBe(fmBefore) // stable across re-runs
    // …and the body region is the regenerated listing under the shared fence.
    const body = read('index.md').slice(fmBefore.length)
    expect(body.startsWith(LISTING_FENCE)).toBe(true)
    expect(body).toContain('## Person')
  })

  it('throws in Obsidian mode (Obsidian stays byte-identical)', () => {
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true })
    write('people/alice.md', '---\ntype: person\n---\nAlice.\n')
    expect(() => writeListings(root)).toThrow(/OKF-mode only/)
  })
})

// ── promote (D9) ──────────────────────────────────────────────────────────────

describe('promoteSection (D9) — OKF md-link / Obsidian wikilink / never an embed', () => {
  it('OKF mode leaves a markdown link, never a wikilink, never an embed', () => {
    write('index.md', `---\nokf_version: 1\ntype: index\n---\n${LISTING_FENCE}\n`)
    write('templates/person.md', '---\ntype: person\nfolder: people\nrole:\n---\n')
    write('notes/braindump.md', '---\ntype: note\n---\nIntro.\n\n## Dana Wu\n\nDana is a designer.\n')
    const r = promoteSection(root, 'notes/braindump.md', 'Dana Wu', 'person')
    expect(r.leftLink).toMatch(/^\[Dana Wu\]\(/)
    expect(r.leftLink).not.toContain(WIKI_OPEN)
    expect(r.leftLink).not.toContain('![')
    const src = read('notes/braindump.md')
    expect(src).toContain(r.leftLink)
    expect(src).not.toContain('Dana is a designer.') // prose moved out
  })

  it('Obsidian mode leaves a wikilink', () => {
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true })
    write('templates/person.md', '---\ntype: person\nfolder: people\nrole:\n---\n')
    write('notes/braindump.md', '---\ntype: note\n---\n## Dana Wu\n\nDana is a designer.\n')
    const r = promoteSection(root, 'notes/braindump.md', 'Dana Wu', 'person')
    expect(r.leftLink).toBe(serializeWikilink('notes/braindump.md', 'people/Dana Wu.md', 'Dana Wu'))
    expect(r.leftLink).toContain(WIKI_OPEN)
  })
})

// ── THE LOCKED ROUND-TRIP (D3) ────────────────────────────────────────────────

describe('THE LOCK (D3) — a gesture-equivalent create persists a markdown link, never a wikilink', () => {
  it('an OKF note linked via the resolve-on-gesture serializer contains a markdown link and ZERO double-open square brackets', () => {
    const v = initVault(path.join(root, 'v')).root // OKF default
    // Two real OKF entities (slugged stems, ids minted).
    const source = createEntityStub(v, 'person', 'Customer Orders', { mode: 'okf' })
    const target = createEntityStub(v, 'person', 'Alice Park', { mode: 'okf' })
    // The wikilink GESTURE is INPUT-ONLY (D3): on resolve, OKF mode writes a
    // STANDARD markdown relative link. We exercise the at-rest serializer that
    // the resolve step calls and write it into the source note's body.
    const resolved = serializeOkfLink(source.path, target.path, 'Alice Park')
    fs.appendFileSync(source.absPath, `\nSee ${resolved}\n`)

    const onDisk = fs.readFileSync(source.absPath, 'utf8')
    // It IS a markdown link…
    const refs = extractLinkRefs(onDisk)
    expect(refs.some((r) => r.syntax === 'mdlink' && r.key === 'alice-park')).toBe(true)
    // …and there is NOT a single double-open-square-bracket sequence anywhere
    // in the persisted note (no wikilink ever survives in OKF mode).
    expect(onDisk.includes(WIKI_OPEN)).toBe(false)
  })
})
