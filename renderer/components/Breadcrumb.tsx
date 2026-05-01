// Stage 10 Phase 4 — breadcrumb bar at the top of the navigator.
// Shows the path from $HOME (as `~`) down to the current folder. Clicking a
// segment navigates there.
//
// Stage 26 PR 3 item 8 (v0.5.4) — clicking the breadcrumb's empty
// space (or hitting ⌘⇧G when the navigator is focused) flips the
// header into an editable input pre-filled with the current path.
// Paste / type, ↵ commits (resolve `~/`, resolve relative against
// current cwd, navigate to folder OR open file's parent + select),
// ⎋ cancels. CLI parity already lives in `duo reveal <path>` —
// this is the user-facing UI counterpart.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

interface BreadcrumbProps {
  cwd: string
  home: string
  onNavigate: (path: string) => void
  /** Stage 26 PR 3 item 8 — fired when an edit resolves to a file
   *  rather than a folder. The host (App.tsx via FilesPane) maps it
   *  to `selectAndReveal` — navigate to parent folder + select the
   *  file in the tree. */
  onRevealFile?: (path: string) => void
}

export interface BreadcrumbHandle {
  /** Stage 26 PR 3 item 8 — programmatically open the editable input
   *  + focus + select. Called from the ⌘⇧G global shortcut handler. */
  focusEdit: () => void
}

export const Breadcrumb = forwardRef<BreadcrumbHandle, BreadcrumbProps>(
  function Breadcrumb({ cwd, home, onNavigate, onRevealFile }, ref) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState('')
    const [error, setError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement | null>(null)

    useImperativeHandle(ref, () => ({
      focusEdit: () => {
        startEdit()
      }
    }), [cwd, home])

    function startEdit() {
      setDraft(displayPath(cwd, home))
      setEditing(true)
      setError(null)
      // Focus + select after the input mounts.
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }

    function cancelEdit() {
      setEditing(false)
      setDraft('')
      setError(null)
    }

    async function commitEdit() {
      const trimmed = draft.trim()
      if (trimmed === '') {
        cancelEdit()
        return
      }
      const resolved = resolvePath(trimmed, cwd, home)
      try {
        const kind = await window.electron.files.kind(resolved)
        if (kind === 'folder') {
          onNavigate(resolved)
          setEditing(false)
          setDraft('')
          setError(null)
        } else if (kind === 'file') {
          // File → reveal in tree (parent + select). Falls back to
          // navigating to the parent folder if the host didn't wire
          // onRevealFile.
          if (onRevealFile) {
            onRevealFile(resolved)
            setEditing(false)
            setDraft('')
            setError(null)
          } else {
            onNavigate(parentDir(resolved))
            setEditing(false)
            setDraft('')
            setError(null)
          }
        } else {
          setError(`Path doesn't exist: ${resolved}`)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    if (editing) {
      return (
        <div className="flex flex-col px-3 py-1 border-b border-border shrink-0">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); if (error) setError(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commitEdit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelEdit()
              }
            }}
            onBlur={() => {
              // Blur cancels — matches Finder's "Go to folder" UX.
              // Use a microtask delay so click-outside doesn't race
              // a click-inside from a prior render.
              setTimeout(() => { if (editing) cancelEdit() }, 0)
            }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="Go to path…"
            className="w-full px-1.5 py-0.5 text-[12px] bg-surface-3 border border-accent rounded text-zinc-100 placeholder-zinc-500 outline-none"
          />
          {error && (
            <div className="mt-1 text-[11px] text-red-400 truncate" title={error}>{error}</div>
          )}
        </div>
      )
    }

    const segments = breadcrumbSegments(cwd, home)
    // ENH-029 — pan the breadcrumb all the way right on mount and on
    // every cwd change so the active (last) segment is visible by
    // default. Without this, deep paths show "~/Documents/..." with
    // the user's actual current folder scrolled off the right edge.
    // Pairs with the bolder weight on the last segment below.
    const scrollerRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
      const el = scrollerRef.current
      if (!el) return
      // Two rAFs — first lets layout settle after the segment array
      // mounts, second commits the scroll. Single rAF was racing the
      // truncation/measurement on first paint for some paths.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!scrollerRef.current) return
          scrollerRef.current.scrollLeft = scrollerRef.current.scrollWidth
        })
      })
    }, [cwd])
    return (
      <div
        ref={scrollerRef}
        className="flex items-center gap-0.5 px-3 h-8 text-[11px] overflow-x-auto scrollbar-none border-b border-border shrink-0 cursor-text"
        onClick={(e) => {
          // Only flip into edit mode when the click hit the bar's
          // background — segment clicks bubble through their own
          // onClick handlers above, but we still want a way to
          // capture clicks on the empty area to the right of the
          // last segment. Check that the target IS the wrapper div.
          if (e.target === e.currentTarget) {
            startEdit()
          }
        }}
        title="Click empty area or press ⌘⇧G to type a path"
      >
        {segments.map((seg, i) => (
          <div key={seg.path} className="flex items-center gap-0.5 min-w-0 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate(seg.path) }}
              className={[
                'px-1 rounded hover:text-zinc-100 hover:bg-surface-3 transition-colors truncate max-w-[160px]',
                // ENH-029 — last segment renders bolder + brighter so
                // the eye lands on it after the pan-right; earlier
                // segments fade back to the muted breadcrumb tone.
                i === segments.length - 1
                  ? 'text-zinc-100 font-semibold'
                  : 'text-zinc-400'
              ].join(' ')}
              title={seg.path}
            >
              {seg.label}
            </button>
            {i < segments.length - 1 && (
              <span className="text-zinc-600 select-none">/</span>
            )}
          </div>
        ))}
      </div>
    )
  }
)

function displayPath(cwd: string, home: string): string {
  const homeClean = home.replace(/\/+$/, '')
  if (homeClean && cwd.startsWith(homeClean)) {
    const rest = cwd.slice(homeClean.length)
    return rest === '' ? '~' : '~' + rest
  }
  return cwd
}

function resolvePath(input: string, cwd: string, home: string): string {
  // Strip surrounding whitespace already done by caller.
  const homeClean = home.replace(/\/+$/, '')
  // ~ or ~/foo
  if (input === '~') return homeClean
  if (input.startsWith('~/')) return homeClean + input.slice(1)
  // Absolute
  if (input.startsWith('/')) return input.replace(/\/+$/, '') || '/'
  // Relative
  return joinPath(cwd, input).replace(/\/+$/, '') || '/'
}

function joinPath(dir: string, rel: string): string {
  // Simple join — handles `..` segment per segment. Doesn't try to
  // resolve symlinks or normalize anything else; that's the kernel's
  // job once the path is stat'd.
  const stack = dir.split('/').filter(Boolean)
  const parts = rel.split('/').filter(Boolean)
  for (const p of parts) {
    if (p === '..') stack.pop()
    else if (p !== '.') stack.push(p)
  }
  return '/' + stack.join('/')
}

function parentDir(absPath: string): string {
  const idx = absPath.lastIndexOf('/')
  if (idx <= 0) return '/'
  return absPath.slice(0, idx)
}

function breadcrumbSegments(cwd: string, home: string): Array<{ label: string; path: string }> {
  if (cwd === '/' || cwd === '') return [{ label: '/', path: '/' }]
  // Normalise trailing slashes.
  const clean = cwd.replace(/\/+$/, '')
  const homeClean = home.replace(/\/+$/, '')

  // If cwd is inside $HOME, render the `~` shortcut for the home segment
  // so PMs don't see the literal /Users/<name>/ prefix.
  if (homeClean && clean.startsWith(homeClean)) {
    const rest = clean.slice(homeClean.length).replace(/^\/+/, '')
    const parts = rest === '' ? [] : rest.split('/')
    const out: Array<{ label: string; path: string }> = [{ label: '~', path: homeClean }]
    let acc = homeClean
    for (const p of parts) {
      acc = acc + '/' + p
      out.push({ label: p, path: acc })
    }
    return out
  }

  // Fallback: absolute path from root.
  const parts = clean.split('/').filter(Boolean)
  const out: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }]
  let acc = ''
  for (const p of parts) {
    acc = acc + '/' + p
    out.push({ label: p, path: acc })
  }
  return out
}
