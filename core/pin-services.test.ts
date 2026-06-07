// Phase H (ENH-191 Cut 0) — interleave-safety for the shared on-disk
// pin writers. These exercise the REAL services (not just the queue
// primitive) against a temp dir via the injectable `baseDir`.
//
// The proof: fire two concurrent toggles of DIFFERENT entries. Without
// serialization each toggle reads the same (empty) list, adds only its
// own entry, and writes a one-element list — the second write clobbers
// the first, so only ONE survives. With the Phase H queue, both survive.
// (Reverting the `enqueue(...)` wrapper in any service turns these red,
// which is the negative control — see write-queue.test.ts for the pure,
// always-present lost-update control.)

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { NavPinsService } from './nav-pins-service'
import { PinsService } from './pins-service'
import { ProjectsService } from './projects-service'

describe('Phase H — pin-service write serialization (interleave safety)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-phaseH-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('NavPinsService: two concurrent toggles of different pins both survive', async () => {
    const svc = new NavPinsService(dir)
    await Promise.all([
      svc.toggle({ path: '/a', kind: 'file' }),
      svc.toggle({ path: '/b', kind: 'file' }),
    ])
    const list = await svc.list()
    expect(list.map((p) => p.path).sort()).toEqual(['/a', '/b'])
  })

  it('PinsService: two concurrent toggles of different pins both survive', async () => {
    const svc = new PinsService(dir)
    await Promise.all([
      svc.toggle({ kind: 'file', ref: '/a', title: 'a' }),
      svc.toggle({ kind: 'file', ref: '/b', title: 'b' }),
    ])
    const list = await svc.list()
    expect(list.map((p) => p.ref).sort()).toEqual(['/a', '/b'])
  })

  it('ProjectsService: two concurrent togglePins both survive', async () => {
    const svc = new ProjectsService(dir)
    await Promise.all([svc.togglePin('/a'), svc.togglePin('/b')])
    const file = await svc.read()
    expect([...file.pins].sort()).toEqual(['/a', '/b'])
  })

  it('write uses a unique tmp — no orphaned .duo.tmp remains after a write', async () => {
    const svc = new NavPinsService(dir)
    await svc.toggle({ path: '/a', kind: 'file' })
    const entries = await fs.readdir(dir)
    expect(entries).toEqual(['nav-pins.json'])
  })
})
