// ENH-239 Phase 0 — the single mock seam.
//
// The renderer reaches Electron through ~478 `window.electron.*` call-sites
// across ~30 files with NO abstraction layer (typed by `interface
// ElectronAPI`, shared/host-api.ts). Because access is global, we satisfy
// ALL of it by setting `window.electron` once, before React mounts — no
// call-site edits.
//
// `createMockElectron()` returns a Proxy typed as ElectronAPI:
//   - unknown namespaces auto-stub (so `window.electron.anything.x()` is safe),
//   - `on*` / `subscribe*` / `watch*` return a no-op unsubscribe,
//   - other invokes resolve `undefined` by default,
//   - boot-critical reads get explicit fixtures so `App.tsx` mounts.
// Typed against ElectronAPI, so a bridge change is a COMPILE error here.
//
// Template precedent: renderer/hooks/useNavigator.flicker.test.ts.

import type { ElectronAPI, ElectronEnv } from '@shared/host-api'
import type { SessionState } from '@shared/types'

// on… / subscribe… methods are sync subscriptions — return an unsubscribe.
// (NB: `watch`-style methods are async and RESOLVE to an unsubscribe, so they
// are not in this set — they fall to the invoke default / explicit stubs.)
const SUBSCRIBE = /^(on[A-Z]|subscribe)/

function defaultMethod(name: string) {
  if (SUBSCRIBE.test(name)) return (..._a: unknown[]) => () => {}
  return async (..._a: unknown[]) => undefined
}

/** A namespace proxy: explicit overrides win; everything else auto-stubs. */
function ns<T extends object>(overrides: Record<string, unknown> = {}): T {
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop]
      return defaultMethod(prop)
    },
  }) as unknown as T
}

export interface MockElectronFixtures {
  env?: Partial<ElectronEnv>
  sessionState?: SessionState
}

export function emptySessionState(): SessionState {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    appVersion: 'preview',
    terminals: [],
    activeTerminalIndex: -1,
    browserTabs: [],
    activeBrowserIndex: -1,
    fileTabs: [],
    activeWorking: null,
    navigatorPath: '',
    aux: null,
  }
}

export function createMockElectron(fixtures: MockElectronFixtures = {}): ElectronAPI {
  const env: ElectronEnv = {
    HOME: '/tmp/duo-preview',
    SHELL: '/bin/zsh',
    USER: 'preview',
    appVersion: 'preview',
    isDev: true,
    windowId: 1,
    blank: false,
    initialCwd: '',
    ...fixtures.env,
  }
  const session = fixtures.sessionState ?? emptySessionState()

  // Boot-path namespaces get explicit returns; array/object reads default to
  // empty so `.map`/`.then` consumers don't crash. Everything else auto-stubs.
  const explicit: Record<string, unknown> = {
    env,
    files: ns({
      exists: async () => false,
      dirExists: async () => true,
      list: async () => [],
      kind: async () => 'file',
      write: async () => {},
      trash: async () => {},
      revealInFinder: () => {},
      // watch returns Promise<() => Promise<void>> — resolve to a no-op unwatch.
      watch: async () => async () => {},
    }),
    sessionState: ns({
      load: async () => session,
      save: async () => {},
      notifyRestoreSettled: () => {},
      onSnapshotRequest: () => () => {},
      snapshotReply: () => {},
    }),
    pins: ns({ list: async () => [], toggle: async () => [] }),
    navPins: ns({ list: async () => [] }),
    recents: ns({ list: async () => [] }),
    projects: ns({ read: async () => ({ projects: [], focusedRoot: null }) }),
    browser: ns({ getTabs: async () => [] }),
    pty: ns({ liveCwd: async () => '', liveCwds: async () => ({}), write: async () => {} }),
    terminal: ns({ claudeOnPath: async () => false }),
    vault: ns({ getDefault: async () => null, search: async () => [] }),
    workspaceFile: ns({ active: async () => null, listRecent: async () => [] }),
    session: ns({ listPrior: async () => [] }),
    git: ns({
      worktrees: async () => [],
      status: async () => null, // callers use gitSnap?.… so null = "not a repo"
      scanReposIn: async () => ({}),
      dirtyFilesFor: async () => ({}),
      watchStart: async () => ({ ok: false }),
      watchStop: async () => ({ ok: true }),
      ghAuth: async () => ({}),
      githubUrlFor: async () => ({}),
    }),
    dialog: ns({ confirm: async () => false }),
  }

  return new Proxy(explicit, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop]
      return ns() // unknown namespace → fully auto-stubbed
    },
  }) as unknown as ElectronAPI
}
