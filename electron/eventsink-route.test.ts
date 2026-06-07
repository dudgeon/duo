// ENH-191 P3 (seam M3) — pins the addressed-cue routing contract: a cue lands
// in the ADDRESSED window (not a broadcast, not window 1), falls back to the
// sole window for an absent/stale id, and is NEVER focus-resolved. Pure node-env,
// mirrors window-resolve.test.ts (fake WindowLike) + the REAL WindowRegistry.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { WindowRegistry, type WindowContext } from './window-registry'
import { routeAmbientCue } from './eventsink-route'

function fakeCtx(id: number, opts: { destroyed?: boolean; wcDestroyed?: boolean } = {}): WindowContext {
  return {
    id,
    window: {
      isDestroyed: () => opts.destroyed ?? false,
      webContents: { isDestroyed: () => opts.wcDestroyed ?? false, send: vi.fn() },
    },
  }
}

describe('eventsink-route — routeAmbientCue (ENH-191 P3 M3)', () => {
  // ---- addressed delivery (not a broadcast, not window 1) -----------------
  it('routes the cue to the ADDRESSED window only', () => {
    const reg = new WindowRegistry()
    const a = fakeCtx(1)
    const b = fakeCtx(2)
    reg.register(a)
    reg.register(b)
    routeAmbientCue(reg, 2, 'claude:read-selection', { pane: 'editor' })
    expect(b.window.webContents.send).toHaveBeenCalledWith('claude:read-selection', { pane: 'editor' })
    expect(b.window.webContents.send).toHaveBeenCalledTimes(1)
    expect(a.window.webContents.send).not.toHaveBeenCalled() // NOT a broadcast, NOT window-1-locked
  })

  // both cue shapes route by channel name identically
  it('routes the browser:focus-gained supplemental push to its addressed window', () => {
    const reg = new WindowRegistry()
    const a = fakeCtx(1)
    const b = fakeCtx(2)
    reg.register(a)
    reg.register(b)
    routeAmbientCue(reg, 1, 'browser:focus-gained', { tabId: 42, slot: 'main' })
    expect(a.window.webContents.send).toHaveBeenCalledWith('browser:focus-gained', { tabId: 42, slot: 'main' })
    expect(b.window.webContents.send).not.toHaveBeenCalled()
  })

  // ---- fallback to the sole window (never drops at N=1) -------------------
  it('undefined id falls back to the sole window via resolveDefault (N=1)', () => {
    const reg = new WindowRegistry()
    const a = fakeCtx(1)
    reg.register(a)
    routeAmbientCue(reg, undefined, 'claude:read-selection', { pane: 'editor' })
    expect(a.window.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('a stale id (no such window) falls back to the sole window at N=1 — never dropped', () => {
    const reg = new WindowRegistry()
    const a = fakeCtx(1)
    reg.register(a)
    routeAmbientCue(reg, 999, 'claude:read-selection', { pane: 'editor' })
    expect(a.window.webContents.send).toHaveBeenCalledTimes(1)
  })

  // NEGATIVE CONTROL (the cardinal rule): undefined id at N>1 must THROW via
  // only() (the fail-loud "P5a must thread a real addressed window" signal),
  // proving the undefined fallback is the only()-default, not a silent first-pick.
  it('undefined id at N>1 THROWS (only()) — not a silent focus/first pick', () => {
    const reg = new WindowRegistry()
    reg.register(fakeCtx(1))
    reg.register(fakeCtx(2))
    expect(() => routeAmbientCue(reg, undefined, 'claude:read-selection', {})).toThrow(
      /all\(\) \(broadcast\) or get\(id\)/
    )
  })

  // ---- destroyed guard ----------------------------------------------------
  it('a destroyed addressed window is guarded — no send (dropped, not redirected)', () => {
    const reg = new WindowRegistry()
    const dead = fakeCtx(2, { destroyed: true })
    reg.register(fakeCtx(1))
    reg.register(dead)
    routeAmbientCue(reg, 2, 'claude:read-selection', { pane: 'editor' })
    expect(dead.window.webContents.send).not.toHaveBeenCalled()
  })

  // ---- NEGATIVE CONTROL: focus-resolution is unrepresentable -------------
  // The module is outside the grep-gate's scope (it scans only main.ts), so its
  // cardinal-rule protection is this source-grep: the module must never CALL
  // getFocusedWindow() / getFocusedWebContents() (the call form — the header
  // comment legitimately documents the ban in prose, so we match `(` not the
  // bare token).
  it('the module source CALLS no getFocusedWindow() / getFocusedWebContents()', () => {
    const src = readFileSync(new URL('./eventsink-route.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/getFocusedWindow\s*\(|getFocusedWebContents\s*\(/)
  })
})
