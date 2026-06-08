// ENH-191 P3-S9 — cross-module routing integration. The item-12 shared-state
// fan-out rides the EXISTING broadcastAll (window-resolve.ts, shipped P2) — the
// only P3 invariant whose mechanism needs no new module. This pins the contract
// end-to-end against the REAL WindowRegistry + window-resolve: a class-ii
// broadcast reaches EVERY registered window, and an only()-routed "fan-out"
// THROWS at N>1 so it can never silently under-deliver to one window. Pure
// node-env; reuses the window-resolve.test.ts fakeCtx shape.

import { describe, it, expect, vi } from 'vitest'
import { WindowRegistry, type WindowContext } from './window-registry'
import { broadcastAll, resolveDefault } from './window-resolve'

function fakeCtx(id: number): WindowContext {
  return {
    id,
    window: {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: vi.fn() },
    },
  }
}

describe('routing integration — shared-state fan-out (ENH-191 P3-S9)', () => {
  it('broadcastAll repaints EVERY registered window (the item-12 fan-out trigger)', () => {
    const reg = new WindowRegistry()
    const a = fakeCtx(1)
    const b = fakeCtx(2)
    reg.register(a)
    reg.register(b)
    broadcastAll(reg, 'projects:changed', { pins: ['/x'] })
    expect(a.window.webContents.send).toHaveBeenCalledWith('projects:changed', { pins: ['/x'] })
    expect(b.window.webContents.send).toHaveBeenCalledWith('projects:changed', { pins: ['/x'] })
  })

  // NEGATIVE CONTROL: routing a class-ii broadcast through resolveDefault (the
  // WRONG path) at N>1 reaches ONLY the primary window — proving a shared-state
  // fan-out must use broadcastAll, never resolveDefault, or the second window
  // is starved. (P0–P4 made this THROW; P5a's non-throwing resolveDefault makes
  // the under-delivery — not a crash — the thing this control guards against.)
  it('a default-routed fan-out under-delivers at N>1 (only the primary window is hit)', () => {
    const reg = new WindowRegistry()
    const a = fakeCtx(1)
    const b = fakeCtx(2)
    reg.register(a)
    reg.register(b)
    resolveDefault(reg)?.webContents.send('projects:changed', {})
    expect(a.window.webContents.send).toHaveBeenCalledTimes(1) // primary only
    expect(b.window.webContents.send).not.toHaveBeenCalled() // second window starved
  })

  it('at N=1 broadcastAll and the default path hit the same sole window', () => {
    const reg = new WindowRegistry()
    const only = fakeCtx(1)
    reg.register(only)
    broadcastAll(reg, 'projects:changed', { pins: [] })
    resolveDefault(reg)?.webContents.send('nav:reveal', '/p')
    expect(only.window.webContents.send).toHaveBeenCalledWith('projects:changed', { pins: [] })
    expect(only.window.webContents.send).toHaveBeenCalledWith('nav:reveal', '/p')
  })
})
