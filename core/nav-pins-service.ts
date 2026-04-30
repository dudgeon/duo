// Stage 26 PR 2 (ENH-010) — pinned files & folders in the navigator.
//
// Persists ~/.claude/duo/nav-pins.json so navigator-pin state
// survives Duo restarts. Separate from Stage 24's tab pins
// (~/.claude/duo/pins.json): different storage, different UX.
//   - Stage 24 pins are WorkingPane tab pins (right column).
//   - Stage 26 PR 2 pins are navigator shortcuts (left column,
//     bottom section), keyed by absolute path.
//
// Schema (v1):
//   {
//     "version": 1,
//     "pins": [
//       { "path": "/Users/.../tasks.md",        "kind": "file"   },
//       { "path": "/Users/.../GitHub/duo",      "kind": "folder", "title": "duo" },
//       { "path": "/Users/.../Documents/notes", "kind": "folder", "title": "notes" }
//     ]
//   }
//
// Pin identity: absolute path. Toggling re-uses the same path-match
// rule to add or remove. `title` is a cached basename so the pinned
// section can render without an extra stat() — refreshed on toggle.
//
// Concurrency: writes are atomic (tmp file + rename). Reads are
// best-effort — corrupt or missing file returns an empty list.

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import type { NavPinEntry } from '../shared/types'

const NAV_PINS_DIR = path.join(os.homedir(), '.claude', 'duo')
const NAV_PINS_PATH = path.join(NAV_PINS_DIR, 'nav-pins.json')
const SCHEMA_VERSION = 1

interface NavPinsFile {
  version: number
  pins: NavPinEntry[]
}

export class NavPinsService {
  async list(): Promise<NavPinEntry[]> {
    try {
      const raw = await fs.readFile(NAV_PINS_PATH, 'utf8')
      const parsed = JSON.parse(raw) as Partial<NavPinsFile>
      if (!Array.isArray(parsed.pins)) return []
      // Filter malformed entries defensively rather than throwing —
      // a single bad entry shouldn't make all pins disappear.
      return parsed.pins.filter(
        (p): p is NavPinEntry =>
          !!p &&
          (p.kind === 'file' || p.kind === 'folder') &&
          typeof p.path === 'string' &&
          p.path.length > 0
      )
    } catch {
      return []
    }
  }

  async toggle(entry: NavPinEntry): Promise<NavPinEntry[]> {
    const current = await this.list()
    const idx = current.findIndex(p => p.path === entry.path)
    const next = idx >= 0
      ? [...current.slice(0, idx), ...current.slice(idx + 1)]
      : [...current, entry]
    await this.write(next)
    return next
  }

  private async write(pins: NavPinEntry[]): Promise<void> {
    await fs.mkdir(NAV_PINS_DIR, { recursive: true })
    const file: NavPinsFile = { version: SCHEMA_VERSION, pins }
    const tmp = NAV_PINS_PATH + '.duo.tmp'
    await fs.writeFile(tmp, JSON.stringify(file, null, 2) + '\n')
    await fs.rename(tmp, NAV_PINS_PATH)
  }
}
