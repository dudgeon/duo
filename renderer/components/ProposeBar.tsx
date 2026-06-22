// ENH-224 Phase 2 — the "Propose changes" footer affordance (D10–D13).
//
// Mounts at the bottom of the markdown editor. INERT for ordinary files — it
// only appears when the open doc lives in a managed checkout AND has diverged
// from its baseline (D2/D10). Clicking opens a prefilled confirm sheet (D7/D12:
// title + branch + fork-note + inline diff); confirming runs the full
// share-back over IPC (branch/commit/push/PR, auto-fork — D3) and morphs the bar
// in place to "Proposed · View PR" (D13). All git/gh state is read LIVE from
// main (core/git/share-back) — never mirrored (§12).
//
// ⚠ NOT yet live-verified — this renderer surface was built without Electron
// access (owner deferred it). Owes a smoke walk: divergence → bar appears →
// confirm sheet → real PR → morph.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShareBackStatus, ShareBackDiff, ShareBackResult, PrInfo } from '../../shared/types'

interface Props {
  /** Absolute path of the open doc. */
  path: string
  /** Only the active editor tab polls + renders the bar. */
  active: boolean
  /** Bumped by the editor on each successful save → re-poll divergence. */
  refreshKey: number
}

function openExternal(url: string): void {
  // BUG-132 path — route through main's shell.openExternal (scheme-guarded),
  // the SAME mechanism FileTree uses. Renderer window.open silently no-ops in
  // this WebContentsView, which is why the old "View PR" button did nothing
  // (ENH-227, owner-reported on the v0.11.2 walk).
  void window.electron?.files?.openExternalUrl(url).catch(() => null)
}

export function ProposeBar({ path, active, refreshKey }: Props): JSX.Element | null {
  const [status, setStatus] = useState<ShareBackStatus | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [diff, setDiff] = useState<ShareBackDiff | null>(null)
  const [title, setTitle] = useState('')
  const [branch, setBranch] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // After a successful create, hold the PR so the bar morphs even before the
  // next status poll lands.
  const [createdPr, setCreatedPr] = useState<PrInfo | null>(null)

  const pr = window.electron?.pr

  // Poll divergence + PR state when active / after a save (D2 signal).
  useEffect(() => {
    if (!active || !path || !pr) return
    let cancelled = false
    void pr.status(path).then((s) => {
      if (!cancelled) setStatus(s)
    }).catch(() => { /* inert on error — never crash the editor */ })
    return () => { cancelled = true }
  }, [path, active, refreshKey, pr])

  const openSheet = useCallback(() => {
    if (!pr) return
    setError(null)
    setSheetOpen(true)
    setDiff(null)
    void pr.diff(path).then((d) => {
      setDiff(d)
      if (d.proposalMeta) {
        setTitle(d.proposalMeta.title)
        setBranch(d.proposalMeta.branch)
        setBody(d.proposalMeta.body)
      }
    }).catch(() => setDiff({ ok: false, diff: '', stat: { filesChanged: 0, additions: 0, deletions: 0 }, error: 'Could not load the diff.' }))
  }, [pr, path])

  const closeSheet = useCallback(() => {
    if (busy) return
    setSheetOpen(false)
  }, [busy])

  const submit = useCallback(async () => {
    if (!pr || busy) return
    setBusy(true)
    setError(null)
    try {
      const res: ShareBackResult = await pr.create(path, { title, body, branch })
      if (res.ok) {
        setCreatedPr(res.pr)
        setSheetOpen(false)
        // Reflect the new PR + cleared divergence locally (a real poll follows).
        setStatus((s) => s ? { ...s, pr: res.pr, divergence: { diverged: false, changedFiles: [] } } : s)
      } else {
        setError(res.error || 'Could not propose changes.')
      }
    } finally {
      setBusy(false)
    }
  }, [pr, path, title, body, branch, busy])

  // Escape closes the sheet.
  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSheet() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetOpen, closeSheet])

  const inCheckout = !!status?.context
  const diverged = !!status?.divergence.diverged
  const effectivePr = createdPr ?? status?.pr ?? null

  // Inert for ordinary files (D10 — zero footprint unless this is a diverged
  // managed checkout, or it already has a PR to view).
  if (!inCheckout || (!diverged && !effectivePr)) return null

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs border-t border-paper-rule bg-paper-deep text-ink shrink-0">
        <span className="truncate">
          {effectivePr && !diverged
            ? (
              // ENH-227 — explicit success affordance (duo-text-ok is legible in
              // both themes) + the PR number, so a successful create reads as
              // success instead of a muted "Proposed".
              <span className="duo-text-ok font-medium">
                ✓ PR #{effectivePr.number} opened · {status?.context?.owner}/{status?.context?.repo}
              </span>
            )
            : effectivePr
              ? <span className="text-ink-soft">Edited since proposing · <span className="text-ink">{status?.context?.owner}/{status?.context?.repo}</span></span>
              : <span className="text-ink-soft">This doc differs from <span className="text-ink">{status?.context?.owner}/{status?.context?.repo}</span></span>}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {effectivePr && (
            <button
              type="button"
              onClick={() => openExternal(effectivePr.url)}
              title={effectivePr.url}
              className="px-2.5 py-1 rounded border border-paper-rule text-ink hover:bg-accent/10"
            >
              View PR #{effectivePr.number} ↗
            </button>
          )}
          {diverged && (
            <button
              type="button"
              onClick={openSheet}
              className="px-2.5 py-1 rounded bg-accent text-white hover:bg-accent/90"
            >
              {effectivePr ? 'Update PR' : 'Propose changes'}
            </button>
          )}
        </div>
      </div>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) closeSheet() }}
        >
          <div
            className="bg-surface-0 border border-border rounded-lg shadow-xl w-[640px] max-w-[92vw] p-5 text-ink flex flex-col gap-3 max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold">Propose changes</div>

            <label className="flex flex-col gap-1 text-xs text-ink-soft">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="px-2 py-1 text-sm rounded border border-border bg-surface-0 text-ink"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-ink-soft">
              Branch
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="px-2 py-1 text-sm rounded border border-border bg-surface-0 text-ink font-mono"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-ink-soft">
              Description
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={2}
                className="px-2 py-1 text-sm rounded border border-border bg-surface-0 text-ink resize-none"
              />
            </label>

            <div className="text-xs text-ink-mute">
              Duo opens a pull request{' '}
              {status?.context && <>against <span className="font-mono">{status.context.owner}/{status.context.repo}</span> </>}
              and <strong>forks automatically</strong> if you don’t have push access.
            </div>

            <div className="flex flex-col gap-1 min-h-0">
              <div className="text-xs text-ink-soft">
                Changes{diff?.stat ? ` · ${diff.stat.filesChanged} file${diff.stat.filesChanged === 1 ? '' : 's'}, +${diff.stat.additions} −${diff.stat.deletions}` : ''}
              </div>
              <pre className="text-[11px] leading-snug font-mono whitespace-pre overflow-auto border border-paper-rule rounded bg-paper-deep p-2 max-h-[34vh] text-ink">
                {diff == null ? 'Loading diff…' : diff.ok ? (diff.diff || '(no textual diff)') : (diff.error || 'Could not load the diff.')}
              </pre>
            </div>

            {error && <div className="text-xs text-red-500">{error}</div>}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={closeSheet}
                disabled={busy}
                className="px-3 py-1 text-sm border border-border rounded text-ink hover:bg-accent/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !title.trim() || !branch.trim()}
                className="px-3 py-1 text-sm bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
              >
                {busy ? 'Proposing…' : effectivePr ? 'Update PR' : 'Propose changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
