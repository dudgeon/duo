#!/usr/bin/env node
// .claude/skills/smoke-walk/generate.mjs
//
// Transform a smoke-walk manifest into a worksheet manifest and hand
// off to the worksheet generator. The smoke-walk skill remains the
// PROCEDURE doc (when to walk, what items to include, how to react to
// the results) — but the rendering primitive is shared with sprint-plan
// and any future agent-built worksheet.
//
// Manifest shape (legacy / authoritative — see smoke-walk/SKILL.md):
//   { version, date, items: [{ id, title, what_fixes?, steps? }, ...] }
//
// Smoke-walk specific defaults (fixed; users don't override):
//   - PASS / FAIL / SKIP radio (green / red / muted)
//   - "Mark all Pass" footer button
//   - Header line: "SMOKE WALK v<VERSION> (<DATE>)"
//   - Cross-checks manifest.version against package.json (catches the
//     v0.5.4-rev3 confusion where the dev build read one version
//     while the walk page read another).
//
// Usage:
//   node .claude/skills/smoke-walk/generate.mjs <manifest.json> <output.html>

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { basename, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { generateWorksheet } from '../worksheet/generate.mjs'

const [, , manifestPath, outPath] = process.argv
if (!manifestPath || !outPath) {
  console.error('Usage: generate.mjs <manifest.json> <output.html>')
  process.exit(2)
}

// Walk identifier derived from the manifest filename (sans .json).
// Used as the localStorage key suffix so two walks of the same
// version (e.g. Sprint 11 wikilink walk + Sprint 12 image-viewer
// walk both targeting v0.6.10) don't collide on
// `worksheet:smoke-walk-v0.6.10` and silently overwrite each other.
// Pre-fix the suffix was just `v${version}` — same version walks
// crashed into each other and applyState() found no matching items
// so the user's edits appeared to vanish.
const walkSlug = basename(manifestPath, '.json')

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (err) {
  console.error(`Failed to read manifest at ${manifestPath}: ${err.message}`)
  process.exit(2)
}

const { version, date, items } = manifest
if (typeof version !== 'string' || typeof date !== 'string' || !Array.isArray(items)) {
  console.error('Smoke-walk manifest must have { version: string, date: string, items: [...] }')
  process.exit(2)
}

// Cross-check the manifest version against package.json. Catches the
// v0.5.4-rev3 confusion: dev-build titlebar said `0.5.3 ·dev` while
// the walk page said `v0.5.4-rev3` because the post-cut bump was
// missed. Allow `version` to be either an exact match (e.g. "0.5.4")
// or a `<base>-rev<N>` / `<base>-<suffix>` form for re-walks.
function readPackageVersion() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(__dirname, '../../..', 'package.json'),
    resolve(process.cwd(), 'package.json')
  ]
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf8'))
      if (pkg && typeof pkg.version === 'string') return { path: p, version: pkg.version }
    } catch { /* try next candidate */ }
  }
  return null
}

const pkg = readPackageVersion()
if (pkg) {
  const manifestBase = version.split('-')[0]
  if (manifestBase !== pkg.version) {
    console.error('')
    console.error(`✗ Version mismatch — refusing to generate.`)
    console.error(`  Smoke walk manifest version : ${version}  (base: ${manifestBase})`)
    console.error(`  package.json version         : ${pkg.version}`)
    console.error(`  Source: ${pkg.path}`)
    console.error('')
    console.error('  This will cause the dev build titlebar to read one')
    console.error('  version while the walk page reads another — confusing')
    console.error('  during a re-walk ("am I walking the right build?").')
    console.error('')
    console.error('  Fix one of:')
    console.error(`    a) Bump package.json to ${manifestBase} (preferred — see cut-version § Step 7)`)
    console.error(`    b) Rename the manifest to v${pkg.version}*.json`)
    console.error('')
    process.exit(3)
  }
}

// Transform smoke-walk manifest → worksheet manifest.
//
// BUG-091 follow-up — render `manifest.title` if set; otherwise default
// to `Smoke walk · v<full-version>`. Pre-fix this wrapper hardcoded
// `Smoke walk · v${version}` ignoring caller-supplied titles, which
// meant `v0.6.7` and `v0.6.7-rev2` both rendered as the same string in
// the browser-tab strip — owner couldn't tell them apart.
const worksheetManifest = {
  kind: 'smoke-walk',
  name: `smoke-walk-${walkSlug}`,
  version,
  date,
  title: typeof manifest.title === 'string' && manifest.title.length > 0
    ? manifest.title
    : `Smoke walk · v${version}`,
  intro_html: typeof manifest.intro === 'string' && manifest.intro.length > 0
    // Per-manifest intro override — used to surface walk-specific
    // routing instructions (e.g. dual-path decision-gate handling for
    // v0.7.0-rev2). Markdown-style markers in the source: ** → <strong>,
    // newlines → <br>. Keep it simple; complex formatting authors HTML.
    ? manifest.intro
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>')
    : `
    <strong>How this works.</strong>
    For each item below, walk the steps in the running Duo, then toggle
    <em>Pass</em>, <em>Fail</em>, or <em>Skip</em>. Add notes on any
    failure. When you're done, hit <strong>Send to Claude</strong> at
    the bottom (or <strong>Copy results</strong> + paste back if Send
    isn't available in your build).`,
  controls: {
    primary: {
      kind: 'radio',
      name: 'result',
      options: [
        { value: 'PASS', label: 'Pass', color: '#4a7d3e' },
        { value: 'FAIL', label: 'Fail', color: '#b13e3a' },
        { value: 'SKIP', label: 'Skip', color: '#6f6557' }
      ]
    },
    secondary: {
      kind: 'textarea',
      name: 'notes',
      placeholder: 'Notes (optional — required if Fail)',
      rows: 2
    },
    mark_all: { label: 'Mark all Pass', value: 'PASS' }
  },
  result_format: {
    header_template: 'SMOKE WALK v{version} ({date})',
    summary_label: 'SUMMARY'
  },
  items,
  misc_notes: {
    title: 'Other notes',
    help: "Anything you noticed during the walk that didn't belong to a specific item — paper cuts, drift, side bugs, \"while we're at it\" thoughts. Captured in the result block as a separate section.",
    placeholder: 'Free-form notes (optional)',
    result_block_title: 'OTHER NOTES'
  }
}

let html
try {
  html = generateWorksheet(worksheetManifest)
} catch (err) {
  console.error(`Worksheet generator error: ${err.message}`)
  process.exit(2)
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, html, 'utf8')
console.log(`Wrote smoke-walk page: ${outPath}`)
console.log(`  ${items.length} items · v${version} · ${date}`)
