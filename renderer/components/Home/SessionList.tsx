// ENH-212 — a project's session list with the lazy "all N sessions" expander.
// Shared by HeroPanel (always shown) and the expandable SpineRow (round-2
// feedback #4: clicking a spine row reveals its sessions in place rather than
// resuming the latest). Owns the paging state so a project with hundreds of
// sessions doesn't resolve every title at once (D5 — lazy titles).
//
// The session-click contract is owned by the parent (HomeView); this list
// reports clicks via onActivateSession.

import { useCallback, useState } from 'react'
import type { HomeProject, HomeSession } from '@shared/types'
import { SessionRow } from './SessionRow'

/** Page size for the "all N sessions" expander. */
const EXPANDER_PAGE = 20

interface SessionListProps {
  project: HomeProject
  onActivateSession: (project: HomeProject, session: HomeSession) => void
  /** uuid of the session currently linked-highlighted (hero snippet hover). */
  linkedUuid?: string | null
  /** Report a row hover up so the parent can highlight the linked snippet. */
  onHoverSession?: (uuid: string | null) => void
}

export function SessionList({ project, onActivateSession, linkedUuid, onHoverSession }: SessionListProps) {
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
        {project.sessions.map((s) => (
          <SessionRow
            key={s.uuid}
            session={s}
            onActivate={(session) => onActivateSession(project, session)}
            linked={linkedUuid === s.uuid}
            onHover={onHoverSession}
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
    </>
  )
}
