// Stage 10 Phase 5 — small per-type renderers for the WorkingPane.
// PDF + unknown-type fallbacks live here. ImageView (ENH-111, Sprint
// 12) graduated to its own file when it grew toolbar chrome.

import { useEffect, useState } from 'react'
import type { WorkingTab } from '@shared/types'

export function PdfPreview({ tab }: { tab: WorkingTab }) {
  // Electron's built-in Chromium ships a PDF viewer; <embed> with the
  // application/pdf type uses it. No extra plugins.
  // ENH-195 (B7) — cache-bust on disk change so a regenerated PDF refreshes.
  // The Chromium PDF plugin caches by URL, so we append a changing
  // `#duobust=N` fragment to force a re-fetch when the watcher fires; the
  // fragment doesn't affect in-document navigation.
  const [bust, setBust] = useState(0)
  useEffect(() => {
    if (!tab.path) return
    // ENH-195 (review) — cancelled-flag guard (mirrors ImageView): if the
    // effect is torn down (unmount / path change) before the async watch()
    // resolves, unwatch the late-resolving handle immediately so the
    // main-process FSWatcher + IPC listener don't leak.
    let cancelled = false
    let unwatch: (() => Promise<void>) | undefined
    void window.electron.files.watch([tab.path], ev => {
      if (ev.path === tab.path && ev.kind !== 'removed') setBust(b => b + 1)
    }).then(fn => { if (cancelled) void fn(); else unwatch = fn })
    return () => { cancelled = true; void unwatch?.() }
  }, [tab.path])

  return (
    <div className="flex-1 overflow-hidden bg-surface-0">
      <embed
        src={'file://' + encodeURI(tab.path ?? '') + '#duobust=' + bust}
        type="application/pdf"
        className="w-full h-full"
      />
    </div>
  )
}

export function UnknownFilePreview({ tab }: { tab: WorkingTab }) {
  const [opening, setOpening] = useState(false)
  // ENH-173 (Sprint 20 / v0.7.7) — probe whether the path is a
  // directory on mount. When true, the no-preview fallback adds a
  // primary "Navigate here" button (moves the file navigator + closes
  // this dead-end tab) ABOVE the existing "Open with default app".
  // For files, the fallback is unchanged.
  const [isDir, setIsDir] = useState<boolean | null>(null)
  const path = tab.path ?? ''
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')) : ''

  useEffect(() => {
    if (!path) { setIsDir(false); return }
    let cancelled = false
    void window.electron.files.dirExists(path).then(exists => {
      if (!cancelled) setIsDir(exists)
    }).catch(() => { if (!cancelled) setIsDir(false) })
    return () => { cancelled = true }
  }, [path])

  const openWithDefault = async () => {
    if (!path) return
    setOpening(true)
    try {
      await window.electron.files.openPath(path)
    } finally {
      setOpening(false)
    }
  }

  const navigateHere = () => {
    // ENH-173 — App.tsx subscribes to this event and routes to
    // `nav.actions.navigateTo(path)` + closes this tab so the user
    // lands on the navigated folder with no dead-end tab left behind.
    // Same dispatch pattern as the ENH-169 tree-new-* events.
    if (!path) return
    window.dispatchEvent(new CustomEvent('duo-navigate-here', { detail: { path, tabId: tab.id } }))
  }

  return (
    <div className="flex-1 bg-surface-0 flex items-center justify-center p-8">
      <div className="max-w-[420px] w-full bg-surface-1 border border-border rounded-lg p-6 text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded bg-surface-2 flex items-center justify-center text-zinc-500">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {isDir ? (
              // Folder glyph for directories — matches the FileTree icon language.
              <path d="M3 5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z" stroke="currentColor" strokeWidth="1.5" />
            ) : (
              <>
                <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5" />
                <path d="M14 2v4h4" stroke="currentColor" strokeWidth="1.5" />
              </>
            )}
          </svg>
        </div>
        <div className="text-zinc-100 text-sm font-medium truncate" title={path}>{tab.title}</div>
        <div className="text-zinc-500 text-[11px] mt-1 break-all">{path}</div>
        {tab.mime && !isDir && (
          <div className="text-zinc-600 text-[11px] mt-0.5">{tab.mime}</div>
        )}
        <div className="text-zinc-600 text-[11px] mt-4">
          {isDir
            ? 'This is a folder. The working pane shows individual files; navigate the file tree to browse its contents.'
            : <>Duo doesn't have a preview for <span className="text-zinc-400">{ext || 'this file type'}</span>.</>
          }
        </div>
        {/* ENH-173 — primary "Navigate here" button for directories, ABOVE
            the existing "Open with default app" secondary. */}
        {isDir && (
          <button
            onClick={navigateHere}
            className="mt-5 px-4 py-2 rounded bg-accent/90 hover:bg-accent text-zinc-100 text-sm font-medium transition-colors"
          >
            Navigate here
          </button>
        )}
        <button
          onClick={openWithDefault}
          disabled={opening}
          className={
            isDir
              ? 'block mx-auto mt-3 px-4 py-2 rounded bg-surface-2 hover:bg-surface-3 text-zinc-300 hover:text-zinc-100 text-sm font-medium transition-colors disabled:opacity-50'
              : 'mt-5 px-4 py-2 rounded bg-accent/90 hover:bg-accent text-zinc-100 text-sm font-medium transition-colors disabled:opacity-50'
          }
        >
          {opening ? 'Opening…' : 'Open with default app'}
        </button>
      </div>
    </div>
  )
}
