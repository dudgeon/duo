import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import * as fs from 'fs'

// ENH-239 Phase 0 — standalone Vite server that renders the Duo renderer
// OUTSIDE Electron (root = renderer/, entry = renderer/preview/index.html).
// This is the browser-runnable render path that gives Claude an observable
// design loop; it is NOT a build target (electron.vite.config.ts still owns
// the shipped renderer bundle).
//
// Replicates the FORK_DEFINES that electron.vite.config injects, because
// renderer code references __DUO_*__ as compile-time constants — without
// them the bundle throws ReferenceError at runtime.

function loadForkDefines(): Record<string, string> {
  const userPath = resolve(__dirname, 'fork.config.json')
  const defaultPath = resolve(__dirname, 'fork.config.default.json')
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

export default defineConfig({
  root: resolve(__dirname, 'renderer'),
  define: loadForkDefines(),
  resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
  // postcss.config.mjs + tailwind.config.mjs live at the repo root, above the
  // renderer/ root — point Vite at them explicitly so globals.css's Tailwind
  // directives are processed.
  css: { postcss: __dirname },
  plugins: [react()],
  // No auto-open: the agent loop hits /preview/ directly; humans open it.
  server: { port: 5199 },
})
