// ENH-212 — one session row inside a hero panel (or the paged expander).
// Renders title + a green "open" pill when an evidence-gated join attributed
// the session to a live terminal (HomeSession.open present) + age + an
// optional subPath badge (D8 worktree / nested-cwd fold).
//
// The click CONTRACT (§ 4.3) is owned by the parent (HomeView) — this row
// just reports the click via onActivate. That keeps the confirm-before-
// resume gate (live-but-idle, § 4.3) out of every leaf row.

import type { HomeSession } from '@shared/types'
import { ageShort, subPathLabel } from './homeModel'

interface SessionRowProps {
  session: HomeSession
  onActivate: (session: HomeSession) => void
}

export function SessionRow({ session, onActivate }: SessionRowProps) {
  const sub = subPathLabel(session.subPath)
  const open = session.open
  const title =
    open?.kind === 'duo'
      ? 'Running in a Duo terminal — click to focus it'
      : open?.kind === 'external'
        ? 'Running outside Duo (another terminal / the desktop app) — click to resume a second copy here'
        : 'Resume this session in a new terminal'
  return (
    <button
      type="button"
      className="duo-home-session-row"
      onClick={() => onActivate(session)}
      title={title}
    >
      <span className="duo-home-session-title">{session.title}</span>
      {sub && <span className="duo-home-subpath-badge">{sub}</span>}
      {open?.kind === 'duo' && (
        <span className="duo-home-open-pill" aria-label="Running in a Duo terminal">
          open
        </span>
      )}
      {open?.kind === 'external' && (
        <span className="duo-home-open-pill is-external" aria-label="Running outside Duo">
          running
        </span>
      )}
      <span className="duo-home-session-age">{ageShort(Date.now() - session.modifiedAt)}</span>
    </button>
  )
}
