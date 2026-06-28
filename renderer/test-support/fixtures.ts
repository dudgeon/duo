// ENH-239 Phase 0 — sample state for the browser preview entry.
// Keep this realistic-but-minimal; richer fixtures (open file tabs, a
// populated navigator) can land as the harness grows.

import type { MockElectronFixtures } from './mock-electron'

export const previewFixtures: MockElectronFixtures = {
  env: {
    HOME: '/Users/preview',
    USER: 'preview',
    appVersion: 'preview',
    isDev: true,
    windowId: 1,
  },
}
