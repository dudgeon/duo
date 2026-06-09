// ENH-208 Vault — the default-vault preference (Phase 2 foundation, D11).
//
// A machine-global "default vault" so capture / search / the other verbs
// work from anywhere — not just from inside a vault. Stored as plain JSON
// at ~/.claude/duo/vault.json (the established shared-pref location, same
// as external-domains.json / installed-packs.json), so BOTH the CLI and
// the Electron main process read the same source of truth — the Phase-2
// Settings "default vault" picker is just a UI editor for this file.
//
// Keeping it a file (not main-process settings reached over the socket)
// preserves the vault verbs' pure-local property: `duo vault capture` with
// no `--vault` resolves the default without a running app.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { isVaultRoot, findVaultRoot, resolveVault } from './detect'

/** Default storage path. Overridable for tests. */
export const DEFAULT_VAULT_FILE = path.join(os.homedir(), '.claude', 'duo', 'vault.json')

/** Read the configured default vault, or null when unset / unreadable /
 *  no longer a vault (a stale pointer self-heals to null rather than
 *  resolving to a dead path — the no-sidecar litmus: pointers resolve
 *  live). */
export function readDefaultVault(filePath: string = DEFAULT_VAULT_FILE): string | null {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { defaultVault?: unknown }
    const p = typeof parsed.defaultVault === 'string' ? parsed.defaultVault : null
    return p && isVaultRoot(p) ? p : null
  } catch {
    return null
  }
}

/** Set the default vault. Validates the target is a real vault first
 *  (refuses a non-vault, so a typo can't strand the pref). Atomic write. */
export function setDefaultVault(target: string, filePath: string = DEFAULT_VAULT_FILE): string {
  const abs = path.resolve(target)
  if (!isVaultRoot(abs)) {
    throw new Error(`not a vault (no .obsidian/): ${abs}. Run \`duo vault init ${target}\` first.`)
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ defaultVault: abs }, null, 2) + '\n')
  fs.renameSync(tmp, filePath)
  return abs
}

/** Clear the default-vault pref (removes the file). Idempotent. */
export function clearDefaultVault(filePath: string = DEFAULT_VAULT_FILE): void {
  try {
    fs.unlinkSync(filePath)
  } catch {
    /* already absent */
  }
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
