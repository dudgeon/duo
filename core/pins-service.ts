// Stage 24 — pinned WorkingPane tabs.
//
// Persists `~/.claude/duo/pins.json` so pin state survives Duo
// restarts and (eventually) feeds Stage 21c session restore.
//
// Schema (v1):
//   {
//     "version": 1,
//     "pins": [
//       { "kind": "browser", "ref": "file:///.../faq.html", "title": "Duo FAQ" },
//       { "kind": "file",    "ref": "/Users/.../tasks.md",   "title": "tasks.md" }
//     ]
//   }
//
// Pin identity: browser tabs match by URL (so a pinned `file://faq`
// stays pinned across reopens), file tabs by absolute path. Title is
// captured for pre-pinned distro entries (Stage 18b's PACK.json) so
// the chrome can label a pin before its contents load.
//
// Concurrency: writes are atomic (tmp file + rename). Reads are
// best-effort — a corrupt or missing file returns an empty list so
// first launch and subsequent corruption recover identically.

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import type { PinEntry } from '../shared/types'
import { createWriteQueue, uniqueTmpPath } from './write-queue'

const DEFAULT_DIR = path.join(os.homedir(), '.claude', 'duo')
const SCHEMA_VERSION = 1

interface PinsFile {
  version: number
  pins: PinEntry[]
}

export class PinsService {
  private readonly dir: string
  private readonly file: string
  // Phase H (ENH-191 Cut 0) — serialize the read-modify-write so a
  // socket toggle + a renderer-click toggle (or two windows) cannot
  // interleave at the await points and lose an update.
  private readonly enqueue = createWriteQueue()

  // `baseDir` is injectable for tests (avoids polluting the real
  // ~/.claude/duo); production constructs it no-arg.
  constructor(baseDir: string = DEFAULT_DIR) {
    this.dir = baseDir
    this.file = path.join(baseDir, 'pins.json')
  }

  async list(): Promise<PinEntry[]> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PinsFile>
      if (!Array.isArray(parsed.pins)) return []
      // Filter out malformed entries defensively rather than throwing —
      // a single bad entry shouldn't make all pins disappear.
      return parsed.pins.filter(
        (p): p is PinEntry =>
          !!p &&
          (p.kind === 'browser' || p.kind === 'file') &&
          typeof p.ref === 'string' &&
          p.ref.length > 0
      )
    } catch {
      return []
    }
  }

  async toggle(entry: PinEntry): Promise<PinEntry[]> {
    return this.enqueue(async () => {
      const current = await this.list()
      const idx = current.findIndex(p => p.kind === entry.kind && p.ref === entry.ref)
      const next = idx >= 0
        ? [...current.slice(0, idx), ...current.slice(idx + 1)]
        : [...current, entry]
      await this.write(next)
      return next
    })
  }

  private async write(pins: PinEntry[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const file: PinsFile = { version: SCHEMA_VERSION, pins }
    const tmp = uniqueTmpPath(this.file)
    try {
      await fs.writeFile(tmp, JSON.stringify(file, null, 2) + '\n')
      await fs.rename(tmp, this.file)
    } catch (err) {
      // Best-effort cleanup so a failed write doesn't orphan a unique tmp.
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw err
    }
  }
}
