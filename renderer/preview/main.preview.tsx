// ENH-239 Phase 0 — browser preview entry. Mirrors renderer/main.tsx, but
// installs the mocked Electron bridge BEFORE pulling in App, so the whole
// shell renders in a plain browser with no Electron / preload present.

import '@xterm/xterm/css/xterm.css'
import '../styles/globals.css'
import ReactDOM from 'react-dom/client'
import { createMockElectron } from '../test-support/mock-electron'
import { previewFixtures } from '../test-support/fixtures'

// Must run before any module that reads window.electron at import time. App
// and its component tree are pulled in via the dynamic import below, which
// executes after this assignment.
;(window as unknown as { electron: ReturnType<typeof createMockElectron> }).electron =
  createMockElectron(previewFixtures)

async function boot() {
  const { App } = await import('../App')
  const { ErrorBoundary } = await import('../components/ErrorBoundary')
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  )
}

void boot()
