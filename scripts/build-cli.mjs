#!/usr/bin/env node
/**
 * Builds the tracked `cli/duo` esbuild bundle from `cli/duo.ts`.
 *
 * The CLI's VERSION is injected here at build time from package.json via
 * esbuild's `define`, so `duo --version` / `duo --help` / `duo doctor`
 * always track the real release — no hand-bumped constant to forget.
 * (Before 2026-05-29 the version was a hardcoded `const VERSION = '0.1.0'`
 * that drifted to package.json's 0.8.5, making `duo doctor` always report
 * a version mismatch.)
 *
 * Run via `npm run build:cli`; commit the resulting `cli/duo` binary —
 * it's a tracked bundle so users install without a build step.
 */
import { build } from 'esbuild'
import { readFileSync, chmodSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

await build({
  entryPoints: [join(root, 'cli', 'duo.ts')],
  bundle: true,
  platform: 'node',
  outfile: join(root, 'cli', 'duo'),
  define: {
    // esbuild replaces the bare identifier __DUO_VERSION__ in cli/duo.ts
    // with this string literal at build time.
    __DUO_VERSION__: JSON.stringify(pkg.version),
  },
})

chmodSync(join(root, 'cli', 'duo'), 0o755)
console.log('Built cli/duo (version ' + pkg.version + ')')
