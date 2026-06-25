// Vitest config — small unit-test scope (added v0.6.4).
//
// Default environment is `node` so pure-function tests run as fast as
// possible. Tests that need a DOM (e.g. characterization tests for the
// worksheet primitive's generated HTML + inline-script behavior) opt
// into jsdom via a per-file directive at the top of the test:
//
//   // @vitest-environment jsdom
//
// jsdom is in devDependencies as of v0.6.6 (Sprint 5 — playground
// primitives initiative; needed for worksheet generator characterization
// tests). The `@shared` path alias mirrors what electron-vite +
// tsconfig.web.json already wire so test imports look the same as
// production imports.
//
// What we test here:
// - Pure utility functions (tilde expansion, file classification)
// - Pure regex matchers extracted from the markdown-trigger machinery
//   in renderer/components/Page/markdownShortcuts.ts (the
//   recurring-regression class — BUG-061 v1/v2/v3 — needed durable
//   coverage so future iterations don't regress what's been fixed)
// - Generated-HTML behavior contracts (worksheet primitive — locks in
//   the smoke-walk-shaped contract before refactoring onto the
//   ENH-092/093/094 playground primitives).
//
// What we DON'T test here:
// - Electron main-process behavior (BrowserWindow, IPC, etc.)
// - React component rendering (would need jsdom + @testing-library)
// - End-to-end UI flows (would need Playwright + a launched Duo)
// Those layers stay covered by the smoke-walk skill at sprint close.

import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared')
    }
  },
  test: {
    // `.test.tsx` added for ENH-231 — the first React-component render tests
    // (CatchupBoard / HomeView), which need JSX (the @testing-library/react +
    // jsdom devDeps were already present for exactly this).
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', 'out/**', 'dist/**', '.claude/worktrees/**'],
    environment: 'node'
  }
})
