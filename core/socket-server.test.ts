// ENH-191 P1d — pins the boot-race contract for the app-scoped SocketServer's
// getter-thunks (P1b). The socket is now constructed in app.whenReady BEFORE
// the first window exists, so the per-window CdpBridge / BrowserManager are
// resolved lazily, per command, via getCdp() / getBrowser(). This file proves
// the three properties the lift depends on:
//
//   (a) `ping` (→ `duo doctor`) answers EVEN before any window exists — it
//       only touches appVersion, never cdp/browser, so the mid-boot liveness
//       probe keeps working during the whenReady→createWindow gap.
//   (b) a cdp/browser command arriving before createWindow assigns the
//       bridges resolves to a CLEAN {ok:false,error} — handle()'s umbrella
//       try/catch contains the thunk throw. It is NOT an unhandled rejection
//       or a crash (corrects the v1-design claim; see PRD Appendix D).
//   (c) once the thunks resolve real bridges, commands route through them.
//
// Pure node-env, no Electron — mirrors safe-send.test.ts / window-teardown.
// The SocketServer constructor body is empty (parameter-properties only), so
// constructing here starts no servers and has no side effects.

import { describe, it, expect, vi } from 'vitest'
import { SocketServer } from './socket-server'

// Minimal stand-ins for the non-cdp/browser ctor deps. The commands under
// test (ping / url / dom) never touch files/nav/navPins/events/packs, so
// empty objects suffice; `as any` keeps the test focused on the thunks.
function stubDeps() {
  return {
    files: {} as never,
    nav: {} as never,
    navPins: {} as never,
    events: {} as never,
    packs: {} as never
  }
}

const THROW_CDP = () => {
  throw new Error('[main] SocketServer.getCdp() ran before createWindow assigned cdpBridge')
}
const THROW_BROWSER = () => {
  throw new Error('[main] SocketServer.getBrowser() ran before createWindow assigned browserManager')
}

// Drive the private dispatch without widening the public surface (no new
// public API just for the test — same posture as casting to reach internals).
function dispatch(server: SocketServer, cmd: string, args: Record<string, unknown> = {}) {
  return (server as unknown as { handle(req: unknown): Promise<{ ok: boolean; result?: unknown; error?: string }> })
    .handle({ id: 't1', cmd, args })
}

describe('SocketServer — app-scoped getter-thunk boot-race contract (ENH-191 P1d)', () => {
  it('(a) ping answers with the app version even when cdp/browser thunks throw (duo doctor mid-boot)', async () => {
    const d = stubDeps()
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, d.nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'ping')
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ version: '9.9.9' })
  })

  it('(b) a browser command before the window resolves → clean {ok:false}, not a throw', async () => {
    const d = stubDeps()
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, d.nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'url') // url → this.getBrowser().getActiveUrl()
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/browserManager/)
  })

  it('(b2) a cdp command before the window resolves → clean {ok:false}, not a throw', async () => {
    const d = stubDeps()
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, d.nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'dom') // bare dom → this.getCdp().getDOM()
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/cdpBridge/)
  })

  it('(c) once the browser thunk resolves a real bridge, the command routes through it', async () => {
    const d = stubDeps()
    const getActiveUrl = vi.fn(() => 'https://example.test/')
    const fakeBrowser = { getActiveUrl } as never
    const server = new SocketServer(THROW_CDP, () => fakeBrowser, d.files, d.nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'url')
    expect(res.ok).toBe(true)
    expect(res.result).toBe('https://example.test/')
    expect(getActiveUrl).toHaveBeenCalledTimes(1)
  })
})
