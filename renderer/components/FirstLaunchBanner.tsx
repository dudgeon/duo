// Stage 18 — first-launch self-install banner.
//
// Shown above the WorkingPane on every launch where
// ~/.claude/duo/installed.json is absent (or the recorded version is
// stale relative to the running build). Click [Install] → main runs
// the install service (copies skill + subagent + help-files into
// ~/.claude/, bootstraps external-domains.json, writes provenance) →
// banner shows success → fades out → won't re-appear next launch.
//
// Click [Skip for now] dismisses for the current session only —
// banner returns next launch (the install is genuinely useful and
// we'd rather nag once than let the user run without their skill +
// subagent installed).
//
// Phase 2 (deferred): CLI binary install to a sandbox-safe PATH
// location. The banner would then show a follow-up note about
// shell-rc PATH if needed.

import { useEffect, useState } from 'react'
import type { InstallStatus } from '@shared/types'

export function FirstLaunchBanner() {
  const [status, setStatus] = useState<InstallStatus | null>(null)
  const [phase, setPhase] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.electron.install.status().then(s => {
      if (!cancelled) setStatus(s)
    })
    return () => { cancelled = true }
  }, [])

  // Hide rules:
  //  - Status unknown (still loading) — render nothing
  //  - Already installed AND not stale — render nothing
  //  - User dismissed for this session — render nothing
  //  - Success state finished its fade — render nothing (driven by
  //    the success effect below, which transitions phase to a final
  //    'idle' after a delay)
  if (!status) return null
  if (status.installed && !status.needsUpdate) return null
  if (dismissed) return null
  if (phase === 'idle' && status.installed && !status.needsUpdate) return null

  const handleInstall = async () => {
    setPhase('running')
    setError(null)
    const result = await window.electron.install.run()
    if (result.ok && result.status) {
      setStatus(result.status)
      setPhase('success')
      // Success state lingers ~3s for visual confirmation, then the
      // status check kicks the banner out of render entirely.
      setTimeout(() => {
        setDismissed(true)
      }, 3000)
    } else {
      setError(result.error || 'Install failed.')
      setPhase('error')
    }
  }

  // Two visual modes: ready-to-install (the default) and post-install
  // success. Failure renders the error inline with a Retry button.
  return (
    <div
      role="status"
      className="shrink-0 px-4 py-2.5 border-b text-sm flex items-center gap-3 transition-colors bg-accent-soft border-accent text-accent-ink"
    >
      <span aria-hidden="true" className="shrink-0">
        {phase === 'success' ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
            <path d="M7 4v3.5l2 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        )}
      </span>

      <span className="flex-1 leading-snug">
        {phase === 'success' ? (
          <>
            <strong>Installed.</strong> Duo's skill, subagent, and help files are now under <code className="font-mono text-[12px]">~/.claude/</code>.
          </>
        ) : phase === 'error' ? (
          <>
            <strong>Install failed:</strong> {error}
          </>
        ) : status.needsUpdate ? (
          <>
            <strong>Duo update available.</strong> Refresh the installed skill + subagent + help files in <code className="font-mono text-[12px]">~/.claude/</code> (currently at v{status.version}).
          </>
        ) : (
          <>
            <strong>Welcome to Duo.</strong> Install the skill + subagent + help files into <code className="font-mono text-[12px]">~/.claude/</code> so Claude Code sessions can discover them. Your existing files won't be touched.
          </>
        )}
      </span>

      {phase === 'idle' && (
        <>
          <button
            type="button"
            onClick={handleInstall}
            className="px-3 h-7 rounded text-xs font-medium bg-accent text-white hover:bg-accent-ink transition-colors"
          >
            {status.needsUpdate ? 'Update' : 'Install'}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="px-2 h-7 rounded text-xs text-accent-ink hover:bg-accent-soft hover:text-accent transition-colors"
          >
            Skip for now
          </button>
        </>
      )}

      {phase === 'running' && (
        <span className="text-xs text-accent-ink">Installing…</span>
      )}

      {phase === 'error' && (
        <button
          type="button"
          onClick={handleInstall}
          className="px-3 h-7 rounded text-xs font-medium bg-accent text-white hover:bg-accent-ink transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  )
}

