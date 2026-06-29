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

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
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

  it('`duo term close <id> [--force]` routes through closeTerminalTabById', async () => {
    const d = stubDeps()
    const closeTerminalTabById = vi.fn(async () => ({ ok: true }))
    const nav = { closeTerminalTabById } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    expect((await dispatch(server, 'term', { op: 'close', tabId: 't_c' })).ok).toBe(true)
    expect(closeTerminalTabById).toHaveBeenCalledWith('t_c', false)
    await dispatch(server, 'term', { op: 'close', tabId: 't_c', force: true })
    expect(closeTerminalTabById).toHaveBeenCalledWith('t_c', true)
  })

  it('`duo term close` surfaces the live-claude refusal', async () => {
    const d = stubDeps()
    const closeTerminalTabById = vi.fn(async () => ({ ok: false, error: 'tab is running a live claude session — pass --force to close it anyway' }))
    const nav = { closeTerminalTabById } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'term', { op: 'close', tabId: 't_c' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/--force/)
  })

  it('`duo session open <uuid>` routes through sessionOpen and surfaces the action', async () => {
    const d = stubDeps()
    const sessionOpen = vi.fn(async () => ({ ok: true as const, action: 'focus' as const }))
    const nav = { sessionOpen } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'session', { op: 'open', uuid: 'u1', cwd: '/p' })
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ ok: true, action: 'focus' })
    expect(sessionOpen).toHaveBeenCalledWith('u1', '/p', false)
  })

  it('`duo session open --force` threads force=true through to sessionOpen', async () => {
    const d = stubDeps()
    const sessionOpen = vi.fn(async () => ({ ok: true as const, action: 'resume' as const }))
    const nav = { sessionOpen } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'session', { op: 'open', uuid: 'u1', cwd: '/p', force: true })
    expect(res.ok).toBe(true)
    expect(sessionOpen).toHaveBeenCalledWith('u1', '/p', true)
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

// ENH-231 — Async Catch-Up CLI routing: session digest|note|next + home
// mode|catchup. Same pure-node dispatch harness; pins each sub-op to its
// NavBridge method + the unknown-op + missing-arg guards (the "IPC handler gap
// is invisible to typecheck" class — a routing miss only shows at runtime).
describe('SocketServer — ENH-231 Async Catch-Up CLI routing', () => {
  it('`duo session digest <tab>` materializes via sessionDigest (youAskedOnly=false)', async () => {
    const d = stubDeps()
    const sessionDigest = vi.fn(async () => ({ ok: true, uuid: 'uX' }))
    const nav = { sessionDigest } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'session', { op: 'digest', tabId: 't1' })
    expect(res.ok).toBe(true)
    expect(sessionDigest).toHaveBeenCalledWith('t1', false)
  })

  it('`--you-asked-only` threads youAskedOnly=true', async () => {
    const d = stubDeps()
    const sessionDigest = vi.fn(async () => ({ ok: true }))
    const nav = { sessionDigest } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    await dispatch(server, 'session', { op: 'digest', tabId: 't1', youAskedOnly: true })
    expect(sessionDigest).toHaveBeenCalledWith('t1', true)
  })

  it('`duo session digest` without a tab fails cleanly', async () => {
    const d = stubDeps()
    const nav = { sessionDigest: vi.fn() } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'session', { op: 'digest' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/requires <tab>/)
  })

  it('`duo session note <tab>` (no text) READS via getSessionNote', async () => {
    const d = stubDeps()
    const getSessionNote = vi.fn(async () => 'shipped the bucket')
    const nav = { getSessionNote } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'session', { op: 'note', tabId: 't1' })
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ ok: true, note: 'shipped the bucket' })
    expect(getSessionNote).toHaveBeenCalledWith('t1')
  })

  it('`duo session note <tab> "<text>"` WRITES via setSessionNote', async () => {
    const d = stubDeps()
    const setSessionNote = vi.fn(async () => ({ ok: true, uuid: 'uX' }))
    const nav = { setSessionNote } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'session', { op: 'note', tabId: 't1', text: 'did the thing' })
    expect(res.ok).toBe(true)
    expect(setSessionNote).toHaveBeenCalledWith('t1', 'did the thing')
  })

  it('`duo session next <tab> "<text>"` WRITES via setSessionNext', async () => {
    const d = stubDeps()
    const setSessionNext = vi.fn(async () => ({ ok: true, uuid: 'uX' }))
    const nav = { setSessionNext } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    await dispatch(server, 'session', { op: 'next', tabId: 't1', text: 'review the PR' })
    expect(setSessionNext).toHaveBeenCalledWith('t1', 'review the PR')
  })

  it('`duo home mode` (no value) READS getHomeMode', async () => {
    const d = stubDeps()
    const getHomeMode = vi.fn(() => 'catchup' as const)
    const nav = { getHomeMode } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'home', { op: 'mode' })
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ mode: 'catchup' })
  })

  it('`duo home mode catchup` SETS via setHomeMode', async () => {
    const d = stubDeps()
    const setHomeMode = vi.fn(async () => ({ ok: true }))
    const nav = { setHomeMode } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'home', { op: 'mode', value: 'catchup' })
    expect(res.ok).toBe(true)
    expect(setHomeMode).toHaveBeenCalledWith('catchup')
  })

  it('`duo home mode <bogus>` is rejected', async () => {
    const d = stubDeps()
    const nav = { setHomeMode: vi.fn() } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'home', { op: 'mode', value: 'sideways' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/expected projects\|catchup/)
  })

  it('`duo home catchup` builds the board via getCatchupBoard', async () => {
    const d = stubDeps()
    const board = { generatedAt: 1, mode: 'catchup', columns: { needsYou: { full: [], compact: [] }, working: { full: [], compact: [] }, done: { full: [], compact: [] } } }
    const getCatchupBoard = vi.fn(async () => board)
    const nav = { getCatchupBoard } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'home', { op: 'catchup' })
    expect(res.ok).toBe(true)
    expect(res.result).toEqual(board)
  })
})

// ENH-240 — `duo frontmatter-default` routing (read / set / bad-value guard).
// Same "IPC handler gap is invisible to typecheck" class as the catch-up block:
// a missing case or arg-name typo only surfaces at runtime.
describe('SocketServer — ENH-240 frontmatter-default CLI routing', () => {
  it('`duo frontmatter-default` (no value) READS getFrontmatterDefaultExpanded', async () => {
    const d = stubDeps()
    const getFrontmatterDefaultExpanded = vi.fn(() => true)
    const nav = { getFrontmatterDefaultExpanded } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'frontmatter-default')
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ expanded: true })
    expect(getFrontmatterDefaultExpanded).toHaveBeenCalled()
  })

  it('`duo frontmatter-default collapsed` SETS expanded=false', async () => {
    const d = stubDeps()
    const setFrontmatterDefaultExpanded = vi.fn(async () => ({ ok: true }))
    const nav = { setFrontmatterDefaultExpanded } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'frontmatter-default', { value: 'collapsed' })
    expect(res.ok).toBe(true)
    expect(res.result).toEqual({ ok: true, expanded: false })
    expect(setFrontmatterDefaultExpanded).toHaveBeenCalledWith(false)
  })

  it('`duo frontmatter-default expanded` SETS expanded=true', async () => {
    const d = stubDeps()
    const setFrontmatterDefaultExpanded = vi.fn(async () => ({ ok: true }))
    const nav = { setFrontmatterDefaultExpanded } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    await dispatch(server, 'frontmatter-default', { value: 'expanded' })
    expect(setFrontmatterDefaultExpanded).toHaveBeenCalledWith(true)
  })

  it('`duo frontmatter-default <bogus>` is rejected', async () => {
    const d = stubDeps()
    const nav = { setFrontmatterDefaultExpanded: vi.fn() } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'frontmatter-default', { value: 'maybe' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/expected expanded\|collapsed/)
  })
})

// ENH-224 D14 — `duo recent` routing + record-on-open. Pins the socket-side
// contract the UI Open bar can't reach: `recent` lists via the NavBridge, and
// a SUCCESSFUL `open` records a derived pointer (a failed open does NOT). Same
// pure-node dispatch harness. Guards the "IPC handler gap is invisible to
// typecheck" class — a missing case here compiles but throws at runtime.
describe('SocketServer — ENH-224 Open Recent (recent + record-on-open)', () => {
  it('`duo recent` returns the list from listOpenRecents', async () => {
    const d = stubDeps()
    const entries = [{ target: '~/x.md', label: 'x.md', kind: 'local', lastOpenedAt: 123 }]
    const listOpenRecents = vi.fn(async () => entries)
    const nav = { listOpenRecents } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'recent')
    expect(res.ok).toBe(true)
    expect(res.result).toEqual(entries)
    expect(listOpenRecents).toHaveBeenCalledTimes(1)
  })

  it('`duo recent` returns [] when the NavBridge lacks listOpenRecents (optional dep)', async () => {
    const d = stubDeps()
    const nav = {} as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'recent')
    expect(res.ok).toBe(true)
    expect(res.result).toEqual([])
  })

  it('a successful web-URL `open` records the derived pointer (origin preferred)', async () => {
    const d = stubDeps()
    const recordOpenRecent = vi.fn(async () => {})
    const nav = { recordOpenRecent, revealMainPaneIfCollapsed: vi.fn() } as never
    const openTab = vi.fn(async () => ({ ok: true, id: 1, url: 'https://example.com/page' }))
    const fakeBrowser = { openTab } as never
    const server = new SocketServer(THROW_CDP, () => fakeBrowser, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'open', {
      url: 'https://example.com/page',
      origin: 'https://example.com/page',
    })
    expect(res.ok).toBe(true)
    expect(recordOpenRecent).toHaveBeenCalledWith({
      target: 'https://example.com/page',
      label: 'example.com',
      kind: 'url',
    })
  })

  it('a FAILED open (missing file://) does NOT record a recent', async () => {
    const d = stubDeps()
    const recordOpenRecent = vi.fn(async () => {})
    const nav = { recordOpenRecent } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    // A file:// URL for a path that does not exist → the command's inner
    // result is {ok:false} (the envelope's own `ok` is transport-level) and
    // the handler breaks BEFORE the record block.
    const res = await dispatch(server, 'open', {
      url: 'file:///tmp/enh221-does-not-exist-xyz.md',
      origin: '/tmp/enh221-does-not-exist-xyz.md',
    })
    expect((res.result as { ok?: boolean })?.ok).toBe(false)
    expect(recordOpenRecent).not.toHaveBeenCalled()
  })
})

// ENH-224 Phase 1 (CLI twin / rule #4) — `duo open <github-file-url>` is the
// socket twin of the Open bar's "open just this doc": classify → managed
// checkout → open-as-local (nav.edit) + focus the checkout folder (nav.reveal)
// → record the github-file recent. A bare-repo / non-file GitHub URL still
// falls through to the browser pane. Pins the routing decision + the optional-
// dep degradation (the same handler-gap class as the record-on-open tests).
describe('SocketServer — ENH-224 Phase 1 github-file open (managed checkout twin)', () => {
  const GH_FILE = 'https://github.com/octocat/Spoon-Knife/blob/main/README.md'
  const POINTER = {
    owner: 'octocat',
    repo: 'Spoon-Knife',
    ref: 'main',
    filePath: 'README.md',
    checkoutDir: '/co/octocat-Spoon-Knife@main',
    fileAbsPath: '/co/octocat-Spoon-Knife@main/README.md',
    baselineSha: 'd0dd1f6',
    via: 'reused' as const,
  }

  it('a github-file URL runs the checkout, opens the file, focuses the folder, records the recent', async () => {
    const d = stubDeps()
    const runManagedCheckout = vi.fn(async () => ({ ok: true, pointer: POINTER }))
    const edit = vi.fn(() => ({ ok: true }))
    const reveal = vi.fn(() => ({ ok: true }))
    const recordOpenRecent = vi.fn(async () => {})
    const nav = { runManagedCheckout, edit, reveal, recordOpenRecent } as never
    // THROW_BROWSER proves no browser-tab fallback fired for the resolved file.
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'open', { url: GH_FILE, origin: GH_FILE, mode: 'browser' })
    expect(res.ok).toBe(true)
    expect((res.result as { ok?: boolean }).ok).toBe(true)
    expect((res.result as { routedTo?: string }).routedTo).toBe('editor')
    expect(runManagedCheckout).toHaveBeenCalledTimes(1)
    expect(runManagedCheckout).toHaveBeenCalledWith({
      owner: 'octocat', repo: 'Spoon-Knife', ref: 'main', filePath: 'README.md',
    })
    expect(edit).toHaveBeenCalledTimes(1)
    expect(edit).toHaveBeenCalledWith(POINTER.fileAbsPath)
    // reveal the FILE (not the dir) so cwd lands INSIDE the checkout folder
    // (D5 — siblings visible), matching the UI's navigateTo(checkoutDir).
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(reveal).toHaveBeenCalledWith(POINTER.fileAbsPath)
    expect(recordOpenRecent).toHaveBeenCalledTimes(1)
    expect(recordOpenRecent).toHaveBeenCalledWith({
      target: GH_FILE,
      label: 'octocat/Spoon-Knife › README.md',
      kind: 'github-file',
    })
  })

  it('a successful checkout whose edit() FAILS reports an error, records nothing, opens no tab', async () => {
    const d = stubDeps()
    const runManagedCheckout = vi.fn(async () => ({ ok: true, pointer: POINTER }))
    const edit = vi.fn(() => ({ ok: false, error: 'renderer not ready' }))
    const reveal = vi.fn(() => ({ ok: true }))
    const recordOpenRecent = vi.fn(async () => {})
    const nav = { runManagedCheckout, edit, reveal, recordOpenRecent } as never
    // THROW_BROWSER proves a failed edit does NOT fall through to a browser tab.
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'open', { url: GH_FILE, origin: GH_FILE })
    expect((res.result as { ok?: boolean }).ok).toBe(false)
    expect((res.result as { error?: string }).error).toContain('renderer not ready')
    expect(reveal).not.toHaveBeenCalled()
    expect(recordOpenRecent).not.toHaveBeenCalled()
  })

  it('records the recent under the CANONICAL github.com/blob URL even when opened via a raw URL (UI parity)', async () => {
    const d = stubDeps()
    const runManagedCheckout = vi.fn(async () => ({ ok: true, pointer: POINTER }))
    const edit = vi.fn(() => ({ ok: true }))
    const reveal = vi.fn(() => ({ ok: true }))
    const recordOpenRecent = vi.fn(async () => {})
    const nav = { runManagedCheckout, edit, reveal, recordOpenRecent } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const rawUrl = 'https://raw.githubusercontent.com/octocat/Spoon-Knife/main/README.md'
    const res = await dispatch(server, 'open', { url: rawUrl, origin: rawUrl })
    expect((res.result as { ok?: boolean }).ok).toBe(true)
    // recorded under the canonical github.com/blob form — NOT the raw URL — so
    // the CLI + UI store the SAME pointer for the same file.
    expect(recordOpenRecent).toHaveBeenCalledWith({
      target: 'https://github.com/octocat/Spoon-Knife/blob/main/README.md',
      label: 'octocat/Spoon-Knife › README.md',
      kind: 'github-file',
    })
  })

  it('an auth-missing checkout bounces to `gh auth login`, opens nothing, records nothing', async () => {
    const d = stubDeps()
    const runManagedCheckout = vi.fn(async () => ({
      ok: false as const, errorKind: 'auth-missing' as const, error: 'GitHub authentication required.',
    }))
    const edit = vi.fn(() => ({ ok: true }))
    const recordOpenRecent = vi.fn(async () => {})
    const nav = { runManagedCheckout, edit, reveal: vi.fn(() => ({ ok: true })), recordOpenRecent } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'open', { url: GH_FILE, origin: GH_FILE })
    expect((res.result as { ok?: boolean }).ok).toBe(false)
    expect((res.result as { errorKind?: string }).errorKind).toBe('auth-missing')
    expect((res.result as { error?: string }).error).toContain('gh auth login')
    expect(edit).not.toHaveBeenCalled()
    expect(recordOpenRecent).not.toHaveBeenCalled()
  })

  it('a bare github REPO URL does NOT check out — it falls through to the browser pane', async () => {
    const d = stubDeps()
    const runManagedCheckout = vi.fn(async () => ({ ok: true, pointer: POINTER }))
    const recordOpenRecent = vi.fn(async () => {})
    const nav = { runManagedCheckout, recordOpenRecent, revealMainPaneIfCollapsed: vi.fn() } as never
    const openTab = vi.fn(async () => ({ ok: true, id: 7, url: 'https://github.com/octocat/Spoon-Knife' }))
    const fakeBrowser = { openTab } as never
    const server = new SocketServer(THROW_CDP, () => fakeBrowser, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const repoUrl = 'https://github.com/octocat/Spoon-Knife'
    const res = await dispatch(server, 'open', { url: repoUrl, origin: repoUrl })
    expect(res.ok).toBe(true)
    expect(runManagedCheckout).not.toHaveBeenCalled()
    expect(openTab).toHaveBeenCalledWith(repoUrl)
    expect(recordOpenRecent).toHaveBeenCalledWith({
      target: repoUrl, label: 'octocat/Spoon-Knife', kind: 'github-repo',
    })
  })

  it('without runManagedCheckout (optional dep), a github-file URL falls through to the browser pane', async () => {
    const d = stubDeps()
    const recordOpenRecent = vi.fn(async () => {})
    const nav = { recordOpenRecent, revealMainPaneIfCollapsed: vi.fn() } as never
    const openTab = vi.fn(async () => ({ ok: true, id: 3, url: GH_FILE }))
    const fakeBrowser = { openTab } as never
    const server = new SocketServer(THROW_CDP, () => fakeBrowser, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'open', { url: GH_FILE, origin: GH_FILE })
    expect(res.ok).toBe(true)
    expect(openTab).toHaveBeenCalledWith(GH_FILE)
  })
})

// ENH-224 / PR #102 — the `open` handler's LOCAL-FILE dispatch (BUG-067 / BUG-129).
// The existing Open-Recent block above pins the web-URL + github-file branches and
// the "missing file → no recent" guard, but NOT the two local-path leaves of the
// same handler: a file:// URL whose target EXISTS routes through nav.edit (the
// renderer's smart router) — never the browser pane — and records the recent;
// a file:// URL whose target is MISSING breaks early with the explicit
// `File not found: <path>` error (so an agent's wrong-cwd relative path
// self-corrects), opening no tab and recording nothing. Same pure-node dispatch
// harness. THROW_BROWSER proves the local leaves never fall through to openTab.
describe('SocketServer — ENH-224 open handler local-file dispatch (BUG-067 / BUG-129)', () => {
  let tmpDir: string
  let realFile: string
  let realFileUrl: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-socket-open-'))
    realFile = path.join(tmpDir, 'note.md')
    fs.writeFileSync(realFile, '# A real local doc\n')
    realFileUrl = 'file://' + realFile
  })
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('a file:// URL for an EXISTING file routes through nav.edit (not the browser) and records the recent', async () => {
    const d = stubDeps()
    const edit = vi.fn(() => ({ ok: true }))
    const recordOpenRecent = vi.fn(async () => {})
    const nav = { edit, recordOpenRecent, revealMainPaneIfCollapsed: vi.fn() } as never
    // THROW_BROWSER proves the resolved local file NEVER falls through to openTab.
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const res = await dispatch(server, 'open', { url: realFileUrl, origin: realFile })
    expect(res.ok).toBe(true)
    expect((res.result as { ok?: boolean }).ok).toBe(true)
    // Non-HTML → the renderer's classifier picks the surface; routedTo is 'editor'.
    expect((res.result as { routedTo?: string }).routedTo).toBe('editor')
    expect(edit).toHaveBeenCalledTimes(1)
    // edit() receives the decoded local path (no file:// scheme), and no HTML mode.
    expect(edit).toHaveBeenCalledWith(realFile, undefined)
    // record-on-open fires off the human-friendly origin (the local path).
    expect(recordOpenRecent).toHaveBeenCalledTimes(1)
    const recorded = (recordOpenRecent.mock.calls as unknown[][])[0][0] as { target?: string }
    expect(recorded.target).toBe(realFile)
  })

  it('an HTML file:// URL respects the default browser mode (ENH-156) — edit gets mode=browser, routedTo=browser', async () => {
    const d = stubDeps()
    const htmlFile = path.join(tmpDir, 'page.html')
    fs.writeFileSync(htmlFile, '<h1>hi</h1>')
    const edit = vi.fn(() => ({ ok: true }))
    const recordOpenRecent = vi.fn(async () => {})
    const nav = { edit, recordOpenRecent, revealMainPaneIfCollapsed: vi.fn() } as never
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    // CLI passes mode:'browser' by default for `duo open <html>`.
    const res = await dispatch(server, 'open', { url: 'file://' + htmlFile, origin: htmlFile, mode: 'browser' })
    expect(res.ok).toBe(true)
    expect((res.result as { routedTo?: string }).routedTo).toBe('browser')
    expect(edit).toHaveBeenCalledWith(htmlFile, 'browser')
  })

  it('a file:// URL for a MISSING file breaks early with "File not found: <path>" — no tab, no recent', async () => {
    const d = stubDeps()
    const edit = vi.fn(() => ({ ok: true }))
    const recordOpenRecent = vi.fn(async () => {})
    const nav = { edit, recordOpenRecent, revealMainPaneIfCollapsed: vi.fn() } as never
    // THROW_BROWSER proves the missing file does NOT fall through to a blank tab.
    const server = new SocketServer(THROW_CDP, THROW_BROWSER, d.files, nav, d.navPins, d.events, d.packs, '9.9.9')
    const missing = path.join(tmpDir, 'does-not-exist-xyz.md')
    const res = await dispatch(server, 'open', { url: 'file://' + missing, origin: missing })
    expect((res.result as { ok?: boolean }).ok).toBe(false)
    expect((res.result as { error?: string }).error).toBe('File not found: ' + missing)
    // The early break sits before nav.edit + the record block.
    expect(edit).not.toHaveBeenCalled()
    expect(recordOpenRecent).not.toHaveBeenCalled()
  })
})
