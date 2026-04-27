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
      // user to do. We hold the banner open if:
      //   - CLI installed but PATH missing — user needs to copy a
      //     shell-rc snippet
      //   - CLI couldn't install — user may want to retry / debug
      //   - Stage 19b: a non-Duo SessionStart hook already exists, so
      //     the user should know our hook will run alongside theirs
      const cli = result.status.cli
      const priming = result.status.priming
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

  // Success path may need the user's eyes longer than the rest if the
  // PATH hint applies. The shell-rc block renders as a separate row
  // below the main banner line.
  const cli = status.cli
  const priming = status.priming
  const showPathHint = phase === 'success' && cli?.installed && !cli.onPath
  const showHookConflictNote = phase === 'success' && priming?.hookConflict
  const showShimMissingNote = phase === 'success' && priming && !priming.shimInstalled
  const pathSnippet = 'export PATH="$HOME/.local/bin:$PATH"'
  const expandRow = showPathHint || showHookConflictNote || showShimMissingNote

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
            cli?.installed && cli.onPath ? (
              <>
                <strong>Installed.</strong> Skill + subagent + help files in <code className="font-mono text-[12px]">~/.claude/</code>; <code className="font-mono text-[12px]">duo</code> CLI ready on your PATH; priming shim + SessionStart hook installed for Duo-aware Claude sessions inside Duo.
              </>
            ) : cli?.installed ? (
              <>
                <strong>Installed.</strong> Skill + subagent + help files in <code className="font-mono text-[12px]">~/.claude/</code>; priming shim + SessionStart hook installed for Duo-aware Claude sessions; <code className="font-mono text-[12px]">duo</code> CLI at <code className="font-mono text-[12px]">~/.local/bin/duo</code>. Add this dir to your PATH to use the CLI from any terminal:
              </>
            ) : (
              <>
                <strong>Installed.</strong> Skill + subagent + help files + SessionStart hook in <code className="font-mono text-[12px]">~/.claude/</code>. (CLI binary couldn't be copied — try again or symlink <code className="font-mono text-[12px]">cli/duo</code> manually.)
              </>
            )
          ) : phase === 'error' ? (
            <>
              <strong>Install failed:</strong> {error}
            </>
          ) : status.needsUpdate ? (
            <>
              <strong>Duo update available.</strong> Refresh the installed skill + subagent + help files + CLI + SessionStart hook in <code className="font-mono text-[12px]">~/.claude/</code> (currently at v{status.version}).
            </>
          ) : (
            <>
              <strong>Welcome to Duo.</strong> Install the skill, subagent, help files, and CLI into <code className="font-mono text-[12px]">~/.claude/</code> + <code className="font-mono text-[12px]">~/.local/bin/</code>, and install a priming shim + SessionStart hook so <code className="font-mono text-[12px]">claude</code> sessions inside Duo arrive Duo-aware. Your existing files won't be touched.
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

      {showPathHint && (
        <pre
          aria-label="Add to your shell rc file (e.g. ~/.zshrc)"
          className="text-[12px] font-mono bg-surface-0 border border-accent-soft rounded px-3 py-2 ml-7 text-ink select-all whitespace-pre-wrap break-all"
        >{pathSnippet}</pre>
      )}

      {showHookConflictNote && (
        <p className="text-[12px] ml-7 text-accent-ink leading-snug">
          <strong>Heads-up:</strong> you already had other <code className="font-mono">SessionStart</code> hooks in <code className="font-mono">~/.claude/settings.json</code>. Duo's priming hook was added alongside them — all hooks will run on each session start. Edit the file to reorder or remove if needed.
        </p>
      )}

      {showShimMissingNote && (
        <p className="text-[12px] ml-7 text-accent-ink leading-snug">
          <strong>Claude Code not detected on PATH.</strong> Duo couldn't install the priming shim, so new <code className="font-mono">claude</code> sessions inside Duo won't get the Duo-aware system prompt. Install Claude Code (<a href="https://docs.claude.com/claude-code" className="underline">docs.claude.com/claude-code</a>) and click Install again, or restart Duo from a terminal that has <code className="font-mono">claude</code> on PATH.
        </p>
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

