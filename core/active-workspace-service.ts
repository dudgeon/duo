// ENH-167 — pointer to the currently-active workspace file.
//
// Persisted at ~/.claude/duo/active-workspace.json. Set on Save /
// Save As / Open / Open Recent; cleared on File > New Workspace.
// Read at boot so the title bar badge and the Save Workspace
// "save to current file" path know where to write back.
//
// Empty / missing / corrupt file → null (treated as "untitled").

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import type { ActiveWorkspace } from '../shared/types'

const ACTIVE_DIR = path.join(os.homedir(), '.claude', 'duo')
const ACTIVE_PATH = path.join(ACTIVE_DIR, 'active-workspace.json')

export class ActiveWorkspaceService {
  private cached: ActiveWorkspace | null = null
  private loaded = false

  async load(): Promise<ActiveWorkspace | null> {
    if (this.loaded) return this.cached
    try {
      const raw = await fs.readFile(ACTIVE_PATH, 'utf8')
      const parsed = JSON.parse(raw) as Partial<ActiveWorkspace>
      if (parsed && typeof parsed.path === 'string' && typeof parsed.name === 'string') {
        this.cached = { path: parsed.path, name: parsed.name }
      }
    } catch {
      // missing / corrupt → untitled
    }
    this.loaded = true
    return this.cached
  }

  get(): ActiveWorkspace | null {
    return this.cached
  }

  async set(active: ActiveWorkspace): Promise<void> {
    this.cached = active
    this.loaded = true
    try {
      await fs.mkdir(ACTIVE_DIR, { recursive: true })
      const tmp = ACTIVE_PATH + '.duo.tmp'
      await fs.writeFile(tmp, JSON.stringify(active, null, 2) + '\n', 'utf8')
      await fs.rename(tmp, ACTIVE_PATH)
    } catch (err) {
      console.warn('[active-workspace] write failed:', (err as Error)?.message ?? err)
    }
  }

  async clear(): Promise<void> {
    this.cached = null
    this.loaded = true
    try {
      await fs.unlink(ACTIVE_PATH)
    } catch {
      // already gone
    }
  }
}
