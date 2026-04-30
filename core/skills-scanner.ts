// Stage 4: Per-tab skill scanner for the Skills context panel.
//
// Scans two scopes (both must be shown in the panel):
//   1. Project scope — the PTY's launch CWD (where Claude Code was invoked)
//   2. Home scope   — ~/.claude/skills/ (global skills available to any agent)
//
// Looks for: SKILL.md, CLAUDE.md, .claude/skills/*.md
// CWD-scan only — no external API or network calls.

import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import type { SkillEntry } from '../shared/types'

const SKILL_FILENAMES = ['SKILL.md', 'CLAUDE.md']
const SKILL_DIRS = ['.claude/skills']

// Scans `cwd` (project scope) and `~/.claude/skills/` (home scope).
// Returns a merged, deduplicated list.
export async function scanSkills(cwd: string): Promise<SkillEntry[]> {
  const entries: SkillEntry[] = []

  // ── Project scope ────────────────────────────────────────────────────────
  for (const filename of SKILL_FILENAMES) {
    const fullPath = path.join(cwd, filename)
    if (fs.existsSync(fullPath)) {
      entries.push({
        name: filename,
        path: fullPath,
        source: filename as SkillEntry['source']
      })
    }
  }

  for (const dir of SKILL_DIRS) {
    const dirPath = path.join(cwd, dir)
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'))
      for (const file of files) {
        entries.push({
          name: path.basename(file, '.md'),
          path: path.join(dirPath, file),
          source: '.claude/skills'
        })
      }
    }
  }

  // ── Home scope ───────────────────────────────────────────────────────────
  const homeSkillsDir = path.join(homedir(), '.claude', 'skills')
  if (fs.existsSync(homeSkillsDir)) {
    const subdirs = fs.readdirSync(homeSkillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
    for (const subdir of subdirs) {
      const skillMd = path.join(homeSkillsDir, subdir.name, 'SKILL.md')
      if (fs.existsSync(skillMd)) {
        // Avoid duplicates if cwd happens to be inside ~/.claude/skills
        if (!entries.some(e => e.path === skillMd)) {
          entries.push({
            name: subdir.name,
            path: skillMd,
            source: '.claude/skills'
          })
        }
      }
    }
  }

  return entries
}
