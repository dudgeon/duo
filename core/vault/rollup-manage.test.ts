// ENH-248 — the gap-batch core functions: R6 lifecycle (delete/duplicate),
// R2 artifact introspection (rollupArtifactInfo), R7 per-type counts +
// ad-hoc type views, R8 GitHub-blob entity links in the HTML artifact.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initVault } from './scaffold'
import { createRollupNote, modelViewData } from './builder'
import { renderAndStampRollup } from './rollup-render'
import {
  deleteRollup,
  duplicateRollup,
  listRollups,
  resolveRollupNote,
  rollupArtifactInfo,
} from './rollup-notes'
import { isVaultRoot } from './detect'
import { buildCorpus } from './corpus'
import { renderTarget } from './render'

let root: string
let v: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-rollup-manage-'))
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

async function makeRenderedRollup(title = 'Open tasks'): Promise<string> {
  task('tasks/a.md', 'status: open\nowner: geoff')
  task('tasks/b.md', 'status: done\nowner: sam')
  const { noteRel } = createRollupNote(v, {
    title,
    types: ['task'],
    groupBy: ['status'],
    buckets: [],
    filters: [],
    columns: ['owner'],
  })
  const res = await renderAndStampRollup(v, noteRel)
  expect(res.ok).toBe(true)
  return noteRel
}

describe('deleteRollup (R6)', () => {
  it('removes the note AND its rendered artifact', async () => {
    const noteRel = await makeRenderedRollup()
    const artifactAbs = path.join(v, 'rollups/open-tasks.html')
    expect(fs.existsSync(artifactAbs)).toBe(true)

    const res = deleteRollup(v, noteRel)
    expect(res.ok).toBe(true)
    expect(res.deleted).toEqual([noteRel, 'rollups/open-tasks.html'])
    expect(fs.existsSync(path.join(v, noteRel))).toBe(false)
    expect(fs.existsSync(artifactAbs)).toBe(false)
    expect(listRollups(v)).toHaveLength(0)
  })

  it('deletes a never-rendered note (no artifact) cleanly', () => {
    const { noteRel } = createRollupNote(v, {
      title: 'Bare',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: [],
    })
    const res = deleteRollup(v, noteRel)
    expect(res.ok).toBe(true)
    expect(res.deleted).toEqual([noteRel])
  })

  it('refuses a non-rollup target', () => {
    task('tasks/a.md', 'status: open')
    const res = deleteRollup(v, 'tasks/a.md')
    expect(res.ok).toBe(false)
    expect(fs.existsSync(path.join(v, 'tasks/a.md'))).toBe(true)
  })

  it('reports ok:true with an error when the note is removed but the artifact removal fails', async () => {
    const noteRel = await makeRenderedRollup()
    const artifactAbs = path.join(v, 'rollups/open-tasks.html')
    // Simulate an undeletable artifact (locked / permission-denied): swap it
    // for a directory so the unconditional fs.rmSync (no `recursive`) throws.
    fs.rmSync(artifactAbs)
    fs.mkdirSync(artifactAbs)

    const res = deleteRollup(v, noteRel)
    expect(res.ok).toBe(true)
    expect(res.deleted).toEqual([noteRel])
    expect(res.error).toBeTruthy()
    expect(fs.existsSync(path.join(v, noteRel))).toBe(false)
    expect(fs.existsSync(artifactAbs)).toBe(true)
  })
})

describe('duplicateRollup (R6)', () => {
  it('copies with "(copy)" title and STRIPS provenance', async () => {
    const noteRel = await makeRenderedRollup()
    const res = duplicateRollup(v, noteRel)
    expect(res.ok).toBe(true)
    expect(res.note).toBe('rollups/open-tasks-copy.md')

    const copy = resolveRollupNote(v, res.note!)!
    expect(copy.title).toBe('Open tasks (copy)')
    expect(copy.outRel).toBeNull()
    expect(copy.frontmatter.last_hash).toBeUndefined()
    expect(copy.frontmatter.last_generated).toBeUndefined()
    // The original keeps its provenance untouched.
    const orig = resolveRollupNote(v, noteRel)!
    expect(orig.outRel).toBe('rollups/open-tasks.html')
    // The copy lists as never-rendered (stale) — its own render stamps it.
    const listed = listRollups(v).find((r) => r.note === res.note)!
    expect(listed.stale).toBe(true)
  })

  it('uniquifies the slug on repeat', async () => {
    const noteRel = await makeRenderedRollup()
    expect(duplicateRollup(v, noteRel).note).toBe('rollups/open-tasks-copy.md')
    expect(duplicateRollup(v, noteRel).note).toBe('rollups/open-tasks-copy-2.md')
  })
})

describe('rollupArtifactInfo (R2)', () => {
  it('matches a rendered artifact path back to its rollup + freshness', async () => {
    const noteRel = await makeRenderedRollup()
    const artifactAbs = path.join(v, 'rollups/open-tasks.html')
    const info = rollupArtifactInfo(artifactAbs, isVaultRoot)
    expect(info).not.toBeNull()
    expect(info!.vaultRoot).toBe(v)
    expect(info!.note).toBe(noteRel)
    expect(info!.title).toBe('Open tasks')
    expect(info!.stale).toBe(false)
    expect(info!.legacyTemplate).toBe(false)
    // A note edit flips staleness on the NEXT probe (live read, no cache).
    task('tasks/c.md', 'status: open')
    expect(rollupArtifactInfo(artifactAbs, isVaultRoot)!.stale).toBe(true)
  })

  it('returns null for a non-artifact file and for files outside any vault', async () => {
    await makeRenderedRollup()
    expect(rollupArtifactInfo(path.join(v, 'tasks/a.md'), isVaultRoot)).toBeNull()
    const outside = path.join(root, 'elsewhere.html')
    fs.writeFileSync(outside, '<html></html>')
    expect(rollupArtifactInfo(outside, isVaultRoot)).toBeNull()
  })

  it('flags a pre-R2 artifact still carrying the old embedded Refresh button', async () => {
    await makeRenderedRollup()
    const artifactAbs = path.join(v, 'rollups/open-tasks.html')
    const legacy = fs
      .readFileSync(artifactAbs, 'utf8')
      .replace(
        '<div class="rl-toolbar">',
        '<div class="rl-toolbar">\n<button class="rl-btn" type="button" data-duo-action="duo:event" data-event="rollup:refresh">Refresh</button>',
      )
    fs.writeFileSync(artifactAbs, legacy)
    expect(rollupArtifactInfo(artifactAbs, isVaultRoot)!.legacyTemplate).toBe(true)
  })
})

describe('countsByType + modelViewData (R7)', () => {
  it('counts entities per type live', () => {
    task('tasks/a.md', 'status: open')
    task('tasks/b.md', 'status: done')
    write('people/geoff.md', '---\ntype: person\n---\n\nhi\n')
    const corpus = buildCorpus(v)
    expect(corpus.countsByType.task).toBe(2)
    expect(corpus.countsByType.person).toBe(1)
  })

  it('evaluates an ad-hoc single-type model with no note behind it', () => {
    task('tasks/a.md', 'status: open\nowner: geoff')
    task('tasks/b.md', 'status: done\nowner: sam')
    const data = modelViewData(v, {
      title: 'task',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: ['owner', 'status'],
    })
    expect(data.error).toBeNull()
    expect(data.note).toBe('')
    expect(data.rows).toHaveLength(2)
    expect(data.rows.map((r) => r.cells.owner).sort()).toEqual(['geoff', 'sam'])
  })
})

describe('GitHub link mode (R8)', () => {
  it('renders entity links as blob URLs when a github base is supplied', () => {
    task('tasks/a.md', 'status: open')
    // Vault-as-repo-root: relPath from the (real) worktree root is the
    // vault-relative path. No git needed — the base is pre-probed input.
    const github = {
      remote: 'git@github.com:owner/repo.git',
      branch: 'main',
      workTreeRootReal: (fs.realpathSync.native ?? fs.realpathSync)(v),
    }
    const { noteRel } = createRollupNote(v, {
      title: 'GH',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: [],
    })
    const resolved = resolveRollupNote(v, noteRel)!
    const result = renderTarget(v, resolved.noteRel, {
      outDir: path.join(v, 'rollups'),
      embedSnapshot: true,
      github,
    })
    expect(result.html).toContain('https://github.com/owner/repo/blob/main/tasks/a.md')
    // Without the base, the same render stays relative.
    const rel = renderTarget(v, resolved.noteRel, {
      outDir: path.join(v, 'rollups'),
      embedSnapshot: true,
    })
    expect(rel.html).toContain('href="../tasks/a.md"')
    expect(rel.html).not.toContain('github.com')
  })

  it('renderAndStampRollup honors `links: github` frontmatter (falls back without a repo)', async () => {
    // No git repo here — the probe returns null and the render degrades to
    // relative links rather than failing.
    task('tasks/a.md', 'status: open')
    const { noteRel, absPath } = createRollupNote(v, {
      title: 'Linked',
      types: ['task'],
      groupBy: [],
      buckets: [],
      filters: [],
      columns: [],
    })
    const raw = fs.readFileSync(absPath, 'utf8')
    fs.writeFileSync(absPath, raw.replace('---\n', '---\nlinks: github\n'))
    expect(resolveRollupNote(v, noteRel)!.links).toBe('github')
    const res = await renderAndStampRollup(v, noteRel)
    expect(res.ok).toBe(true)
    expect(fs.readFileSync(res.absOut!, 'utf8')).toContain('href="../tasks/a.md"')
  })
})
