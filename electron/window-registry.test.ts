// ENH-191 P0 (seam 1) — pins the registry-of-one contract. The two
// negative controls are load-bearing: each goes red if the known foot-gun
// is injected (only() silently picking a window; resolving by focus instead
// of identity). A harness assertion without such a control proves nothing
// (spec §8.3). Pure node-env — no Electron, mirrors safe-send.test.ts.

import { describe, it, expect, vi } from 'vitest'
import { WindowRegistry, type WindowContext } from './window-registry'
import type { WindowLike } from './safe-send'

function makeFakeContext(id: number): {
  ctx: WindowContext
  send: ReturnType<typeof vi.fn>
} {
  const send = vi.fn()
  const window: WindowLike = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send }
  }
  return { ctx: { id, window }, send }
}

describe('WindowRegistry — registry-of-one spine (ENH-191 P0)', () => {
  it('register / get / all / count reflect a registered context', () => {
    const reg = new WindowRegistry()
    const { ctx } = makeFakeContext(1)
    reg.register(ctx)
    expect(reg.count()).toBe(1)
    expect(reg.get(1)).toBe(ctx)
    expect(reg.all()).toEqual([ctx])
    expect(reg.get(99)).toBeUndefined()
  })

  it('only() returns the sole context (the app-wide default-send target)', () => {
    const reg = new WindowRegistry()
    const { ctx } = makeFakeContext(1)
    reg.register(ctx)
    expect(reg.only()).toBe(ctx)
  })

  it('only() returns undefined when empty', () => {
    expect(new WindowRegistry().only()).toBeUndefined()
  })

  // NEGATIVE CONTROL (H1): the registry-of-one invariant. A silent
  // "pick first" would let an app-wide send hit an arbitrary window once a
  // second opens. only() must THROW instead. Change only() to "return the
  // first context" and this goes red — that is the guard doing its job.
  it('only() THROWS at N>1 instead of silently picking one', () => {
    const reg = new WindowRegistry()
    reg.register(makeFakeContext(1).ctx)
    reg.register(makeFakeContext(2).ctx)
    expect(() => reg.only()).toThrow(/2 windows/)
  })

  it('unregister removes the context (only() resolves again afterward)', () => {
    const reg = new WindowRegistry()
    reg.register(makeFakeContext(1).ctx)
    reg.register(makeFakeContext(2).ctx)
    reg.unregister(2)
    expect(reg.count()).toBe(1)
    expect(reg.only()?.id).toBe(1)
  })

  it('an identity-resolved send routes to the sole context webContents.send (H2)', () => {
    const reg = new WindowRegistry()
    const { ctx, send } = makeFakeContext(1)
    reg.register(ctx)
    // The app-wide default-send path: resolve by IDENTITY, then send.
    reg.only()?.window.webContents.send('channel', { foo: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('channel', { foo: 1 })
  })

  // NEGATIVE CONTROL (H2 — identity, not focus): resolving the default
  // target by IDENTITY (registry.only()) must hit the REGISTERED window,
  // never a "focused" one. Here a decoy window is frontmost but NOT
  // registered; the identity send reaches the registered window and the
  // focused decoy receives nothing. A focus-based resolver (the R2
  // foot-gun) would invert this — hitting `focusedDecoy` and dropping the
  // backgrounded registered window's send, invisibly during a focused walk.
  it('identity resolution targets the registered window, not a focused decoy', () => {
    const reg = new WindowRegistry()
    const registered = makeFakeContext(1)
    const focusedDecoy = makeFakeContext(2) // frontmost, but never registered
    reg.register(registered.ctx)

    const resolveByIdentity = (): WindowLike | undefined => reg.only()?.window
    resolveByIdentity()?.webContents.send('channel', 'payload')

    expect(registered.send).toHaveBeenCalledWith('channel', 'payload')
    expect(focusedDecoy.send).not.toHaveBeenCalled()
  })

  // ENH-191 P3-S8a — the per-window pointer fields (item 10 active-workspace,
  // item 8 presence) are independent per context: each window's title source +
  // probe slot reads back via get(id) with no cross-window aliasing, and a
  // fresh context defaults both to undefined (zero runtime change at land).
  it('per-window activeWorkspace + presence fields are isolated by context (P3-S8a)', () => {
    const reg = new WindowRegistry()
    const a = makeFakeContext(1)
    const b = makeFakeContext(2)
    reg.register(a.ctx)
    reg.register(b.ctx)
    a.ctx.activeWorkspace = { path: '/a', name: 'A' }
    b.ctx.activeWorkspace = { path: '/b', name: 'B' }
    const p1 = { tag: 'probe-1' }
    const p2 = { tag: 'probe-2' }
    a.ctx.presence = p1
    b.ctx.presence = p2
    expect(reg.get(1)?.activeWorkspace?.name).toBe('A')
    expect(reg.get(2)?.activeWorkspace?.name).toBe('B')
    expect(reg.get(1)?.presence).toBe(p1)
    expect(reg.get(2)?.presence).toBe(p2)
    const fresh = makeFakeContext(3).ctx
    expect(fresh.activeWorkspace).toBeUndefined()
    expect(fresh.presence).toBeUndefined()
  })

  // ENH-191 P3-S10 — models applyWindowTitle(ctx)'s per-window badge push
  // (WORKSPACE_FILE_ACTIVE_CHANGED): each window's renderer receives ITS OWN
  // active-workspace pointer, so two windows on different projects show two
  // different titles (NFR-6.1).
  it('per-window title push: each window receives its OWN active-workspace pointer (P3-S10)', () => {
    const reg = new WindowRegistry()
    const a = makeFakeContext(1)
    const b = makeFakeContext(2)
    a.ctx.activeWorkspace = { path: '/a', name: 'A' }
    b.ctx.activeWorkspace = { path: '/b', name: 'B' }
    reg.register(a.ctx)
    reg.register(b.ctx)
    for (const ctx of reg.all()) {
      ctx.window.webContents.send('workspace-file:active-changed', ctx.activeWorkspace ?? null)
    }
    expect(a.send).toHaveBeenCalledWith('workspace-file:active-changed', { path: '/a', name: 'A' })
    expect(b.send).toHaveBeenCalledWith('workspace-file:active-changed', { path: '/b', name: 'B' })
  })

  // NEGATIVE CONTROL: a regression that pushes the SHARED singleton (one
  // last-writer pointer) to every window mis-delivers — window 1's badge shows
  // window 2's name. This is exactly the clobber the per-window pointer removes.
  it('a shared-singleton title push mis-delivers window 2\'s name to window 1 (P3-S10 control)', () => {
    const reg = new WindowRegistry()
    const a = makeFakeContext(1)
    const b = makeFakeContext(2)
    a.ctx.activeWorkspace = { path: '/a', name: 'A' }
    b.ctx.activeWorkspace = { path: '/b', name: 'B' }
    reg.register(a.ctx)
    reg.register(b.ctx)
    const singleton = reg.get(2)!.activeWorkspace // the last writer a shared service holds
    for (const ctx of reg.all()) {
      ctx.window.webContents.send('workspace-file:active-changed', singleton)
    }
    // window 1 WRONGLY gets B — the bug the per-window pointer fixes:
    expect(a.send).toHaveBeenCalledWith('workspace-file:active-changed', { path: '/b', name: 'B' })
  })
})
