// ENH-212 — a project's session list with the lazy "all N sessions" expander.
// Shared by HeroPanel (always shown) and the expandable SpineRow (round-2
// feedback #4: clicking a spine row reveals its sessions in place rather than
// resuming the latest). Owns the paging state so a project with hundreds of
// sessions doesn't resolve every title at once (D5 — lazy titles).
//
// The session-click contract is owned by the parent (HomeView); this list
// reports clicks via onActivateSession.

import { Fragment, useCallback, useState } from 'react'
import type { HomeProject, HomeSession } from '@shared/types'
import { SessionRow } from './SessionRow'

/** Page size for the "all N sessions" expander. */
const EXPANDER_PAGE = 20

interface SessionListProps {
  project: HomeProject
  onActivateSession: (project: HomeProject, session: HomeSession) => void
  /** round-2 #B — the last-response snippet, rendered as an indented reply
   *  directly beneath its source session row (heroes only; spine passes none). */
  snippet?: { sessionUuid: string; text: string }
}

export function SessionList({ project, onActivateSession, snippet }: SessionListProps) {
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
      if (page.length < EXPANDER_PAGE) setExhausted(true)
    } catch {
      setExhausted(true)
    } finally {
      setLoading(false)
    }
  }, [loading, exhausted, inlineCount, extra.length, project.rootPath])

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
    setExpanded(false)
  }, [expanded, extra.length, exhausted, loadMore])

  return (
    <>
      <div className="duo-home-sessions">
        {project.sessions.map((s) => {
          const reply = snippet && snippet.sessionUuid === s.uuid ? snippet : null
          const row = (
            <SessionRow
              session={s}
              onActivate={(session) => onActivateSession(project, session)}
              hasReplyBelow={!!reply}
            />
          )
          // round-2 #B — wrap the source row + its snippet reply in one
          // connected group (shared tint), the reply indented with a rail.
          return reply ? (
            <div key={s.uuid} className="duo-home-session-group">
              {row}
              <div className="duo-home-snippet-reply">
                <span className="duo-home-snippet-reply-rail" aria-hidden="true" />
                <button
                  type="button"
                  className="duo-home-hero-snippet"
                  onClick={() => onActivateSession(project, s)}
                  title={`Last response in “${s.title}” — click to open it`}
                  aria-label={`Last response in ${s.title}; click to open the session`}
                >
                  <span className="duo-home-hero-snippet-label">Last</span>
                  <span className="duo-home-hero-snippet-text">{reply.text}</span>
                </button>
              </div>
            </div>
          ) : (
            <Fragment key={s.uuid}>{row}</Fragment>
          )
        })}
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
    </>
  )
}
