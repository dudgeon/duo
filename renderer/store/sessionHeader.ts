// ENH-183 (Sprint 21 / v0.7.9) — per-tab in-memory UI state for the
// polymorphic SessionHeader. **D9 architectural invariant:** none of
// this state is persisted to disk. It resets on Duo restart.
//
// Stored as a Map<tabId, SessionHeaderUiState> in module scope so
// state survives tab switches within a session without round-tripping
// through React state on every TerminalPane render.
//
// C3 wires up only the fields the existing ClaudeResumeBanner uses
// (`dismissedBanner`). C5/C6/C7 will activate `collapsed`,
// `pillsVisible`, and `editingTitle` as those states ship.

export type SessionHeaderUiState = {
  /** S3 — user clicked × on the restore-offer banner (this tab + run only). */
  dismissedBanner: boolean
  /** S2 — banner collapsed to a small accent dot on the tab marker. */
  collapsed: boolean
  /** S1 — pills strip visible (auto-dismissed after first user Return). */
  pillsVisible: boolean
  /** S2 — title contentEditable cursor active. */
  editingTitle: boolean
}

const DEFAULT_STATE: SessionHeaderUiState = {
  dismissedBanner: false,
  collapsed: false,
  pillsVisible: true,
  editingTitle: false,
}

const store: Map<string, SessionHeaderUiState> = new Map()
const subscribers: Set<() => void> = new Set()

export function getSessionHeaderState(tabId: string): SessionHeaderUiState {
  return store.get(tabId) ?? DEFAULT_STATE
}

export function setSessionHeaderState(tabId: string, patch: Partial<SessionHeaderUiState>): void {
  const cur = getSessionHeaderState(tabId)
  store.set(tabId, { ...cur, ...patch })
  subscribers.forEach((fn) => fn())
}

export function clearSessionHeaderState(tabId: string): void {
  if (store.delete(tabId)) subscribers.forEach((fn) => fn())
}

export function subscribeSessionHeader(fn: () => void): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}
