import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Duo Web — Vite config for the browser-served renderer.
 *
 * Diverges from `electron.vite.config.ts`:
 *
 *   - No main/preload targets — those don't exist in the web build.
 *   - Output goes to `web/client-dist/` so the daemon's static-server
 *     can find it next to `out/web/daemon`.
 *   - We reuse the `__DUO_*__` defines so `shared/fork-config.d.ts`
 *     consumers in `renderer/` keep working.
 *   - The dev server runs on a fixed port (5173) so the daemon can
 *     proxy `/ws/renderer` and `/api/bootstrap` straight to it during
 *     development.
 */

import * as fs from 'fs'

interface ForkConfig {
  appId: string
  productName: string
  publish: { provider: string; owner: string; repo: string }
  bootstrap: { externalDomains: string[]; helpPinnedFiles: string[] }
}

function loadForkConfigForBuild(): ForkConfig {
  const root = resolve(__dirname, '../..')
  const userPath = resolve(root, 'fork.config.json')
  const defaultPath = resolve(root, 'fork.config.default.json')
  const p = fs.existsSync(userPath) ? userPath : defaultPath
  return JSON.parse(fs.readFileSync(p, 'utf8')) as ForkConfig
}

const fork = loadForkConfigForBuild()

const FORK_DEFINES = {
  __DUO_APP_ID__: JSON.stringify(fork.appId),
  __DUO_PRODUCT_NAME__: JSON.stringify(fork.productName),
  __DUO_PUBLISH_PROVIDER__: JSON.stringify(fork.publish.provider),
  __DUO_PUBLISH_OWNER__: JSON.stringify(fork.publish.owner),
  __DUO_PUBLISH_REPO__: JSON.stringify(fork.publish.repo),
  __DUO_BOOTSTRAP_EXTERNAL_DOMAINS__: JSON.stringify(fork.bootstrap.externalDomains),
  __DUO_BOOTSTRAP_HELP_PINNED__: JSON.stringify(fork.bootstrap.helpPinnedFiles)
}

export default defineConfig({
  root: __dirname,
  base: './',
  define: FORK_DEFINES,
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../../shared'),
      '@renderer': resolve(__dirname, '../../renderer')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: resolve(__dirname, '../client-dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html')
      }
    }
  },
  plugins: [react()]
})
