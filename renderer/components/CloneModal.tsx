// FOLLOWUP-025 — File → Clone… modal.
//
// Pure-UI complement to ENH-151's CLI surface. The IPC layer
// (`window.electron.git.{clone, ghAuth}`) is pre-wired; this component
// just composes inputs + result display around it. Auth-missing UX
// directs the user at `gh auth login` until ENH-150's Doctor panel
// lands; swap the pointer when that ships.

import { useEffect, useRef, useState } from 'react'
import type { CloneResult, GhAuthStatus } from '@shared/types'

interface CloneModalProps {
  open: boolean
  onClose: () => void
  /** Called with the cloned-folder absolute path on success. Parent
   *  decides whether to navigate the file tree there (recommended) or
   *  leave the modal-side "Open in Duo" button as the action. */
  onCloned: (clonedTo: string) => void
}

/** Default target-dir parent — packs land beside the user's other
 *  projects rather than dumping into $HOME. Pre-populates the target
 *  input so the user only needs to confirm or pick a different parent. */
const DEFAULT_PARENT = '~/Documents'

/** Pull a sensible folder name out of a clone URL. Mirrors the
 *  derivation gh / git themselves use (strip .git, strip owner/, strip
 *  trailing slash). */
function deriveRepoName(url: string): string {
  let name = url.trim().replace(/\/$/, '')
  name = name.replace(/\.git$/, '')
  const lastSlash = name.lastIndexOf('/')
  if (lastSlash >= 0) name = name.slice(lastSlash + 1)
  const lastColon = name.lastIndexOf(':')
  if (lastColon >= 0) name = name.slice(lastColon + 1)
  return name
}

export function CloneModal({ open, onClose, onCloned }: CloneModalProps) {
  const [url, setUrl] = useState('')
  const [targetParent, setTargetParent] = useState(DEFAULT_PARENT)
  const [repoName, setRepoName] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CloneResult | null>(null)
  const [auth, setAuth] = useState<GhAuthStatus | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

  // Reset state every time the modal opens; pre-fetch the gh-auth
  // status so the auth-missing banner can render up front rather than
  // after the user clicks Clone.
  useEffect(() => {
    if (!open) return
    setUrl('')
    setRepoName('')
    setResult(null)
    setBusy(false)
    void window.electron.git.ghAuth().then(setAuth).catch(() => setAuth(null))
    // Focus the URL field on next tick so the modal mount completes first.
    const h = setTimeout(() => urlInputRef.current?.focus(), 0)
    return () => clearTimeout(h)
  }, [open])

  // Derive the repo name from the URL as the user types — keeps the
  // landing folder predictable without a separate "compute" step.
  useEffect(() => {
    if (!url.trim()) {
      setRepoName('')
      return
    }
    setRepoName(deriveRepoName(url))
  }, [url])

  // Close on Escape, submit on Enter (when not busy + URL present).
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, busy, onClose])

  if (!open) return null

  const targetDir = repoName ? `${targetParent.replace(/\/$/, '')}/${repoName}` : ''
  const canClone = !busy && !!url.trim() && !!repoName

  const handleClone = async () => {
    if (!canClone) return
    setBusy(true)
    setResult(null)
    try {
      // Expand ~ to the user's home so we ship an absolute path to
      // the main process (gh / git don't tilde-expand themselves).
      // The renderer doesn't have process.env.HOME but the preload's
      // env getter does. Fall back to /tmp on the unlikely-but-let's-
      // be-safe HOME-missing case.
      const home = (window.electron as { env?: { HOME?: string } }).env?.HOME ?? '/tmp'
      const expanded = targetDir.replace(/^~/, home)
      const res = await window.electron.git.clone({ url: url.trim(), targetDir: expanded })
      setResult(res)
      if (res.ok && res.clonedTo) {
        // Parent decides what to do with the clonedTo path (usually
        // navigateTo it). Modal stays open with a success state so
        // the user can read the via=gh|git message before dismissing.
        onCloned(res.clonedTo)
      }
    } catch (err) {
      setResult({
        ok: false,
        errorKind: 'clone-failed',
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setBusy(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && canClone) {
      e.preventDefault()
      void handleClone()
    }
  }

  // Auth-missing banner: shown when gh isn't authenticated AND we
  // know it (auth probe completed). Doesn't block submitting (git
  // clone may still work for public repos), just sets expectations.
  const showAuthBanner = auth && !auth.authenticated

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        // Click outside the modal body dismisses (when not busy).
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-[480px] max-w-[90vw] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Clone GitHub repo</h2>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {showAuthBanner && (
          <div className="mb-3 px-3 py-2 rounded text-xs bg-amber-950/30 border border-amber-700/40 text-amber-200">
            <strong className="font-semibold">gh not authenticated.</strong> Private repos won't clone.
            Run <code className="font-mono">gh auth login</code> in a Duo terminal first.
            Public repos will still work via plain git clone.
          </div>
        )}

        <label className="block text-xs text-muted-foreground mb-1" htmlFor="clone-url">
          Repository URL or <code className="font-mono">owner/repo</code>
        </label>
        <input
          id="clone-url"
          ref={urlInputRef}
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://github.com/owner/repo or owner/repo"
          disabled={busy}
          className="w-full px-2 py-1 mb-3 bg-input border border-border rounded text-sm font-mono"
        />

        <label className="block text-xs text-muted-foreground mb-1" htmlFor="clone-target">
          Parent directory (final path: {targetDir || <em className="opacity-50">enter a URL first</em>})
        </label>
        <input
          id="clone-target"
          type="text"
          value={targetParent}
          onChange={(e) => setTargetParent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="~/Documents"
          disabled={busy}
          className="w-full px-2 py-1 mb-3 bg-input border border-border rounded text-sm font-mono"
        />

        {result && (
          <div
            className={
              result.ok
                ? 'mb-3 px-3 py-2 rounded text-xs bg-emerald-950/30 border border-emerald-700/40 text-emerald-200'
                : 'mb-3 px-3 py-2 rounded text-xs bg-red-950/30 border border-red-700/40 text-red-200'
            }
          >
            {result.ok ? (
              <>
                <strong>Cloned via {result.via}</strong> → <code className="font-mono">{result.clonedTo}</code>
              </>
            ) : (
              <>
                <strong>Clone failed ({result.errorKind ?? 'unknown'}):</strong>{' '}
                {result.error ?? 'no detail'}
                {result.errorKind === 'auth-missing' && (
                  <div className="mt-1 opacity-80">
                    Run <code className="font-mono">gh auth login</code> in a Duo terminal, then retry.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1 text-sm border border-border rounded hover:bg-accent/10 disabled:opacity-50"
          >
            {result?.ok ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => void handleClone()}
            disabled={!canClone}
            className="px-3 py-1 text-sm bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? 'Cloning…' : result?.ok ? 'Clone another' : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  )
}
