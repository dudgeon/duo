// ENH-182 (Sprint 22) — fs-touching projects service (main-only).
//
// This module is the Node.js / Electron-main side of the project
// model. It owns:
//   • `ProjectsService` — persisted slice at ~/.claude/duo/projects.json
//     (pins + color overrides). Mirrors PinsService.
//   • `hasMarker()` — async fs probe for CLAUDE.md / .claude/.
//
// The pure derivation (deriveProjects, hashColorIndex, etc.) lives in
// `shared/projects.ts` so the renderer can import it too.

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import type { ProjectsFile } from '../shared/types'
import { NUM_PROJECT_COLORS, normalizeProjectsFile } from '../shared/projects'
import { createWriteQueue, uniqueTmpPath } from './write-queue'

const DEFAULT_DIR = path.join(os.homedir(), '.claude', 'duo')
const SCHEMA_VERSION = 1

// Re-export pure helpers so existing imports of this file keep working.
// Phase 1+ wiring code should import directly from `shared/projects`.
export {
  NUM_PROJECT_COLORS,
  hashColorIndex,
  ancestors,
  deepestEnclosingRoot,
  deriveProjects,
  normalizeProjectsFile as normalize,
  type QualificationResult,
  type DeriveProjectsInput,
  type DeriveProjectsOutput
} from '../shared/projects'
export type { Project, ProjectsFile } from '../shared/types'

/**
 * Reads/writes `~/.claude/duo/projects.json`. Mirrors `PinsService` —
 * atomic writes (tmp + rename), defensive reads (corrupt or missing
 * file returns the empty default).
 */
export class ProjectsService {
  private readonly dir: string
  private readonly file: string
  // Phase H (ENH-191 Cut 0) — serialize the read-modify-write so a
  // socket toggle + a renderer-click toggle (or two windows) cannot
  // interleave at the await points and lose an update. Covers BOTH
  // mutators (togglePin + setColorOverride) since they share `read`.
  private readonly enqueue = createWriteQueue()

  // `baseDir` is injectable for tests (avoids polluting the real
  // ~/.claude/duo); production constructs it no-arg.
  constructor(baseDir: string = DEFAULT_DIR) {
    this.dir = baseDir
    this.file = path.join(baseDir, 'projects.json')
  }

  async read(): Promise<ProjectsFile> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<ProjectsFile>
      return normalizeProjectsFile(parsed)
    } catch {
      return { version: SCHEMA_VERSION, pins: [], colorOverrides: {} }
    }
  }

  async togglePin(root: string): Promise<ProjectsFile> {
    return this.enqueue(async () => {
      const current = await this.read()
      const idx = current.pins.indexOf(root)
      const next: ProjectsFile = {
        ...current,
        pins:
          idx >= 0
            ? [...current.pins.slice(0, idx), ...current.pins.slice(idx + 1)]
            : [...current.pins, root]
      }
      await this.write(next)
      return next
    })
  }

  async setColorOverride(root: string, colorIndex: number | null): Promise<ProjectsFile> {
    return this.enqueue(async () => {
      const current = await this.read()
      const overrides = { ...current.colorOverrides }
      if (colorIndex === null) {
        delete overrides[root]
      } else if (
        Number.isInteger(colorIndex) &&
        colorIndex >= 0 &&
        colorIndex < NUM_PROJECT_COLORS
      ) {
        overrides[root] = colorIndex
      }
      const next: ProjectsFile = { ...current, colorOverrides: overrides }
      await this.write(next)
      return next
    })
  }

  private async write(file: ProjectsFile): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
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

/**
 * D2 marker check: does `dir` contain `CLAUDE.md` (file) or `.claude/`
 * (directory)? Lone files / lone dir both count. Returns false on any
 * fs error (missing dir, permission denied, etc.) — same defensive
 * posture as the rest of the qualification surface.
 *
 * `tasks.md` / `AGENTS.md` deliberately do NOT qualify on their own;
 * the candidate set in `ProjectClaudeContext.tsx` is broader for
 * cosmetic purposes, but the project-qualification gate is tighter
 * (per PRD § 9 area 6).
 */
export async function hasMarker(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.name === 'CLAUDE.md' && e.isFile()) return true
      if (e.name === '.claude' && e.isDirectory()) return true
    }
    return false
  } catch {
    return false
  }
}
