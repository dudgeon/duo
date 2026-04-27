import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Stage 21e-ii — runtime fork-config injection.
//
// Read fork.config.json (or fork.config.default.json fallback) at
// build time and inject the values as compile-time constants into
// the main / preload / renderer bundles. Source code references
// these via the `__DUO_*__` identifiers (declared globally in
// `shared/fork-config.d.ts`); Vite's `define:` does a literal
// string substitution at compile time so there's no runtime cost.
//
// Why compile-time vs. runtime: the values shouldn't change between
// launches (a fork's identity is fixed at build time). Runtime
// reads would mean every consumer pays a JSON-parse + fs-read cost
// at startup; compile-time substitution puts the literal string
// directly into the bundle.
//
// Inline the JSON read here rather than `require()`-ing the loader
// — esbuild (Vite's bundler for the config file) chokes on the
// loader's `#!/usr/bin/env node` shebang when it tries to resolve
// it as a dependency. A 5-line direct read is simpler than fixing
// the loader-as-importable-module path.
import * as fs from 'fs'

interface ForkConfig {
  appId: string
  productName: string
  publish: { provider: string; owner: string; repo: string }
  bootstrap: { externalDomains: string[]; helpPinnedFiles: string[] }
}

function loadForkConfigForBuild(): ForkConfig {
  const userPath = resolve(__dirname, 'fork.config.json')
  const defaultPath = resolve(__dirname, 'fork.config.default.json')
  const path = fs.existsSync(userPath) ? userPath : defaultPath
  return JSON.parse(fs.readFileSync(path, 'utf8')) as ForkConfig
}

const fork = loadForkConfigForBuild()

const FORK_DEFINES = {
  __DUO_APP_ID__: JSON.stringify(fork.appId),
  __DUO_PRODUCT_NAME__: JSON.stringify(fork.productName),
  __DUO_PUBLISH_PROVIDER__: JSON.stringify(fork.publish.provider),
  __DUO_PUBLISH_OWNER__: JSON.stringify(fork.publish.owner),
  __DUO_PUBLISH_REPO__: JSON.stringify(fork.publish.repo),
  __DUO_BOOTSTRAP_EXTERNAL_DOMAINS__: JSON.stringify(fork.bootstrap.externalDomains),
  __DUO_BOOTSTRAP_HELP_PINNED__: JSON.stringify(fork.bootstrap.helpPinnedFiles),
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: FORK_DEFINES,
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    define: FORK_DEFINES,
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    define: FORK_DEFINES,
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'renderer/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared')
      }
    },
    plugins: [react()]
  }
})
