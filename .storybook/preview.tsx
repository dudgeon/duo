import type { Preview } from '@storybook/react'
import '../renderer/styles/globals.css'
import { createMockElectron } from '../renderer/test-support/mock-electron'
import { previewFixtures } from '../renderer/test-support/fixtures'

// ENH-239 Phase 1 — install the mocked Electron bridge ONCE, before any story
// renders, so components that reach window.electron.* render in isolation
// without a real preload. Same factory as the browser-preview entry.
;(window as unknown as { electron: ReturnType<typeof createMockElectron> }).electron =
  createMockElectron(previewFixtures)

// Duo ships light by default (electron/main.ts sets themeSource = 'light');
// set the attribute so globals.css's [data-theme] tokens resolve in stories.
document.documentElement.setAttribute('data-theme', 'light')

const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
}

export default preview
