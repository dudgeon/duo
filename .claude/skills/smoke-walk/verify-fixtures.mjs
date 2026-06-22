#!/usr/bin/env node
// .claude/skills/smoke-walk/verify-fixtures.mjs
//
// MECHANICAL FIXTURE GUARD. Reads a smoke-walk manifest and actually runs
// every `duo open|edit <target>` it tells the owner to run, asserting each
// returns ok:true. Exits NON-ZERO if ANY fixture can't open — so a sheet
// with a bad fixture (file-missing, no-extension, wrong repo, unsupported
// kind) CANNOT reach the owner.
//
// Why this exists: prose rules kept getting skipped. The owner has FAILed
// multiple walks on fixtures the agent never opened itself (a no-extension
// `…/README`, a non-existent `.github/FUNDING.yml`). A script that fails
// loudly is enforcement; a rule in a doc is a suggestion. The smoke-walk
// SKILL now MANDATES a clean run of this guard before any handoff.
//
// Usage (from anywhere — resolves ./cli/duo relative to the repo):
//   node .claude/skills/smoke-walk/verify-fixtures.mjs <manifest.json>
//
// Requires the Duo dev app running (it drives the live `duo` CLI, same code
// path the owner hits). Exit 0 = every fixture opened; exit 1 = at least one
// failed; exit 2 = usage / manifest error.

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { homedir } from 'node:os'

// Expand a leading ~/ the way the owner's shell would (spawnSync bypasses the
// shell, so an un-expanded ~ would 404 here while opening fine for the owner).
const expandHome = (arg) => (arg.startsWith('~/') ? join(homedir(), arg.slice(2)) : arg)

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
// .claude/skills/smoke-walk/ -> repo root is three levels up.
const DUO = resolve(SCRIPT_DIR, '../../../cli/duo')

// Gather every string a fixture command could hide in: intro + each item's
// what_fixes + steps. Exported for unit testing.
export function manifestHaystacks(manifest) {
  const haystacks = []
  const pushAll = (...vals) => vals.forEach((v) => typeof v === 'string' && haystacks.push(v))
  pushAll(manifest.intro, manifest.intro_html)
  for (const item of manifest.items || []) {
    pushAll(item.what_fixes)
    for (const s of item.steps || []) pushAll(s)
  }
  return haystacks
}

// Collect every backtick-wrapped `duo open|edit <target>` from the manifest.
// The smoke-walk convention wraps commands in backticks; deduped, order
// preserved. Exported so the guard's parsing is unit-tested independently of
// the live `duo` calls.
export function extractFixtures(manifest) {
  const fenced = /`\s*duo\s+(open|edit)\s+([^`]+?)\s*`/g
  const fixtures = []
  const seen = new Set()
  for (const h of manifestHaystacks(manifest)) {
    let m
    while ((m = fenced.exec(h)) !== null) {
      const verb = m[1]
      const target = m[2].trim()
      const key = `${verb} ${target}`
      if (!seen.has(key)) {
        seen.add(key)
        fixtures.push({ verb, target })
      }
    }
  }
  return fixtures
}

// Catch un-backticked "duo open/edit" mentions the fenced matcher misses —
// likely real fixtures an author forgot to format, which would slip through
// unverified. Exported for testing.
export function extractBareWarnings(manifest) {
  const warnings = []
  for (const h of manifestHaystacks(manifest)) {
    const bare = /\bduo\s+(open|edit)\s+\S+/g
    let m
    while ((m = bare.exec(h)) !== null) {
      const before = h.slice(Math.max(0, m.index - 1), m.index)
      if (before !== '`') warnings.push(h.slice(m.index, m.index + 60).replace(/\n/g, ' '))
    }
  }
  return warnings
}

function main() {
  const manifestPath = process.argv[2]
  if (!manifestPath) {
    console.error('usage: verify-fixtures.mjs <manifest.json>')
    process.exit(2)
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    console.error(`Cannot read/parse manifest: ${manifestPath}\n  ${err.message}`)
    process.exit(2)
  }

  const fixtures = extractFixtures(manifest)
  const bareWarnings = extractBareWarnings(manifest)

  if (fixtures.length === 0) {
    console.log(`No \`duo open|edit\` fixtures found in ${manifestPath} — nothing to verify.`)
    if (bareWarnings.length) {
      console.log('\n⚠️  but found un-backticked duo commands (verify these manually):')
      bareWarnings.forEach((w) => console.log(`    ${w}`))
    }
    process.exit(0)
  }

  console.log(`Verifying ${fixtures.length} fixture(s) from ${manifestPath} via ${DUO}\n`)

  let failed = 0
  for (const { verb, target } of fixtures) {
    const args = [verb, ...target.split(/\s+/).map(expandHome)]
    const res = spawnSync(DUO, args, { encoding: 'utf8', timeout: 90000 })
    const stdout = (res.stdout || '').trim()
    const stderr = (res.stderr || '').trim()

    let ok
    let detail = ''
    try {
      const j = JSON.parse(stdout)
      ok = j.ok !== false
      if (!ok) detail = j.error ? `${j.error}${j.errorKind ? ` (${j.errorKind})` : ''}` : stdout
    } catch {
      // Non-JSON output: fall back to the process exit code, but surface the
      // raw output so the agent can eyeball it.
      ok = res.status === 0
      if (!ok) detail = stderr || stdout || `exit ${res.status}`
    }

    if (ok) {
      console.log(`  ✓ duo ${verb} ${target}`)
    } else {
      failed++
      console.log(`  ✗ duo ${verb} ${target}`)
      console.log(`      → ${detail.replace(/\n/g, '\n        ')}`)
    }
  }

  if (bareWarnings.length) {
    console.log('\n⚠️  un-backticked duo commands (NOT auto-verified — check by hand):')
    bareWarnings.forEach((w) => console.log(`    ${w}`))
  }

  console.log(
    failed === 0
      ? `\n✅ all ${fixtures.length} fixture(s) open — safe to hand off`
      : `\n❌ ${failed}/${fixtures.length} fixture(s) FAILED — fix the manifest BEFORE handoff`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

// Run only when invoked directly (not when imported by a test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
