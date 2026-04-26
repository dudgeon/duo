// Stage 13b — Warn-before-overwrite banner (editor-agnostic primitive).
//
// Renders the "Claude wants to edit this page" banner the host surface
// shows when the agent attempts a write while the human has unsaved
// edits. The host (markdown editor today, HTML canvas in Stage 17 H36)
// catches the incoming write, holds the resolution, and renders this
// banner. The user's accept/decline choice flows back through the
// host's own IPC reply path.
//
// Pure visual layer — no editor-specific imports, no IPC, no global
// state. Per the contract in `primitives/README.md`, the data layer
// (which write API, which reply channel) is the host's concern.

import type { ReactNode } from 'react'

export interface WriteWarningBannerProps {
  /** Short label naming what the agent wants to do.
   *  e.g. "Replace the whole document" or "Insert at the caret". */
  action: string
  /** Optional preview text — the proposed replacement, truncated.
   *  The host clamps length to whatever's tasteful for the surface. */
  preview?: string
  /** Optional agent label. Defaults to "Claude". */
  agent?: string
  /** Called when the user accepts the agent's write. Host should apply
   *  the write and reply ok to the agent's IPC. */
  onAccept: () => void
  /** Called when the user declines. Host should reply with an error
   *  ("user declined") so the agent's CLI surfaces it. */
  onDecline: () => void
  /** Optional secondary slot — host can pass a "Save first" or "Diff"
   *  link, etc. Rendered to the right of the buttons. */
  extra?: ReactNode
}

/**
 * Stage 17 reuse: the canvas surface (H36) imports this verbatim. The
 * `action` string is the only thing that varies — for HTML it might be
 * "Replace this element" or "Append to <main>".
 */
export function WriteWarningBanner({
  action,
  preview,
  agent = 'Claude',
  onAccept,
  onDecline,
  extra
}: WriteWarningBannerProps) {
  return (
    <div
      role="alertdialog"
      aria-label="Agent wants to write to this document"
      className="duo-write-warning-banner"
    >
      <div className="duo-write-warning-banner__body">
        <span className="duo-write-warning-banner__sparkle" aria-hidden="true">
          ✨
        </span>
        <div className="duo-write-warning-banner__copy">
          <div className="duo-write-warning-banner__title">
            <strong>{agent}</strong> wants to edit this document
          </div>
          <div className="duo-write-warning-banner__action">{action}</div>
          {preview && (
            <div
              className="duo-write-warning-banner__preview"
              title={preview}
            >
              {preview}
            </div>
          )}
        </div>
      </div>
      <div className="duo-write-warning-banner__actions">
        <button
          type="button"
          className="duo-write-warning-banner__btn duo-write-warning-banner__btn--decline"
          onClick={onDecline}
        >
          Decline
        </button>
        <button
          type="button"
          className="duo-write-warning-banner__btn duo-write-warning-banner__btn--accept"
          onClick={onAccept}
          autoFocus
        >
          Apply edit
        </button>
        {extra}
      </div>
    </div>
  )
}
