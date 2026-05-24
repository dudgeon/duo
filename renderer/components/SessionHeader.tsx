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

import { useState, useSyncExternalStore } from 'react'
import type { ClaudePresenceState } from '@shared/host-api'
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
  tabId, lastClaudeSession, claudePresence, onResume,
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
  if (state === 'S2') return null // placeholder — C5

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
