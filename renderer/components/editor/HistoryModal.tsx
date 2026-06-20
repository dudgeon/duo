// ENH-221 — File version history modal: "the richer rewind".
//
// The ADDITIONAL rewind surface that complements (never replaces) native
// Cmd+Z: a cross-session timeline of captured saves with who-wrote-it
// attribution and restore-any-point. Reads the durable store via
// window.electron.history.{list,show,restore} (the IPC bridge); restore
// routes through the normal save path so the open editor reconciles.
//
// Owner decisions (docs/research/enh-221-history-view.html, 2026-06-20):
//   surface = modal · restore = overwrite-with-confirm · rows = time/who/Δsize.
// v1 preview = the selected version's content (plain). The rendered
// inline-highlight diff (reusing ENH-197 applyTrackedDiff in a read-only
// editor) is the tracked follow-up.
//
// DOM-overlay modal pattern cloned from NewVaultModal: fixed backdrop,
// window-keydown Escape, Atelier tokens, backdrop-click dismiss. Parks the
// browser WebContentsView while open (duo-wcv-park) so it can't occlude.

import { useEffect, useRef, useState, useCallback } from 'react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import type { FileHistorySnapshot } from '@shared/host-api'
import { InsertionMark } from './extensions/InsertionMark'
import { DeletionMark } from './extensions/DeletionMark'
import { HighlightMark } from './extensions/HighlightMark'
import { applyTrackedDiff } from './trackedDiff'

interface HistoryModalProps {
  open: boolean
  /** Absolute path of the doc whose history to show. */
  path: string | null
  onClose: () => void
  /** Fired after a successful restore (parent may refocus / refresh). */
  onRestored?: (size: number) => void
}

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.floor(h / 24)
  return `${d} day${d > 1 ? 's' : ''} ago`
}

// source → human label + dot color (Tailwind app tokens). Today every
// Duo-mediated save is 'save'; 'agent'/'external' light up once source
// tagging lands (tracked follow-up).
const SOURCE_META: Record<FileHistorySnapshot['source'], { label: string; dot: string }> = {
  save: { label: 'You', dot: 'bg-accent' },
  agent: { label: 'Agent', dot: 'bg-[var(--project-iris,#5B57A6)]' },
  restore: { label: 'Restored', dot: 'bg-[var(--project-pine,#2E7D74)]' },
  open: { label: 'Opened', dot: 'bg-ink-ghost' },
  external: { label: 'External', dot: 'bg-[var(--project-harbor,#3C6E93)]' }
}

function sizeDelta(snap: FileHistorySnapshot, prev: FileHistorySnapshot | undefined): string {
  if (!prev) return `${snap.size} B`
  const d = snap.size - prev.size
  if (d === 0) return '±0 B'
  return `${d > 0 ? '+' : '−'}${Math.abs(d)} B`
}

export function HistoryModal({ open, path, onClose, onRestored }: HistoryModalProps) {
  // Snapshots newest-first for display (store returns oldest→newest).
  const [snaps, setSnaps] = useState<FileHistorySnapshot[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Content of the newest snapshot — the baseline the selected version is
  // diffed against ("what changed since this version").
  const [currentContent, setCurrentContent] = useState<string | null>(null)
  // Read-only TipTap instance that renders the preview as real prose with the
  // inline tracked-changes diff (reuses ENH-197 applyTrackedDiff). Created when
  // the modal opens, torn down on close.
  const previewHostRef = useRef<HTMLDivElement>(null)
  const previewEditorRef = useRef<Editor | null>(null)
  const [editorReady, setEditorReady] = useState(false)

  // Park the browser WCV while open (it paints above DOM; BUG-153/209).
  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent('duo-wcv-park'))
    return () => {
      window.dispatchEvent(new CustomEvent('duo-wcv-restore'))
    }
  }, [open])

  // Load the timeline on open / path change.
  useEffect(() => {
    if (!open || !path) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setConfirming(false)
    setCurrentContent(null)
    window.electron.history
      .list(path)
      .then(async (list) => {
        if (cancelled) return
        const newestFirst = [...list].reverse()
        setSnaps(newestFirst)
        setSelectedId(newestFirst[0]?.id ?? null)
        setLoading(false)
        // Baseline for the diff = newest snapshot's content.
        const newestId = newestFirst[0]?.id
        const cur = newestId ? await window.electron.history.show(path, newestId) : ''
        if (!cancelled) setCurrentContent(cur ?? '')
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e?.message ?? e))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, path])

  // Load the selected version's content into the preview pane.
  useEffect(() => {
    if (!open || !path || !selectedId) {
      setPreview('')
      return
    }
    let cancelled = false
    setConfirming(false)
    window.electron.history.show(path, selectedId).then((content) => {
      if (!cancelled) setPreview(content ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [open, path, selectedId])

  // Read-only preview editor lifecycle (created on open, destroyed on close).
  useEffect(() => {
    if (!open) return
    const host = previewHostRef.current
    if (!host) return
    const ed = new Editor({
      element: host,
      editable: false,
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        Markdown.configure({ html: false }),
        InsertionMark,
        DeletionMark,
        HighlightMark
      ],
      content: ''
    })
    previewEditorRef.current = ed
    setEditorReady(true)
    return () => {
      ed.destroy()
      previewEditorRef.current = null
      setEditorReady(false)
    }
  }, [open])

  // Render the preview: the selected version's content with an inline
  // tracked-changes diff vs. the current (newest) version. When the newest is
  // selected, there's nothing to diff — show it plain.
  useEffect(() => {
    const ed = previewEditorRef.current
    if (!open || !editorReady || !ed || currentContent == null) return
    try {
      if (selectedId === snaps[0]?.id) {
        ed.commands.setContent(currentContent, false)
        return
      }
      // selected (old) → capture as oldDoc, then load current (new) and mark
      // the old→new diff in place (insertions green, deletions struck red).
      ed.commands.setContent(preview, false)
      const oldDoc = ed.state.doc
      ed.commands.setContent(currentContent, false)
      applyTrackedDiff(ed, oldDoc, { author: null, ts: null })
    } catch {
      ed.commands.setContent(preview, false)
    }
  }, [open, editorReady, preview, currentContent, selectedId, snaps])

  // Escape closes (when not mid-restore).
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, busy, onClose])

  const doRestore = useCallback(async () => {
    if (!path || !selectedId) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.electron.history.restore(path, selectedId)
      if (!res || !res.ok) throw new Error('restore failed')
      onRestored?.(res.size ?? 0)
      onClose()
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      setBusy(false)
    }
  }, [path, selectedId, onRestored, onClose])

  if (!open) return null

  const selectedIsNewest = selectedId === snaps[0]?.id

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="history-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={panelRef}
        className="bg-surface-0 border border-border rounded-lg shadow-xl w-[760px] max-w-[92vw] h-[520px] max-h-[86vh] flex flex-col text-ink"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">Version history</h2>
            {path && (
              <span className="text-xs text-ink-mute font-mono truncate max-w-[360px]">
                {path.split('/').pop()}
              </span>
            )}
          </div>
          <button
            className="text-ink-mute hover:text-ink text-lg leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body: timeline | preview */}
        <div className="flex-1 min-h-0 flex">
          {/* Timeline */}
          <div className="w-[240px] flex-none border-r border-border overflow-y-auto">
            {loading ? (
              <div className="p-4 text-sm text-ink-mute">Loading…</div>
            ) : snaps.length === 0 ? (
              <div className="p-4 text-sm text-ink-mute">
                No version history yet for this file. It builds up as you save.
              </div>
            ) : (
              snaps.map((s, i) => {
                const meta = SOURCE_META[s.source]
                const prev = snaps[i + 1] // chronologically-earlier
                const active = s.id === selectedId
                return (
                  <button
                    key={s.id}
                    data-testid="history-row"
                    onClick={() => setSelectedId(s.id)}
                    className={`w-full text-left px-3 py-2 border-b border-border/60 flex gap-2 items-start ${
                      active ? 'bg-accent/10 shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-paper-deep'
                    }`}
                  >
                    <span className={`mt-1 w-2 h-2 rounded-full flex-none ${meta.dot}`} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink leading-tight">
                        {relTime(s.ts)}
                        {i === 0 && <span className="text-ink-ghost font-normal"> · current</span>}
                      </span>
                      <span className="block text-[11px] text-ink-mute">
                        {meta.label} · {sizeDelta(s, prev)}
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>

          {/* Preview — rendered prose with an inline tracked-changes diff vs
              the current version (plain when the newest is selected). */}
          <div className="flex-1 min-w-0 overflow-auto bg-surface-0">
            {selectedId && snaps.length > 0 && selectedId !== snaps[0]?.id && (
              <div className="px-4 pt-3 pb-2 text-[11px] text-ink-mute border-b border-border/50">
                Changes since this version —{' '}
                <span className="text-[#2c5524]">added</span> ·{' '}
                <span className="line-through text-[#7d2622]">removed</span>
              </div>
            )}
            <div ref={previewHostRef} className="history-preview px-4 py-3 text-[13px] leading-relaxed text-ink" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="text-xs text-ink-mute">
            {error ? (
              <span className="text-fail">{error}</span>
            ) : confirming ? (
              <span>Restore this version? Your current content is saved to history first.</span>
            ) : selectedIsNewest ? (
              <span>This is the current version.</span>
            ) : (
              <span>&nbsp;</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              className="px-3 py-1 text-sm border border-border rounded text-ink hover:bg-paper-deep"
              onClick={onClose}
              disabled={busy}
            >
              Close
            </button>
            {confirming ? (
              <button
                className="px-3 py-1 text-sm rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
                onClick={doRestore}
                disabled={busy}
                data-testid="history-restore-confirm"
              >
                {busy ? 'Restoring…' : 'Confirm restore'}
              </button>
            ) : (
              <button
                className="px-3 py-1 text-sm rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
                onClick={() => setConfirming(true)}
                disabled={busy || !selectedId || selectedIsNewest}
                data-testid="history-restore"
                title={selectedIsNewest ? 'Already the current version' : 'Restore this version'}
              >
                Restore this version
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
