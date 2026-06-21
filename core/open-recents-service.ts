// ENH-221 D14 — Open Recent store.
//
// Persists `~/.claude/duo/open-recents.json` — the last N targets opened
// via the Open bar (local paths AND GitHub URLs), machine-global,
// surfaced in File ▸ Open Recent and inside the empty Open bar.
//
// No-sidecar (CLAUDE.md §12): entries are POINTERS — the raw target
// string + a display label + a kind + a timestamp. They resolve live on
// click; a target that no longer exists self-heals (the consuming UI
// greys it, and `record` naturally ages it out). We never mirror file
// contents or GitHub state here.
//
// Schema (v1):
//   {
//     "version": 1,
//     "recents": [
//       { "target": "~/duo/docs/roadmap.md", "label": "roadmap.md",
//         "kind": "local", "lastOpenedAt": 1718900000000 },
//       { "target": "https://github.com/o/r/blob/main/README.md",
//         "label": "o/r › README.md", "kind": "github-file",
//         "lastOpenedAt": 1718800000000 }
//     ]
//   }
//
// Modeled on PinsService: injectable baseDir for tests, write-queue so
// concurrent records can't interleave, atomic tmp+rename writes, and a
// defensive read that returns [] on missing/corrupt files.

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { createWriteQueue, uniqueTmpPath } from './write-queue'
import type { RecentEntry, RecentKind } from '../shared/types'

// Canonical type home is shared/types.ts (so the renderer Open bar + preload
// share one contract). Re-exported here for existing core/CLI importers.
export type { RecentEntry, RecentKind }

interface RecentsFile {
  version: number
  recents: RecentEntry[]
}

const DEFAULT_DIR = path.join(os.homedir(), '.claude', 'duo')
const SCHEMA_VERSION = 1
export const MAX_RECENTS = 10

function isValidEntry(e: unknown): e is RecentEntry {
  if (!e || typeof e !== 'object') return false
  const r = e as Partial<RecentEntry>
  return (
    typeof r.target === 'string' &&
    r.target.length > 0 &&
    typeof r.label === 'string' &&
    (r.kind === 'local' || r.kind === 'github-file' || r.kind === 'github-repo' || r.kind === 'url') &&
    typeof r.lastOpenedAt === 'number' &&
    Number.isFinite(r.lastOpenedAt)
  )
}

export class OpenRecentsService {
  private readonly dir: string
  private readonly file: string
  private readonly enqueue = createWriteQueue()

  constructor(baseDir: string = DEFAULT_DIR) {
    this.dir = baseDir
    this.file = path.join(baseDir, 'open-recents.json')
  }

  /** Most-recent-first; defensive — missing/corrupt file returns []. */
  async list(): Promise<RecentEntry[]> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<RecentsFile>
      if (!Array.isArray(parsed.recents)) return []
      return parsed.recents
        .filter(isValidEntry)
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
        .slice(0, MAX_RECENTS)
    } catch {
      return []
    }
  }

  /**
   * Record an open. Dedupes by `target` (an existing entry moves to the
   * front with a refreshed label + timestamp), then caps at MAX_RECENTS.
   * `at` is injectable for deterministic tests.
   */
  async record(
    entry: Omit<RecentEntry, 'lastOpenedAt'> & { lastOpenedAt?: number },
    at: number = Date.now()
  ): Promise<RecentEntry[]> {
    return this.enqueue(async () => {
      const stamped: RecentEntry = {
        target: entry.target,
        label: entry.label,
        kind: entry.kind,
        lastOpenedAt: entry.lastOpenedAt ?? at,
      }
      if (!isValidEntry(stamped)) return this.list()
      const current = await this.list()
      const deduped = current.filter((r) => r.target !== stamped.target)
      const next = [stamped, ...deduped]
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
        .slice(0, MAX_RECENTS)
      await this.write(next)
      return next
    })
  }

  /** Clear the whole list (File ▸ Open Recent ▸ Clear). */
  async clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.write([])
    })
  }

  private async write(recents: RecentEntry[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const file: RecentsFile = { version: SCHEMA_VERSION, recents }
    const tmp = uniqueTmpPath(this.file)
    try {
      await fs.writeFile(tmp, JSON.stringify(file, null, 2) + '\n')
      await fs.rename(tmp, this.file)
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw err
    }
  }
}
