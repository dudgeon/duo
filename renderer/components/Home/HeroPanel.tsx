// ENH-212 — a hero panel: one of the two most-recently-active projects,
// rendered rich. Project name + hue dot, last-active age, session count, an
// italic last-line transcript snippet, the session list (via SessionList,
// which owns the lazy "all N sessions" expander), and recent-file chips.
//
// The session-click contract and the recent-file-open bridge are owned by
// the parent (HomeView); HeroPanel reports clicks via the callbacks.

import { useState } from 'react'
import type { HomeProject, HomeSession } from '@shared/types'
import { SessionList } from './SessionList'
import { ageShort, projectHue, fileChipLabel } from './homeModel'

interface HeroPanelProps {
  project: HomeProject
  onActivateSession: (project: HomeProject, session: HomeSession) => void
  onOpenFile: (path: string) => void
}

export function HeroPanel({ project, onActivateSession, onOpenFile }: HeroPanelProps) {
  // Round-2 feedback — the last-response snippet is now a first-class link to
  // its source session: hovering it (or its row) highlights the pair, hovering
  // expands the full text, and clicking focuses/resumes that session.
  const [linkedUuid, setLinkedUuid] = useState<string | null>(null)
  const snippet = project.snippet
  const snippetSession = snippet
    ? project.sessions.find((s) => s.uuid === snippet.sessionUuid)
    : undefined
  const snippetLinked = !!snippet && linkedUuid === snippet.sessionUuid

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

      {snippet && (
        <button
          type="button"
          className={`duo-home-hero-snippet font-serif text-ink-soft${snippetLinked ? ' is-linked' : ''}`}
          onClick={() => snippetSession && onActivateSession(project, snippetSession)}
          onMouseEnter={() => setLinkedUuid(snippet.sessionUuid)}
          onMouseLeave={() => setLinkedUuid(null)}
          title={
            snippetSession
              ? `Last response in “${snippetSession.title}” — click to open it`
              : undefined
          }
          aria-label={
            snippetSession
              ? `Last response in ${snippetSession.title}; click to open the session`
              : 'Last response'
          }
        >
          <span className="duo-home-hero-snippet-label">Last</span>
          <span className="duo-home-hero-snippet-text">{snippet.text}</span>
        </button>
      )}

      <SessionList
        project={project}
        onActivateSession={onActivateSession}
        linkedUuid={linkedUuid}
        onHoverSession={setLinkedUuid}
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
