// ENH-191 P2 (seam 1) — pins the send-taxonomy resolution contract (harness
// assertion H2 + the class-(ii) fan-out), with the two load-bearing negative
// controls: a focus-resolved default send (the getFocusedWindow foot-gun) and
// an only()-on-a-broadcast mis-route must BOTH be unrepresentable. Pure
// node-env, mirrors safe-send.test.ts (fake WindowLike) + uses the real
// WindowRegistry (it's pure — no Electron).

import { describe, it, expect, vi } from 'vitest'
import { WindowRegistry, type WindowContext } from './window-registry'
import { resolveDefault, resolveBySender, resolveAll, broadcastAll } from './window-resolve'

function fakeCtx(
  id: number,
  opts: { destroyed?: boolean; wcDestroyed?: boolean } = {}
): WindowContext {
  return {
    id,
    window: {
      isDestroyed: () => opts.destroyed ?? false,
      webContents: {
        isDestroyed: () => opts.wcDestroyed ?? false,
        send: vi.fn(),
      },
    },
  }
}

describe('window-resolve — the send taxonomy (ENH-191 P2)', () => {
  // ---- resolveDefault (class i) -------------------------------------------
  it('resolveDefault returns the sole window and a send routes to it (H2 positive)', () => {
    const reg = new WindowRegistry()
    const ctx = fakeCtx(1)
    reg.register(ctx)
    const win = resolveDefault(reg)
    expect(win).toBe(ctx.window)
    win!.webContents.send('nav:reveal', '/p')
    expect(ctx.window.webContents.send).toHaveBeenCalledWith('nav:reveal', '/p')
    expect(ctx.window.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('resolveDefault returns undefined when no window is registered', () => {
    expect(resolveDefault(new WindowRegistry())).toBeUndefined()
  })

  // NEGATIVE CONTROL (the getFocusedWindow foot-gun): at N>1 there is no single
  // "the window", so resolveDefault must THROW rather than silently pick the
  // focused/first one. A variant that resolved by focus would return a window
  // here instead of throwing — this pins that it can't.
  it('resolveDefault THROWS at N>1 — no silent focus/first pick (H2 negative control)', () => {
    const reg = new WindowRegistry()
    reg.register(fakeCtx(1))
    reg.register(fakeCtx(2))
    expect(() => resolveDefault(reg)).toThrow(/all\(\) \(broadcast\) or get\(id\)/)
  })

  // ---- resolveBySender (class iii) ----------------------------------------
  it('resolveBySender returns the addressed window; a foreign id returns undefined', () => {
    const reg = new WindowRegistry()
    const ctx = fakeCtx(7)
    reg.register(ctx)
    expect(resolveBySender(reg, 7)).toBe(ctx.window)
    expect(resolveBySender(reg, 999)).toBeUndefined()
  })

  // ---- resolveAll / broadcastAll (class ii) -------------------------------
  it('broadcastAll fans out to EVERY registered window (taxonomy positive)', () => {
    const reg = new WindowRegistry()
    const a = fakeCtx(1)
    const b = fakeCtx(2)
    reg.register(a)
    reg.register(b)
    const file = { pins: ['/x'] }
    broadcastAll(reg, 'projects:changed', file)
    expect(a.window.webContents.send).toHaveBeenCalledWith('projects:changed', file)
    expect(b.window.webContents.send).toHaveBeenCalledWith('projects:changed', file)
  })

  // NEGATIVE CONTROL (only()-converted broadcast): routing a class-(ii) channel
  // through resolveDefault (the WRONG, only()-based path) at N=2 must THROW —
  // proving an accidental only() on a broadcast can never silently under-deliver
  // to just one window. If broadcasts used only(), this would not throw.
  it('an only()-routed broadcast FAILS the two-context fan-out (only()-negative control)', () => {
    const reg = new WindowRegistry()
    reg.register(fakeCtx(1))
    reg.register(fakeCtx(2))
    expect(() => resolveDefault(reg)?.webContents.send('projects:changed', {})).toThrow()
  })

  // BUG-190 fan-out edition: a destroyed window is excluded so a fan-out can't
  // throw on it mid-loop.
  it('resolveAll/broadcastAll skip destroyed windows (BUG-190 guard, fan-out edition)', () => {
    const reg = new WindowRegistry()
    const live = fakeCtx(1)
    const dead = fakeCtx(2, { destroyed: true })
    const wcDead = fakeCtx(3, { wcDestroyed: true })
    reg.register(live)
    reg.register(dead)
    reg.register(wcDead)
    expect(resolveAll(reg)).toEqual([live.window])
    broadcastAll(reg, 'projects:changed', {})
    expect(live.window.webContents.send).toHaveBeenCalledTimes(1)
    expect(dead.window.webContents.send).not.toHaveBeenCalled()
    expect(wcDead.window.webContents.send).not.toHaveBeenCalled()
  })
})
