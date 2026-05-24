// ENH-177 (Sprint 20 / v0.7.7) — non-modal "Resume Claude session"
// banner. Mounted by TerminalPane when the active tab has a
// captured `lastClaudeSession` AND claudePresence is NOT currently
// 'claude'. Click Resume → writes `claude --resume <id>\n` into the
// tab's PTY. Click × → dismisses for this tab only, this session
// only (no persistence).
//
// Anchored as an absolute overlay above the xterm host, so it
// doesn't push xterm's measured cell geometry around. Owner spec
// 2026-05-23: *"a non-annoying banner"*.

import { useState } from 'react'

interface Props {
  sessionId: string
  onResume: () => void
  onDismiss: () => void
}

export function ClaudeResumeBanner({ sessionId, onResume, onDismiss }: Props) {
  const [resuming, setResuming] = useState(false)
  // Truncate the UUID for display — full ID is too long for a banner
  // but the prefix is unique enough to disambiguate visually if the
  // user has multiple recent sessions.
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
