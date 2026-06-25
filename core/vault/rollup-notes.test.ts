// ENH-228 — the `type: rollup` lifecycle layer: discovery (listRollups),
// render-target resolution (resolveRollupNote), and surgical provenance
// stamping (stampRollupProvenance).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initVault } from './scaffold'
import { listRollups, resolveRollupNote, stampRollupProvenance } from './rollup-notes'
import { sourceHash } from './render'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-rollup-notes-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function write(v: string, rel: string, content: string): string {
  const abs = path.join(v, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}

describe('listRollups (ENH-228 D1 — a type query, not an artifact scan)', () => {
  it('returns [] for a vault with no rollups/ folder', () => {
    const v = initVault(path.join(root, 'v')).root
    expect(listRollups(v)).toEqual([])
  })

  it('discovers type:rollup notes; flags fresh vs stale vs never-rendered; excludes artifacts', () => {
    const v = initVault(path.join(root, 'v')).root
    // sourceHash skips rollups/, so writing rollup notes never perturbs it —
    // capture it once and stamp the "fresh" note with it.
    const hash = sourceHash(v)

    write(v, 'rollups/fresh.md',
      `---\ntype: rollup\ntitle: Fresh\nformat: html\nout: rollups/fresh.html\n` +
      `last_generated: "2026-06-01T00:00:00.000Z"\nlast_hash: "${hash}"\n---\n`)
    write(v, 'rollups/stale.md',
      `---\ntype: rollup\ntitle: Stale\nformat: html\nout: rollups/stale.html\n` +
      `last_generated: "2026-05-01T00:00:00.000Z"\nlast_hash: "deadbeef0000"\n---\n`)
    write(v, 'rollups/new.md', `---\ntype: rollup\ntitle: Brand New\nformat: html\n---\n`)
    // A rendered HTML artifact (excluded by the .md-only read) + a rendered
    // .md artifact (no type: → excluded by the type filter). Neither is a note.
    write(v, 'rollups/fresh.html', '<html><body>rendered</body></html>')
    write(v, 'rollups/report.md', `---\ntitle: rendered\ngenerated: x\nsource_hash: y\n---\n# a rollup artifact`)

    const list = listRollups(v)
    // sorted by title; only the three real type:rollup notes
    expect(list.map((r) => r.title)).toEqual(['Brand New', 'Fresh', 'Stale'])

    const fresh = list.find((r) => r.title === 'Fresh')!
    expect(fresh.stale).toBe(false)
    expect(fresh.out).toBe('rollups/fresh.html')
    expect(fresh.format).toBe('html')
    expect(fresh.note).toBe('rollups/fresh.md')

    const stale = list.find((r) => r.title === 'Stale')!
    expect(stale.stale).toBe(true)

    const brandNew = list.find((r) => r.title === 'Brand New')!
    expect(brandNew.stale).toBe(true) // never rendered → always stale
    expect(brandNew.last_hash).toBeNull()
    expect(brandNew.out).toBeNull()
  })

  it('infers format md from the out extension when format: is absent', () => {
    const v = initVault(path.join(root, 'v')).root
    write(v, 'rollups/md-one.md', `---\ntype: rollup\ntitle: MD\nout: rollups/md-one.md\nlast_hash: "x"\n---\n`)
    // Note: out points at a `.md` artifact whose name differs from the note,
    // so the note isn't its own artifact (no clobber).
    const r = listRollups(v).find((x) => x.title === 'MD')!
    expect(r.format).toBe('md')
  })
})

describe('resolveRollupNote', () => {
  it('resolves a type:rollup note by slug, by rel path; null for non-rollup / missing', () => {
    const v = initVault(path.join(root, 'v')).root
    write(v, 'rollups/tasks.md',
      `---\ntype: rollup\ntitle: My Tasks\nformat: html\nout: rollups/tasks.html\nspec: bases/tasks.base\n---\n`)

    const bySlug = resolveRollupNote(v, 'tasks')
    expect(bySlug).not.toBeNull()
    expect(bySlug!.slug).toBe('tasks')
    expect(bySlug!.title).toBe('My Tasks')
    expect(bySlug!.format).toBe('html')
    expect(bySlug!.outRel).toBe('rollups/tasks.html')
    expect(bySlug!.specPath).toBe('bases/tasks.base')
    expect(bySlug!.noteRel).toBe('rollups/tasks.md')

    expect(resolveRollupNote(v, 'rollups/tasks.md')!.slug).toBe('tasks')

    write(v, 'people/alice.md', `---\ntype: person\n---\n`)
    expect(resolveRollupNote(v, 'people/alice.md')).toBeNull()
    expect(resolveRollupNote(v, 'does-not-exist')).toBeNull()
  })

  it('defaults format to html (D2) and specPath to null for an embedded-block rollup', () => {
    const v = initVault(path.join(root, 'v')).root
    write(v, 'rollups/embedded.md', `---\ntype: rollup\ntitle: E\n---\n\n## Spec\n`)
    const r = resolveRollupNote(v, 'embedded')!
    expect(r.format).toBe('html')
    expect(r.specPath).toBeNull()
    expect(r.outRel).toBeNull()
  })
})

describe('stampRollupProvenance (surgical + idempotent — §D9-clean)', () => {
  it('updates only out/last_generated/last_hash; preserves other keys + body; idempotent', () => {
    const v = initVault(path.join(root, 'v')).root
    const body = '\n## Spec\n\n```base\nfilters:\n  and:\n    - type == "milestone"\n```\n\nAuthor notes here.\n'
    const abs = write(v, 'rollups/r.md',
      `---\ntype: rollup\ntitle: R\nspec:\nformat: html\nout:\nlast_generated:\nlast_hash:\n---${body}`)

    stampRollupProvenance(abs, {
      last_generated: '2026-06-24T10:00:00.000Z',
      last_hash: 'abc123def456',
      out: 'rollups/r.html',
    })
    const after = fs.readFileSync(abs, 'utf8')

    expect(after).toContain('last_generated: "2026-06-24T10:00:00.000Z"')
    expect(after).toContain('last_hash: "abc123def456"')
    expect(after).toContain('out: "rollups/r.html"')
    // other frontmatter keys preserved
    expect(after).toContain('type: rollup')
    expect(after).toContain('title: R')
    // body byte-preserved (heading, base block, prose)
    expect(after).toContain('## Spec')
    expect(after).toContain('type == "milestone"')
    expect(after).toContain('Author notes here.')
    // exactly ONE of each provenance key (no duplicate appended)
    expect(after.match(/^last_hash:/gm)!).toHaveLength(1)
    expect(after.match(/^out:/gm)!).toHaveLength(1)

    // Idempotent — re-stamping the same values is a byte no-op.
    const snapshot = fs.readFileSync(abs, 'utf8')
    stampRollupProvenance(abs, {
      last_generated: '2026-06-24T10:00:00.000Z',
      last_hash: 'abc123def456',
      out: 'rollups/r.html',
    })
    expect(fs.readFileSync(abs, 'utf8')).toBe(snapshot)
  })

  it('appends provenance keys when the note lacks them', () => {
    const v = initVault(path.join(root, 'v')).root
    const abs = write(v, 'rollups/r2.md', `---\ntype: rollup\ntitle: R2\n---\n\nbody\n`)
    stampRollupProvenance(abs, { last_generated: 'T', last_hash: 'H', out: 'rollups/r2.html' })
    const after = fs.readFileSync(abs, 'utf8')
    expect(after).toContain('last_generated: "T"')
    expect(after).toContain('out: "rollups/r2.html"')
    expect(after).toContain('title: R2')
    expect(after).toContain('body')
  })
})
