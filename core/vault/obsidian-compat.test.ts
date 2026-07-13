// ENH-266c — Obsidian-compat `.obsidian/app.json` seed. OKF mode writes
// prose links as standard markdown links, never wikilinks (frontmatter
// entity refs are a separate, not-yet-shipped effort — sibling ENH-266a);
// these two Obsidian settings (confirmed live against a real installed
// Obsidian 1.12.7) flip Obsidian's factory-default (Use Wikilinks ON) so a
// human authoring a NEW prose link inside Obsidian matches OKF's own
// convention instead of producing an unresolved phantom-node wikilink.
//
// Covers the shared helper directly (seed-when-absent, respect-when-present,
// foreign-bundle-skip) plus its three call sites: scaffold-time (initVault's
// OKF branch), create-on-choose (setDefaultVault picking an ALREADY-existing
// vault — the branch that never touches initVault), and the eligibility gate
// electron/main.ts's vault-open flow (maybeAutoRelinkVault) reuses.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  seedObsidianAppJson,
  maybeSeedObsidianAppJson,
  setDefaultVault,
  detectVaultMode,
  isForeignVault,
} from './index'
import { initVault } from './scaffold'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-obsidian-compat-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const APP_JSON_PATH = (vault: string) => path.join(vault, '.obsidian', 'app.json')

describe('seedObsidianAppJson — the raw absent-only writer', () => {
  it('seed-when-absent: writes exactly the two ENH-266c keys', () => {
    const v = path.join(root, 'v')
    fs.mkdirSync(v, { recursive: true })
    expect(seedObsidianAppJson(v)).toBe(true)
    expect(fs.existsSync(APP_JSON_PATH(v))).toBe(true)
    const parsed = JSON.parse(fs.readFileSync(APP_JSON_PATH(v), 'utf8'))
    expect(parsed).toEqual({ useMarkdownLinks: true, newLinkFormat: 'relative' })
    expect(Object.keys(parsed).sort()).toEqual(['newLinkFormat', 'useMarkdownLinks'])
  })

  it('respect-when-present: an existing app.json (any content) is byte-unchanged', () => {
    const v = path.join(root, 'v')
    fs.mkdirSync(path.join(v, '.obsidian'), { recursive: true })
    const ownerContent = JSON.stringify({ promptDelete: true, someOtherKey: 'kept' }, null, 2) + '\n'
    fs.writeFileSync(APP_JSON_PATH(v), ownerContent)
    expect(seedObsidianAppJson(v)).toBe(false)
    expect(fs.readFileSync(APP_JSON_PATH(v), 'utf8')).toBe(ownerContent) // byte-identical
  })

  it('respect-when-present: even an EMPTY app.json ({}) is left untouched', () => {
    const v = path.join(root, 'v')
    fs.mkdirSync(path.join(v, '.obsidian'), { recursive: true })
    fs.writeFileSync(APP_JSON_PATH(v), '{}')
    expect(seedObsidianAppJson(v)).toBe(false)
    expect(fs.readFileSync(APP_JSON_PATH(v), 'utf8')).toBe('{}')
  })
})

describe('maybeSeedObsidianAppJson — the OKF-mode + non-foreign gate', () => {
  it('seeds an OKF-mode vault', () => {
    const v = initVault(path.join(root, 'v')).root
    fs.rmSync(APP_JSON_PATH(v)) // scaffold-time seed already wrote it — clear to isolate this call
    expect(detectVaultMode(v)).toBe('okf')
    expect(maybeSeedObsidianAppJson(v)).toBe(true)
    expect(fs.existsSync(APP_JSON_PATH(v))).toBe(true)
  })

  it('skips an Obsidian-mode vault (its own .obsidian/app.json is a different shape — never touched)', () => {
    const v = initVault(path.join(root, 'v'), { format: 'obsidian' }).root
    expect(detectVaultMode(v)).toBe('obsidian')
    const before = fs.readFileSync(APP_JSON_PATH(v), 'utf8')
    expect(maybeSeedObsidianAppJson(v)).toBe(false)
    expect(fs.readFileSync(APP_JSON_PATH(v), 'utf8')).toBe(before) // legacy Obsidian scaffold content intact
  })

  it('foreign-bundle-skip: a vault carrying loop.manifest.json is NEVER seeded, even via the gate', () => {
    const v = path.join(root, 'foreign')
    fs.mkdirSync(v, { recursive: true })
    fs.writeFileSync(path.join(v, '_index.md'), '---\nokf_version: "0.1"\ntype: index\n---\n')
    fs.writeFileSync(path.join(v, 'loop.manifest.json'), JSON.stringify({ kit: 'brainkit' }))
    expect(detectVaultMode(v)).toBe('okf')
    expect(isForeignVault(v)).toBe(true)
    expect(maybeSeedObsidianAppJson(v)).toBe(false)
    expect(fs.existsSync(APP_JSON_PATH(v))).toBe(false)
  })
})

describe('site 1 — scaffold-time seed (initVault OKF branch)', () => {
  it('a freshly-scaffolded OKF vault carries .obsidian/app.json with the two keys', () => {
    const v = initVault(path.join(root, 'v')).root
    const parsed = JSON.parse(fs.readFileSync(APP_JSON_PATH(v), 'utf8'))
    expect(parsed).toEqual({ useMarkdownLinks: true, newLinkFormat: 'relative' })
  })

  it('a freshly-scaffolded Obsidian-mode vault keeps its OWN legacy app.json (different keys, untouched)', () => {
    const v = initVault(path.join(root, 'v'), { format: 'obsidian' }).root
    const parsed = JSON.parse(fs.readFileSync(APP_JSON_PATH(v), 'utf8'))
    expect(parsed).toEqual({ promptDelete: false, alwaysUpdateLinks: true })
  })
})

describe('site 2 — create-on-choose via setDefaultVault (the "already a vault" branch)', () => {
  it('picking an EXISTING OKF vault that pre-dates ENH-266c self-heals the seed', () => {
    // Simulate a vault created before this PR shipped: a bare OKF marker,
    // no .obsidian/ at all — never went through initVault's scaffold-time
    // seed. This is exactly the branch `duo vault default <path> --init`
    // hits when <path> is already a vault (it calls setDefaultVault directly,
    // never initVault).
    const v = path.join(root, 'pre-existing')
    fs.mkdirSync(v, { recursive: true })
    fs.writeFileSync(path.join(v, '_index.md'), '---\nokf_version: "0.1"\ntype: index\n---\n')
    expect(fs.existsSync(APP_JSON_PATH(v))).toBe(false)
    const prefFile = path.join(root, 'vault.json')
    setDefaultVault(v, prefFile)
    expect(fs.existsSync(APP_JSON_PATH(v))).toBe(true)
    expect(JSON.parse(fs.readFileSync(APP_JSON_PATH(v), 'utf8'))).toEqual({
      useMarkdownLinks: true,
      newLinkFormat: 'relative',
    })
  })

  it('setDefaultVault never seeds a foreign OKF bundle even when chosen as default', () => {
    const v = path.join(root, 'foreign')
    fs.mkdirSync(v, { recursive: true })
    fs.writeFileSync(path.join(v, '_index.md'), '---\nokf_version: "0.1"\ntype: index\n---\n')
    fs.writeFileSync(path.join(v, 'loop.manifest.json'), JSON.stringify({ kit: 'brainkit' }))
    const prefFile = path.join(root, 'vault.json')
    setDefaultVault(v, prefFile)
    expect(fs.existsSync(APP_JSON_PATH(v))).toBe(false)
  })

  it('setDefaultVault respects an already-configured app.json (byte-unchanged)', () => {
    const v = initVault(path.join(root, 'v')).root
    const owner = JSON.stringify({ useMarkdownLinks: false, newLinkFormat: 'absolute', customFlag: true })
    fs.writeFileSync(APP_JSON_PATH(v), owner)
    const prefFile = path.join(root, 'vault.json')
    setDefaultVault(v, prefFile)
    expect(fs.readFileSync(APP_JSON_PATH(v), 'utf8')).toBe(owner)
  })
})
