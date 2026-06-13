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
function dispatch(server: SocketServer, cmd: string, args: Record<string, unknown> = {}, windowId?: number) {
  return (server as unknown as { handle(req: unknown): Promise<{ ok: boolean; result?: unknown; error?: string }> })
    .handle({ id: 't1', cmd, args, ...(windowId !== undefined ? { windowId } : {}) })
}

describe('SocketServer — app-scoped getter-thunk boot-race contract (ENH-191 P1d)', () => {
  it('(a) ping answers with the app version even when cdp/browser thunks throw (duo doctor mid-boot)', async () => {
    const d = stubDeps()
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, d.nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'ping')
    expect(res.ok).toBe(true)
    // ENH-191 P5a (Tier-3) — ping now also carries the live window count
    // (0 here: empty stub bridge → windowCount?.() ?? 0).
    expect(res.result).toEqual({ version: '9.9.9', windows: 0 })
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

// ENH-191 P3-S11a — the ambient-cue emits now carry the ADDRESSED window id as
// the 3rd eventSink arg (resolved by the getAddressedWindowId thunk) so main can
// route the cue to that window via routeAmbientCue, not always window 1.
describe('SocketServer — addressed-window-id on ambient cues (ENH-191 P3-S11a)', () => {
  it('the read-glow cue carries the addressed window id (3rd arg)', async () => {
    const d = stubDeps()
    const nav = { getSelection: () => ({ from: 0, to: 1 }) } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const eventSink = vi.fn()
    server.setEventSink(eventSink, () => 1)
    await dispatch(server, 'selection', { pane: 'editor' })
    expect(eventSink).toHaveBeenCalledWith('claude:read-selection', { pane: 'editor' }, 1)
  })

  // NEGATIVE CONTROL: a missing resolver must NOT suppress the cue — it fires
  // with an undefined 3rd arg (routeAmbientCue then falls back to the sole window).
  it('with no getAddressedWindowId resolver the cue still fires (undefined 3rd arg)', async () => {
    const d = stubDeps()
    const nav = { getSelection: () => ({ from: 0, to: 1 }) } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const eventSink = vi.fn()
    server.setEventSink(eventSink) // no resolver → default () => undefined
    await dispatch(server, 'selection', { pane: 'editor' })
    expect(eventSink).toHaveBeenCalledWith('claude:read-selection', { pane: 'editor' }, undefined)
  })
})

// ENH-191 P5a (Tier-3/S4) — per-request window addressing. handle() sets the
// target window from req.windowId (validated against listWindows) BEFORE the
// dispatch, so main's CLI helpers resolve the addressed window (DUO_WINDOW /
// --window N). An unknown/stale id falls back to undefined (→ primary).
describe('SocketServer — DUO_WINDOW addressing (ENH-191 P5a Tier-3)', () => {
  const WINDOWS = [
    { id: 1, primary: true, focused: false, activeWorkspace: null },
    { id: 2, primary: false, focused: true, activeWorkspace: null }
  ]
  function navWithWindows(captured: { id?: number }) {
    return {
      listWindows: () => WINDOWS,
      setTargetWindow: (id?: number) => { captured.id = id },
      windowCount: () => WINDOWS.length
    } as never
  }

  it('a valid req.windowId is validated + set as the per-request target', async () => {
    const d = stubDeps()
    const captured: { id?: number } = {}
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, navWithWindows(captured), d.navPins, d.events, d.packs, '9.9.9')
    await dispatch(server, 'windows', {}, 2)
    expect(captured.id).toBe(2)
  })

  it('an unknown req.windowId (stale DUO_WINDOW) falls back to undefined → primary', async () => {
    const d = stubDeps()
    const captured: { id?: number } = { id: 7 }
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, navWithWindows(captured), d.navPins, d.events, d.packs, '9.9.9')
    await dispatch(server, 'windows', {}, 99) // 99 not in listWindows → undefined
    expect(captured.id).toBeUndefined()
  })

  it('no req.windowId → undefined target (primary)', async () => {
    const d = stubDeps()
    const captured: { id?: number } = { id: 5 }
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, navWithWindows(captured), d.navPins, d.events, d.packs, '9.9.9')
    await dispatch(server, 'windows')
    expect(captured.id).toBeUndefined()
  })

  it('`duo windows` returns the live window list', async () => {
    const d = stubDeps()
    const captured: { id?: number } = {}
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, navWithWindows(captured), d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'windows')
    expect(res.ok).toBe(true)
    expect(res.result).toEqual(WINDOWS)
  })
})

// ENH-212 (Home) — `duo home` / `duo term` / `duo session open` verb routing.
// Pins each verb to its NavBridge method (show vs refresh share showHome; state
// pulls getHomeState; term tabs/tab map to the two enumeration/activate methods;
// session open routes through sessionOpen with the action surfaced) plus the
// unknown-op guards. Same pure-node dispatch harness as above.
describe('SocketServer — ENH-212 Home CLI routing', () => {
  it('`duo home` (default show) and `home refresh` both call showHome', async () => {
    const d = stubDeps()
    const showHome = vi.fn(() => ({ ok: true }))
    const nav = { showHome } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    // Bare `duo home` arrives as { op: 'show' } from the CLI; refresh as { op: 'refresh' }.
    const r1 = await dispatch(server, 'home', { op: 'show' })
    const r2 = await dispatch(server, 'home', { op: 'refresh' })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(showHome).toHaveBeenCalledTimes(2)
  })

  it('`duo home state` pulls getHomeState and returns its snapshot', async () => {
    const d = stubDeps()
    const snap = { greeting: { openCount: 0 }, projects: [] }
    const getHomeState = vi.fn(async () => snap)
    const nav = { getHomeState } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'home', { op: 'state' })
    expect(res.ok).toBe(true)
    expect(res.result).toEqual(snap)
    expect(getHomeState).toHaveBeenCalledTimes(1)
  })

  it('an unknown home op fails cleanly (umbrella try/catch → {ok:false})', async () => {
    const d = stubDeps()
    const nav = { showHome: vi.fn(() => ({ ok: true })) } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'home', { op: 'bogus' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/Unknown home op/)
  })

  it('`duo term tabs` enumerates via listTerminalTabs', async () => {
    const d = stubDeps()
    const tabs = { tabs: [{ id: 't_a', kind: 'shell', cwd: '/x', title: 'a', active: true }], activeTabId: 't_a' }
    const listTerminalTabs = vi.fn(async () => tabs)
    const nav = { listTerminalTabs } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'term', { op: 'tabs' })
    expect(res.ok).toBe(true)
    expect(res.result).toEqual(tabs)
    expect(listTerminalTabs).toHaveBeenCalledTimes(1)
  })

  it('`duo term tab <id>` activates by id', async () => {
    const d = stubDeps()
    const activateTerminalTab = vi.fn(() => ({ ok: true }))
    const nav = { activateTerminalTab } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'term', { op: 'tab', tabId: 't_b' })
    expect(res.ok).toBe(true)
    expect(activateTerminalTab).toHaveBeenCalledWith('t_b')
  })

  it('`duo term tab` without an id fails cleanly', async () => {
    const d = stubDeps()
    const nav = { activateTerminalTab: vi.fn(() => ({ ok: true })) } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'term', { op: 'tab' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/requires <id>/)
  })

  it('`duo session open <uuid>` routes through sessionOpen and surfaces the action', async () => {
    const d = stubDeps()
    const sessionOpen = vi.fn(async () => ({ ok: true as const, action: 'focus' as const }))
    const nav = { sessionOpen } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'session', { op: 'open', uuid: 'u1', cwd: '/p' })
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ ok: true, action: 'focus' })
    expect(sessionOpen).toHaveBeenCalledWith('u1', '/p')
  })

  it('`duo session open` without a uuid fails cleanly', async () => {
    const d = stubDeps()
    const nav = { sessionOpen: vi.fn() } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'session', { op: 'open' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/requires <uuid>/)
  })
})
