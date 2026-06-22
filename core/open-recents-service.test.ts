import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { OpenRecentsService, MAX_RECENTS } from './open-recents-service'

let dir: string
let svc: OpenRecentsService

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-recents-'))
  svc = new OpenRecentsService(dir)
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('OpenRecentsService', () => {
  it('empty before any record', async () => {
    expect(await svc.list()).toEqual([])
  })

  it('records and lists an entry', async () => {
    await svc.record({ target: '~/a.md', label: 'a.md', kind: 'local' }, 1000)
    const list = await svc.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ target: '~/a.md', label: 'a.md', kind: 'local', lastOpenedAt: 1000 })
  })

  it('lists most-recent-first', async () => {
    await svc.record({ target: 'a', label: 'a', kind: 'local' }, 1000)
    await svc.record({ target: 'b', label: 'b', kind: 'local' }, 3000)
    await svc.record({ target: 'c', label: 'c', kind: 'local' }, 2000)
    expect((await svc.list()).map((r) => r.target)).toEqual(['b', 'c', 'a'])
  })

  it('dedupes by target — re-opening moves to front + refreshes label/time', async () => {
    await svc.record({ target: 'x', label: 'old', kind: 'local' }, 1000)
    await svc.record({ target: 'y', label: 'y', kind: 'local' }, 2000)
    await svc.record({ target: 'x', label: 'new', kind: 'local' }, 3000)
    const list = await svc.list()
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ target: 'x', label: 'new', lastOpenedAt: 3000 })
    expect(list[1].target).toBe('y')
  })

  it(`caps at ${MAX_RECENTS}`, async () => {
    for (let i = 0; i < MAX_RECENTS + 5; i++) {
      await svc.record({ target: `t${i}`, label: `t${i}`, kind: 'local' }, 1000 + i)
    }
    const list = await svc.list()
    expect(list).toHaveLength(MAX_RECENTS)
    // The newest MAX_RECENTS survive; the oldest five aged out.
    expect(list[0].target).toBe(`t${MAX_RECENTS + 4}`)
    expect(list.some((r) => r.target === 't0')).toBe(false)
  })

  it('preserves mixed kinds (github + local + url)', async () => {
    await svc.record({ target: 'https://github.com/o/r/blob/main/R.md', label: 'o/r › R.md', kind: 'github-file' }, 1000)
    await svc.record({ target: 'https://github.com/o/r', label: 'o/r', kind: 'github-repo' }, 2000)
    await svc.record({ target: 'https://example.com', label: 'example.com', kind: 'url' }, 3000)
    expect((await svc.list()).map((r) => r.kind)).toEqual(['url', 'github-repo', 'github-file'])
  })

  it('clear() empties the list', async () => {
    await svc.record({ target: 'a', label: 'a', kind: 'local' }, 1000)
    await svc.clear()
    expect(await svc.list()).toEqual([])
  })

  it('survives a corrupt file (returns [])', async () => {
    await fs.writeFile(path.join(dir, 'open-recents.json'), '{ not json')
    expect(await svc.list()).toEqual([])
  })

  it('drops malformed entries defensively', async () => {
    const file = path.join(dir, 'open-recents.json')
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        recents: [
          { target: 'good', label: 'good', kind: 'local', lastOpenedAt: 5 },
          { target: '', label: 'empty-target', kind: 'local', lastOpenedAt: 6 },
          { label: 'no-target', kind: 'local', lastOpenedAt: 7 },
          { target: 'badkind', label: 'x', kind: 'nope', lastOpenedAt: 8 },
        ],
      })
    )
    const list = await svc.list()
    expect(list.map((r) => r.target)).toEqual(['good'])
  })

  it('persists across service instances (same dir)', async () => {
    await svc.record({ target: 'a', label: 'a', kind: 'local' }, 1000)
    const svc2 = new OpenRecentsService(dir)
    expect((await svc2.list()).map((r) => r.target)).toEqual(['a'])
  })
})
