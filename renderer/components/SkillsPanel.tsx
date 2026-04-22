// Stage 4: Skills context panel — CWD-scoped list of available Claude Code skills
// Collapses to an icon strip; expands to show skill names + sources.

import type { SkillEntry } from '@shared/types'

interface SkillsPanelProps {
  skills: SkillEntry[]
  cwd: string
  isLoading?: boolean
}

export function SkillsPanel({ skills, cwd, isLoading = false }: SkillsPanelProps) {
  const SOURCE_LABEL: Record<SkillEntry['source'], string> = {
    'SKILL.md': 'skill',
    'CLAUDE.md': 'claude',
    '.claude/skills': 'skills/',
    'brainstem': 'brainstem'
  }

  return (
    <div className="flex flex-col w-48 h-full bg-surface-1 border-l border-border text-xs">
      <div className="flex items-center justify-between px-3 h-8 border-b border-border shrink-0">
        <span className="text-zinc-400 font-medium">Skills</span>
        {isLoading && (
          <div className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      <div className="px-2 py-1 text-zinc-600 truncate" title={cwd}>
        {cwd.replace(window.electron?.env.HOME ?? '', '~')}
      </div>

      <div className="flex-1 overflow-y-auto">
        {skills.length === 0 ? (
          <div className="px-3 py-4 text-zinc-700">No skills found</div>
        ) : (
          skills.map((skill, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-2 transition-colors">
              <div className="w-1.5 h-1.5 rounded-full bg-accent/60 shrink-0" />
              <span className="flex-1 truncate text-zinc-300">{skill.name}</span>
              <span className="text-zinc-600 shrink-0">{SOURCE_LABEL[skill.source]}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
