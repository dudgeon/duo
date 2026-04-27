#!/usr/bin/env node
// Stage 21e-i — load fork.config.json (or fork.config.default.json
// fallback) and emit values for downstream consumers.
//
// Why this exists
// ---------------
//
// Today, "fork Duo" means grep + patch seven files (electron-builder.yml
// appId / publish, package.json repository, electron/update-checker.ts
// URL, electron/install-service.ts external-domains seed, README install
// URLs). Every upstream merge re-introduces the patched values.
//
// Stage 21e-i moves all of that to one file (fork.config.json) that
// the forker owns. Upstream ships fork.config.default.json with Duo's
// values; forkers copy + edit. This script reads whichever exists and
// emits the values for two downstream consumers:
//
//   1. The build-time path (electron-builder via the dist.sh wrapper).
//      Run with --shell-export to print `export X="..."` lines suitable
//      for `source <(node scripts/load-fork-config.cjs --shell-export)`.
//      The yml uses ${env.X} interpolation against these env vars.
//
//   2. The runtime path (Vite-injected compile-time constants — Stage
//      21e-ii). Run with --json to print the full config as JSON; Vite's
//      `define:` block reads it at compile time.
//
// Usage:
//   node scripts/load-fork-config.cjs                # human-readable summary
//   node scripts/load-fork-config.cjs --shell-export # `export X="Y"` lines
//   node scripts/load-fork-config.cjs --json         # full JSON dump

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const USER_CONFIG = path.join(REPO_ROOT, 'fork.config.json')
const DEFAULT_CONFIG = path.join(REPO_ROOT, 'fork.config.default.json')

function loadConfig() {
  const configPath = fs.existsSync(USER_CONFIG) ? USER_CONFIG : DEFAULT_CONFIG
  if (!fs.existsSync(configPath)) {
    console.error(`[fork-config] ERROR: neither ${USER_CONFIG} nor ${DEFAULT_CONFIG} found.`)
    process.exit(1)
  }

  let raw
  try {
    raw = fs.readFileSync(configPath, 'utf8')
  } catch (err) {
    console.error(`[fork-config] ERROR: cannot read ${configPath}:`, err.message)
    process.exit(1)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error(`[fork-config] ERROR: malformed JSON in ${configPath}:`, err.message)
    process.exit(1)
  }

  // Defensive validation. Required fields throw with a clear message;
  // optional fields default to upstream values.
  const errors = []
  if (typeof parsed.appId !== 'string' || !parsed.appId) errors.push('missing or empty `appId`')
  if (typeof parsed.productName !== 'string' || !parsed.productName) errors.push('missing or empty `productName`')
  if (!parsed.publish || typeof parsed.publish !== 'object') errors.push('missing `publish` block')
  else {
    if (typeof parsed.publish.provider !== 'string') errors.push('missing `publish.provider`')
    if (typeof parsed.publish.owner !== 'string') errors.push('missing `publish.owner`')
    if (typeof parsed.publish.repo !== 'string') errors.push('missing `publish.repo`')
  }
  if (errors.length > 0) {
    console.error(`[fork-config] ERROR: invalid ${configPath}:`)
    errors.forEach((e) => console.error(`  - ${e}`))
    process.exit(1)
  }

  return {
    source: configPath,
    appId: parsed.appId,
    productName: parsed.productName,
    copyright: parsed.copyright || 'Copyright © 2026 Geoff',
    publish: {
      provider: parsed.publish.provider,
      owner: parsed.publish.owner,
      repo: parsed.publish.repo,
    },
    bootstrap: {
      externalDomains: Array.isArray(parsed.bootstrap?.externalDomains)
        ? parsed.bootstrap.externalDomains
        : [],
      helpPinnedFiles: Array.isArray(parsed.bootstrap?.helpPinnedFiles)
        ? parsed.bootstrap.helpPinnedFiles
        : ['faq.html'],
    },
  }
}

function shellEscape(value) {
  // Wrap in double quotes, escape any internal $, ", `, \\
  return `"${String(value).replace(/(["$`\\])/g, '\\$1')}"`
}

function main() {
  const config = loadConfig()
  const arg = process.argv[2]

  if (arg === '--shell-export') {
    // Emit lines suitable for `source <(...)`.
    console.log(`export DUO_APP_ID=${shellEscape(config.appId)}`)
    console.log(`export DUO_PRODUCT_NAME=${shellEscape(config.productName)}`)
    console.log(`export DUO_COPYRIGHT=${shellEscape(config.copyright)}`)
    console.log(`export DUO_PUBLISH_PROVIDER=${shellEscape(config.publish.provider)}`)
    console.log(`export DUO_PUBLISH_OWNER=${shellEscape(config.publish.owner)}`)
    console.log(`export DUO_PUBLISH_REPO=${shellEscape(config.publish.repo)}`)
    console.log(`export DUO_BOOTSTRAP_EXTERNAL_DOMAINS=${shellEscape(JSON.stringify(config.bootstrap.externalDomains))}`)
    console.log(`export DUO_BOOTSTRAP_HELP_PINNED=${shellEscape(JSON.stringify(config.bootstrap.helpPinnedFiles))}`)
    return
  }

  if (arg === '--json') {
    // Emit full JSON for Vite/programmatic consumers.
    process.stdout.write(JSON.stringify(config, null, 2))
    process.stdout.write('\n')
    return
  }

  // Default: human-readable summary.
  console.log(`[fork-config] loaded from ${path.relative(REPO_ROOT, config.source)}`)
  console.log(`  appId:        ${config.appId}`)
  console.log(`  productName:  ${config.productName}`)
  console.log(`  publish:      ${config.publish.owner}/${config.publish.repo} (${config.publish.provider})`)
  console.log(`  bootstrap:`)
  console.log(`    externalDomains: ${JSON.stringify(config.bootstrap.externalDomains)}`)
  console.log(`    helpPinnedFiles: ${JSON.stringify(config.bootstrap.helpPinnedFiles)}`)
}

if (require.main === module) {
  main()
}

module.exports = { loadConfig }
