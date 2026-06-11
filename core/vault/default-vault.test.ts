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
} from './index'
import { initVault } from './scaffold'

let dir: string
let prefFile: string
let vaultA: string
let vaultB: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-default-vault-'))
  prefFile = path.join(dir, 'vault.json')
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

  it('refuses a non-vault target', () => {
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
