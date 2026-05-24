// ENH-177 (Sprint 20 / v0.7.7) — Claude session-id capture for the
// workspace autosave path. Claude Code writes per-session JSONL
// files at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` —
// one file per active session, named with the session UUID, updated
// on every turn. We scrape the most-recently-modified `.jsonl` in
// the encoded-cwd directory to identify the live session and persist
// the ID in workspace metadata so a future workspace switch can
// offer a one-click `claude --resume <id>`.
//
// Pure file system scan; no Claude internals. The shape is stable
// (Claude Code v2.x as of 2026-05).

import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

/**
 * Encode an absolute filesystem path the way Claude Code does to map
 * a cwd to its `~/.claude/projects/<dir>/` subdirectory. Both `/` and
 * `.` are mapped to `-` — verified against the live filesystem:
 *
 *   /Users/geoffreydudgeon/Documents/GitHub/duo
 *     → -Users-geoffreydudgeon-Documents-GitHub-duo
 *   /Users/geoffreydudgeon/.claude/skills/duo
 *     → -Users-geoffreydudgeon--claude-skills-duo
 *   /Users/geoffreydudgeon/Documents/GitHub/duo/.claude/worktrees/X
 *     → -Users-geoffreydudgeon-Documents-GitHub-duo--claude-worktrees-X
 */
export function encodeProjectDir(absPath: string): string {
  return absPath.replace(/[/.]/g, '-')
}

export interface DetectedClaudeSession {
  id: string
  capturedAt: number
  /** Modification time of the JSONL file at scan time. Useful for
   *  staleness pruning at restore. */
  jsonlModifiedAt: number
}

/**
 * Find the most-recently-modified `.jsonl` under
 * `~/.claude/projects/<encoded-cwd>/`. Returns `null` if the
 * directory is missing, empty, or otherwise unreadable — best-effort
 * by design (never crash the save path).
 *
 * Optional `maxAgeMs` — if the most-recent file is older than this,
 * returns null. Defaults to no limit. Callers that want to skip
 * stale captures can pass e.g. 24h.
 */
export async function detectLatestClaudeSession(
  cwd: string,
  maxAgeMs?: number
): Promise<DetectedClaudeSession | null> {
  try {
    const projectDir = path.join(os.homedir(), '.claude', 'projects', encodeProjectDir(cwd))
    const entries = await fs.readdir(projectDir, { withFileTypes: true })
    let best: { id: string; mtimeMs: number } | null = null
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
      const id = e.name.slice(0, -'.jsonl'.length)
      // Skip empty/garbage names.
      if (!id) continue
      const stat = await fs.stat(path.join(projectDir, e.name)).catch(() => null)
      if (!stat) continue
      if (!best || stat.mtimeMs > best.mtimeMs) {
        best = { id, mtimeMs: stat.mtimeMs }
      }
    }
    if (!best) return null
    const now = Date.now()
    if (maxAgeMs !== undefined && now - best.mtimeMs > maxAgeMs) return null
    return {
      id: best.id,
      capturedAt: now,
      jsonlModifiedAt: best.mtimeMs
    }
  } catch {
    return null
  }
}
