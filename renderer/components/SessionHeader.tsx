// ENH-183 (Sprint 21 / v0.7.9) — polymorphic session header.
//
// Replaces the cherry-picked `ClaudeResumeBanner` (C2) with a state-
// routing component. Computes one of S0 / S1 / S2 / S3 from the
// per-tab signals (`lastClaudeSession`, claudePresence, …) and
// renders the matching surface.
//
//   S0 — quiet (no header). Default when no Claude history exists
//        for the tab AND no captured `lastClaudeSession.id`.
//   S1 — resume pills (Variant B vertical mini-list). Lands in C6.
//   S2 — named banner (collapsed dot + expandable). Lands in C5.
//   S3 — restore-offer banner. Workspace restore reattaches a tab
//        whose previous Claude session UUID was captured at save
//        time; claude itself is not running yet. The user can click
//        Resume to spawn `claude --resume <uuid>` into the PTY.
//
// C3 is a structural refactor only. S0 + S3 are wired (S3 reuses the
// banner UI verbatim from the cherry-pick). S1 + S2 fall through to
// S0 (no render) until C5/C6 ship the respective surfaces.
//
// **D9 invariant** — all UI state held here lives in
// `renderer/store/sessionHeader.ts` as in-memory only. Nothing
// persists to disk; restart wipes dismissal + collapse + edit state.

import { useState, useSyncExternalStore, useEffect, useMemo, useRef } from 'react'
import type { ClaudePresenceState, BannerTitleResult, PriorSessionListing } from '@shared/host-api'
import {
  getSessionHeaderState,
  setSessionHeaderState,
  subscribeSessionHeader,
} from '../store/sessionHeader'
import {
  getSeenRenameTip,
  setSeenRenameTip,
  subscribeSeenRenameTip,
} from '../store/sessionTipPrefs'

type LastClaudeSession = { id: string; capturedAt: number } | null | undefined

interface SessionHeaderProps {
  /** Stable per-tab identifier — keys the in-memory UI store. */
  tabId: string
  /** Workspace-captured session UUID if any (the cherry-picked field). */
  lastClaudeSession: LastClaudeSession
  /** Active terminal cwd — needed for the JSONL-store IPC lookup. */
  cwd: string
  /** Claude presence for the active terminal — gates S2 vs S3. */
  claudePresence: ClaudePresenceState
  /** Click handler for S3's Resume button. */
  onResume: (sessionId: string) => void
}

export type SessionHeaderState = 'S0' | 'S1' | 'S2' | 'S3'

/** Pure state computation — no React, no side effects. Exported for tests.
 *
 * State priority:
 *   - dismissedBanner → S0 (suppress everything)
 *   - lastClaudeSession.id + claude live → S2 (named banner)
 *   - lastClaudeSession.id + claude not running → S3 (restore offer)
 *   - no captured UUID + claude not running + priorSessionsCount > 0 → S1 (pills)
 *   - everything else → S0
 */
export function computeSessionHeaderState(args: {
  lastClaudeSession: LastClaudeSession
  claudePresence: ClaudePresenceState
  dismissedBanner: boolean
  /** Number of prior `<uuid>.jsonl` files in the active CWD's
   *  `~/.claude/projects/` dir (refreshed async by S1 fetch in
   *  SessionHeader). Defaults to 0 if the fetch hasn't returned yet
   *  or the CWD has no prior sessions. */
  priorSessionsCount?: number
}): SessionHeaderState {
  const { lastClaudeSession, claudePresence, dismissedBanner, priorSessionsCount = 0 } = args
  if (dismissedBanner) return 'S0'
  if (lastClaudeSession?.id) {
    if (claudePresence === 'claude' || claudePresence === 'starting') return 'S2'
    return 'S3'
  }
  // No captured UUID. If claude is already live in the tab we have
  // nothing to offer — the live session will itself become S2 once
  // its UUID gets captured (C9 first-capture trigger). When claude
  // is NOT running, offer the prior-sessions pills if any exist.
  if (claudePresence === 'claude' || claudePresence === 'starting') return 'S0'
  if (priorSessionsCount > 0) return 'S1'
  return 'S0'
}

export function SessionHeader({
  tabId, lastClaudeSession, cwd, claudePresence, onResume,
}: SessionHeaderProps): JSX.Element | null {
  const ui = useSyncExternalStore(
    subscribeSessionHeader,
    () => getSessionHeaderState(tabId),
  )

  // S1 gate — we only fetch the prior-sessions list when the tab is
  // in a state that could become S1 (no captured UUID, claude not
  // live). Avoids unnecessary I/O on S2/S3/S0 paths.
  const couldBeS1 = !lastClaudeSession?.id &&
    claudePresence !== 'claude' &&
    claudePresence !== 'starting' &&
    !ui.dismissedBanner

  const [priorSessions, setPriorSessions] = useState<PriorSessionListing[]>([])
  useEffect(() => {
    if (!couldBeS1) {
      setPriorSessions([])
      return
    }
    let cancelled = false
    void window.electron.session.listPrior(cwd, { limit: 10, excludeUuid: lastClaudeSession?.id })
      .then((rows) => { if (!cancelled) setPriorSessions(rows) })
      .catch(() => { if (!cancelled) setPriorSessions([]) })
    return () => { cancelled = true }
  }, [couldBeS1, cwd, lastClaudeSession?.id])

  // Auto-dismiss S1 pills only when THIS tab transitions INTO a
  // claude-running state — i.e. the user actually spawned claude in
  // this tab. Without the prev-tracking + same-tabId check, we'd
  // dismiss on:
  //   1. initial mount (prev presence undefined, current happens to
  //      be 'claude' because useClaudePresence cached the previous
  //      front-terminal's value during the ~100ms probe lag)
  //   2. cross-tab switches (component instance persists across
  //      activeTab changes; prev presence was the OLD tab's state)
  // Both of those were observed by the owner on a fresh shell tab in
  // a CWD with prior sessions — S1 should have fired but didn't.
  const prevTransitionRef = useRef<{ tabId: string; presence: ClaudePresenceState } | null>(null)
  useEffect(() => {
    const prev = prevTransitionRef.current
    prevTransitionRef.current = { tabId, presence: claudePresence }
    if (
      prev &&
      prev.tabId === tabId &&
      prev.presence !== 'claude' &&
      prev.presence !== 'starting' &&
      (claudePresence === 'claude' || claudePresence === 'starting')
    ) {
      if (ui.pillsVisible) setSessionHeaderState(tabId, { pillsVisible: false })
    }
  }, [claudePresence, ui.pillsVisible, tabId])

  const state = computeSessionHeaderState({
    lastClaudeSession,
    claudePresence,
    dismissedBanner: ui.dismissedBanner,
    priorSessionsCount: priorSessions.length,
  })

  if (state === 'S0') return null

  if (state === 'S1') {
    if (!ui.pillsVisible) return null
    return (
      <SessionPillsList
        sessions={priorSessions}
        onPickSession={(uuid) => {
          void window.electron.pty.write(tabId, `claude --resume ${uuid}\n`)
          setSessionHeaderState(tabId, { pillsVisible: false })
        }}
        onDismiss={() => setSessionHeaderState(tabId, { pillsVisible: false })}
      />
    )
  }

  // S2 — claude is live in this tab AND we have a captured session
  // UUID. Default collapsed (small dot on TabBar marker, handled
  // there). Click the active tab to expand into the named banner.
  if (state === 'S2') {
    if (ui.collapsed) return null
    return (
      <NamedBanner
        tabId={tabId}
        sessionUuid={lastClaudeSession!.id}
        cwd={cwd}
        claudePresence={claudePresence}
        onCollapse={() => setSessionHeaderState(tabId, { collapsed: true })}
      />
    )
  }

  // S3 — restore-offer banner. ENH-183 C7 — title now derived via D5
  // ladder (C4 IPC), not the UUID prefix.
  const sessionId = lastClaudeSession!.id
  return (
    <RestoreOfferBanner
      sessionId={sessionId}
      cwd={cwd}
      onResume={() => {
        onResume(sessionId)
        setSessionHeaderState(tabId, { dismissedBanner: true })
      }}
      onDismiss={() => setSessionHeaderState(tabId, { dismissedBanner: true })}
    />
  )
}

interface NamedBannerProps {
  tabId: string
  sessionUuid: string
  cwd: string
  claudePresence: ClaudePresenceState
  onCollapse: () => void
}

/** S2 expanded surface. Reads the D5 ladder title via IPC and displays
 *  it. × re-collapses (does NOT permanently dismiss — distinguishing
 *  collapse from dismiss is part of D11/D12 owner spec).
 *
 *  C10 — inline rename. Click the title → contentEditable cursor +
 *  text selected. Return commits via PTY-write `\r/rename <title>\n`;
 *  Esc cancels; click-outside commits. Only editable when
 *  claudePresence === 'claude' (the same gate the C8 hydrator uses
 *  for its Duo-driven counterpart). */
function NamedBanner({ tabId, sessionUuid, cwd, claudePresence, onCollapse }: NamedBannerProps) {
  const [titleResult, setTitleResult] = useState<BannerTitleResult | null>(null)
  const [editing, setEditing] = useState(false)
  const titleRef = useRef<HTMLSpanElement>(null)
  const originalRef = useRef<string>('')
  const reloadTickRef = useRef(0)
  // ENH-183 C11 — first-time educational banner. Shown above the title
  // line the FIRST time any user sees an S2 named banner on this Duo
  // install. Dismiss persists per-install via localStorage (D9 — a
  // renderer pref, not session-shadowing).
  const seenRenameTip = useSyncExternalStore(subscribeSeenRenameTip, getSeenRenameTip)

  // Read the title from the D5 ladder. After a rename commit, bump
  // `reloadTickRef` to re-fetch so we see Claude's actual customTitle
  // write (rather than our optimistic preview).
  useEffect(() => {
    let cancelled = false
    void window.electron.session.readBannerTitle(sessionUuid, cwd).then((r) => {
      if (!cancelled) setTitleResult(r)
    }).catch(() => {
      if (!cancelled) setTitleResult({ title: sessionUuid.slice(0, 8), source: 'uuid' })
    })
    return () => { cancelled = true }
  }, [sessionUuid, cwd, reloadTickRef.current])

  const title = titleResult?.title ?? '…'
  const canEdit = claudePresence === 'claude'

  const beginEdit = () => {
    if (!canEdit || editing) return
    originalRef.current = title
    setEditing(true)
  }

  // After entering edit mode, set the DOM text + select all + focus.
  // This is imperative so React's children prop doesn't fight the
  // contentEditable buffer.
  useEffect(() => {
    if (!editing || !titleRef.current) return
    const el = titleRef.current
    el.textContent = originalRef.current
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [editing])

  const commit = () => {
    if (!editing) return
    const candidate = (titleRef.current?.textContent ?? '').trim()
    if (candidate && candidate !== originalRef.current) {
      // PTY-inject /rename. Same shape as C8 hydrator — CR + slash
      // + LF — so Claude treats it identically to a typed command.
      void window.electron.pty.write(tabId, `\r/rename ${candidate}\n`)
      // Optimistic update — show the new title immediately. Re-fetch
      // after 2s so we transition from optimism to the actual
      // customTitle JSONL entry once Claude has processed.
      setTitleResult({ title: candidate, source: 'customTitle' })
      setTimeout(() => { reloadTickRef.current += 1 }, 2000)
    }
    setEditing(false)
  }

  const cancel = () => {
    if (!editing) return
    setEditing(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  return (
    <div className="claude-resume-banner" data-session-header-state="S2">
      {!seenRenameTip && (
        <div
          className="claude-resume-banner__tip"
          data-session-header-tip="rename"
          role="status"
        >
          <span className="claude-resume-banner__tip-text">
            Duo named this session from your first message. To change it,
            type{' '}
            <code className="claude-resume-banner__tip-code">/rename &lt;new title&gt;</code>
            {' '}in Claude any time.
          </span>
          <button
            type="button"
            className="claude-resume-banner__tip-dismiss"
            onClick={() => setSeenRenameTip(true)}
            aria-label="Dismiss tip"
          >
            Got it
          </button>
        </div>
      )}
      <div className="claude-resume-banner__row">
        <span className="claude-resume-banner__arrow">●</span>
        <span className="claude-resume-banner__text">
          Claude session:{' '}
          <code
            ref={titleRef}
            className={[
              'claude-resume-banner__sid',
              canEdit ? 'claude-resume-banner__sid--editable' : '',
              editing ? 'claude-resume-banner__sid--editing' : '',
            ].filter(Boolean).join(' ')}
            contentEditable={editing}
            suppressContentEditableWarning
            spellCheck={false}
            onClick={beginEdit}
            onBlur={commit}
            onKeyDown={onKeyDown}
            title={canEdit ? 'Click to rename' : 'Rename available when Claude is live'}
            data-editable={canEdit ? 'true' : 'false'}
          >
            {editing ? null : title}
          </code>
        </span>
        <button
          type="button"
          className="claude-resume-banner__dismiss"
          onClick={onCollapse}
          aria-label="Collapse"
          title="Collapse to tab marker"
        >
          ×
        </button>
      </div>
    </div>
  )
}

interface RestoreOfferBannerProps {
  sessionId: string
  cwd: string
  onResume: () => void
  onDismiss: () => void
}

interface SessionPillsListProps {
  sessions: PriorSessionListing[]
  onPickSession: (uuid: string) => void
  onDismiss: () => void
}

/** S1 — vertical mini-list of prior sessions for this CWD. D10 = Variant B,
 *  D11 = 3 visible + "show all". Header copy locked: "Resume previous session". */
function SessionPillsList({ sessions, onPickSession, onDismiss }: SessionPillsListProps) {
  const [showAll, setShowAll] = useState(false)
  const visible = useMemo(() => showAll ? sessions : sessions.slice(0, 3), [sessions, showAll])
  const hiddenCount = sessions.length - visible.length
  return (
    <div className="claude-resume-banner claude-resume-banner--pills" data-session-header-state="S1">
      <div className="claude-resume-banner__pills-header">Resume previous session</div>
      <div className="claude-resume-banner__pills-list">
        {visible.map((s) => (
          <button
            key={s.uuid}
            type="button"
            className="claude-resume-banner__pill-row"
            onClick={() => onPickSession(s.uuid)}
            title={`${s.title} · ${s.messageCount} msg${s.messageCount === 1 ? '' : 's'} · resume`}
            data-session-uuid={s.uuid}
          >
            <span className="claude-resume-banner__pill-icon">↻</span>
            <span className="claude-resume-banner__pill-title">{s.title}</span>
            <span className="claude-resume-banner__pill-msgs">{s.messageCount} msg{s.messageCount === 1 ? '' : 's'}</span>
            <span className="claude-resume-banner__pill-when">{relativeWhen(s.modifiedAt)}</span>
          </button>
        ))}
      </div>
      <div className="claude-resume-banner__pills-footer">
        <span>
          {hiddenCount > 0
            ? <>
                {hiddenCount} older session{hiddenCount === 1 ? '' : 's'} ·{' '}
                <button
                  type="button"
                  className="claude-resume-banner__pills-showall"
                  onClick={() => setShowAll(true)}
                >show all</button>
              </>
            : null}
        </span>
        <button
          type="button"
          className="claude-resume-banner__pills-dismiss"
          onClick={onDismiss}
        >Dismiss · keep new session</button>
      </div>
    </div>
  )
}

/** "5h ago", "2d ago" — single-unit relative time. */
function relativeWhen(modifiedAtMs: number): string {
  const diffMs = Date.now() - modifiedAtMs
  const m = Math.floor(diffMs / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function RestoreOfferBanner({ sessionId, cwd, onResume, onDismiss }: RestoreOfferBannerProps) {
  const [resuming, setResuming] = useState(false)
  // ENH-183 C7 — read the D5 ladder title so the restore offer shows
  // a meaningful name (customTitle / aiTitle / first user message)
  // instead of a bare UUID prefix. Falls back to short UUID if the
  // JSONL is gone (tombstoned) or unreadable.
  const [titleResult, setTitleResult] = useState<BannerTitleResult | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.electron.session.readBannerTitle(sessionId, cwd).then((r) => {
      if (!cancelled) setTitleResult(r)
    }).catch(() => {
      if (!cancelled) {
        const short = sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId
        setTitleResult({ title: short, source: 'uuid' })
      }
    })
    return () => { cancelled = true }
  }, [sessionId, cwd])
  const title = titleResult?.title ?? (sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId)
  return (
    <div className="claude-resume-banner" data-session-header-state="S3">
      <span className="claude-resume-banner__arrow">⏪</span>
      <span className="claude-resume-banner__text">
        This tab had: <code className="claude-resume-banner__sid">{title}</code>
      </span>
      <button
        type="button"
        className="claude-resume-banner__resume"
        onClick={() => {
          if (resuming) return
          setResuming(true)
          onResume()
        }}
        disabled={resuming}
      >
        {resuming ? 'Resuming…' : 'Resume'}
      </button>
      <button
        type="button"
        className="claude-resume-banner__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
