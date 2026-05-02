// Stage 18b — Distro skill pack loader.
//
// Scans ~/.claude/duo/packs/, parses each PACK.json, returns a
// LoadedPack[] registry. Defensive by design: a malformed manifest
// surfaces as a `LoadedPack` with `manifest: null` and an `errors`
// array, NOT a thrown exception that would crash boot. Other packs
// keep loading.
//
// Cadence: scanned once on app boot via PackLoader.scan() → cached
// in a PackRegistry that the SocketServer's `duo packs` case + the
// first-launch defaults hook both consume. Hot-reload (re-scan
// without restart) is out of scope for v1; restart Duo to pick up
// new packs.
//
// Why this lives in core/: shared between main process (Electron)
// and any future Native Messaging host. Same-process-only — no
// cross-process state.

import * as fs from 'fs/promises'
import * as path from 'path'
import { PACKS_DIR } from './constants'
import type {
  LoadedPack,
  PackDefault,
  PackManifest,
  PackNavPin,
  PackRegistry,
} from '../shared/types'

const SUPPORTED_SCHEMA_VERSION = 1

/**
 * Validate a parsed JSON object against the v1 PackManifest contract.
 * Returns the typed manifest on success or an array of human-readable
 * error strings on failure. Errors are diagnostic — `duo packs`
 * surfaces them so an authoring agent can self-correct.
 */
function validateManifest(
  raw: unknown,
  dirName: string
): { manifest: PackManifest } | { errors: string[] } {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['PACK.json must be a JSON object'] }
  }
  const obj = raw as Record<string, unknown>
  const sv = obj.schemaVersion
  if (sv !== SUPPORTED_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must be ${SUPPORTED_SCHEMA_VERSION} (got ${JSON.stringify(sv)}); ` +
      `pack loader does not understand other schema versions yet`
    )
  }
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    errors.push('name must be a non-empty string')
  } else if (obj.name !== dirName) {
    errors.push(
      `name field "${obj.name}" must match the pack directory name "${dirName}"`
    )
  }
  if (typeof obj.version !== 'string' || obj.version.length === 0) {
    errors.push('version must be a non-empty string')
  }
  if (typeof obj.title !== 'string' || obj.title.length === 0) {
    errors.push('title must be a non-empty string')
  }
  if (obj.description !== undefined && typeof obj.description !== 'string') {
    errors.push('description, when present, must be a string')
  }

  // defaults[] — optional. Each entry is validated; bad entries push
  // errors but don't reject the whole manifest. Returning a
  // best-effort defaults[] lets a pack with one bad row still
  // first-launch-open the rest.
  const defaults: PackDefault[] = []
  if (obj.defaults !== undefined) {
    if (!Array.isArray(obj.defaults)) {
      errors.push('defaults, when present, must be an array')
    } else {
      obj.defaults.forEach((d, idx) => {
        if (!d || typeof d !== 'object') {
          errors.push(`defaults[${idx}] must be an object`)
          return
        }
        const def = d as Record<string, unknown>
        if (def.kind !== 'canvas') {
          errors.push(`defaults[${idx}].kind must be 'canvas' (v1 only)`)
          return
        }
        if (typeof def.path !== 'string' || def.path.length === 0) {
          errors.push(`defaults[${idx}].path must be a non-empty string`)
          return
        }
        if (typeof def.openOnFirstLaunch !== 'boolean') {
          errors.push(`defaults[${idx}].openOnFirstLaunch must be boolean`)
          return
        }
        if (def.pin !== undefined && typeof def.pin !== 'boolean') {
          errors.push(`defaults[${idx}].pin, when present, must be boolean`)
          return
        }
        defaults.push({
          kind: 'canvas',
          path: def.path,
          openOnFirstLaunch: def.openOnFirstLaunch,
          ...(def.pin !== undefined ? { pin: def.pin } : {}),
        })
      })
    }
  }

  // navPins[] — same defensive parse pattern.
  const navPins: PackNavPin[] = []
  if (obj.navPins !== undefined) {
    if (!Array.isArray(obj.navPins)) {
      errors.push('navPins, when present, must be an array')
    } else {
      obj.navPins.forEach((p, idx) => {
        if (!p || typeof p !== 'object') {
          errors.push(`navPins[${idx}] must be an object`)
          return
        }
        const pin = p as Record<string, unknown>
        if (typeof pin.path !== 'string' || pin.path.length === 0) {
          errors.push(`navPins[${idx}].path must be a non-empty string`)
          return
        }
        if (
          pin.kind !== undefined &&
          pin.kind !== 'file' &&
          pin.kind !== 'folder'
        ) {
          errors.push(`navPins[${idx}].kind, when present, must be 'file' or 'folder'`)
          return
        }
        navPins.push({
          path: pin.path,
          ...(pin.kind ? { kind: pin.kind as 'file' | 'folder' } : {}),
        })
      })
    }
  }

  if (errors.length > 0) return { errors }

  // All checks passed. Construct the typed manifest. We've already
  // narrowed each field above so the casts here are safe.
  const manifest: PackManifest = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    name: obj.name as string,
    version: obj.version as string,
    title: obj.title as string,
    ...(obj.description ? { description: obj.description as string } : {}),
    ...(defaults.length > 0 ? { defaults } : {}),
    ...(navPins.length > 0 ? { navPins } : {}),
  }
  return { manifest }
}

/**
 * Loader for distro packs. One instance per main process. Construct
 * once at app boot, call `scan()` whenever you need a fresh registry
 * (cheap: filesystem-bound, ~milliseconds for a handful of packs).
 */
export class PackLoader {
  /** Last scan result. Updated by every scan() call. Consumers may
   *  read this directly between scans. */
  private cached: PackRegistry = { packs: [] }

  /** Walk the packs directory, parse each PACK.json, return the
   *  registry. Missing packs dir is treated as "no packs" (empty
   *  registry, no error). */
  async scan(): Promise<PackRegistry> {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(PACKS_DIR, { withFileTypes: true })
    } catch (err: unknown) {
      // ENOENT = no packs dir = no packs. Anything else = log and
      // return empty so app boot doesn't fail on a permissions issue
      // we can't fix.
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        console.warn(`[PackLoader] readdir(${PACKS_DIR}) failed:`, err)
      }
      this.cached = { packs: [] }
      return this.cached
    }

    const packs: LoadedPack[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      // Skip dotfiles + the special installed-packs.json file's
      // sibling state if any.
      if (entry.name.startsWith('.')) continue
      const rootDir = path.join(PACKS_DIR, entry.name)
      packs.push(await this.loadOne(rootDir, entry.name))
    }

    // Stable sort by directory name so iteration order is predictable
    // (first-launch defaults fire in this order).
    packs.sort((a, b) => a.dirName.localeCompare(b.dirName))
    this.cached = { packs }
    return this.cached
  }

  /** Read the cached registry without re-scanning. Returns empty
   *  registry if scan() hasn't been called yet. */
  get(): PackRegistry {
    return this.cached
  }

  private async loadOne(rootDir: string, dirName: string): Promise<LoadedPack> {
    const manifestPath = path.join(rootDir, 'PACK.json')
    let raw: unknown
    try {
      const text = await fs.readFile(manifestPath, 'utf8')
      raw = JSON.parse(text)
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return {
          dirName,
          rootDir,
          manifest: null,
          errors: ['PACK.json missing — directory ignored'],
        }
      }
      return {
        dirName,
        rootDir,
        manifest: null,
        errors: [
          `Failed to read or parse PACK.json: ${err instanceof Error ? err.message : String(err)}`,
        ],
      }
    }
    const result = validateManifest(raw, dirName)
    if ('errors' in result) {
      return { dirName, rootDir, manifest: null, errors: result.errors }
    }
    return { dirName, rootDir, manifest: result.manifest, errors: [] }
  }
}
