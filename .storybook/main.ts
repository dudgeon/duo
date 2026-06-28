import type { StorybookConfig } from '@storybook/react-vite'
import { resolve } from 'path'
import * as fs from 'fs'

// ENH-239 Phase 1 — Storybook on the Vite builder (matches electron-vite's
// Vite, so cold-start/HMR are fast). The renderer references __DUO_*__ as
// compile-time constants and imports via the @shared alias; viteFinal injects
// both, plus points PostCSS at the repo-root config (tailwind lives there).
//
// NB: loadForkDefines mirrors vite.preview.config.ts — keep them in sync if
// fork.config gains fields.
function loadForkDefines(): Record<string, string> {
  const userPath = resolve(__dirname, '../fork.config.json')
  const defaultPath = resolve(__dirname, '../fork.config.default.json')
  const path = fs.existsSync(userPath) ? userPath : defaultPath
  const fork = JSON.parse(fs.readFileSync(path, 'utf8'))
  return {
    __DUO_APP_ID__: JSON.stringify(fork.appId),
    __DUO_PRODUCT_NAME__: JSON.stringify(fork.productName),
    __DUO_PUBLISH_PROVIDER__: JSON.stringify(fork.publish.provider),
    __DUO_PUBLISH_OWNER__: JSON.stringify(fork.publish.owner),
    __DUO_PUBLISH_REPO__: JSON.stringify(fork.publish.repo),
    __DUO_BOOTSTRAP_EXTERNAL_DOMAINS__: JSON.stringify(fork.bootstrap.externalDomains),
    __DUO_BOOTSTRAP_HELP_PINNED__: JSON.stringify(fork.bootstrap.helpPinnedFiles),
    __DUO_PACKS_DISABLED__: JSON.stringify(fork.packs?.disabled ?? []),
  }
}

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../renderer/**/*.stories.@(ts|tsx)'],
  addons: [],
  core: { disableTelemetry: true },
  async viteFinal(cfg) {
    cfg.resolve = cfg.resolve ?? {}
    cfg.resolve.alias = { ...(cfg.resolve.alias ?? {}), '@shared': resolve(__dirname, '../shared') }
    cfg.define = { ...(cfg.define ?? {}), ...loadForkDefines() }
    cfg.css = { ...(cfg.css ?? {}), postcss: resolve(__dirname, '..') }
    return cfg
  },
}

export default config
