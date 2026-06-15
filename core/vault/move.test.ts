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
} from './move'

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

  it('dryRun resolves + reports but writes nothing', () => {
    write('people/customer-orders.md', '---\nid: c1\ntype: note\n---\nOrders.\n')
    write('m.md', '---\ntype: note\n---\n[Orders](./docs/customer-orders.md)\n')
    const before = read('m.md')
    const r = relinkVault(root, { dryRun: true })
    expect(r.repaired).toHaveLength(1)
    expect(read('m.md')).toBe(before) // unchanged
  })
})
