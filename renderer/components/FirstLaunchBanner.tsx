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
import type { InstallStatus, AddToShellPathResult } from '@shared/types'

export function FirstLaunchBanner() {
  const [status, setStatus] = useState<InstallStatus | null>(null)
  const [phase, setPhase] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  // ENH-017 — local state for the inline "Add to PATH" follow-up.
  const [pathPhase, setPathPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [pathResult, setPathResult] = useState<AddToShellPathResult | null>(null)

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
      // user to do. We hold the banner open if:
      //   - CLI installed but PATH missing — user needs to copy a
      //     shell-rc snippet
      //   - CLI couldn't install — user may want to retry / debug
      //   - Stage 19b: a non-Duo SessionStart hook already exists, so
      //     the user should know our hook will run alongside theirs
      const cli = result.status.cli
      const priming = result.status.priming
      // ENH-017 — when CLI installed but not on PATH, hold the banner
      // so the user can click the new "Add to PATH" button.
      const cliStable = !cli || (cli.installed && cli.onPath) || !cli.installed
      // Hold the banner if priming has a hook conflict (user should
      // notice their other hooks will run alongside ours) OR if the
      // shim couldn't install because Claude Code wasn't found on
      // PATH (the load-bearing priming mechanism is missing — they
      // should install Claude Code and re-run).
      const primingStable = !priming?.hookConflict && (!priming || priming.shimInstalled)
      if (cliStable && primingStable) {
        setTimeout(() => {
          setDismissed(true)
        }, 3000)
      }
    } else {
      setError(result.error || 'Install failed.')
      setPhase('error')
    }
  }

  // Success path may need the user's eyes longer than the rest when a
  // follow-up note applies (hook conflict, claude not detected). Each
  // such note renders as a separate row below the main banner line.
  // v0.4.5: dropped the duo-CLI-on-PATH hint entirely — the CLI is
  // designed to run inside Duo's own terminals (whose PTYs inherit
  // ~/.local/bin via priming), not from external shells. Surfacing
  // a "fix your PATH" warning to non-technical users for an
  // intentionally-internal CLI was confusing without being load-bearing.
  const cli = status.cli
  const priming = status.priming
  const showHookConflictNote = phase === 'success' && priming?.hookConflict
  const showShimMissingNote = phase === 'success' && priming && !priming.shimInstalled
  // ENH-017 — show the "Add to PATH" row when the CLI is installed but
  // its directory isn't on the user's external-shell PATH. Inside Duo
  // PTYs the binary works because PtyManager prepends ~/.local/bin;
  // this row offers to also wire it up for external Terminal/iTerm
  // sessions where users hit "duo: command not found".
  const showAddToPathNote = phase === 'success' && cli?.installed && cli.onPath === false
  const expandRow = showHookConflictNote || showShimMissingNote || showAddToPathNote

  const handleAddToPath = async () => {
    setPathPhase('running')
    const result = await window.electron.install.addToShellPath()
    setPathResult(result)
    setPathPhase(result.ok ? 'done' : 'error')
  }

  return (
    <div
      role="status"
      className={[
        'shrink-0 border-b text-sm transition-colors bg-accent-soft border-accent text-accent-ink',
        expandRow ? 'flex flex-col gap-2 px-4 py-3' : 'flex items-center gap-3 px-4 py-2.5'
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
            cli?.installed ? (
              <>
                <strong>Installed.</strong> Claude inside Duo's terminals will arrive Duo-aware.
              </>
            ) : (
              <>
                <strong>Installed.</strong> Agent files added to <code className="font-mono text-[12px]">~/.claude/</code>. (Couldn't drop Duo's CLI helper into <code className="font-mono text-[12px]">~/.local/bin/</code>; try again or symlink <code className="font-mono text-[12px]">cli/duo</code> manually.)
              </>
            )
          ) : phase === 'error' ? (
            <>
              <strong>Install failed:</strong> {error}
            </>
          ) : status.needsUpdate ? (
            // BUG-062 — be explicit about which version is which.
            // Old wording "(currently from v{X})" was ambiguous —
            // sounded like Duo itself was at v{X}. The accurate
            // framing: agent files in ~/.claude/ were installed by
            // an older Duo; the running Duo is newer; Refresh
            // to bring the agent files forward.
            <>
              <strong>Agent files in <code className="font-mono text-[12px]">~/.claude/</code> are from Duo v{status.version}.</strong> You're running v{window.electron.env.appVersion}. Refresh to update.
            </>
          ) : (
            <>
              <strong>Welcome to Duo.</strong> Set up the files Duo needs to work with Claude — they go in <code className="font-mono text-[12px]">~/.claude/</code>, and we won't touch any of your existing files.
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

        {expandRow && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="px-2 h-7 rounded text-xs text-accent-ink hover:bg-accent-soft hover:text-accent transition-colors"
          >
            Got it
          </button>
        )}
      </div>

      {showHookConflictNote && (
        <p className="text-[12px] ml-7 text-accent-ink leading-snug">
          <strong>Heads-up:</strong> you had existing entries in <code className="font-mono">~/.claude/settings.json</code>. Duo added its setup alongside them — nothing was overwritten.
        </p>
      )}

      {showShimMissingNote && (
        <p className="text-[12px] ml-7 text-accent-ink leading-snug">
          <strong>Couldn't find Claude Code on this Mac.</strong> Duo searched your usual shell paths and didn't see <code className="font-mono">claude</code>. If it's installed, the agent inside Duo's terminals will still work — it just won't be Duo-aware (won't know how to drive the browser pane, etc.). Install Claude Code from <a href="https://docs.claude.com/claude-code" className="underline">docs.claude.com/claude-code</a>, then click Update.
        </p>
      )}

      {showAddToPathNote && (
        <div className="text-[12px] ml-7 text-accent-ink leading-snug flex items-start gap-3">
          <div className="flex-1">
            {pathPhase === 'idle' && (
              <>
                <strong>Use <code className="font-mono">duo</code> from outside the app?</strong> Inside Duo's terminals it works automatically. To use it from Terminal / iTerm too, add <code className="font-mono">~/.local/bin</code> to your shell PATH.
              </>
            )}
            {pathPhase === 'running' && <>Updating shell config…</>}
            {pathPhase === 'done' && pathResult?.ok && (
              <>
                {pathResult.alreadyPresent ? (
                  <>
                    <strong>Already done.</strong> The Duo PATH block is already in <code className="font-mono">{pathResult.rcFile}</code>. If <code className="font-mono">duo</code> still isn't found, open a new terminal.
                  </>
                ) : (
                  <>
                    <strong>Done.</strong> Added <code className="font-mono">~/.local/bin</code> to <code className="font-mono">{pathResult.rcFile}</code>. Open a new terminal (or run <code className="font-mono">source {pathResult.rcFile}</code>) to pick it up.
                  </>
                )}
              </>
            )}
            {pathPhase === 'error' && (
              <>
                <strong>Couldn't update shell config:</strong> {pathResult?.error ?? 'unknown error'}. Add this line manually: <code className="font-mono">export PATH="$HOME/.local/bin:$PATH"</code>
              </>
            )}
          </div>
          {pathPhase === 'idle' && (
            <button
              type="button"
              onClick={() => void handleAddToPath()}
              className="shrink-0 px-3 h-7 rounded text-xs font-medium bg-accent text-white hover:bg-accent-ink transition-colors"
            >
              Add to PATH
            </button>
          )}
        </div>
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

