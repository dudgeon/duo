// Stage 25 (v0.4.0) — post-redirect chrome banner.
//
// After `duo external <url>` (or any other shell.openExternal call
// from the duo subagent) succeeds, main pushes an
// `IPC.EXTERNAL_REDIRECTED` event with `{host, reason?}`. We render
// a small banner above the WorkingPane: "Sent <host> to your
// default browser. ⌘Tab to find it." Auto-dismisses after ~6s so
// it doesn't pile up if the agent fires several externals in quick
// succession (each new event resets the timer + replaces the
// banner contents — most recent wins).
//
// Why this exists: an off-host link (Cap One internal site, banking
// portal, the user's hardened personal browser bookmarks) routes
// invisibly without this nudge — the user sees nothing happen in
// Duo and may click again or assume the action failed. The banner
// is the visible receipt that the redirect ran AND a hint that
// their default browser has the page.

import { useEffect, useState } from 'react'
import type { ExternalRedirectedPush } from '@shared/types'

const AUTO_DISMISS_MS = 6000

export function ExternalRedirectedBanner() {
  const [push, setPush] = useState<ExternalRedirectedPush | null>(null)

  useEffect(() => {
    return window.electron.external.onRedirected(p => {
      setPush(p)
    })
  }, [])

  // Reset timer on each push: most-recent-wins. If two redirects
  // fire within 6s, only the second's banner remains visible (and
  // its timer counts from the second's arrival).
  useEffect(() => {
    if (!push) return
    const timer = setTimeout(() => setPush(null), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [push])

  if (!push) return null

  return (
    <div
      role="status"
      className="shrink-0 border-b border-accent/40 bg-accent-soft text-accent-ink text-sm flex items-center gap-3 px-4 py-2"
    >
      <span aria-hidden="true" className="shrink-0">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          {/* Arrow-out-of-box glyph */}
          <path d="M9 3h2v2M11 3l-4 4M3 5v6h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="flex-1 leading-snug">
        Sent <code className="font-mono text-[12px]">{push.host}</code> to your default browser.{' '}
        <span className="text-ink-mute">⌘Tab to find it.</span>
        {push.reason && (
          <span className="ml-2 text-[12px] text-ink-mute italic">— {push.reason}</span>
        )}
      </span>
      <button
        type="button"
        onClick={() => setPush(null)}
        className="px-2 h-6 rounded text-xs text-accent-ink hover:bg-accent hover:text-white transition-colors"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
