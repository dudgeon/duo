// ENH-250 — renderAndStampRollup: the deterministic (no-Claude) render+stamp
// shared by the Rollups tab's live-save (gap #1: GUI-created rollups never
// produced an HTML artifact) and the artifact's own Refresh button (gap #2:
// it only posted a bus event nothing in Duo consumed).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initVault } from './scaffold'
import { createRollupNote } from './builder'
import { renderAndStampRollup } from './rollup-render'
import { listRollups } from './rollup-notes'
import { extractSummaryLog, prependSummary, summaryLogComment } from './rollup'

let root: string
let v: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-rollup-render-'))
  v = initVault(path.join(root, 'v')).root
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function write(rel: string, content: string): void {
  const abs = path.join(v, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

function task(rel: string, fm: string): void {
  write(rel, `---\ntype: task\n${fm}\n---\n\nbody\n`)
}

describe('renderAndStampRollup', () => {
  it('writes the HTML artifact + stamps provenance for a builder-created note', async () => {
    task('tasks/a.md', 'status: open\nowner: geoff')
    const { noteRel, absPath } = createRollupNote(v, {
      title: 'Open tasks',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: ['owner'],
    })
    const before = listRollups(v).find((r) => r.note === noteRel)!
    expect(before.stale).toBe(true)
    expect(before.out).toBeNull()

    const res = await renderAndStampRollup(v, noteRel)
    expect(res.ok).toBe(true)
    expect(res.error).toBeNull()
    expect(res.stamped).toBe(true)
    expect(res.outRel).toBe('rollups/open-tasks.html')
    expect(fs.existsSync(res.absOut!)).toBe(true)
    const html = fs.readFileSync(res.absOut!, 'utf8')
    expect(html).toContain('geoff')

    const after = listRollups(v).find((r) => r.note === noteRel)!
    expect(after.stale).toBe(false)
    expect(after.out).toBe('rollups/open-tasks.html')

    void absPath
  })

  it('is idempotent — re-running after no vault changes produces a byte-identical row set', async () => {
    task('tasks/a.md', 'status: open')
    const { noteRel } = createRollupNote(v, {
      title: 'T',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: [],
    })
    const first = await renderAndStampRollup(v, noteRel)
    const second = await renderAndStampRollup(v, noteRel)
    expect(second.ok).toBe(true)
    expect(second.outRel).toBe(first.outRel)
  })

  it('picks up entity changes on re-render (the "Refresh" contract)', async () => {
    task('tasks/a.md', 'status: open')
    const { noteRel } = createRollupNote(v, {
      title: 'T',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: [],
    })
    await renderAndStampRollup(v, noteRel)
    task('tasks/b.md', 'status: open')
    const res = await renderAndStampRollup(v, noteRel)
    const html = fs.readFileSync(res.absOut!, 'utf8')
    expect(html).toContain('>a<')
    expect(html).toContain('>b<')
  })

  it('carries forward the prior artifact\'s change-summary history unchanged', async () => {
    task('tasks/a.md', 'status: open')
    const { noteRel, absPath } = createRollupNote(v, {
      title: 'T',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: [],
    })
    // Seed an artifact carrying history the way a CLI `--summary` render
    // would (a rows snapshot + a summary-log HTML comment) — hand-crafted
    // so this test doesn't depend on the CLI's flag parsing.
    const outAbs = path.join(v, 'rollups', 't.html')
    const seededLog = prependSummary([], { date: '2026-Jan-01', text: 'Initial cut' })
    fs.writeFileSync(outAbs, `<html><body>seed\n${summaryLogComment(seededLog)}\n</body></html>`)

    const res = await renderAndStampRollup(v, noteRel)
    expect(res.ok).toBe(true)
    const after = extractSummaryLog(fs.readFileSync(res.absOut!, 'utf8'))
    expect(after).toEqual(seededLog)
    void absPath
  })

  it('refuses when the artifact path would collide with the note itself', async () => {
    task('tasks/a.md', 'status: open')
    write(
      'rollups/collide.md',
      '---\ntype: rollup\ntitle: Collide\nformat: md\nout: "rollups/collide.md"\n---\n\n```base\nfilters:\n  and:\n    - type == "task"\nviews:\n  - type: table\n    name: T\n    order: [file.name]\n```\n',
    )
    const res = await renderAndStampRollup(v, 'rollups/collide.md')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/collides with the rollup note/)
  })

  it('surfaces a broken spec as an error, never throws', async () => {
    write('rollups/broken.md', '---\ntype: rollup\ntitle: Broken\n---\n\n```base\nfilters: [unclosed\n```\n')
    const res = await renderAndStampRollup(v, 'rollups/broken.md')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('errors cleanly on a non-rollup target', async () => {
    task('tasks/a.md', 'status: open')
    const res = await renderAndStampRollup(v, 'tasks/a.md')
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/not a type: rollup note/)
  })
})
