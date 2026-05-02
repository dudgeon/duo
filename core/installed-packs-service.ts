// Stage 18b — Installed-packs state.
//
// Per-pack-version first-launch flag stored at
// ~/.claude/duo/installed-packs.json. Keys are `<name>@<version>` so
// bumping a pack's version re-fires its `defaults[]` (the user
// gets the new welcome canvas etc.) without re-firing for unchanged
// packs.
//
// Atomic writes (tmp + rename) mirror the pins service. Missing or
// corrupt file = treat all packs as not-yet-first-launched (defaults
// will fire on next boot). Same defensive posture as nav-pins-
// service: a single bad entry shouldn't strand the whole file.

import * as fs from 'fs/promises'
import * as path from 'path'
import { INSTALLED_PACKS_PATH } from './constants'
import type {
  InstalledPackEntry,
  InstalledPacksState,
} from '../shared/types'

const SCHEMA_VERSION = 1

const EMPTY_STATE: InstalledPacksState = {
  schemaVersion: SCHEMA_VERSION,
  packs: {},
}

function isEntry(v: unknown): v is InstalledPackEntry {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as InstalledPackEntry).firstLaunchedAt === 'string'
  )
}

export class InstalledPacksService {
  /** Read the current state file. Returns the empty state on missing
   *  / corrupt / wrong-schema. Never throws — callers can rely on a
   *  valid InstalledPacksState. */
  async load(): Promise<InstalledPacksState> {
    let raw: string
    try {
      raw = await fs.readFile(INSTALLED_PACKS_PATH, 'utf8')
    } catch {
      return { schemaVersion: SCHEMA_VERSION, packs: {} }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { schemaVersion: SCHEMA_VERSION, packs: {} }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { schemaVersion: SCHEMA_VERSION, packs: {} }
    }
    const obj = parsed as Partial<InstalledPacksState>
    if (obj.schemaVersion !== SCHEMA_VERSION) {
      // Future schema bump: load a converter; for v1 we just discard.
      return { schemaVersion: SCHEMA_VERSION, packs: {} }
    }
    const cleaned: Record<string, InstalledPackEntry> = {}
    if (obj.packs && typeof obj.packs === 'object' && !Array.isArray(obj.packs)) {
      for (const [key, val] of Object.entries(obj.packs)) {
        if (typeof key === 'string' && key.length > 0 && isEntry(val)) {
          cleaned[key] = val
        }
      }
    }
    return { schemaVersion: SCHEMA_VERSION, packs: cleaned }
  }

  /** Atomic write. Creates the parent dir if missing. */
  async save(state: InstalledPacksState): Promise<void> {
    const dir = path.dirname(INSTALLED_PACKS_PATH)
    await fs.mkdir(dir, { recursive: true })
    const tmp = `${INSTALLED_PACKS_PATH}.tmp`
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
    await fs.rename(tmp, INSTALLED_PACKS_PATH)
  }

  /** Mark `<name>@<version>` as first-launched. Idempotent — calling
   *  twice doesn't update the timestamp. Returns the new state for
   *  callers that want to re-emit it. */
  async markFirstLaunched(
    name: string,
    version: string,
    when: Date = new Date()
  ): Promise<InstalledPacksState> {
    const key = `${name}@${version}`
    const state = await this.load()
    if (state.packs[key]) return state
    state.packs[key] = { firstLaunchedAt: when.toISOString() }
    await this.save(state)
    return state
  }

  /** Helper: returns true when this pack@version has NOT yet been
   *  first-launched. */
  static needsFirstLaunch(
    state: InstalledPacksState,
    name: string,
    version: string
  ): boolean {
    return !state.packs[`${name}@${version}`]
  }
}

// Re-export for callers that want the empty value without
// constructing one inline.
export const EMPTY_INSTALLED_PACKS_STATE = EMPTY_STATE
