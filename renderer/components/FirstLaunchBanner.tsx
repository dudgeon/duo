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
  // BUG-011 fix — the redundant `if (status.installed && !status.needsUpdate)
  // return null` that lived here short-circuited BEFORE the success state
  // could render: setStatus on install completion immediately marked the
  // banner as "installed" and unmounted the component, so the user never
  // saw the "Installed." confirmation. The fourth check below is the
  // correct gate — only hide on installed when phase is idle (i.e. we're
  // not in the middle of showing success / error / running feedback).
  if (dismissed) return null
  if (phase === 'idle' && status.installed && !status.needsUpdate) return null

  const handleInstall = async () => {
    setPhase('running')
    setError(null)
    const result = await window.electron.install.run()
    if (result.ok && result.status) {
      setStatus(result.status)
      setPhase('success')
      // Auto-dismiss after ~3s ONLY when there's nothing more for the
      // user to do. If the CLI binary landed but the user's PATH
      // doesn't include ~/.local/bin, leave the banner up so they can
      // copy the shell-rc snippet at their own pace — they'll dismiss
      // when ready.
      const cli = result.status.cli
      const stable = !cli || (cli.installed && cli.onPath) || !cli.installed
      if (stable) {
        setTimeout(() => {
          setDismissed(true)
        }, 3000)
      }
    } else {
      setError(result.error || 'Install failed.')
      setPhase('error')
    }
  }

  // Success path may need the user's eyes longer than the rest if the
  // PATH hint applies. The shell-rc block renders as a separate row
  // below the main banner line.
  const cli = status.cli
  const showPathHint = phase === 'success' && cli?.installed && !cli.onPath
  const pathSnippet = 'export PATH="$HOME/.local/bin:$PATH"'

  return (
    <div
      role="status"
      className={[
        'shrink-0 border-b text-sm transition-colors bg-accent-soft border-accent text-accent-ink',
        showPathHint ? 'flex flex-col gap-2 px-4 py-3' : 'flex items-center gap-3 px-4 py-2.5'
      ].join(' ')}
    >
      <div className="flex items-center gap-3 w-full">
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
            cli?.installed && cli.onPath ? (
              <>
                <strong>Installed.</strong> Skill + subagent + help files in <code className="font-mono text-[12px]">~/.claude/</code>; <code className="font-mono text-[12px]">duo</code> CLI ready on your PATH.
              </>
            ) : cli?.installed ? (
              <>
                <strong>Installed.</strong> Skill + subagent + help files in <code className="font-mono text-[12px]">~/.claude/</code>; <code className="font-mono text-[12px]">duo</code> CLI at <code className="font-mono text-[12px]">~/.local/bin/duo</code>. Add this dir to your PATH to use the CLI from any terminal:
              </>
            ) : (
              <>
                <strong>Installed.</strong> Skill + subagent + help files in <code className="font-mono text-[12px]">~/.claude/</code>. (CLI binary couldn't be copied — try again or symlink <code className="font-mono text-[12px]">cli/duo</code> manually.)
              </>
            )
          ) : phase === 'error' ? (
            <>
              <strong>Install failed:</strong> {error}
            </>
          ) : status.needsUpdate ? (
            <>
              <strong>Duo update available.</strong> Refresh the installed skill + subagent + help files + CLI in <code className="font-mono text-[12px]">~/.claude/</code> (currently at v{status.version}).
            </>
          ) : (
            <>
              <strong>Welcome to Duo.</strong> Install the skill + subagent + help files into <code className="font-mono text-[12px]">~/.claude/</code> and the <code className="font-mono text-[12px]">duo</code> CLI to <code className="font-mono text-[12px]">~/.local/bin</code>. Your existing files won't be touched.
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

        {showPathHint && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="px-2 h-7 rounded text-xs text-accent-ink hover:bg-accent-soft hover:text-accent transition-colors"
          >
            Got it
          </button>
        )}
      </div>

      {showPathHint && (
        <pre
          aria-label="Add to your shell rc file (e.g. ~/.zshrc)"
          className="text-[12px] font-mono bg-surface-0 border border-accent-soft rounded px-3 py-2 ml-7 text-ink select-all whitespace-pre-wrap break-all"
        >{pathSnippet}</pre>
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

