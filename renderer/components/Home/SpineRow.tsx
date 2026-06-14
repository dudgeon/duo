// ENH-212 — one compact spine row per remaining project (below the two
// heroes). A 3px color spine (the project hue), the display name, the session
// count, the latest-session label + its age.
//
// Round-2 feedback #4: clicking the row EXPANDS it to reveal the project's
// sessions in place (via SessionList) — it does NOT immediately resume the
// latest session. Only a click on a revealed session row focuses/resumes.
// The parent (HomeView) owns the expanded set + the session-click contract.

import type { HomeProject, HomeSession } from '@shared/types'
import { SessionList } from './SessionList'
import { ageShort, projectHue } from './homeModel'

interface SpineRowProps {
  project: HomeProject
  expanded: boolean
  onToggle: (project: HomeProject) => void
  onActivateSession: (project: HomeProject, session: HomeSession) => void
}

export function SpineRow({ project, expanded, onToggle, onActivateSession }: SpineRowProps) {
  const latest = project.sessions[0]
  const count = project.sessionCount
  return (
    <div className={`duo-home-spine-item${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="duo-home-spine-row"
        onClick={() => onToggle(project)}
        aria-expanded={expanded}
        title={`${project.displayName} — ${count} ${count === 1 ? 'session' : 'sessions'} — click to ${expanded ? 'collapse' : 'see sessions'}`}
      >
        <span
          className="duo-home-spine-color"
          style={{ background: projectHue(project.colorIndex) }}
          aria-hidden="true"
        />
        <span className="duo-home-spine-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span className="duo-home-spine-name">{project.displayName}</span>
        <span className="duo-home-spine-count">
          {count} {count === 1 ? 'session' : 'sessions'}
        </span>
        <span className="duo-home-spine-latest">{latest ? latest.title : '—'}</span>
        <span className="duo-home-spine-age">{ageShort(Date.now() - project.lastActiveAt)}</span>
      </button>

      {expanded && (
        <div className="duo-home-spine-sessions">
          <SessionList project={project} onActivateSession={onActivateSession} />
        </div>
      )}
    </div>
  )
}
