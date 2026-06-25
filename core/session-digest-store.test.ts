// ENH-231 — SessionDigestStore persistence tests.
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { SessionDigestStore } from './session-digest-store'
import type { SessionDigest } from '../shared/types'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-digest-store-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const digest = (uuid: string): SessionDigest => ({
  uuid,
  cwd: '/repo',
  goal: 'g',
  youAsked: 'y',
  todos: [],
  files: [],
  artifacts: {},
  attention: null,
  state: 'done',
  gitBranch: null,
  lastActivityAt: 1000,
})

describe('SessionDigestStore', () => {
  it('load on a missing file yields an empty cache', async () => {
    const store = new SessionDigestStore(path.join(dir, 'session-digests.json'))
    await store.load()
    expect(store.snapshot().size).toBe(0)
  })

  it('persists across instances (set → reload)', async () => {
    const file = path.join(dir, 'session-digests.json')
    const a = new SessionDigestStore(file)
    await a.load()
    await a.setDigest('u1', digest('u1'))
    await a.whenIdle()

    const b = new SessionDigestStore(file)
    await b.load()
    expect(b.getDigest('u1')?.goal).toBe('g')
  })

  it('delete removes the entry and persists', async () => {
    const file = path.join(dir, 'session-digests.json')
    const a = new SessionDigestStore(file)
    await a.load()
    await a.setDigest('u1', digest('u1'))
    await a.setDigest('u2', digest('u2'))
    await a.deleteDigest('u1')
    await a.whenIdle()

    const b = new SessionDigestStore(file)
    await b.load()
    expect(b.getDigest('u1')).toBeUndefined()
    expect(b.getDigest('u2')).toBeDefined()
  })

  it('tolerates a corrupt file by starting empty', async () => {
    const file = path.join(dir, 'session-digests.json')
    await fs.writeFile(file, '{ this is not json', 'utf8')
    const store = new SessionDigestStore(file)
    await store.load()
    expect(store.snapshot().size).toBe(0)
  })

  it('serializes concurrent writes without losing updates', async () => {
    const file = path.join(dir, 'session-digests.json')
    const a = new SessionDigestStore(file)
    await a.load()
    await Promise.all([
      a.setDigest('u1', digest('u1')),
      a.setDigest('u2', digest('u2')),
      a.setDigest('u3', digest('u3')),
    ])
    await a.whenIdle()

    const b = new SessionDigestStore(file)
    await b.load()
    expect(b.snapshot().size).toBe(3)
  })

  it('snapshot returns a copy (mutating it does not affect the store)', async () => {
    const store = new SessionDigestStore(path.join(dir, 'session-digests.json'))
    await store.load()
    await store.setDigest('u1', digest('u1'))
    const snap = store.snapshot()
    snap.delete('u1')
    expect(store.getDigest('u1')).toBeDefined()
  })
})
