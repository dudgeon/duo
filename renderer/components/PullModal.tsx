// ENH-253 — "Pull latest changes" result panel. Opened from the navigator's
// repo-root right-click menu (FileTree.tsx); no form to fill in (unlike
// CloneModal) — it fires the pull immediately on open and renders whatever
// state comes back. Visual structure (busy spinner panel / duo-banner-*
// result panels) mirrors CloneModal so this reads as the same family of
// "networked git action" surface.

import { useEffect, useState } from 'react'
import type { PullResult } from '@shared/types'

interface PullModalProps {
  open: boolean
  /** Absolute path of the repo root to pull. */
  cwd: string | null
  onClose: () => void
}

export function PullModal({ open, cwd, onClose }: PullModalProps) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PullResult | null>(null)

  const runPull = async (force: boolean) => {
    if (!cwd) return
    setBusy(true)
    try {
      const res = await window.electron.git.pull({ cwd, force })
      setResult(res)
    } catch (err) {
      setResult({
        ok: false,
        errorKind: 'pull-failed',
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setBusy(false)
    }
  }

  // Reset + fire on the open-transition only (mirrors CloneModal — cwd is
  // stable for the lifetime of one open modal).
  useEffect(() => {
    if (!open) return
    setResult(null)
    void runPull(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, busy, onClose])

  if (!open) return null

  const needsConfirmation = !!result && !result.ok && result.errorKind === 'needs-confirmation'

  const successLabel = (r: PullResult): string => {
    switch (r.result) {
      case 'up-to-date': return 'Already up to date.'
      case 'fast-forwarded': return `Pulled ${r.commitsApplied} commit${r.commitsApplied === 1 ? '' : 's'}.`
      case 'merged': return `Pulled and merged ${r.commitsApplied} commit${r.commitsApplied === 1 ? '' : 's'}.`
      case 'discarded-and-pulled': return `Discarded your local changes and pulled ${r.commitsApplied} commit${r.commitsApplied === 1 ? '' : 's'}.`
      default: return 'Done.'
    }
  }

  const errorLabel = (r: PullResult): { title: string; hint?: string } => {
    switch (r.errorKind) {
      case 'not-a-repo':
        return { title: "This folder isn't a git repository." }
      case 'no-upstream':
        return { title: r.error || "This branch isn't tracking a remote branch." }
      case 'auth-missing':
        return {
          title: 'GitHub authentication is required.',
          hint: 'Run `gh auth login` in a Duo terminal, then retry.'
        }
      case 'merge-conflict':
        return {
          title: 'Pulling would create conflicting changes that need manual resolution.',
          hint: 'Nothing was changed — ask someone comfortable with git for help, or resolve it in a terminal.'
        }
      default:
        return { title: r.error || 'Pull failed.' }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="bg-surface-0 border border-border rounded-lg shadow-xl w-[520px] max-w-[92vw] p-5 text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-ink">Pull latest changes</h2>
          <button
            type="button"
            className="text-ink-mute hover:text-ink"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="text-xs text-ink-mute font-mono break-all mb-3">{cwd}</div>

        {busy && (
          <div className="mb-3 px-4 py-3 rounded bg-paper-deep border border-paper-rule">
            <div className="flex items-center gap-3">
              <span className="text-accent" aria-hidden="true">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </span>
              <div className="text-ink font-semibold text-sm">Pulling…</div>
            </div>
          </div>
        )}

        {!busy && needsConfirmation && result && (
          <div className="mb-3 px-3 py-2 rounded text-xs border duo-banner-warn">
            <div className="flex items-start gap-2">
              <span className="duo-text-warn leading-none mt-0.5" aria-hidden="true">⚠</span>
              <div className="flex-1 min-w-0">
                <strong className="font-semibold">
                  You have unsaved changes in {result.changedCount} file{result.changedCount === 1 ? '' : 's'}.
                </strong>
                <div className="mt-1 opacity-90">
                  Pulling the latest changes will discard {result.changedCount === 1 ? 'it' : 'them'}.
                  {result.aheadCount ? ` You also have ${result.aheadCount} local commit${result.aheadCount === 1 ? '' : 's'} that ${result.aheadCount === 1 ? "hasn't" : "haven't"} been pushed — that will be lost too.` : ''}
                </div>
              </div>
            </div>
          </div>
        )}

        {!busy && result && result.ok && (
          <div className="mb-3 px-4 py-3 rounded border duo-banner-ok">
            <div className="flex items-start gap-2">
              <span className="duo-text-ok text-base leading-none" aria-hidden="true">✓</span>
              <div className="duo-text-ok font-semibold text-sm">{successLabel(result)}</div>
            </div>
          </div>
        )}

        {!busy && result && !result.ok && !needsConfirmation && (
          <div className="mb-3 px-3 py-2 rounded text-xs border duo-banner-error">
            <strong>{errorLabel(result).title}</strong>
            {errorLabel(result).hint && (
              <div className="mt-1 opacity-90">{errorLabel(result).hint}</div>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          {needsConfirmation ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1 text-sm border border-border rounded text-ink hover:bg-accent/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runPull(true)}
                className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-600/90"
              >
                Discard my changes and pull
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-1 text-sm bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
