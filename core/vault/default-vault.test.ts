// ENH-208 Vault — default-vault pref tests (Phase 2 foundation, D11).
// Uses an injected temp file path so nothing touches the real
// ~/.claude/duo/vault.json.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  readDefaultVault,
  setDefaultVault,
  clearDefaultVault,
  rememberVault,
  listKnownVaults,
  resolveVaultOrDefault,
  resolveVaultForUi,
  detectVaultMode,
} from './index'
import { writePrefs } from './default-vault'
import { initVault } from './scaffold'

let dir: string
let prefFile: string
let vaultA: string
let vaultB: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-default-vault-'))
  prefFile = path.join(dir, 'vault.json')
  // ENH-216 D2: initVault now defaults to OKF, so these scaffolded test
  // vaults are OKF-mode — the default-vault pref is mode-agnostic (it stores
  // a pointer only, never a mode key, D4) and must accept either mode.
  vaultA = initVault(path.join(dir, 'A')).root
  vaultB = initVault(path.join(dir, 'B')).root
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('default-vault pref', () => {
  it('reads null when unset', () => {
    expect(readDefaultVault(prefFile)).toBeNull()
  })

  it('sets + reads a default vault (validated, absolute) + records it as known', () => {
    const set = setDefaultVault(vaultA, prefFile)
    expect(set).toBe(vaultA)
    expect(readDefaultVault(prefFile)).toBe(vaultA)
    expect(JSON.parse(fs.readFileSync(prefFile, 'utf8'))).toEqual({
      defaultVault: vaultA,
      knownVaults: [vaultA],
    })
  })

  it('accepts an OKF vault and stores NO mode key (the pref is a pointer only, D4)', () => {
    // The scaffolded vaultA is OKF (D2 default). setDefaultVault must accept
    // it the same as an Obsidian vault, and the on-disk pref must carry only
    // pointers — never a `mode` (mode is live-detected from the marker, D4).
    expect(detectVaultMode(vaultA)).toBe('okf')
    setDefaultVault(vaultA, prefFile)
    const onDisk = JSON.parse(fs.readFileSync(prefFile, 'utf8'))
    expect(Object.keys(onDisk).sort()).toEqual(['defaultVault', 'knownVaults'])
    expect('mode' in onDisk).toBe(false)
  })

  it('refuses a non-vault target (the /not a vault/ guard still holds)', () => {
    expect(() => setDefaultVault(path.join(dir, 'not-a-vault'), prefFile)).toThrow(/not a vault/)
  })

  it('clears the pref (idempotent)', () => {
    setDefaultVault(vaultA, prefFile)
    clearDefaultVault(prefFile)
    expect(readDefaultVault(prefFile)).toBeNull()
    expect(() => clearDefaultVault(prefFile)).not.toThrow() // already gone
  })

  it('self-heals a stale pointer to null (the no-sidecar litmus)', () => {
    setDefaultVault(vaultA, prefFile)
    fs.rmSync(vaultA, { recursive: true, force: true }) // vault deleted out from under the pref
    expect(readDefaultVault(prefFile)).toBeNull() // resolves live, never a dead path
  })
})

describe('known vaults (ENH-208 Phase 2 — window-independent picker)', () => {
  it('clearing the default PRESERVES the known list (the stranding bug)', () => {
    setDefaultVault(vaultA, prefFile)
    setDefaultVault(vaultB, prefFile) // both now known; B is the default
    clearDefaultVault(prefFile)
    expect(readDefaultVault(prefFile)).toBeNull()
    // The picker can still offer A and B even though nothing is the default.
    expect(listKnownVaults(prefFile)).toEqual([vaultA, vaultB].sort())
  })

  it('rememberVault records without changing the default', () => {
    rememberVault(vaultA, prefFile)
    expect(readDefaultVault(prefFile)).toBeNull() // not made the default
    expect(listKnownVaults(prefFile)).toEqual([vaultA])
  })

  it('rememberVault is idempotent and refuses non-vaults', () => {
    rememberVault(vaultA, prefFile)
    rememberVault(vaultA, prefFile)
    rememberVault(path.join(dir, 'not-a-vault'), prefFile)
    expect(listKnownVaults(prefFile)).toEqual([vaultA])
  })

  it('listKnownVaults self-heals — a deleted vault drops off the list', () => {
    setDefaultVault(vaultA, prefFile)
    rememberVault(vaultB, prefFile)
    fs.rmSync(vaultA, { recursive: true, force: true })
    expect(listKnownVaults(prefFile)).toEqual([vaultB]) // A filtered out live
  })

  it('clearing a legacy file (default only, no known list) removes it entirely', () => {
    // A pre-knownVaults file: just { defaultVault }. Clearing leaves nothing
    // to keep, so the file is removed (returns to a clean unset state).
    fs.writeFileSync(prefFile, JSON.stringify({ defaultVault: vaultA }) + '\n')
    clearDefaultVault(prefFile)
    expect(fs.existsSync(prefFile)).toBe(false)
  })

  it('clearing keeps the file while any known entry remains (filtered live on read)', () => {
    setDefaultVault(vaultA, prefFile) // known: [vaultA]
    fs.rmSync(vaultA, { recursive: true, force: true }) // vault deleted, but the raw entry persists
    clearDefaultVault(prefFile)
    expect(fs.existsSync(prefFile)).toBe(true) // raw knownVaults non-empty → file kept
    expect(listKnownVaults(prefFile)).toEqual([]) // …but the dead entry is filtered on read
  })

  it('the same known list resolves regardless of caller (window-independent)', () => {
    // No cwd/window input — listKnownVaults is a pure read of the global file,
    // so every window's menu build sees the identical set.
    setDefaultVault(vaultA, prefFile)
    rememberVault(vaultB, prefFile)
    expect(listKnownVaults(prefFile)).toEqual([vaultA, vaultB].sort())
  })
})

describe('pref-file shape hardening (hand-edited / malformed files)', () => {
  it('a non-array knownVaults ({knownVaults: 42}) degrades to [] — no throw', () => {
    fs.writeFileSync(prefFile, JSON.stringify({ knownVaults: 42 }) + '\n')
    expect(listKnownVaults(prefFile)).toEqual([])
  })

  it('a string knownVaults ({knownVaults: "/x"}) is not spread into characters', () => {
    fs.writeFileSync(prefFile, JSON.stringify({ knownVaults: '/x' }) + '\n')
    expect(listKnownVaults(prefFile)).toEqual([])
    setDefaultVault(vaultA, prefFile) // pre-fix: spread '/x' into ['/', 'x']
    expect(JSON.parse(fs.readFileSync(prefFile, 'utf8')).knownVaults).toEqual([vaultA])
  })

  it('non-string entries inside a knownVaults array are filtered out', () => {
    fs.writeFileSync(prefFile, JSON.stringify({ knownVaults: [vaultA, 7, null] }) + '\n')
    expect(listKnownVaults(prefFile)).toEqual([vaultA])
  })

  it('a non-string defaultVault reads as unset', () => {
    fs.writeFileSync(prefFile, JSON.stringify({ defaultVault: ['/x'] }) + '\n')
    expect(readDefaultVault(prefFile)).toBeNull()
  })
})

describe('knownVaults lost-update guard (CLI + Electron race)', () => {
  it('writePrefs union-merges with the on-disk knownVaults', () => {
    // Simulate the race: another writer landed vaultB on disk AFTER this
    // writer's read (its prefs object only knows about vaultA).
    fs.writeFileSync(prefFile, JSON.stringify({ knownVaults: [vaultB] }) + '\n')
    writePrefs({ defaultVault: vaultA, knownVaults: [vaultA] }, prefFile)
    const onDisk = JSON.parse(fs.readFileSync(prefFile, 'utf8'))
    expect(onDisk.defaultVault).toBe(vaultA) // last-writer-wins, by design
    expect([...onDisk.knownVaults].sort()).toEqual([vaultA, vaultB].sort()) // monotonic
  })
})

describe('resolveVaultOrDefault precedence', () => {
  it('explicit --vault wins over everything', () => {
    setDefaultVault(vaultA, prefFile)
    expect(resolveVaultOrDefault('/tmp', vaultB, prefFile)).toBe(vaultB)
  })

  it('the enclosing vault beats the default', () => {
    setDefaultVault(vaultA, prefFile)
    // cwd is inside vault B → B wins even though A is the default
    expect(resolveVaultOrDefault(path.join(vaultB, 'inbox'), null, prefFile)).toBe(vaultB)
  })

  it('falls back to the default when outside any vault', () => {
    setDefaultVault(vaultA, prefFile)
    expect(resolveVaultOrDefault(dir, null, prefFile)).toBe(vaultA)
  })

  it('throws a clear error when nothing resolves', () => {
    expect(() => resolveVaultOrDefault(dir, null, prefFile)).toThrow(/no default vault is set/)
  })
})

describe('resolveVaultForUi precedence (ENH-208 Phase 2 — D11/D22)', () => {
  it('the default vault wins even when the active file sits in another vault', () => {
    setDefaultVault(vaultA, prefFile)
    // UI order inverts the CLI: ⇧⌘N / ⌘⇧F act on the DEFAULT first
    expect(resolveVaultForUi(path.join(vaultB, 'inbox', 'note.md'), prefFile)).toBe(vaultA)
  })

  it("falls back to the active file's enclosing vault when no default is set", () => {
    expect(resolveVaultForUi(path.join(vaultB, 'inbox', 'note.md'), prefFile)).toBe(vaultB)
  })

  it('returns null when no default is set and the active file is outside any vault', () => {
    expect(resolveVaultForUi(path.join(dir, 'loose.md'), prefFile)).toBeNull()
  })

  it('returns null with no default and no active file', () => {
    expect(resolveVaultForUi(null, prefFile)).toBeNull()
  })
})

describe('PR#98 review — --no-default contract (C1) + mode-aware rejection (C2)', () => {
  // C1 — `duo vault init --no-default` skips setDefaultVault while still
  // calling rememberVault. At the core level that's exactly this combination:
  // a vault registered in knownVaults WITHOUT becoming the global default.
  it('rememberVault registers a vault without hijacking an established default', () => {
    setDefaultVault(vaultA, prefFile) // a pre-existing default that must survive
    rememberVault(vaultB, prefFile) // the --no-default path: remember only
    expect(readDefaultVault(prefFile)).toBe(vaultA) // default untouched
    expect(listKnownVaults(prefFile)).toContain(vaultB) // still offered by the picker
  })

  // C2 — proves the "not a vault (no .obsidian/)" path is COSMETIC: the guard
  // (isVaultRoot → detectVaultMode) accepts a real OKF vault, so it's never
  // rejected; only the message string was stale.
  it('setDefaultVault accepts an OKF vault (root index.md w/ okf_version, no .obsidian/)', () => {
    expect(fs.existsSync(path.join(vaultA, '.obsidian'))).toBe(false) // it IS an OKF vault
    expect(detectVaultMode(vaultA)).toBe('okf')
    expect(() => setDefaultVault(vaultA, prefFile)).not.toThrow()
    expect(readDefaultVault(prefFile)).toBe(vaultA)
  })

  // C2 — the rejection message names BOTH markers (not just .obsidian/).
  it('setDefaultVault rejection names both the OKF and Obsidian markers', () => {
    const notAVault = path.join(dir, 'nope')
    fs.mkdirSync(notAVault, { recursive: true })
    expect(() => setDefaultVault(notAVault, prefFile)).toThrow(
      /okf_version _index\.md\/index\.md or \.obsidian\//,
    )
  })
})
