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
import { selectHeroes, selectSpine, foldSpine, freshestSession } from './homeModel'
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

export function HomeView({ isActive, onSnapshotChange }: HomeViewProps) {
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null)
  const [spineExpanded, setSpineExpanded] = useState(false)
  // Round-2 #4 — which spine projects are expanded to reveal their sessions.
  const [expandedSpine, setExpandedSpine] = useState<Set<string>>(() => new Set())
  // A transient notice (e.g. an unexpected action error). Null = hidden.
  const [notice, setNotice] = useState<string | null>(null)
  // The session pending a fork-confirm — set when the user clicks a session
  // that's live OUTSIDE Duo. We warn, but let the user fork it (their call).
  const [forkConfirm, setForkConfirm] = useState<HomeSession | null>(null)

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

  // ── Click contract (§ 4.3 — process-primary, focus-not-fork) ───────────
  // A session click resolves to ONE of three outcomes by its liveness:
  //   - open.kind 'duo'      → focus the hosting Duo tab (raise its window)
  //   - open.kind 'external' → it's live OUTSIDE Duo; we can't focus it, and
  //                            we must NOT fork it → show a notice, do nothing
  //   - not open             → resume `claude --resume` in a new tab here.
  // Main re-checks liveness at click time too (never-fork backstop), so even a
  // stale snapshot can't fork: a resume that main finds is actually live comes
  // back !ok and we surface the message instead of spawning a duplicate.
  // Resume in the SESSION's REAL recorded cwd (D6) — never reconstruct from
  // rootPath + subPath (a sibling worktree folds into its main repo with
  // subPath undefined). `force` skips the live-external refusal (the user
  // chose to fork after the warning).
  const doResume = useCallback((session: HomeSession, force: boolean) => {
    void window.electron.home
      .sessionAction({ op: 'resume', uuid: session.uuid, cwd: session.cwd, force })
      .then((res) => {
        if (res && !res.ok) {
          // The session went live OUTSIDE Duo in the snapshot gap — don't
          // silently fork; warn-then-allow via the same confirm.
          if (res.externalLive) setForkConfirm(session)
          else if (res.error) setNotice(res.error)
        }
      })
  }, [])

  const onActivateSession = useCallback((session: HomeSession) => {
    const open = session.open
    if (open?.kind === 'duo') {
      void window.electron.home.sessionAction({ op: 'focus', windowId: open.windowId, tabId: open.tabId })
      return
    }
    if (open?.kind === 'external') {
      // Live outside Duo — warn, but let the user fork it (their call).
      setForkConfirm(session)
      return
    }
    doResume(session, false)
  }, [doResume])

  // SessionList / Hero / Spine hand us (project, session); the project arg is
  // display-only here (cwd lives on the session), so we drop it.
  const onActivateSessionInProject = useCallback(
    (_project: HomeProject, session: HomeSession) => onActivateSession(session),
    [onActivateSession]
  )

  // Round-2 #4 — a spine row click EXPANDS/collapses the project (reveals its
  // sessions in place); it no longer resumes the latest session.
  const onToggleSpine = useCallback((project: HomeProject) => {
    setExpandedSpine((prev) => {
      const next = new Set(prev)
      if (next.has(project.rootPath)) next.delete(project.rootPath)
      else next.add(project.rootPath)
      return next
    })
  }, [])

  // Recent-file chip click → open the file in Duo's editor. App.tsx owns
  // the open-file machinery (openFileSmart); we hand it the path via a
  // window CustomEvent the App-level wiring (step 6) subscribes to. This
  // keeps HomeView free of App props per the step boundary.
  const onOpenFile = useCallback((path: string) => {
    const name = path.slice(path.lastIndexOf('/') + 1) || path
    window.dispatchEvent(new CustomEvent('duo-home-open-file', { detail: { path, name } }))
  }, [])

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
  const freshest = freshestSession(snapshot.projects)

  return (
    <div className="duo-home" data-duo-tab-kind="home">
      <GreetingLine
        greeting={snapshot.greeting}
        onClickFreshest={freshest ? () => onActivateSession(freshest.session) : undefined}
      />

      {heroes.length > 0 && (
        <div className="duo-home-heroes">
          {heroes.map((project) => (
            <HeroPanel
              key={project.rootPath}
              project={project}
              onActivateSession={onActivateSessionInProject}
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
              expanded={expandedSpine.has(project.rootPath)}
              onToggle={onToggleSpine}
              onActivateSession={onActivateSessionInProject}
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

      {forkConfirm && (
        <div className="duo-home-confirm-backdrop" role="dialog" aria-modal="true">
          <div className="duo-home-confirm">
            <p className="duo-home-confirm-title font-serif text-ink">
              This session is running outside Duo
            </p>
            <p className="duo-home-confirm-body text-ink-soft">
              It’s live in another terminal or the Claude desktop app, so Duo can’t
              focus it. Resuming here starts a <strong>second copy</strong> — both
              would write to the same session and could conflict.
            </p>
            <div className="duo-home-confirm-actions">
              <button
                type="button"
                className="duo-home-confirm-cancel"
                onClick={() => setForkConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="duo-home-confirm-go"
                onClick={() => {
                  const s = forkConfirm
                  setForkConfirm(null)
                  doResume(s, true)
                }}
              >
                Resume anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="duo-home-confirm-backdrop" role="dialog" aria-modal="true">
          <div className="duo-home-confirm">
            <p className="duo-home-confirm-title font-serif text-ink">
              Couldn’t open the session
            </p>
            <p className="duo-home-confirm-body text-ink-soft">{notice}</p>
            <div className="duo-home-confirm-actions">
              <button
                type="button"
                className="duo-home-confirm-go"
                onClick={() => setNotice(null)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
