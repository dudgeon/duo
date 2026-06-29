// ENH-191 P5a (S1) — SettingsService against a real temp file (injectable
// path). The load-bearing assertion is the DEFAULT: multiWindow is ON when
// there's no settings file (owner decision — multi-window on by default), and
// a corrupt / wrong-typed file degrades to the default rather than wiping it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { SettingsService, DEFAULT_SETTINGS } from './settings-service'

describe('SettingsService (ENH-191 P5a S1)', () => {
  let dir: string
  let file: string
  let svc: SettingsService

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-settings-test-'))
    file = path.join(dir, 'settings.json')
    svc = new SettingsService(file)
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('defaults multiWindow ON when there is no settings file (owner decision)', async () => {
    const loaded = await svc.load()
    expect(loaded.multiWindow).toBe(true)
    expect(DEFAULT_SETTINGS.multiWindow).toBe(true)
  })

  it('set persists and round-trips across a fresh instance', async () => {
    await svc.set({ multiWindow: false })
    const reloaded = new SettingsService(file)
    expect((await reloaded.load()).multiWindow).toBe(false)
  })

  it('get() returns the cached value after load (synchronous read)', async () => {
    await svc.set({ multiWindow: false })
    expect(svc.get().multiWindow).toBe(false)
    expect(new SettingsService(file).get().multiWindow).toBe(true) // pre-load = default
  })

  it('a corrupt file degrades to defaults (not a throw, not a wipe)', async () => {
    await fs.writeFile(file, '{ this is not json')
    expect((await svc.load()).multiWindow).toBe(true)
  })

  it('a wrong-typed field falls back to the default for that field', async () => {
    await fs.writeFile(file, JSON.stringify({ multiWindow: 'yes-please' }))
    expect((await svc.load()).multiWindow).toBe(true)
  })

  it('get() returns a copy — callers cannot mutate the internal cache', async () => {
    await svc.load()
    const snap = svc.get()
    snap.multiWindow = false
    expect(svc.get().multiWindow).toBe(true)
  })

  // ENH-240 — frontmatter-panel default: expanded ON by default (owner
  // decision), persists, and a wrong-typed value degrades to the default.
  it('defaults frontmatterDefaultExpanded ON (expanded) with no settings file', async () => {
    const loaded = await svc.load()
    expect(loaded.frontmatterDefaultExpanded).toBe(true)
    expect(DEFAULT_SETTINGS.frontmatterDefaultExpanded).toBe(true)
  })

  it('frontmatterDefaultExpanded persists across a fresh instance', async () => {
    await svc.set({ frontmatterDefaultExpanded: false })
    const reloaded = new SettingsService(file)
    expect((await reloaded.load()).frontmatterDefaultExpanded).toBe(false)
  })

  it('a wrong-typed frontmatterDefaultExpanded falls back to the default (true)', async () => {
    await fs.writeFile(file, JSON.stringify({ frontmatterDefaultExpanded: 'nope' }))
    expect((await svc.load()).frontmatterDefaultExpanded).toBe(true)
  })
})
