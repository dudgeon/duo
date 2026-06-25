// ENH-231 — HomeStateStore (Duo-owned annotations + watermark) tests.
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { HomeStateStore } from './home-state-store'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-home-state-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('HomeStateStore', () => {
  it('round-trips note / next / reviewedAt + watermark', async () => {
    const file = path.join(dir, 'home-state.json')
    const a = new HomeStateStore(file)
    await a.load()
    await a.setNote('u1', 'shipped the rotation')
    await a.setNext('u1', 'review PR #214')
    await a.markReviewed('u2', 1234)
    await a.setWatermark(9999)
    await a.whenIdle()

    const b = new HomeStateStore(file)
    await b.load()
    expect(b.getAnnotation('u1')).toMatchObject({ note: 'shipped the rotation', next: 'review PR #214' })
    expect(b.getAnnotation('u2')?.reviewedAt).toBe(1234)
    expect(b.getWatermark()).toBe(9999)
  })

  it('clearing the last payload field drops the annotation row', async () => {
    const file = path.join(dir, 'home-state.json')
    const a = new HomeStateStore(file)
    await a.load()
    await a.setNote('u1', 'temp')
    await a.setNote('u1', '') // empty → remove
    await a.whenIdle()
    expect(a.getAnnotation('u1')).toBeUndefined()
  })

  it('tolerates a corrupt file by starting empty', async () => {
    const file = path.join(dir, 'home-state.json')
    await fs.writeFile(file, 'not json', 'utf8')
    const store = new HomeStateStore(file)
    await store.load()
    expect(store.snapshot().size).toBe(0)
    expect(store.getWatermark()).toBeUndefined()
  })

  it('is independent of the digest cache (separate file, §D9 boundary)', async () => {
    const file = path.join(dir, 'home-state.json')
    const a = new HomeStateStore(file)
    await a.load()
    await a.setNote('u1', 'narrative that is NOT in any transcript')
    await a.whenIdle()
    // The annotation persists on its own file with no digest dependency.
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(raw.annotations[0]).toMatchObject({ uuid: 'u1', note: 'narrative that is NOT in any transcript' })
  })
})
