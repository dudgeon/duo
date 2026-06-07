// ENH-191 P4 (seam 1) — pins the v1-flat → v2-envelope migration + read/compose
// contract. The load-bearing negative control is a field-dropping migration:
// the round-trip assertion must catch lost per-window data (the C8 data-loss
// class P4 closes). Pure node-env — no Electron/fs.

import { describe, it, expect } from 'vitest'
import type { SessionState, SessionEnvelope, WindowState } from '../shared/types'
import {
  migrateFlatToEnvelope,
  readEnvelopeWindows,
  composeEnvelope,
  SESSION_ENVELOPE_VERSION,
} from './session-envelope'

const FLAT_V1: SessionState = {
  version: 1,
  savedAt: '2026-06-07T00:00:00Z',
  appVersion: '0.9.2',
  terminals: [
    { cwd: '/x', kind: 'shell', title: 't1' },
    { cwd: '/y', kind: 'claude', title: 't2', lastClaudeSession: { id: 'abc', capturedAt: 123 } },
  ],
  activeTerminalIndex: 1,
  browserTabs: [{ url: 'https://e.test', title: 'E' }],
  activeBrowserIndex: 0,
  fileTabs: [{ path: '/a.md', type: 'editor', mime: 'text/markdown' }],
  activeWorking: { kind: 'file', path: '/a.md' },
  navigatorPath: '/x',
  aux: null,
}

describe('session-envelope — v1→v2 migration (ENH-191 P4 seam 1)', () => {
  it('migrates a flat v1 doc into a ONE-window v2 envelope', () => {
    const env = migrateFlatToEnvelope(FLAT_V1)
    expect(env.version).toBe(SESSION_ENVELOPE_VERSION)
    expect(env.savedAt).toBe(FLAT_V1.savedAt)
    expect(env.appVersion).toBe(FLAT_V1.appVersion)
    expect(env.windows).toHaveLength(1)
    const w = env.windows[0]
    expect(w.windowId).toBe(1)
    expect(w.bounds).toBeNull()
    expect(w.activeWorkspace).toBeNull()
  })

  // Round-trip: EVERY per-window field carries over verbatim. A migration that
  // drops any of these would fail here — this is the data-loss guard.
  it('round-trip preserves every per-window field (no data loss)', () => {
    const w = migrateFlatToEnvelope(FLAT_V1).windows[0]
    expect(w.terminals).toEqual(FLAT_V1.terminals)
    expect(w.activeTerminalIndex).toBe(FLAT_V1.activeTerminalIndex)
    expect(w.browserTabs).toEqual(FLAT_V1.browserTabs)
    expect(w.activeBrowserIndex).toBe(FLAT_V1.activeBrowserIndex)
    expect(w.fileTabs).toEqual(FLAT_V1.fileTabs)
    expect(w.activeWorking).toEqual(FLAT_V1.activeWorking)
    expect(w.navigatorPath).toBe(FLAT_V1.navigatorPath)
    expect(w.aux).toEqual(FLAT_V1.aux)
    // doc-level fields must NOT leak into the per-window state:
    expect('version' in w).toBe(false)
    expect('savedAt' in w).toBe(false)
  })

  // NEGATIVE CONTROL: a field-dropping migration loses data; the round-trip
  // assertion catches it. Proves the round-trip test above is load-bearing.
  it('a field-dropping migration loses data the round-trip catches', () => {
    const buggyMigrate = (flat: SessionState): SessionEnvelope => ({
      version: 2,
      savedAt: flat.savedAt,
      appVersion: flat.appVersion,
      windows: [{
        windowId: 1, bounds: null, activeWorkspace: null,
        terminals: [], // BUG: dropped the terminals
        activeTerminalIndex: flat.activeTerminalIndex,
        browserTabs: flat.browserTabs, activeBrowserIndex: flat.activeBrowserIndex,
        fileTabs: flat.fileTabs, activeWorking: flat.activeWorking,
        navigatorPath: flat.navigatorPath, aux: flat.aux,
      }],
    })
    expect(buggyMigrate(FLAT_V1).windows[0].terminals).not.toEqual(FLAT_V1.terminals)
    expect(migrateFlatToEnvelope(FLAT_V1).windows[0].terminals).toEqual(FLAT_V1.terminals)
  })
})

describe('session-envelope — read/compose (ENH-191 P4 seam 1)', () => {
  it('reads a v1 flat doc by migrating it to a one-window list', () => {
    const windows = readEnvelopeWindows(FLAT_V1)
    expect(windows).toHaveLength(1)
    expect(windows[0].terminals).toEqual(FLAT_V1.terminals)
  })

  it('reads a v2 envelope by returning its windows', () => {
    const env = migrateFlatToEnvelope(FLAT_V1)
    expect(readEnvelopeWindows(env)).toEqual(env.windows)
  })

  it('returns [] for an unknown/absent version or non-object (graceful downgrade)', () => {
    expect(readEnvelopeWindows({ version: 99 })).toEqual([])
    expect(readEnvelopeWindows(null)).toEqual([])
    expect(readEnvelopeWindows('nope')).toEqual([])
    expect(readEnvelopeWindows({ version: 2 })).toEqual([]) // v2 but no windows array
  })

  it('composes a v2 envelope from window states + meta', () => {
    const windows: WindowState[] = migrateFlatToEnvelope(FLAT_V1).windows
    const env = composeEnvelope(windows, { savedAt: 's', appVersion: 'a' })
    expect(env).toEqual({ version: 2, savedAt: 's', appVersion: 'a', windows })
  })
})
