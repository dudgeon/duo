// BUG-189 — pins the guarded-send invariants so the quit-loop crash
// can't regress silently. Each case targets one branch the production
// closure depends on; the destroyed-window-throws-on-webContents case
// is the specific defensive behavior that motivated the short-circuit
// (a naive `w.webContents.isDestroyed()` after a destroyed window
// would itself throw).

import { describe, it, expect, vi } from 'vitest'
import { makeSafeSend, type WindowLike } from './safe-send'

function makeFakeWindow(opts?: {
  destroyed?: boolean
  webContentsDestroyed?: boolean
}): { window: WindowLike; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  const window: WindowLike = {
    isDestroyed: () => opts?.destroyed ?? false,
    webContents: {
      isDestroyed: () => opts?.webContentsDestroyed ?? false,
      send
    }
  }
  return { window, send }
}

describe('makeSafeSend — BUG-189 guard', () => {
  it('no-ops when getWindow returns null', () => {
    const safeSend = makeSafeSend(() => null)
    expect(() => safeSend('channel', 'payload')).not.toThrow()
  })

  it('no-ops when window.isDestroyed() is true', () => {
    const { window, send } = makeFakeWindow({ destroyed: true })
    const safeSend = makeSafeSend(() => window)
    safeSend('channel', 'payload')
    expect(send).not.toHaveBeenCalled()
  })

  it('no-ops when webContents.isDestroyed() is true (window still alive)', () => {
    const { window, send } = makeFakeWindow({ webContentsDestroyed: true })
    const safeSend = makeSafeSend(() => window)
    safeSend('channel', 'payload')
    expect(send).not.toHaveBeenCalled()
  })

  it('short-circuits BEFORE touching webContents on a destroyed window', () => {
    // Reproduces the BUG-189 defensive shape: accessing webContents on a
    // torn-down BrowserWindow can itself throw. The guard must check
    // isDestroyed() first so the getter never fires.
    const send = vi.fn()
    const window: WindowLike = {
      isDestroyed: () => true,
      get webContents(): WindowLike['webContents'] {
        throw new Error('Object has been destroyed')
      }
    }
    const safeSend = makeSafeSend(() => window)
    expect(() => safeSend('channel', 'payload')).not.toThrow()
    expect(send).not.toHaveBeenCalled()
  })

  it('sends through to webContents.send on a live window', () => {
    const { window, send } = makeFakeWindow()
    const safeSend = makeSafeSend(() => window)
    safeSend('channel', { foo: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('channel', { foo: 1 })
  })

  it('passes undefined payload when caller omits it', () => {
    const { window, send } = makeFakeWindow()
    const safeSend = makeSafeSend(() => window)
    safeSend('channel')
    expect(send).toHaveBeenCalledWith('channel', undefined)
  })

  it('re-reads the window on each call (so a window swap is reflected)', () => {
    // Production wiring is `makeSafeSend(() => mainWindow)`; if the
    // closure cached the window at construction, sends after a
    // workspace-driven window swap would target the dead handle.
    const live = makeFakeWindow()
    const dead = makeFakeWindow({ destroyed: true })
    let current: WindowLike = live.window
    const safeSend = makeSafeSend(() => current)

    safeSend('a', 1)
    expect(live.send).toHaveBeenCalledWith('a', 1)

    current = dead.window
    safeSend('b', 2)
    expect(dead.send).not.toHaveBeenCalled()
    expect(live.send).toHaveBeenCalledTimes(1)
  })
})
