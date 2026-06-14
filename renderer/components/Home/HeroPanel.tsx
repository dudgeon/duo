// ENH-212 — a hero panel: one of the two most-recently-active projects,
// rendered rich. Project name + hue dot, last-active age, session count, the
// session list (via SessionList, which owns the lazy "all N sessions"
// expander AND renders the last-response snippet as an indented reply under
// its source row — round-2 #B), and recent-file chips.
//
// The session-click contract and the recent-file-open bridge are owned by
// the parent (HomeView); HeroPanel reports clicks via the callbacks.

import type { HomeProject, HomeSession } from '@shared/types'
import { SessionList } from './SessionList'
import { ageShort, projectHue, fileChipLabel } from './homeModel'

interface HeroPanelProps {
  project: HomeProject
  onActivateSession: (project: HomeProject, session: HomeSession) => void
  onOpenFile: (path: string) => void
}

export function HeroPanel({ project, onActivateSession, onOpenFile }: HeroPanelProps) {
  return (
    <section className="duo-home-hero" aria-label={`${project.displayName} project`}>
      <header className="duo-home-hero-head">
        <span
          className="duo-home-hero-dot"
          style={{ background: projectHue(project.colorIndex) }}
          aria-hidden="true"
        />
        <h2 className="duo-home-hero-name font-serif text-ink">{project.displayName}</h2>
        <span className="duo-home-hero-meta">
          {project.sessionCount} {project.sessionCount === 1 ? 'session' : 'sessions'}
          {' · '}
          {ageShort(Date.now() - project.lastActiveAt)}
        </span>
      </header>

      {/* The last-response snippet renders as an indented reply UNDER its
          source session row, inside SessionList (round-2 #B). */}
      <SessionList
        project={project}
        onActivateSession={onActivateSession}
        snippet={project.snippet}
      />

      {project.recentFiles.length > 0 && (
        <div className="duo-home-hero-chips" aria-label="Recent files">
          {project.recentFiles.map((f) => (
            <button
              key={f.path}
              type="button"
              className="duo-home-file-chip"
              onClick={() => onOpenFile(f.path)}
              title={f.path}
            >
              {fileChipLabel(f.path)}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
