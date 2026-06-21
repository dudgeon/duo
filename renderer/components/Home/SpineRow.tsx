// ENH-212 — one compact spine row per remaining project (below the two
// heroes). A 3px color spine (the project hue), the display name, the session
// count, the latest-session label + its age.
//
// Round-2 feedback #4: clicking the row EXPANDS it to reveal the project's
// sessions in place (via SessionList) — it does NOT immediately resume the
// latest session. Only a click on a revealed session row focuses/resumes.
// The parent (HomeView) owns the expanded set + the session-click contract.

import type { HomeProject, HomeSession, CronJobView } from '@shared/types'
import { SessionList } from './SessionList'
import { CronJobRow, NewScheduleButton, type CronInvoke } from './CronJobRow'
import { ageShort, projectHue } from './homeModel'

interface SpineRowProps {
  project: HomeProject
  expanded: boolean
  /** D6 — cron jobs whose project is this card; shown nested when expanded. */
  cronJobs: CronJobView[]
  cronInvoke: CronInvoke
  onToggle: (project: HomeProject) => void
  onActivateSession: (project: HomeProject, session: HomeSession) => void
}

export function SpineRow({ project, expanded, cronJobs, cronInvoke, onToggle, onActivateSession }: SpineRowProps) {
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
        {cronJobs.length > 0 && (
          <span className="duo-home-spine-cron" title={`${cronJobs.length} scheduled job${cronJobs.length === 1 ? '' : 's'}`}>
            ⏱ {cronJobs.length}
          </span>
        )}
        <span className="duo-home-spine-age">{ageShort(Date.now() - project.lastActiveAt)}</span>
      </button>

      {expanded && (
        <div className="duo-home-spine-sessions">
          <SessionList project={project} onActivateSession={onActivateSession} />
          {/* D6 — scheduled jobs nested in the expanded card + per-card "+ Schedule". */}
          <div className="duo-home-card-cron" aria-label="Scheduled jobs">
            {cronJobs.map((job) => (
              <CronJobRow key={job.id} job={job} invoke={cronInvoke} hideProject />
            ))}
            <NewScheduleButton cwd={project.rootPath} />
          </div>
        </div>
      )}
    </div>
  )
}
