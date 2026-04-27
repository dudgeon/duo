// v0.4.0 — GitHub Releases upgrade-available banner.
//
// Distinct from `FirstLaunchBanner` (which is the LOCAL re-install
// reminder triggered when `~/.claude/duo/installed.json`'s version
// drifts from `app.getVersion()`). This banner asks the GitHub API
// whether there's a newer DUO release available than the one
// currently running, and surfaces a download link if so.
//
// The user can dismiss for the current session. The dismissal is
// localStorage-keyed by the upstream version so a NEW upstream
// release re-surfaces the banner (the user dismissed v0.4.0 →
// banner stays hidden; v0.4.1 ships → banner returns).
//
// Failure mode: the banner only renders when `updateAvailable` is
// true. Network failures, GitHub rate limits, missing cache — all
// silently skip the banner; the user is no worse off than they
// were before this feature shipped.

import { useEffect, useState } from 'react'
import type { UpdateCheckResult } from '@shared/types'

const LS_KEY_DISMISSED = 'duo.updateBanner.dismissed'

function loadDismissed(): string | null {
  try { return localStorage.getItem(LS_KEY_DISMISSED) } catch { return null }
}

function saveDismissed(version: string): void {
  try { localStorage.setItem(LS_KEY_DISMISSED, version) } catch { /* ignore */ }
}

export function UpdateAvailableBanner() {
  const [check, setCheck] = useState<UpdateCheckResult | null>(null)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(loadDismissed)

  useEffect(() => {
    let cancelled = false
    void window.electron.update.check().then(result => {
      if (!cancelled) setCheck(result)
    })
    return () => { cancelled = true }
  }, [])

  if (!check) return null
  if (!check.updateAvailable || !check.latest) return null
  // User explicitly dismissed THIS upstream version — stay quiet
  // until a newer one ships.
  if (dismissedVersion === check.latest) return null

  const handleDownload = () => {
    if (check.releaseUrl) {
      // Punt to the system browser via the same `duo external`
      // mechanism the rest of the app uses. The release page
      // typically lives on github.com which is on most users'
      // external-domains.json (or just generally a place users
      // prefer in their hardened personal browser anyway).
      void window.electron.browser.addTab(check.releaseUrl)
    }
  }

  const handleDismiss = () => {
    if (check.latest) {
      saveDismissed(check.latest)
      setDismissedVersion(check.latest)
    }
  }

  return (
    <div
      role="status"
      className="shrink-0 border-b border-accent bg-accent-soft text-accent-ink text-sm flex items-center gap-3 px-4 py-2.5"
    >
      <span aria-hidden="true" className="shrink-0">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1.5v8M3.5 6L7 9.5 10.5 6M2 12h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="flex-1 leading-snug">
        <strong>Duo v{check.latest} is available.</strong>{' '}
        You're running v{check.current}. Download the new DMG from{' '}
        <button
          type="button"
          onClick={handleDownload}
          className="underline underline-offset-2 hover:text-accent transition-colors"
        >
          GitHub Releases
        </button>
        {' '}then re-install.
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        className="px-2 h-7 rounded text-xs text-accent-ink hover:bg-accent hover:text-white transition-colors"
        aria-label="Dismiss for this version"
      >
        Skip
      </button>
    </div>
  )
}
