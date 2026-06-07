// ENH-191 P4 (seam 1) — pure migration / read / compose for the multi-window
// session envelope, extracted as a node-env module so the schema-v1→v2
// migration + the compose contract are unit-testable without Electron or fs.
//
// The on-disk session doc moves from a FLAT single-window SessionState (v1) to a
// { version:2, windows: WindowState[] } envelope. A v1 flat doc migrates into a
// ONE-window envelope, round-trip-identical for that window. SessionStateService
// adopts these in a later seam (with the SCHEMA_VERSION bump + field validation);
// until then nothing imports this, so it ships as byte-identical dead code.

import type { SessionState, SessionEnvelope, WindowState } from '../shared/types'

export const SESSION_ENVELOPE_VERSION = 2 as const

/**
 * Old flat v1 SessionState → a one-window v2 envelope. The per-window slice
 * (terminals / tabs / browser / aux / navigatorPath / activeWorking) carries
 * over verbatim; windowId / bounds / activeWorkspace get safe defaults so the
 * single restored window is byte-identical to the v1 restore.
 */
export function migrateFlatToEnvelope(flat: SessionState, windowId = 1): SessionEnvelope {
  // Drop the doc-level fields (version/savedAt/appVersion); the rest is the
  // per-window slice that becomes the sole WindowState.
  const { version: _ignoredVersion, savedAt, appVersion, ...perWindow } = flat
  return {
    version: SESSION_ENVELOPE_VERSION,
    savedAt,
    appVersion,
    windows: [{ windowId, bounds: null, activeWorkspace: null, ...perWindow }]
  }
}

/**
 * Read either on-disk shape into the window list: a v2 envelope returns its
 * windows; a v1 flat doc migrates to a one-window list; an unknown/absent
 * version → [] (the caller falls back to empty state). Defensive only at the
 * shape level — the service still field-validates each WindowState on load.
 */
export function readEnvelopeWindows(parsed: unknown): WindowState[] {
  if (!parsed || typeof parsed !== 'object') return []
  const version = (parsed as { version?: unknown }).version
  if (version === SESSION_ENVELOPE_VERSION) {
    const windows = (parsed as SessionEnvelope).windows
    return Array.isArray(windows) ? windows : []
  }
  if (version === 1) {
    return migrateFlatToEnvelope(parsed as SessionState).windows
  }
  return []
}

/** Compose a v2 envelope from the live per-window states for a write. */
export function composeEnvelope(
  windows: WindowState[],
  meta: { savedAt: string; appVersion: string }
): SessionEnvelope {
  return {
    version: SESSION_ENVELOPE_VERSION,
    savedAt: meta.savedAt,
    appVersion: meta.appVersion,
    windows
  }
}

/**
 * One window's restorable slice (a flat v1 SessionState) → a WindowState for the
 * envelope. Doc-level fields (version/savedAt/appVersion) are dropped — they live
 * at the envelope level. `windowId` is supplied by the caller; `bounds` +
 * `activeWorkspace` carry over from `prev` (this window's last WindowState) so a
 * renderer flat-save (which knows neither) can't wipe main-side geometry / the
 * active-workspace pointer. At P4 both default to null (seam 6 populates
 * activeWorkspace; P5 populates bounds).
 */
export function flatToWindowState(
  flat: SessionState,
  windowId: number,
  prev?: WindowState | null
): WindowState {
  return {
    windowId,
    bounds: prev?.bounds ?? null,
    activeWorkspace: prev?.activeWorkspace ?? null,
    terminals: flat.terminals,
    activeTerminalIndex: flat.activeTerminalIndex,
    browserTabs: flat.browserTabs,
    activeBrowserIndex: flat.activeBrowserIndex,
    fileTabs: flat.fileTabs,
    activeWorking: flat.activeWorking,
    navigatorPath: flat.navigatorPath,
    aux: flat.aux ?? null
  }
}

/**
 * A WindowState → the flat v1 SessionState the renderer IPC + .duo-workspace
 * contract still expects (the envelope is purely the session-state.json on-disk
 * shape). The window-only fields (windowId/bounds/activeWorkspace) are dropped;
 * doc-level savedAt/appVersion are re-attached from `meta`.
 */
export function windowStateToFlat(
  ws: WindowState,
  meta: { savedAt: string; appVersion: string }
): SessionState {
  return {
    version: 1,
    savedAt: meta.savedAt,
    appVersion: meta.appVersion,
    terminals: ws.terminals,
    activeTerminalIndex: ws.activeTerminalIndex,
    browserTabs: ws.browserTabs,
    activeBrowserIndex: ws.activeBrowserIndex,
    fileTabs: ws.fileTabs,
    activeWorking: ws.activeWorking,
    navigatorPath: ws.navigatorPath,
    aux: ws.aux ?? null
  }
}
