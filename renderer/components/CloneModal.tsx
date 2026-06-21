// FOLLOWUP-025 — File → Clone… modal.
//
// Pure-UI complement to ENH-151's CLI surface. The IPC layer
// (`window.electron.git.{clone, ghAuth}`) is pre-wired; this component
// just composes inputs + result display around it. Auth-missing UX
// directs the user at `gh auth login` until ENH-150's Doctor panel
// lands; swap the pointer when that ships.
//
// v2 (post-v0.7.0 walk):
// - All shadcn/ui token classnames swapped for Atelier tokens. The
//   prior `bg-background` / `text-muted-foreground` / `bg-input`
//   classes don't exist in this project's tailwind config — they
//   silently no-op, so the modal body rendered as transparent and the
//   bg-black/40 backdrop bled through. Atelier tokens are
//   `bg-surface-0`, `text-ink-mute`, etc.
// - `defaultParent` prop accepts the cwd to pre-populate the target
//   directory input. Priority order in App.tsx: right-click IPC payload
//   path → Navigator cwd → ~/Documents (this component's own fallback).
//   Owner Q1 decision: right-click context wins over Navigator cwd.

import { useEffect, useRef, useState } from 'react'
import type { CloneResult, GhAuthStatus } from '@shared/types'

interface CloneModalProps {
  open: boolean
  /** Optional pre-populated parent directory. When null/undefined the
   *  modal falls back to ~/Documents. App.tsx supplies the
   *  right-click context path OR the Navigator's current cwd. */
  defaultParent?: string | null
  /** ENH-224 D15 — pre-populate the repo URL (the Open bar routes a GitHub
   *  repo / file URL here). null/undefined → empty field (manual clone). */
  defaultUrl?: string | null
  /** ENH-224 D16 — when the clone came from a GitHub *file* URL, the path to
   *  that file within the repo. On success the hero becomes "Open <file>"
   *  and opens `<clonedTo>/<openAfterRelPath>`. null → the plain "Done" hero. */
  openAfterRelPath?: string | null
  onClose: () => void
  /** Called with the cloned-folder absolute path on success. Parent
   *  decides whether to navigate the file tree there (recommended) or
   *  leave the modal-side "Open in Duo" button as the action. */
  onCloned: (clonedTo: string) => void
  /** ENH-224 D16 — open the post-clone target file (absolute path). Wired by
   *  the "Open <file>" success hero when openAfterRelPath is set. */
  onOpenAfter?: (absPath: string) => void
}

/** Fallback target-dir parent when neither right-click context nor
 *  Navigator cwd are available. Stays at ~/Documents so cold-start
 *  before Navigator hydrates still produces a sensible default. */
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

export function CloneModal({ open, defaultParent, defaultUrl, openAfterRelPath, onClose, onCloned, onOpenAfter }: CloneModalProps) {
  const [url, setUrl] = useState('')
  const [targetParent, setTargetParent] = useState(defaultParent ?? DEFAULT_PARENT)
  const [repoName, setRepoName] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CloneResult | null>(null)
  const [auth, setAuth] = useState<GhAuthStatus | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  // ENH-162 — pre-flight collision check. When the target dir already
  // exists, surface a warning above the inputs so the user catches the
  // collision BEFORE clicking Clone (instead of getting a cryptic gh/git
  // "destination path already exists" error post-attempt).
  // null = check pending / not run; 'free' = path doesn't exist; 'exists' = collision.
  const [collisionState, setCollisionState] = useState<null | 'free' | 'exists'>(null)
  const [collisionAbsPath, setCollisionAbsPath] = useState<string>('')

  // Reset state on the open-transition (false → true) ONLY. The
  // `defaultParent` is intentionally NOT in the dep array — it changes
  // whenever Navigator's cwd changes (which happens automatically on
  // successful clone, because onCloned navigates to the new folder).
  // If `defaultParent` were in the deps, the post-clone cwd change
  // would re-fire this effect and call setResult(null), nuking the
  // success panel mid-render. The result: owner saw "stale-unchanged
  // modal" instead of the success state. Walk-rev3 reported this; fix
  // is to scope the reset to open-transitions only.
  useEffect(() => {
    if (!open) return
    // ENH-224 D15 — prefill the URL when the Open bar routed a GitHub URL in.
    setUrl(defaultUrl ?? '')
    setTargetParent(defaultParent ?? DEFAULT_PARENT)
    setRepoName('')
    setResult(null)
    setBusy(false)
    void window.electron.git.ghAuth().then(setAuth).catch(() => setAuth(null))
    // BUG-136 — re-probe gh auth on window focus. If the user runs
    // `gh auth login` in a Duo terminal while the modal is open, the
    // banner should clear without the user dismissing + re-opening the
    // modal. Cheap (one execFile call); only fires when focus returns
    // to the Duo window.
    const onFocus = () => { void window.electron.git.ghAuth().then(setAuth).catch(() => setAuth(null)) }
    window.addEventListener('focus', onFocus)
    // Focus the URL field on next tick so the modal mount completes first.
    const h = setTimeout(() => urlInputRef.current?.focus(), 0)
    return () => {
      clearTimeout(h)
      window.removeEventListener('focus', onFocus)
    }
    // defaultParent intentionally omitted from deps — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ENH-162 — debounced pre-flight collision check. Runs window.electron
  // .files.stat on the would-be target dir; if it exists, flips
  // collisionState to 'exists' and disables Clone. 300ms debounce so
  // we don't IPC-spam while the user is typing the URL/parent.
  useEffect(() => {
    if (!open || !repoName) {
      setCollisionState(null)
      setCollisionAbsPath('')
      return
    }
    const home = (window.electron as { env?: { HOME?: string } }).env?.HOME ?? '/tmp'
    const expanded = `${targetParent.replace(/\/$/, '')}/${repoName}`.replace(/^~/, home)
    setCollisionAbsPath(expanded)
    let cancelled = false
    const handle = setTimeout(async () => {
      try {
        // ENH-162 — file.stat returns null for directories, so use
        // dirExists + exists in parallel to catch both file-collision
        // and folder-collision cases.
        const [isDir, isFile] = await Promise.all([
          window.electron.files.dirExists(expanded),
          window.electron.files.exists(expanded)
        ])
        if (!cancelled) setCollisionState(isDir || isFile ? 'exists' : 'free')
      } catch {
        if (!cancelled) setCollisionState('free')
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [open, targetParent, repoName])

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
  // ENH-162 — block Clone when the pre-flight check says the target
  // already exists. Owner can change the parent dir or repoName to
  // unstick the button.
  const canClone = !busy && !!url.trim() && !!repoName && collisionState !== 'exists'

  // ENH-224 D16 — context-aware success hero. When the clone came from a
  // GitHub *file* URL, the hero opens that file after cloning (clonedTo + the
  // in-repo path); otherwise it's a plain "Done". The label name lives here
  // so the JSX can render it without re-deriving.
  const heroOpenPath =
    result?.ok && result.clonedTo && openAfterRelPath
      ? `${result.clonedTo.replace(/\/+$/, '')}/${openAfterRelPath.replace(/^\/+/, '')}`
      : null
  const heroOpenName = openAfterRelPath ? openAfterRelPath.split('/').pop() : null

  // ENH-162 — recognize the "destination path already exists" stderr
  // class so we can render a clearer error than the raw gh/git output.
  const isCollisionError = !!(result && !result.ok && result.error &&
    /already exists|not an empty directory/i.test(result.error))

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

  // D16 — reset the form for another clone WITHOUT closing the modal (the
  // demoted "Clone another" link). The prior code re-ran handleClone() on
  // the same URL, which just collided; this clears url/result/collision so
  // the user genuinely starts a fresh clone, and re-focuses the URL field.
  const resetForAnother = () => {
    setUrl('')
    setRepoName('')
    setResult(null)
    setCollisionState(null)
    setCollisionAbsPath('')
    setTimeout(() => urlInputRef.current?.focus(), 0)
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
        className="bg-surface-0 border border-border rounded-lg shadow-xl w-[480px] max-w-[90vw] p-5 text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-ink">Clone from GitHub</h2>
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

        {showAuthBanner && (
          <div className="mb-3 px-3 py-2 rounded text-xs border duo-banner-warn">
            <strong className="font-semibold">gh not authenticated.</strong> Private repos won't clone.
            Run <code className="font-mono">gh auth login</code> in a Duo terminal first.
            Public repos will still work via plain git clone.
          </div>
        )}

        <label className="block text-xs text-ink-mute mb-1" htmlFor="clone-url">
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
          className="w-full px-2 py-1 mb-3 bg-paper-deep border border-border rounded text-sm font-mono text-ink placeholder-ink-ghost focus:outline-accent"
        />

        {collisionState === 'exists' && !busy && !result?.ok && (
          // ENH-162 — pre-flight collision warning. Surfaces BEFORE the
          // user clicks Clone so they can edit the parent or rename
          // without round-tripping through a cryptic gh/git failure.
          <div className="mb-3 px-3 py-2 rounded text-xs border duo-banner-warn">
            <div className="flex items-start gap-2">
              <span className="duo-text-warn leading-none mt-0.5" aria-hidden="true">⚠</span>
              <div className="flex-1 min-w-0">
                <strong className="font-semibold">A folder already exists at that path.</strong>
                <div className="font-mono text-[11px] mt-1 break-all opacity-80">{collisionAbsPath}</div>
                <div className="mt-1 opacity-90">
                  Change the parent directory or rename — the clone won't overwrite an existing folder.
                </div>
                <button
                  type="button"
                  onClick={() => void window.electron.files.revealInFinder(collisionAbsPath)}
                  className="mt-1.5 text-[11px] underline duo-text-warn"
                >
                  Reveal existing folder in Finder
                </button>
              </div>
            </div>
          </div>
        )}

        <label className="block text-xs text-ink-mute mb-1" htmlFor="clone-target">
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
          className="w-full px-2 py-1 mb-3 bg-paper-deep border border-border rounded text-sm font-mono text-ink placeholder-ink-ghost focus:outline-accent"
        />

        {busy && (
          // FOLLOWUP-025 v2 walk-rev3 — owner: "the 'cloning' status
          // message is incredibly brief". The button-label-only
          // "Cloning…" was hard to notice. This is a more substantial
          // in-progress panel that shows ABOVE the inputs while the
          // clone runs — same surface area as the success panel will
          // occupy, so the visual transition is "panel appears →
          // panel updates to green checkmark" rather than "small
          // button label → small green text flash → disappear".
          <div className="mb-3 px-4 py-3 rounded bg-paper-deep border border-paper-rule">
            <div className="flex items-center gap-3">
              <span className="text-accent" aria-hidden="true">
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path
                    d="M22 12a10 10 0 0 1-10 10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-ink font-semibold text-sm">Cloning…</div>
                <div className="text-ink-mute text-xs mt-0.5 font-mono break-all">
                  {targetDir}
                </div>
              </div>
            </div>
            <div className="text-ink-mute text-xs mt-2 leading-relaxed">
              This can take a few seconds for small repos, longer for big ones.
              Don't dismiss the modal until it finishes.
            </div>
          </div>
        )}
        {result && result.ok && (
          // ENH-224 D16 — success-screen redesign. The prior panel led with
          // a wall of next-step prose; the owner's note: "cloning >1 repo at
          // a time is an edge case — show a success message and make the hero
          // either Done or Open." So: one clean confirmation line; the action
          // moves to the footer (Open / Done hero, "Clone another" demoted).
          // (Rebase 2026-06-21: adopts main's duo-banner-ok/duo-text-ok theme.)
          <div className="mb-3 px-4 py-3 rounded border duo-banner-ok">
            <div className="flex items-start gap-2">
              <span className="duo-text-ok text-base leading-none" aria-hidden="true">✓</span>
              <div className="flex-1 min-w-0">
                <div className="duo-text-ok font-semibold text-sm">
                  Cloned {repoName || 'repository'}
                </div>
                <div className="duo-text-ok text-xs mt-1 font-mono break-all">
                  {result.clonedTo}
                </div>
                <div className="text-emerald-200/80 text-xs mt-1">
                  It’s now in your navigator.
                </div>
              </div>
            </div>
          </div>
        )}
        {result && !result.ok && (
          <div className="mb-3 px-3 py-2 rounded text-xs border duo-banner-error">
            {isCollisionError ? (
              // ENH-162 — friendlier render when stderr matches the
              // "destination already exists" pattern.
              <>
                <strong>That folder already exists.</strong>
                <div className="font-mono text-[11px] mt-1 break-all opacity-80">{collisionAbsPath || targetDir}</div>
                <div className="mt-1 opacity-90">
                  Pick a different parent directory, rename the repo folder,
                  or remove the existing folder first.
                </div>
                {collisionAbsPath && (
                  <button
                    type="button"
                    onClick={() => void window.electron.files.revealInFinder(collisionAbsPath)}
                    className="mt-1.5 text-[11px] underline duo-text-error"
                  >
                    Reveal existing folder in Finder
                  </button>
                )}
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

        {result?.ok ? (
          // D16 — success footer. Hero is "Done" for a bare-repo clone
          // (File ▸ Clone… / FileTree / duo clone), OR "Open <file>" when the
          // merged Open flow routed a GitHub *file* URL into clone (ENH-224
          // D19 live path — openAfterRelPath set). "Clone another" is the
          // demoted quiet link (multi-clone is the edge case, per owner).
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={resetForAnother}
              className="text-xs text-ink-mute hover:text-ink underline"
            >
              Clone another
            </button>
            {heroOpenPath ? (
              <button
                type="button"
                onClick={() => { onOpenAfter?.(heroOpenPath); onClose() }}
                className="px-4 py-1 text-sm bg-accent text-white rounded hover:bg-accent/90"
              >
                Open {heroOpenName}
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1 text-sm bg-accent text-white rounded hover:bg-accent/90"
              >
                Done
              </button>
            )}
          </div>
        ) : (
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-3 py-1 text-sm border border-border rounded text-ink hover:bg-accent/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleClone()}
              disabled={!canClone}
              className="px-3 py-1 text-sm bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
            >
              {busy ? 'Cloning…' : 'Clone'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
