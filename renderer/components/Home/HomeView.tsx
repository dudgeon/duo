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
import type { HomeSnapshot, HomeProject, HomeSession, HomeMode, CatchupSnapshot, CatchupCard } from '@shared/types'
import { GreetingLine } from './GreetingLine'
import { HeroPanel } from './HeroPanel'
import { SpineRow } from './SpineRow'
import { CronSection } from './CronSection'
import { ModeToggle } from './ModeToggle'
import { CatchupBoard } from './CatchupBoard'
import { useCronJobs } from './CronJobRow'
import { selectHeroes, selectSpine, foldSpine, freshestSession, assignCronJobs } from './homeModel'
import './Home.css'
import './Catchup.css'

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
  // ENH-231 — the app-global Home mode (Projects ↔ Catch-up) + the catch-up
  // board snapshot. The mode is a display switch; it never triggers a fetch
  // (BUG-046) — the board is polled by the isActive-gated effect below, so a
  // toggle just changes which already-fetched view shows.
  const [homeMode, setHomeModeState] = useState<HomeMode>('projects')
  const [catchup, setCatchup] = useState<CatchupSnapshot | null>(null)
  const [spineExpanded, setSpineExpanded] = useState(false)
  // Round-2 #4 — which spine projects are expanded to reveal their sessions.
  const [expandedSpine, setExpandedSpine] = useState<Set<string>>(() => new Set())
  // A transient notice (e.g. an unexpected action error). Null = hidden.
  const [notice, setNotice] = useState<string | null>(null)
  // The session pending a fork-confirm — set when the user clicks a session
  // that's live OUTSIDE Duo. We warn, but let the user fork it (their call).
  const [forkConfirm, setForkConfirm] = useState<HomeSession | null>(null)

  // ENH-223 Tier 2 — scheduled ("cron") jobs, fetched live. Lifted here (not in
  // CronSection) so jobs can BOTH nest under their project card (D6) and the
  // remainder feed the aggregated "Scheduled" block.
  const { jobs: cronJobs, invoke: cronInvoke } = useCronJobs()

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

  // ENH-231 — the catch-up board. Same isActive gate (BUG-046): a hidden Home
  // polls nothing. Deliberately NOT gated on `homeMode` — both views stay warm
  // while Home is active, so flipping the mode is an instant display switch
  // that fires ZERO fetches. Cross-stage parity with the projects effect above.
  const fetchCatchup = useCallback(async () => {
    try {
      const next = await window.electron.home.catchup()
      if (aliveRef.current) setCatchup(next)
    } catch {
      // Best-effort — keep the last-good board (D14-style degradation).
    }
  }, [])

  useEffect(() => {
    if (!isActive) return
    void fetchCatchup()
    const id = setInterval(() => { void fetchCatchup() }, SNAPSHOT_POLL_MS)
    return () => clearInterval(id)
  }, [isActive, fetchCatchup])

  // ENH-231 — seed the mode once on mount (a cheap pref read, not a poll) and
  // subscribe to HOME_MODE_PUSH so a toggle in ANOTHER window moves this one.
  // The subscription sets state ONLY — it never fetches (the effects above own
  // the data; the mode is display-state).
  useEffect(() => {
    let alive = true
    void window.electron.home.getMode().then((m) => { if (alive) setHomeModeState(m) })
    const off = window.electron.home.onModeSet((m) => setHomeModeState(m))
    return () => { alive = false; off() }
  }, [])

  // The toggle: persist app-global (→ Settings → HOME_MODE_PUSH fan-out) AND set
  // local state optimistically. No fetch (BUG-046) — the board is already warm.
  const onChangeMode = useCallback((mode: HomeMode) => {
    setHomeModeState(mode)
    void window.electron.home.setMode(mode)
  }, [])

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

  // ENH-231 — catch-up card actions. A card carries the SAME focusable `open`
  // join as a HomeSession, so re-entry reuses the existing click contract
  // verbatim (focus duo-tab / fork-confirm external / resume closed) by adapting
  // the card to the minimal HomeSession shape onActivateSession consumes.
  const onOpenCatchupSession = useCallback((card: CatchupCard) => {
    const session: HomeSession = {
      uuid: card.uuid,
      title: card.goal || card.uuid.slice(0, 8),
      titleSource: 'jsonl-firstmsg',
      modifiedAt: card.lastActivityAt,
      cwd: card.cwd,
      ...(card.open ? { open: card.open } : {}),
    }
    onActivateSession(session)
  }, [onActivateSession])

  // A PR / external link opens in Duo's browser pane (a comparatively rare
  // reach — D7); best-effort, like the recent-file open.
  const onOpenUrl = useCallback((url: string) => {
    void window.electron.browser.addTab(url)
  }, [])

  // ── Render ──────────────────────────────────────────────────────────
  // Shared modals (fork-confirm + error notice) — a catch-up card click can
  // raise the same fork-confirm as a project session, so both modes render them.
  const overlays = (
    <>
      {forkConfirm && (
        <div className="duo-home-confirm-backdrop" role="dialog" aria-modal="true">
          <div className="duo-home-confirm">
            <p className="duo-home-confirm-title font-serif text-ink">Fork this session?</p>
            <p className="duo-home-confirm-body text-ink-soft">
              It’s already running outside Duo (another terminal or the Claude
              desktop app), so Duo can’t focus it. Forking branches a{' '}
              <strong>new session</strong> from its current state — your copy
              runs independently and won’t disturb the original.
            </p>
            <div className="duo-home-confirm-actions">
              <button type="button" className="duo-home-confirm-cancel" onClick={() => setForkConfirm(null)}>
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
                Fork session
              </button>
            </div>
          </div>
        </div>
      )}
      {notice && (
        <div className="duo-home-confirm-backdrop" role="dialog" aria-modal="true">
          <div className="duo-home-confirm">
            <p className="duo-home-confirm-title font-serif text-ink">Couldn’t open the session</p>
            <p className="duo-home-confirm-body text-ink-soft">{notice}</p>
            <div className="duo-home-confirm-actions">
              <button type="button" className="duo-home-confirm-go" onClick={() => setNotice(null)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  // ENH-231 — Catch-up mode renders independently of the projects snapshot
  // (it works before / without a projects fetch). The toggle sits above both.
  if (homeMode === 'catchup') {
    return (
      <div className="duo-home" data-duo-tab-kind="home">
        <ModeToggle mode={homeMode} onChange={onChangeMode} />
        {catchup ? (
          <CatchupBoard
            snapshot={catchup}
            now={catchup.generatedAt}
            onOpenSession={onOpenCatchupSession}
            onOpenFile={onOpenFile}
            onOpenUrl={onOpenUrl}
          />
        ) : (
          <div className="duo-home-loading text-ink-mute">Loading your sessions…</div>
        )}
        {overlays}
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="duo-home" data-duo-tab-kind="home">
        <ModeToggle mode={homeMode} onChange={onChangeMode} />
        <div className="duo-home-loading text-ink-mute">Loading your projects…</div>
      </div>
    )
  }

  const heroes = selectHeroes(snapshot.projects)
  const spine = selectSpine(snapshot.projects)
  const { visible: visibleSpine, hiddenCount } = foldSpine(spine, spineExpanded)
  const freshest = freshestSession(snapshot.projects)

  // D6 — split cron jobs into per-(surfaced-)project buckets + the aggregated
  // remainder. Surfaced = the two heroes + the currently-visible spine rows.
  const allRoots = snapshot.projects.map((p) => p.rootPath)
  const surfacedRoots = new Set([...heroes, ...visibleSpine].map((p) => p.rootPath))
  const { byRoot: cronByRoot, unmatched: cronUnmatched } = assignCronJobs(cronJobs, allRoots, surfacedRoots)

  return (
    <div className="duo-home" data-duo-tab-kind="home">
      <ModeToggle mode={homeMode} onChange={onChangeMode} />
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
              cronJobs={cronByRoot.get(project.rootPath) ?? []}
              cronInvoke={cronInvoke}
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
              cronJobs={cronByRoot.get(project.rootPath) ?? []}
              cronInvoke={cronInvoke}
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

      {/* ENH-223 Tier 2 — the aggregated "Scheduled" block (D6): only jobs whose
          project isn't a surfaced card. Jobs under surfaced projects nest under
          their hero/spine card instead. Renders nothing when empty. */}
      <CronSection jobs={cronUnmatched} invoke={cronInvoke} />

      {heroes.length === 0 && spine.length === 0 && (
        <div className="duo-home-empty text-ink-mute font-serif">
          No projects yet — open a folder in a terminal to get started.
        </div>
      )}

      {overlays}
    </div>
  )
}
