// Stage 4: Per-tab CWD scanner for skills context panel
//
// Scans for: SKILL.md, CLAUDE.md, .claude/skills/, .claude/commands/
// Also queries brainstem.cc API for personal knowledge context (Geoff's MCP).

import * as fs from 'fs'
import * as path from 'path'
import type { SkillEntry } from '../shared/types'

const SKILL_FILENAMES = ['SKILL.md', 'CLAUDE.md']
const SKILL_DIRS = ['.claude/skills']

export async function scanSkills(cwd: string): Promise<SkillEntry[]> {
  const entries: SkillEntry[] = []

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

  // TODO Stage 4: query brainstem.cc API for personal context

  return entries
}
