// ENH-221 — FileHistoryService unit tests. Pure node-env: a temp store root
// per test, no Electron. Exercises the contract the CLI + future History panel
// depend on: dedupe of no-op saves, autosave coalescing, distinct timeline
// points for agent/restore edits, capping, blob GC, and faithful read-back.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  FileHistoryService,
  MAX_SNAPSHOTS_PER_FILE,
  COALESCE_WINDOW_MS
} from './file-history-service'

const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)

describe('FileHistoryService', () => {
  let root: string
  let svc: FileHistoryService
  let target: string // the user's file path (only used as a key; never written)

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-filehist-test-'))
    svc = new FileHistoryService(root)
    target = path.join(root, 'fixture.md')
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('captures a first snapshot and reads it back faithfully', async () => {
    const snap = await svc.capture(target, '# hello', { source: 'save' })
    expect(snap).not.toBeNull()
    expect(snap!.source).toBe('save')
    expect(snap!.size).toBe(7)
    const list = await svc.list(target)
    expect(list).toHaveLength(1)
    expect(dec(await svc.read(target, snap!.id))).toBe('# hello')
  })

  it('skips a no-op save (identical content to newest)', async () => {
    await svc.capture(target, 'same', { source: 'save' })
    const dup = await svc.capture(target, 'same', { source: 'save' })
    expect(dup).toBeNull()
    expect(await svc.list(target)).toHaveLength(1)
  })

  it('coalesces consecutive autosaves into one moving checkpoint', async () => {
    await svc.capture(target, 'v1', { source: 'save' })
    await svc.capture(target, 'v2', { source: 'save' })
    await svc.capture(target, 'v3', { source: 'save' })
    const list = await svc.list(target)
    // All three within the coalesce window → one entry, holding the latest state.
    expect(list).toHaveLength(1)
    expect(dec(await svc.read(target, list[0].id))).toBe('v3')
  })

  it('does NOT coalesce across sources — agent/restore edits are distinct points', async () => {
    await svc.capture(target, 'user typing', { source: 'save' })
    await svc.capture(target, 'agent rewrite', { source: 'agent' })
    await svc.capture(target, 'user typing again', { source: 'save' })
    const list = await svc.list(target)
    expect(list).toHaveLength(3)
    expect(list.map(s => s.source)).toEqual(['save', 'agent', 'save'])
  })

  it('coalescing respects the time window (stale prior save is not collapsed)', async () => {
    const old = await svc.capture(target, 'old', { source: 'save' })
    // Backdate the stored snapshot beyond the coalesce window, then capture again.
    const idxFile = path.join(root, 'index', (await fs.readdir(path.join(root, 'index')))[0])
    const idx = JSON.parse(await fs.readFile(idxFile, 'utf8'))
    idx.snapshots[0].ts = old!.ts - (COALESCE_WINDOW_MS + 1000)
    await fs.writeFile(idxFile, JSON.stringify(idx))
    await svc.capture(target, 'new', { source: 'save' })
    expect(await svc.list(target)).toHaveLength(2)
  })

  it('caps retained snapshots and prunes oldest, GCing orphan blobs', async () => {
    // Force every capture to be a distinct, non-coalesced point by alternating
    // source so coalescing never fires; unique content keeps hashes distinct.
    const total = MAX_SNAPSHOTS_PER_FILE + 25
    for (let i = 0; i < total; i++) {
      await svc.capture(target, `content #${i}`, { source: i % 2 === 0 ? 'save' : 'agent' })
    }
    const list = await svc.list(target)
    expect(list).toHaveLength(MAX_SNAPSHOTS_PER_FILE)
    // Newest survives; the very first was pruned.
    expect(dec(await svc.read(target, list[list.length - 1].id))).toBe(`content #${total - 1}`)
    expect(await svc.read(target, list[0].id)).not.toBeNull()
    // Orphan blobs were GC'd — blob count tracks the retained snapshot count.
    const blobDir = path.join(root, 'blobs', (await fs.readdir(path.join(root, 'blobs')))[0])
    const blobs = await fs.readdir(blobDir)
    expect(blobs.length).toBe(MAX_SNAPSHOTS_PER_FILE)
  })

  it('read accepts either the snapshot id or its content hash', async () => {
    const snap = await svc.capture(target, 'byhash', { source: 'save' })
    expect(dec(await svc.read(target, snap!.hash))).toBe('byhash')
    expect(dec(await svc.read(target, snap!.id))).toBe('byhash')
  })

  it('returns null for unknown snapshot ids and empty list for unknown files', async () => {
    expect(await svc.read(target, 'nope')).toBeNull()
    expect(await svc.list(path.join(root, 'never-touched.md'))).toEqual([])
  })

  it('keeps separate histories per file path', async () => {
    const other = path.join(root, 'other.md')
    await svc.capture(target, 'A', { source: 'save' })
    await svc.capture(other, 'B', { source: 'save' })
    expect(dec(await svc.read(target, (await svc.list(target))[0].id))).toBe('A')
    expect(dec(await svc.read(other, (await svc.list(other))[0].id))).toBe('B')
  })

  it('survives a corrupt index by starting fresh (never blocks a save)', async () => {
    await svc.capture(target, 'first', { source: 'save' })
    const idxFile = path.join(root, 'index', (await fs.readdir(path.join(root, 'index')))[0])
    await fs.writeFile(idxFile, '{ this is not valid json')
    // Must not throw; treats the file as having no history and appends.
    const snap = await svc.capture(target, 'second', { source: 'save' })
    expect(snap).not.toBeNull()
    expect(await svc.list(target)).toHaveLength(1)
  })
})
