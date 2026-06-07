// ENH-191 P5a (S1) — main-side app settings, persisted at
// `~/.claude/duo/settings.json`. The first setting is the multi-window
// enable flag (`multiWindow`), which gates ONLY window-opening (the "New
// Window" menu item + `duo window new`); the registry / windowId-resolution
// plumbing is byte-identical at N=1 regardless of this flag (PRD §7.2).
//
// Owner decision 2026-06-07: `multiWindow` defaults TRUE (multi-window on by
// default; users can disable it via the Settings menu). This overrides the
// PRD's original "default false until Cut 4a ships green" — recorded in
// PRD §7.2.
//
// Storage shape: same `~/.claude/duo/` dir + atomic tmp+rename write as the
// other Duo services (pins.json, projects.json, session-state.json). NOT a
// shared-origin localStorage key on the storage-event bus — a per-window flag
// divergence would be the C13 hazard class. Read once at boot in main; the
// renderer learns the value via one-shot IPC (S3), not the storage broadcast.

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { uniqueTmpPath } from './write-queue'

export interface DuoSettings {
  /** ENH-191 P5a — multi-window opening. Default ON (owner decision). Gates
   *  ONLY the "New Window" menu item + `duo window new`; never the
   *  byte-identical-at-N=1 registry / windowId resolution. */
  multiWindow: boolean
}

export const DEFAULT_SETTINGS: DuoSettings = {
  multiWindow: true,
}

const SETTINGS_DIR = path.join(os.homedir(), '.claude', 'duo')
const SETTINGS_PATH = path.join(SETTINGS_DIR, 'settings.json')

export class SettingsService {
  private cache: DuoSettings = { ...DEFAULT_SETTINGS }
  private readonly settingsPath: string
  private readonly settingsDir: string

  // Injectable path (default = the real ~/.claude/duo/settings.json) so
  // node-env tests point at an isolated temp dir with real fs.
  constructor(settingsPath: string = SETTINGS_PATH) {
    this.settingsPath = settingsPath
    this.settingsDir = path.dirname(settingsPath)
  }

  /** Load from disk into the cache. Best-effort: a missing / corrupt /
   *  wrong-typed file falls back to defaults (field-by-field) so a single bad
   *  value can't wipe the rest. Call once at boot before get(). */
  async load(): Promise<DuoSettings> {
    try {
      const raw = await fs.readFile(this.settingsPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<DuoSettings>
      this.cache = {
        multiWindow:
          typeof parsed.multiWindow === 'boolean' ? parsed.multiWindow : DEFAULT_SETTINGS.multiWindow,
      }
    } catch {
      // ENOENT first launch (the common path) or a corrupt file → defaults.
      this.cache = { ...DEFAULT_SETTINGS }
    }
    return this.cache
  }

  /** Synchronous cached read (valid after load()). */
  get(): DuoSettings {
    return { ...this.cache }
  }

  /** Merge `patch` into the cache and persist atomically (tmp + rename, unique
   *  suffix). Best-effort — a write failure logs and leaves the cache updated
   *  in memory (the next successful write persists it). */
  async set(patch: Partial<DuoSettings>): Promise<DuoSettings> {
    this.cache = { ...this.cache, ...patch }
    const tmp = uniqueTmpPath(this.settingsPath, 'tmp')
    try {
      await fs.mkdir(this.settingsDir, { recursive: true })
      await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), 'utf8')
      await fs.rename(tmp, this.settingsPath)
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      console.warn('[settings] save failed:', (err as Error)?.message ?? err)
    }
    return { ...this.cache }
  }
}
