// Vitest config — small unit-test scope (added v0.6.4).
//
// Tests target pure helpers extracted from main/renderer code so they
// can run in plain Node without an Electron runtime or jsdom. The
// `@shared` path alias mirrors what electron-vite + tsconfig.web.json
// already wire so test imports look the same as production imports.
//
// What we test here:
// - Pure utility functions (tilde expansion, file classification)
// - Pure regex matchers extracted from the markdown-trigger machinery
//   in renderer/components/HtmlCanvas/markdownShortcuts.ts (the
//   recurring-regression class — BUG-061 v1/v2/v3 — needed durable
//   coverage so future iterations don't regress what's been fixed)
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
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', 'out/**', 'dist/**', '.claude/worktrees/**'],
    environment: 'node'
  }
})
