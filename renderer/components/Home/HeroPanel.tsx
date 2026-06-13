// ENH-212 — a hero panel: one of the two most-recently-active projects,
// rendered rich. Project name + hue dot, last-active age, session count, an
// italic last-line transcript snippet, the 3 most-recent sessions (via
// SessionRow), recent-file chips, and an "all N sessions" expander that
// pages lazily through home.listSessions (D5 — lazy titles).
//
// The session-click contract and the recent-file-open bridge are owned by
// the parent (HomeView); HeroPanel reports clicks via the callbacks.

import { useCallback, useState } from 'react'
import type { HomeProject, HomeSession } from '@shared/types'
import { SessionRow } from './SessionRow'
import { ageShort, projectHue, fileChipLabel } from './homeModel'

/** Page size for the "all N sessions" expander. Heroes show 3 inline; the
 *  expander pages the rest in chunks so a project with hundreds of sessions
 *  doesn't resolve every title at once (D5 lazy). */
const EXPANDER_PAGE = 20

interface HeroPanelProps {
  project: HomeProject
  onActivateSession: (project: HomeProject, session: HomeSession) => void
  onOpenFile: (path: string) => void
}

export function HeroPanel({ project, onActivateSession, onOpenFile }: HeroPanelProps) {
  // Expander state. `extra` accumulates the sessions paged in beyond the
  // snapshot's inline cap; `expanded` tracks whether the expander is open.
  const [expanded, setExpanded] = useState(false)
  const [extra, setExtra] = useState<HomeSession[]>([])
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  const inlineCount = project.sessions.length
  const remaining = Math.max(0, project.sessionCount - inlineCount)

  const loadMore = useCallback(async () => {
    if (loading || exhausted) return
    setLoading(true)
    try {
      const offset = inlineCount + extra.length
      const page = await window.electron.home.listSessions(project.rootPath, offset, EXPANDER_PAGE)
      setExtra((prev) => [...prev, ...page])
      // Fewer than a full page back → we've reached the tail.
      if (page.length < EXPANDER_PAGE) setExhausted(true)
    } catch {
      // Best-effort — a failed page just stops the expander; D14-style
      // degradation (no error UI in v1).
      setExhausted(true)
    } finally {
      setLoading(false)
    }
  }, [loading, exhausted, inlineCount, extra.length, project.rootPath])

  // Open the expander (first click) → page in the first chunk. Subsequent
  // clicks while open + not exhausted page in the next chunk. Once exhausted
  // the button collapses the expander back to the inline 3.
  const onExpanderClick = useCallback(() => {
    if (!expanded) {
      setExpanded(true)
      if (extra.length === 0 && !exhausted) void loadMore()
      return
    }
    if (!exhausted) {
      void loadMore()
      return
    }
    // Expanded + fully paged → collapse.
    setExpanded(false)
  }, [expanded, extra.length, exhausted, loadMore])

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

      {project.snippet && (
        <p className="duo-home-hero-snippet font-serif text-ink-soft">{project.snippet}</p>
      )}

      <div className="duo-home-hero-sessions">
        {project.sessions.map((s) => (
          <SessionRow
            key={s.uuid}
            session={s}
            onActivate={(session) => onActivateSession(project, session)}
          />
        ))}
        {expanded &&
          extra.map((s) => (
            <SessionRow
              key={s.uuid}
              session={s}
              onActivate={(session) => onActivateSession(project, session)}
            />
          ))}
      </div>

      {remaining > 0 && (
        <button
          type="button"
          className="duo-home-hero-expander"
          onClick={onExpanderClick}
          disabled={loading}
        >
          {expanded
            ? (exhausted ? 'Show fewer' : (loading ? 'Loading…' : 'Show more'))
            : `All ${project.sessionCount} sessions`}
        </button>
      )}

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
