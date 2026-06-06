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
})
