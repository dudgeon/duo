// ENH-212 — one compact spine row per remaining project (the projects
// below the two heroes). A 3px color spine (the project hue), the display
// name, the session count, the latest-session label + its age. Clicking the
// row activates the project's latest session (focus-if-open, else resume) —
// the parent owns the contract via onActivateProject.

import type { HomeProject } from '@shared/types'
import { ageShort, projectHue } from './homeModel'

interface SpineRowProps {
  project: HomeProject
  onActivateProject: (project: HomeProject) => void
}

export function SpineRow({ project, onActivateProject }: SpineRowProps) {
  const latest = project.sessions[0]
  const count = project.sessionCount
  return (
    <button
      type="button"
      className="duo-home-spine-row"
      onClick={() => onActivateProject(project)}
      title={`${project.displayName} — ${count} ${count === 1 ? 'session' : 'sessions'}`}
    >
      <span
        className="duo-home-spine-color"
        style={{ background: projectHue(project.colorIndex) }}
        aria-hidden="true"
      />
      <span className="duo-home-spine-name">{project.displayName}</span>
      <span className="duo-home-spine-count">
        {count} {count === 1 ? 'session' : 'sessions'}
      </span>
      <span className="duo-home-spine-latest">{latest ? latest.title : '—'}</span>
      <span className="duo-home-spine-age">{ageShort(Date.now() - project.lastActiveAt)}</span>
    </button>
  )
}
