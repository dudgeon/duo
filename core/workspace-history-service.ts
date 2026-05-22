// ENH-167 — Open Recent Workspaces backing store.
//
// Mirrors browser-history-service.ts pattern: lazy-load, atomic write,
// LRU by `lastOpenedAt`. Capped at HISTORY_CAP (10 per owner Q4).
// Prune-missing-on-read: when the renderer pulls the list, any entry
// whose file no longer exists on disk is dropped from both the
// in-memory list AND the persisted file. The user never sees a
// dangling Open Recent row.

import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { WorkspaceHistoryEntry } from '../shared/types'

const HISTORY_DIR = path.join(os.homedir(), '.claude', 'duo')
const HISTORY_PATH = path.join(HISTORY_DIR, 'workspace-history.json')
const HISTORY_CAP = 10
const SCHEMA_VERSION = 1

interface HistoryFile {
  version: number
  entries: WorkspaceHistoryEntry[]
}

export class WorkspaceHistoryService {
  private entries: WorkspaceHistoryEntry[] = []
  private loaded = false
  private writeTimer: NodeJS.Timeout | null = null

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await fs.readFile(HISTORY_PATH, 'utf8')
      const parsed = JSON.parse(raw) as Partial<HistoryFile>
      if (Array.isArray(parsed.entries)) {
        this.entries = parsed.entries.filter(
          (e): e is WorkspaceHistoryEntry =>
            !!e &&
            typeof e.path === 'string' &&
            typeof e.name === 'string' &&
            typeof e.lastOpenedAt === 'number' &&
            typeof e.savedAt === 'string'
        )
      }
    } catch {
      // missing / corrupt → start empty
    }
    this.loaded = true
  }

  /** Record a save or open. Updates an existing entry's
   *  lastOpenedAt+name+savedAt or appends a new one. LRU-prunes to
   *  HISTORY_CAP entries by lastOpenedAt. */
  async record(entry: { path: string; name: string; savedAt: string }): Promise<void> {
    await this.ensureLoaded()
    const idx = this.entries.findIndex(e => e.path === entry.path)
    const now = Date.now()
    if (idx >= 0) {
      this.entries[idx].lastOpenedAt = now
      this.entries[idx].name = entry.name
      this.entries[idx].savedAt = entry.savedAt
    } else {
      this.entries.push({
        path: entry.path,
        name: entry.name,
        savedAt: entry.savedAt,
        lastOpenedAt: now
      })
    }
    if (this.entries.length > HISTORY_CAP) {
      this.entries.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      this.entries = this.entries.slice(0, HISTORY_CAP)
    }
    this.scheduleWrite()
  }

  /** Synchronous read of the in-memory entries. Caller is responsible
   *  for calling ensureLoaded() at least once before relying on this.
   *  Used by the macOS menu builder, which is synchronous. */
  getEntriesSync(): WorkspaceHistoryEntry[] {
    return [...this.entries]
  }

  /** Return entries sorted by recency, pruning any whose file is gone.
   *  Owner Q4 — "prune missing on open." */
  async listSorted(): Promise<WorkspaceHistoryEntry[]> {
    await this.ensureLoaded()
    const surviving: WorkspaceHistoryEntry[] = []
    let pruned = false
    for (const e of this.entries) {
      if (fsSync.existsSync(e.path)) {
        surviving.push(e)
      } else {
        pruned = true
      }
    }
    if (pruned) {
      this.entries = surviving
      this.scheduleWrite()
    }
    return [...surviving].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  }

  /** Remove a specific entry (e.g. user picked Open Recent on a path
   *  that was deleted out-from-under us between menu-render and click). */
  async forget(filePath: string): Promise<void> {
    await this.ensureLoaded()
    const next = this.entries.filter(e => e.path !== filePath)
    if (next.length !== this.entries.length) {
      this.entries = next
      this.scheduleWrite()
    }
  }

  /** Wipe the entire history. Backs the File > Open Recent Workspace >
   *  Clear Recent Workspaces menu item. */
  async clear(): Promise<void> {
    await this.ensureLoaded()
    this.entries = []
    this.scheduleWrite()
  }

  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    await this.write()
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this.write()
    }, 500)
  }

  private async write(): Promise<void> {
    try {
      await fs.mkdir(HISTORY_DIR, { recursive: true })
      const file: HistoryFile = { version: SCHEMA_VERSION, entries: this.entries }
      const tmp = HISTORY_PATH + '.duo.tmp'
      await fs.writeFile(tmp, JSON.stringify(file, null, 2) + '\n', 'utf8')
      await fs.rename(tmp, HISTORY_PATH)
    } catch (err) {
      console.warn('[workspace-history] write failed:', (err as Error)?.message ?? err)
    }
  }
}
