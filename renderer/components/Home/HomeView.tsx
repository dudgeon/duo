// ENH-212 — Home, the permanent re-entry surface (slot 0). Renders a serif
// greeting line, two equal hero panels (the 2 most-recently-active
// projects), and a spine stack of the rest (folding after 8 — D5).
//
// Data is read LIVE on every snapshot (D9 — no cache, no sidecar). All
// fetching is gated on `isActive` (BUG-046 hidden-mount tolerance): file
// tabs stay mounted with display:none, so an inactive Home must NOT poll.
// We fetch on mount, on every isActive flip to true, and on a 30s interval
// while active; the interval is torn down on unmount and whenever isActive
// goes false.
//
// Click contract (§ 4.3): a session with an evidence-gated `open` join
// focuses its live terminal tab (raising the window if needed); a closed
// session resumes `claude --resume <uuid>` in a new shell tab in THIS
// window. When the snapshot flags the session's root as hosting an
// unattributed live claude (§ 4.3 [V]), a closed-session resume is gated
// behind an inline confirm so a click can't fork a concurrently-running
// session.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { HomeSnapshot, HomeProject, HomeSession } from '@shared/types'
import { GreetingLine } from './GreetingLine'
import { HeroPanel } from './HeroPanel'
import { SpineRow } from './SpineRow'
import { selectHeroes, selectSpine, foldSpine, rootsWithUnattributedLiveClaude } from './homeModel'
import './Home.css'

/** Heroes show their 3 most-recent sessions inline (§ 1); the snapshot's
 *  per-project cap. */
const HERO_SESSION_LIMIT = 3

/** Poll cadence while the surface is the active tab (D9 live recompute). */
const SNAPSHOT_POLL_MS = 30_000

interface HomeViewProps {
  /** True when Home is the active visible tab. ALL fetching gates on this
   *  (BUG-046): hidden-but-mounted Home must not poll. */
  isActive: boolean
  /** ENH-212 — publish the last-fetched snapshot UP to App so it can back
   *  `window.__duoGetHomeState()` (`duo home state`). Called on every
   *  snapshot change while mounted; called with null on unmount so a stale
   *  snapshot can't outlive the surface. */
  onSnapshotChange?: (snap: HomeSnapshot | null) => void
}

/** Pending-resume confirm state for the live-but-idle guard (§ 4.3). */
interface PendingResume {
  session: HomeSession
  project: HomeProject
}

export function HomeView({ isActive, onSnapshotChange }: HomeViewProps) {
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null)
  const [spineExpanded, setSpineExpanded] = useState(false)
  const [pendingResume, setPendingResume] = useState<PendingResume | null>(null)

  // Guard against a late-resolving fetch landing after unmount / after the
  // surface went inactive. Mirrors the cancelled-flag pattern the editor
  // surfaces use for their async loads.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const fetchSnapshot = useCallback(async () => {
    try {
      const next = await window.electron.home.snapshot(HERO_SESSION_LIMIT)
      if (aliveRef.current) setSnapshot(next)
    } catch {
      // Best-effort — a failed snapshot leaves the last-good render in
      // place (D14-style degradation; no error UI in v1).
    }
  }, [])

  // BUG-046 — fetch on mount + on isActive flip + a 30s interval while
  // active. The interval is created only while active and cleared on
  // unmount / when isActive goes false. Inactive Home polls nothing.
  useEffect(() => {
    if (!isActive) return
    void fetchSnapshot()
    const id = setInterval(() => { void fetchSnapshot() }, SNAPSHOT_POLL_MS)
    return () => clearInterval(id)
  }, [isActive, fetchSnapshot])

  // `duo home` (HOME_SHOW push) — refresh the snapshot when main asks the
  // window to show Home. Only meaningful while active; the App-level
  // subscription owns the activation/synthesis itself (step 6).
  useEffect(() => {
    if (!isActive) return
    return window.electron.home.onHomeShow(() => { void fetchSnapshot() })
  }, [isActive, fetchSnapshot])

  // ENH-212 — publish the snapshot UP to App for `window.__duoGetHomeState()`
  // (`duo home state`). Fires on every snapshot change; clears (null) on
  // unmount so a stale snapshot can't outlive the surface.
  useEffect(() => {
    onSnapshotChange?.(snapshot)
    return () => onSnapshotChange?.(null)
  }, [snapshot, onSnapshotChange])

  // ── Click contract (§ 4.3) ─────────────────────────────────────────
  const unattributedRoots = snapshot
    ? rootsWithUnattributedLiveClaude(snapshot.projects, snapshot.unattributedLiveCwds)
    : new Set<string>()

  const doFocus = useCallback((session: HomeSession) => {
    if (!session.open) return
    void window.electron.home.sessionAction({
      op: 'focus',
      windowId: session.open.windowId,
      tabId: session.open.tabId
    })
  }, [])

  const doResume = useCallback((session: HomeSession, _project: HomeProject) => {
    void window.electron.home.sessionAction({
      op: 'resume',
      uuid: session.uuid,
      // D6 — resume runs in the SESSION's REAL recorded cwd, carried verbatim
      // on the snapshot. Do NOT reconstruct from rootPath + subPath: a sibling
      // git worktree folds into its MAIN repo (root = main repo) with subPath
      // undefined, so that reconstruction would resume in the main repo and
      // Claude Code could not locate the worktree-encoded session JSONL.
      // subPath stays a display-only badge.
      cwd: session.cwd
    })
  }, [])

  // A session click: focus when open, else resume — gated behind a confirm
  // when the project root hosts an unattributed live claude (§ 4.3).
  const onActivateSession = useCallback((project: HomeProject, session: HomeSession) => {
    if (session.open) {
      doFocus(session)
      return
    }
    if (unattributedRoots.has(project.rootPath)) {
      setPendingResume({ session, project })
      return
    }
    doResume(session, project)
  }, [doFocus, doResume, unattributedRoots])

  // A spine row click activates the project's latest session.
  const onActivateProject = useCallback((project: HomeProject) => {
    const latest = project.sessions[0]
    if (latest) onActivateSession(project, latest)
  }, [onActivateSession])

  // Recent-file chip click → open the file in Duo's editor. App.tsx owns
  // the open-file machinery (openFileSmart); we hand it the path via a
  // window CustomEvent the App-level wiring (step 6) subscribes to. This
  // keeps HomeView free of App props per the step boundary.
  const onOpenFile = useCallback((path: string) => {
    const name = path.slice(path.lastIndexOf('/') + 1) || path
    window.dispatchEvent(new CustomEvent('duo-home-open-file', { detail: { path, name } }))
  }, [])

  const confirmPendingResume = useCallback(() => {
    if (pendingResume) doResume(pendingResume.session, pendingResume.project)
    setPendingResume(null)
  }, [pendingResume, doResume])

  // ── Render ──────────────────────────────────────────────────────────
  if (!snapshot) {
    return (
      <div className="duo-home" data-duo-tab-kind="home">
        <div className="duo-home-loading text-ink-mute">Loading your projects…</div>
      </div>
    )
  }

  const heroes = selectHeroes(snapshot.projects)
  const spine = selectSpine(snapshot.projects)
  const { visible: visibleSpine, hiddenCount } = foldSpine(spine, spineExpanded)

  return (
    <div className="duo-home" data-duo-tab-kind="home">
      <GreetingLine greeting={snapshot.greeting} />

      {heroes.length > 0 && (
        <div className="duo-home-heroes">
          {heroes.map((project) => (
            <HeroPanel
              key={project.rootPath}
              project={project}
              onActivateSession={onActivateSession}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}

      {visibleSpine.length > 0 && (
        <div className="duo-home-spine">
          {visibleSpine.map((project) => (
            <SpineRow
              key={project.rootPath}
              project={project}
              onActivateProject={onActivateProject}
            />
          ))}
          {/* D5 — the fold expander. Visible when rows are hidden
              (collapsed) or when expanded (so the user can collapse). A
              spine of ≤ 8 never folds (foldSpine returns hiddenCount 0 and
              spineExpanded stays false), so the button doesn't render. */}
          {(hiddenCount > 0 || spineExpanded) && (
            <button
              type="button"
              className="duo-home-spine-fold"
              onClick={() => setSpineExpanded((v) => !v)}
            >
              {spineExpanded ? 'Show fewer projects' : `${hiddenCount} older projects`}
            </button>
          )}
        </div>
      )}

      {heroes.length === 0 && spine.length === 0 && (
        <div className="duo-home-empty text-ink-mute font-serif">
          No projects yet — open a folder in a terminal to get started.
        </div>
      )}

      {pendingResume && (
        <div className="duo-home-confirm-backdrop" role="dialog" aria-modal="true">
          <div className="duo-home-confirm">
            <p className="duo-home-confirm-title font-serif text-ink">
              A live Claude is already running here
            </p>
            <p className="duo-home-confirm-body text-ink-soft">
              There is a running <strong>claude</strong> in{' '}
              <span className="duo-home-confirm-path">{pendingResume.project.displayName}</span>{' '}
              that Duo is not hosting. Resuming this session in a new terminal could
              fork a session that is already in use.
            </p>
            <div className="duo-home-confirm-actions">
              <button
                type="button"
                className="duo-home-confirm-cancel"
                onClick={() => setPendingResume(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="duo-home-confirm-go"
                onClick={confirmPendingResume}
              >
                Resume anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
