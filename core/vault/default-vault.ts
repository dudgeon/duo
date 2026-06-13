// ENH-208 Vault — the vault preferences file (Phase 2, D11).
//
// A machine-global JSON pref at ~/.claude/duo/vault.json (the established
// shared-pref location, same as external-domains.json / installed-packs.json),
// read by BOTH the CLI and the Electron main process so they share one source
// of truth. Two fields:
//   - `defaultVault` — the single global default (⇧⌘N captures into it, ⌘⇧F
//     searches it, every vault verb falls back to it). Persistent across
//     windows, workspaces, and restarts BY CONSTRUCTION: it lives here, not in
//     any per-window cache or the .duo-workspace envelope, and is read live on
//     every resolution (no cache to drift).
//   - `knownVaults` — every vault Duo has been pointed at (set as default or
//     `vault init`'d). The Settings → Default Vault picker lists these so it is
//     window-INDEPENDENT (same rows in every window) — discovery isn't scoped
//     to the focused window's cwd. Self-healing: entries that are no longer
//     vaults are filtered out live (the no-sidecar litmus — pointers resolve
//     live, never a stale cached path).
//
// Keeping it a file (not main-process state over the socket) preserves the
// verbs' pure-local property: `duo vault capture` with no `--vault` resolves
// the default without a running app.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { isVaultRoot, findVaultRoot, resolveVault } from './detect'

/** Default storage path. Overridable for tests. */
export const DEFAULT_VAULT_FILE = path.join(os.homedir(), '.claude', 'duo', 'vault.json')

export interface VaultPrefs {
  defaultVault?: string
  knownVaults?: string[]
}

/** Shape-hardened read — returns `{}` on missing / unreadable / malformed,
 *  and normalizes each field so a hand-edited file with the wrong types
 *  (`{knownVaults: 42}`, `{knownVaults: "/x"}`) degrades to defaults instead
 *  of throwing downstream (or spreading a string into characters).
 *  Callers still validate paths live (isVaultRoot) so a stale entry never
 *  resolves. */
function readPrefs(filePath: string): VaultPrefs {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return {}
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const rec = parsed as Record<string, unknown>
    const prefs: VaultPrefs = {}
    if (typeof rec.defaultVault === 'string') prefs.defaultVault = rec.defaultVault
    if (Array.isArray(rec.knownVaults)) {
      prefs.knownVaults = rec.knownVaults.filter((v): v is string => typeof v === 'string')
    }
    return prefs
  } catch {
    return {}
  }
}

/** Atomic write (tmp + rename). Omits empty fields so a cleared, never-known
 *  file stays `{}`-shaped rather than carrying empty arrays.
 *
 *  Lost-update guard: the CLI and the Electron main process both
 *  read-modify-write this file with no lock, so re-read at write time and
 *  union-merge `knownVaults` — the list is MONOTONIC under a race (a
 *  concurrent writer's registration can be reordered, never dropped).
 *  `defaultVault` stays last-writer-wins: it's a single user intent.
 *
 *  Exported for the lost-update unit test only — production callers go
 *  through set/remember/clear. */
export function writePrefs(prefs: VaultPrefs, filePath: string): void {
  const onDisk = readPrefs(filePath).knownVaults ?? []
  const known = [...new Set([...onDisk, ...(prefs.knownVaults ?? [])])]
  const out: VaultPrefs = {}
  if (prefs.defaultVault) out.defaultVault = prefs.defaultVault
  if (known.length > 0) out.knownVaults = known
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n')
  fs.renameSync(tmp, filePath)
}

/** Read the configured default vault, or null when unset / unreadable / no
 *  longer a vault (a stale pointer self-heals to null rather than resolving to
 *  a dead path — the no-sidecar litmus: pointers resolve live). */
export function readDefaultVault(filePath: string = DEFAULT_VAULT_FILE): string | null {
  const p = readPrefs(filePath).defaultVault
  return typeof p === 'string' && isVaultRoot(p) ? p : null
}

/** Set the default vault. Validates the target is a real vault first (refuses a
 *  non-vault, so a typo can't strand the pref), and records it in
 *  `knownVaults` so the picker keeps offering it even after a later clear.
 *  Atomic write; preserves any existing known set. */
export function setDefaultVault(target: string, filePath: string = DEFAULT_VAULT_FILE): string {
  const abs = path.resolve(target)
  if (!isVaultRoot(abs)) {
    throw new Error(`not a vault (no .obsidian/): ${abs}. Run \`duo vault init ${target}\` first.`)
  }
  const prefs = readPrefs(filePath)
  prefs.defaultVault = abs
  prefs.knownVaults = [...new Set([...(prefs.knownVaults ?? []), abs])]
  writePrefs(prefs, filePath)
  return abs
}

/** Record a vault in `knownVaults` WITHOUT making it the default — the
 *  registration point for `vault init` (a vault you scaffolded should appear in
 *  the picker before you've ever set it). Idempotent; refuses non-vaults so the
 *  list only ever holds resolvable pointers. */
export function rememberVault(target: string, filePath: string = DEFAULT_VAULT_FILE): void {
  const abs = path.resolve(target)
  if (!isVaultRoot(abs)) return
  const prefs = readPrefs(filePath)
  const known = new Set(prefs.knownVaults ?? [])
  if (known.has(abs)) return
  known.add(abs)
  prefs.knownVaults = [...known]
  writePrefs(prefs, filePath)
}

/** The known vaults, self-healed: entries that are no longer vaults (moved /
 *  deleted) are filtered out live, never shown. Window-independent — the
 *  picker's stable candidate set. */
export function listKnownVaults(filePath: string = DEFAULT_VAULT_FILE): string[] {
  return (readPrefs(filePath).knownVaults ?? []).filter(isVaultRoot).sort()
}

/** Clear the default-vault pref. Crucially PRESERVES `knownVaults` — clearing
 *  the active default must not strand the vaults the picker offers (the bug
 *  that motivated the known-vaults registry). Only when nothing else remains is
 *  the file removed, returning to a clean `{}` state. Idempotent. */
export function clearDefaultVault(filePath: string = DEFAULT_VAULT_FILE): void {
  const prefs = readPrefs(filePath)
  if (prefs.defaultVault === undefined) {
    // Already cleared; if there's also nothing known, ensure no empty file lingers.
    if (!prefs.knownVaults || prefs.knownVaults.length === 0) {
      try {
        fs.unlinkSync(filePath)
      } catch {
        /* already absent */
      }
    }
    return
  }
  delete prefs.defaultVault
  if (!prefs.knownVaults || prefs.knownVaults.length === 0) {
    try {
      fs.unlinkSync(filePath)
    } catch {
      /* already absent */
    }
  } else {
    writePrefs(prefs, filePath)
  }
}

/** Resolve the vault for a renderer UI surface (ENH-208 Phase 2).
 *  Order differs from the CLI's `resolveVaultOrDefault`: the UI chords act
 *  on the DEFAULT vault first (D11 — ⇧⌘N captures into the default vault;
 *  D22 — ⌘⇧F searches it), falling back to the active file's enclosing
 *  vault, else null (callers surface "set a default vault" guidance).
 *  The CLI keeps enclosing-first because a shell cwd inside a vault is a
 *  strong signal; an editor merely *showing* a vault file is weaker than
 *  the user's explicit default. */
export function resolveVaultForUi(
  activePath?: string | null,
  filePath: string = DEFAULT_VAULT_FILE,
): string | null {
  const def = readDefaultVault(filePath)
  if (def) return def
  if (activePath) {
    const enclosing = findVaultRoot(path.dirname(activePath))
    if (enclosing) return enclosing
  }
  return null
}

/** Resolve the vault for a verb, with the default as the last resort:
 *  explicit `--vault` → the enclosing vault (walk-up from cwd) → the
 *  default-vault pref → a clear error. This is what lets the verbs run
 *  from outside any vault once a default is set. */
export function resolveVaultOrDefault(
  cwd: string,
  explicit?: string | null,
  filePath: string = DEFAULT_VAULT_FILE,
): string {
  if (explicit) return resolveVault(cwd, explicit) // explicit always wins (and is validated)
  const enclosing = findVaultRoot(cwd)
  if (enclosing) return enclosing
  const def = readDefaultVault(filePath)
  if (def) return def
  throw new Error(
    `no vault found from ${cwd} (walked up for .obsidian/) and no default vault is set. ` +
      `Pass --vault <path>, set a default with \`duo vault default <path>\`, or run \`duo vault init <folder>\`.`,
  )
}
