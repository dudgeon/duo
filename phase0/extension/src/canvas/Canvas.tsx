// Phase 4b — top-level canvas component.
//
// Responsibilities:
//   * Read `?path=` from URL → drive load on mount.
//   * Hold the markdown buffer + dirty/saved state.
//   * Expose ⌘S to save; show inline status; warn on close-with-dirty.
//
// Mirrors the Phase 4a textarea version but the editor surface is
// now the TipTap-based MarkdownEditor.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { files } from './ipc'
import { MarkdownEditor } from './MarkdownEditor'

type Status =
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

const initialStatus: Status = { kind: 'loading' }

export function Canvas() {
  const filePath = useMemo(() => {
    const p = new URLSearchParams(location.search).get('path')
    return p && p.length > 0 ? p : ''
  }, [])

  const [content, setContent] = useState('')
  const [lastSaved, setLastSaved] = useState('')
  const [status, setStatus] = useState<Status>(initialStatus)

  const dirty = content !== lastSaved
  const canSave = !!filePath && dirty && status.kind !== 'saving'

  // Refresh document title + status pill class.
  useEffect(() => {
    document.title = filePath
      ? `Duo — ${filePath.split('/').pop()}`
      : 'Duo Canvas'
  }, [filePath])

  useEffect(() => {
    if (status.kind === 'loaded' || status.kind === 'saved') {
      if (dirty) setStatus({ kind: 'dirty' })
    }
  }, [dirty, status.kind])

  // Initial load.
  useEffect(() => {
    if (!filePath) {
      setStatus({ kind: 'error', message: 'no path' })
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await files.read(filePath)
        if (cancelled) return
        setContent(res.content)
        setLastSaved(res.content)
        setStatus({ kind: 'loaded' })
      } catch (e) {
        if (cancelled) return
        setStatus({ kind: 'error', message: (e as Error).message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filePath])

  const save = useCallback(async () => {
    if (!filePath || !dirty) return
    const snapshot = content
    setStatus({ kind: 'saving' })
    try {
      await files.write(filePath, snapshot)
      setLastSaved(snapshot)
      setStatus({ kind: 'saved' })
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message })
    }
  }, [filePath, dirty, content])

  // ⌘S / Ctrl-S
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Warn on dirty unload.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  return (
    <>
      <header id="toolbar">
        <span className="label">file</span>
        <span className="path" title={filePath}>{filePath || '(no path)'}</span>
        <StatusPill status={status} dirty={dirty} />
        <button
          id="save-btn"
          type="button"
          disabled={!canSave}
          onClick={save}
        >
          save
        </button>
      </header>
      <main id="editor-host">
        {status.kind === 'loading' && <div className="placeholder">(loading…)</div>}
        {status.kind !== 'loading' && (
          <MarkdownEditor
            value={content}
            onChange={setContent}
          />
        )}
      </main>
    </>
  )
}

function StatusPill({ status, dirty }: { status: Status; dirty: boolean }) {
  let text = ''
  let cls = ''
  if (status.kind === 'loading') { text = 'loading…' }
  else if (status.kind === 'saving') { text = 'saving…' }
  else if (status.kind === 'error') { text = `error: ${status.message}`; cls = 'err' }
  else if (dirty) { text = 'unsaved'; cls = 'dirty' }
  else if (status.kind === 'saved') { text = 'saved'; cls = 'ok' }
  else if (status.kind === 'loaded') { text = 'loaded'; cls = 'ok' }
  return <span className={`status ${cls}`}>{text}</span>
}
