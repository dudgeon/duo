// Stage 4: per-tab skills scanner
// Watches the active tab's CWD and returns the relevant SkillEntry list.

import { useState, useEffect } from 'react'
import type { SkillEntry } from '@shared/types'

export function useSkillsContext(cwd: string): { skills: SkillEntry[]; isLoading: boolean } {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // TODO Stage 4: call window.electron.skills.scan(cwd) when IPC is wired up
    setSkills([])
    setIsLoading(false)
  }, [cwd])

  return { skills, isLoading }
}
