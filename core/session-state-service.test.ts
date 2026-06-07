// ENH-191 P4 (seam 5) — SessionStateService against the v2 windows envelope.
// Real fs into an isolated temp dir (the on-disk path is injectable) so the
// ACTUAL migrate / compose / atomic-write / backup path is exercised — no fs
// mocking. The load-bearing tests are CONCURRENT-FLUSH (two windows' overlapping
// saves both survive the single composed writer — the C8 data-corruption gate)
// and its NEGATIVE CONTROL (a per-window writer that composes only its own
// window loses the other). Pure node-env.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { SessionStateService } from './session-state-service'
import type { SessionState, ActiveWorkspace } from '../shared/types'

type RawEnvelope = {
  version: number
  windows: Array<{ windowId: number; navigatorPath: string }>
}

function flat(over: Partial<SessionState> = {}): SessionState {
  return {
    version: 1,
    savedAt: '2026-06-07T00:00:00Z',
    appVersion: '0.9.2',
    terminals: [],
    activeTerminalIndex: -1,
    browserTabs: [],
    activeBrowserIndex: -1,
    fileTabs: [],
    activeWorking: null,
    navigatorPath: '',
    aux: null,
    ...over,
  }
}

describe('SessionStateService — v2 envelope persistence (ENH-191 P4 seam 5)', () => {
  let dir: string
  let file: string
  let svc: SessionStateService

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-session-test-'))
    file = path.join(dir, 'session-state.json')
    svc = new SessionStateService(file)
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  async function readRaw(p = file): Promise<RawEnvelope> {
    return JSON.parse(await fs.readFile(p, 'utf8')) as RawEnvelope
  }

  it('save + flush writes a v2 envelope (downgrade invariant: an old v1 reader rejects version:2)', async () => {
    svc.save(flat({ navigatorPath: '/proj' }), 1)
    await svc.flush()
    const doc = await readRaw()
    // version:2 → an old build's `parsed.version !== 1` guard returns empty
    // (NFR-8.2 — no crash, no destructive overwrite on downgrade).
    expect(doc.version).toBe(2)
    expect(doc.windows).toHaveLength(1)
    expect(doc.windows[0].navigatorPath).toBe('/proj')
  })

  it('load() migrates an on-disk v1 flat doc to a flat SessionState (round-trip)', async () => {
    const v1 = flat({
      navigatorPath: '/v1',
      terminals: [{ cwd: '/x', kind: 'shell', title: 't' }],
      activeTerminalIndex: 0,
    })
    await fs.writeFile(file, JSON.stringify(v1, null, 2))
    const loaded = await svc.load()
    expect(loaded.version).toBe(1) // renderer + .duo-workspace contract stays flat v1
    expect(loaded.navigatorPath).toBe('/v1')
    expect(loaded.terminals).toEqual(v1.terminals)
    expect(loaded.activeTerminalIndex).toBe(0)
  })

  it('load() reads a v2 envelope and returns the sole/first window flat', async () => {
    svc.save(flat({ navigatorPath: '/w1' }), 1)
    await svc.flush()
    const fresh = new SessionStateService(file) // simulate a relaunch
    const loaded = await fresh.load()
    expect(loaded.version).toBe(1)
    expect(loaded.navigatorPath).toBe('/w1')
  })

  it('load() on an unknown schema version returns empty (graceful)', async () => {
    await fs.writeFile(file, JSON.stringify({ version: 99, junk: true }))
    const loaded = await svc.load()
    expect(loaded.terminals).toEqual([])
    expect(loaded.navigatorPath).toBe('')
  })

  it('load() on a missing file returns empty (first launch)', async () => {
    const loaded = await svc.load()
    expect(loaded.terminals).toEqual([])
    expect(loaded.browserTabs).toEqual([])
  })

  it("CONCURRENT FLUSH — two windows' overlapping saves both survive the single composed writer", async () => {
    svc.save(flat({ navigatorPath: '/win1' }), 1)
    svc.save(flat({ navigatorPath: '/win2' }), 2) // both saved before any flush completes
    await svc.flush()
    const doc = await readRaw()
    const byId = Object.fromEntries(doc.windows.map((w) => [w.windowId, w.navigatorPath]))
    expect(byId[1]).toBe('/win1')
    expect(byId[2]).toBe('/win2') // window 2 NOT clobbered (the C8/C13 fix)
    expect(doc.windows).toHaveLength(2)
  })

  it('CONCURRENT FLUSH — a save arriving DURING an in-flight flush survives (reschedule)', async () => {
    svc.save(flat({ navigatorPath: '/a' }), 1)
    const inFlight = svc.flush() // starts; writing=true, yields at the first await
    svc.save(flat({ navigatorPath: '/b' }), 2) // lands while the flush is in flight
    await inFlight
    await svc.flush() // drain any rescheduled change
    const doc = await readRaw()
    expect(doc.windows).toHaveLength(2) // both windows present — no lost update
  })

  it('NEGATIVE CONTROL — a per-window writer (composes ONLY its own window) loses the other', async () => {
    // Models the bug P4 forbids: each window has its OWN writer that persists
    // only its own state to the shared file. The second write clobbers the
    // first — exactly what the single composed writer above prevents.
    const w1 = new SessionStateService(file)
    w1.save(flat({ navigatorPath: '/win1' }), 1)
    await w1.flush()
    const w2 = new SessionStateService(file) // a separate writer that only knows window 2
    w2.save(flat({ navigatorPath: '/win2' }), 2)
    await w2.flush()
    const doc = await readRaw()
    expect(doc.windows).toHaveLength(1) // DATA LOSS — only one window survived
    expect(doc.windows[0].navigatorPath).toBe('/win2')
    // Contrast: the correct single composed writer (one service holding both
    // windows) keeps both — proven by the concurrent-flush test above.
  })

  it('v1.bak — the pre-migration v1 doc is backed up once before the first v2 write', async () => {
    const v1 = flat({ navigatorPath: '/legacy' })
    await fs.writeFile(file, JSON.stringify(v1, null, 2))

    svc.save(flat({ navigatorPath: '/new' }), 1)
    await svc.flush()

    expect((await readRaw()).version).toBe(2) // main file migrated to v2
    const bak = await readRaw(file + '.v1.bak') // backup holds the ORIGINAL v1
    expect(bak.version).toBe(1)
    expect((bak as unknown as { navigatorPath: string }).navigatorPath).toBe('/legacy')

    // write-once: a second flush must NOT overwrite the backup with v2 content
    svc.save(flat({ navigatorPath: '/newer' }), 1)
    await svc.flush()
    const bak2 = await readRaw(file + '.v1.bak')
    expect(bak2.version).toBe(1)
    expect((bak2 as unknown as { navigatorPath: string }).navigatorPath).toBe('/legacy')
  })

  it('does not back up when there is no pre-existing v1 file (fresh install)', async () => {
    svc.save(flat({ navigatorPath: '/fresh' }), 1)
    await svc.flush()
    await expect(fs.access(file + '.v1.bak')).rejects.toBeTruthy() // no backup created
  })

  it('seam 6 — folds the per-window active-workspace pointer into the envelope (round-trips via loadWindows)', async () => {
    const aw: ActiveWorkspace = { path: '/p.duo-workspace', name: 'Proj' }
    svc.setActiveWorkspaceResolver((id) => (id === 1 ? aw : null))
    svc.save(flat({ navigatorPath: '/p' }), 1)
    await svc.flush()
    const windows = await new SessionStateService(file).loadWindows()
    expect(windows[0].activeWorkspace).toEqual(aw)
  })

  it('seam 6 — a cleared workspace (resolver returns null) persists as null, not the stale value', async () => {
    let current: ActiveWorkspace | null = { path: '/p.duo-workspace', name: 'Proj' }
    svc.setActiveWorkspaceResolver(() => current)
    svc.save(flat(), 1)
    await svc.flush()
    current = null // user cleared the workspace
    svc.save(flat({ navigatorPath: '/x' }), 1)
    await svc.flush()
    const windows = await new SessionStateService(file).loadWindows()
    expect(windows[0].activeWorkspace).toBeNull()
  })

  it('seam 6 — aux round-trips per window through the envelope (item 8 / auxTabId)', async () => {
    const aux = { paths: ['/x.md', '/y.md'], activeIndex: 1, splitPct: 0.5 }
    svc.save(flat({ aux }), 1)
    await svc.flush()
    const windows = await new SessionStateService(file).loadWindows()
    expect(windows[0].aux).toEqual(aux)
  })
})
