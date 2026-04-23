// Stage 10 Phase 5 — small per-type renderers for the WorkingPane.
// MarkdownPreview has its own file since it's heavier; this file groups the
// lightweight glyphs (image / pdf / unknown).

import { useState } from 'react'
import type { WorkingTab } from '@shared/types'

export function ImagePreview({ tab }: { tab: WorkingTab }) {
  return (
    <div className="flex-1 overflow-auto bg-surface-0 flex items-center justify-center p-8">
      <img
        src={'file://' + encodeURI(tab.path ?? '')}
        alt={tab.title}
        className="max-w-full max-h-full object-contain"
        style={{ imageRendering: 'auto' }}
      />
    </div>
  )
}

export function PdfPreview({ tab }: { tab: WorkingTab }) {
  // Electron's built-in Chromium ships a PDF viewer; <embed> with the
  // application/pdf type uses it. No extra plugins.
  return (
    <div className="flex-1 overflow-hidden bg-surface-0">
      <embed
        src={'file://' + encodeURI(tab.path ?? '')}
        type="application/pdf"
        className="w-full h-full"
      />
    </div>
  )
}

export function UnknownFilePreview({ tab }: { tab: WorkingTab }) {
  const [opening, setOpening] = useState(false)
  const path = tab.path ?? ''
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')) : ''

  const openWithDefault = async () => {
    if (!path) return
    setOpening(true)
    try {
      await window.electron.files.openExternal(path)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="flex-1 bg-surface-0 flex items-center justify-center p-8">
      <div className="max-w-[420px] w-full bg-surface-1 border border-border rounded-lg p-6 text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded bg-surface-2 flex items-center justify-center text-zinc-500">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5" />
            <path d="M14 2v4h4" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
        <div className="text-zinc-100 text-sm font-medium truncate" title={path}>{tab.title}</div>
        <div className="text-zinc-500 text-[11px] mt-1 break-all">{path}</div>
        {tab.mime && (
          <div className="text-zinc-600 text-[11px] mt-0.5">{tab.mime}</div>
        )}
        <div className="text-zinc-600 text-[11px] mt-4">
          Duo doesn't have a preview for <span className="text-zinc-400">{ext || 'this file type'}</span>.
        </div>
        <button
          onClick={openWithDefault}
          disabled={opening}
          className="mt-5 px-4 py-2 rounded bg-accent/90 hover:bg-accent text-zinc-100 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {opening ? 'Opening…' : 'Open with default app'}
        </button>
      </div>
    </div>
  )
}
