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

import { useState, useSyncExternalStore, useEffect } from 'react'
import type { ClaudePresenceState, BannerTitleResult } from '@shared/host-api'
import {
  getSessionHeaderState,
  setSessionHeaderState,
  subscribeSessionHeader,
} from '../store/sessionHeader'

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

/** Pure state computation — no React, no side effects. Exported for tests. */
export function computeSessionHeaderState(args: {
  lastClaudeSession: LastClaudeSession
  claudePresence: ClaudePresenceState
  dismissedBanner: boolean
}): SessionHeaderState {
  const { lastClaudeSession, claudePresence, dismissedBanner } = args
  if (!lastClaudeSession?.id) return 'S0'
  if (dismissedBanner) return 'S0'
  // C5 will distinguish S2 (claude running with customTitle) from
  // pure "claude is up" no-op. For now: claude live → S0 (no header
  // until C5 lights up S2's named-banner surface).
  if (claudePresence === 'claude' || claudePresence === 'starting') return 'S2'
  // C6 will distinguish S1 (no captured UUID but prior sessions exist
  // in CWD) from S3 (captured UUID, restore offer). Only one of those
  // two reaches this branch today: S3 (we have a captured UUID).
  return 'S3'
}

export function SessionHeader({
  tabId, lastClaudeSession, cwd, claudePresence, onResume,
}: SessionHeaderProps): JSX.Element | null {
  const ui = useSyncExternalStore(
    subscribeSessionHeader,
    () => getSessionHeaderState(tabId),
  )
  const state = computeSessionHeaderState({
    lastClaudeSession,
    claudePresence,
    dismissedBanner: ui.dismissedBanner,
  })

  if (state === 'S0') return null
  if (state === 'S1') return null // placeholder — C6

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
        onCollapse={() => setSessionHeaderState(tabId, { collapsed: true })}
      />
    )
  }

  // S3 — restore-offer banner (reuses the cherry-picked UI verbatim).
  const sessionId = lastClaudeSession!.id
  return (
    <RestoreOfferBanner
      sessionId={sessionId}
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
  onCollapse: () => void
}

/** S2 expanded surface. Reads the D5 ladder title via IPC and displays
 *  it. × re-collapses (does NOT permanently dismiss — distinguishing
 *  collapse from dismiss is part of D11/D12 owner spec).
 *
 *  C5 minimum scope: title + close (collapse) only. Inline rename
 *  (C10) and Save-workspace button (later polish) come later. */
function NamedBanner({ tabId: _tabId, sessionUuid, cwd, onCollapse }: NamedBannerProps) {
  const [titleResult, setTitleResult] = useState<BannerTitleResult | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.electron.session.readBannerTitle(sessionUuid, cwd).then((r) => {
      if (!cancelled) setTitleResult(r)
    }).catch(() => {
      if (!cancelled) setTitleResult({ title: sessionUuid.slice(0, 8), source: 'uuid' })
    })
    return () => { cancelled = true }
  }, [sessionUuid, cwd])

  const title = titleResult?.title ?? '…'
  return (
    <div className="claude-resume-banner" data-session-header-state="S2">
      <span className="claude-resume-banner__arrow">●</span>
      <span className="claude-resume-banner__text">
        Claude session: <code className="claude-resume-banner__sid">{title}</code>
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
  )
}

interface RestoreOfferBannerProps {
  sessionId: string
  onResume: () => void
  onDismiss: () => void
}

function RestoreOfferBanner({ sessionId, onResume, onDismiss }: RestoreOfferBannerProps) {
  const [resuming, setResuming] = useState(false)
  const idDisplay = sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId
  return (
    <div className="claude-resume-banner">
      <span className="claude-resume-banner__arrow">⏪</span>
      <span className="claude-resume-banner__text">
        This tab had Claude session <code className="claude-resume-banner__sid">{idDisplay}</code>
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
