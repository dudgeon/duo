// Stage 17a — HTML canvas tab. Owns load / save / dirty / autosave;
// composes the shared <EditorToolbar> (Stage 17a polish item 3 — same
// component the markdown editor uses) and <RenderedCanvas>.
//
// 17a polish wiring:
//   - item 3: shared EditorToolbar via canvasEditorActions adapter
//   - item 4: blockOps for headings / lists / blockquote / code / hr / table
//   - item 5: native execCommand undo/redo (covers our DOM mutations
//     because they happen inside the contentEditable body)
//   - item 6: tableOps for the contextual table strip
//   - item 1: markdownShortcuts for typing-time # / ** / etc.
//   - item 7: placeholder text on fresh + empty pages

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorToolbar } from '../editor/EditorToolbar'
import { RenderedCanvas, type RenderedCanvasHandle } from './RenderedCanvas'
import { buildCanvasEditorActions } from './canvasEditorActions'
import { installMarkdownShortcuts } from './markdownShortcuts'
import { installPlaceholder } from './placeholder'
import { decodeUtf8, encodeUtf8 } from '../editor/markdown-io'

interface Props {
  path: string
  /** Propagate dirty state up so the tab strip can show the unsaved dot. */
  onDirtyChange?: (dirty: boolean) => void
}

const AUTOSAVE_DEBOUNCE_MS = 800

export function CanvasTab({ path, onDirtyChange }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [initialHtml, setInitialHtml] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const canvasRef = useRef<RenderedCanvasHandle | null>(null)
  // The serialized HTML as it was on disk after the last successful read
  // or write. Diff against this to compute `dirty`.
  const lastSavedRef = useRef<string>('')
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 17a polish item 3 — shared toolbar reactivity. Bumped from inside
  // the iframe on every selectionchange / DOM mutation so the toolbar
  // re-queries `actions.isActive(...)` / `currentBlock()` / `inTable()`
  // and updates its visual state. Mirrors the markdown editor's
  // `toolbarVersion`.
  const [selectionVersion, setSelectionVersion] = useState(0)
  const bumpVersion = useCallback(() => setSelectionVersion(v => v + 1), [])

  const getDoc = useCallback(() => canvasRef.current?.getDocument() ?? null, [])

  // Build EditorActions once — it's a thin closure over `getDoc`, so it
  // never needs to rebuild. Toolbar reactivity is driven by selectionVersion.
  const editorActions = useMemo(() => buildCanvasEditorActions(getDoc), [getDoc])

  // Load the file on mount + path change. Same lifecycle as MarkdownEditor.
  useEffect(() => {
    let cancelled = false
    setError(null)
    setInitialHtml(null)
    setDirty(false)

    window.electron.files.read(path).then(
      (res) => {
        if (cancelled) return
        const text = decodeUtf8(res.bytes)
        lastSavedRef.current = text
        setInitialHtml(text)
      },
      (err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    )
    return () => { cancelled = true }
  }, [path])

  const save = useCallback(async () => {
    const handle = canvasRef.current
    if (!handle) return
    if (saving) return
    const html = handle.serialize()
    if (!html) return
    if (html === lastSavedRef.current && !dirty) return

    setSaving(true)
    try {
      await window.electron.files.write(path, encodeUtf8(html))
      lastSavedRef.current = html
      setDirty(false)
      onDirtyChange?.(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [path, saving, dirty, onDirtyChange])

  const saveRef = useRef(save)
  saveRef.current = save

  const handleChange = useCallback(() => {
    const handle = canvasRef.current
    if (!handle) return
    const html = handle.serialize()
    const isDirty = html !== '' && html !== lastSavedRef.current
    setDirty(isDirty)
    bumpVersion()  // mutations may also affect toolbar state (e.g. inTable)
    if (isDirty) {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = setTimeout(() => {
        autosaveTimerRef.current = null
        void saveRef.current()
      }, AUTOSAVE_DEBOUNCE_MS)
    }
  }, [bumpVersion])

  // Push dirty up in its own effect so we don't cross-update the parent
  // during render (mirrors MarkdownEditor's pattern).
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // Flush pending autosave on unmount.
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
        void saveRef.current()
      }
    }
  }, [])

  // Wire iframe-side hooks once the canvas has a live document:
  //   - selectionchange → bump toolbar reactivity
  //   - markdown shortcuts (item 1)
  //   - placeholder text (item 7)
  // Re-run when initialHtml lands (signals the iframe is mounted with content).
  useEffect(() => {
    if (initialHtml === null) return
    const doc = getDoc()
    if (!doc) return

    const onSelChange = () => bumpVersion()
    doc.addEventListener('selectionchange', onSelChange)

    const cleanShortcuts = installMarkdownShortcuts(doc)
    const cleanPlaceholder = installPlaceholder(doc)

    return () => {
      doc.removeEventListener('selectionchange', onSelChange)
      cleanShortcuts()
      cleanPlaceholder()
    }
  }, [initialHtml, getDoc, bumpVersion])

  // Keyboard shortcut handler — fires from inside the iframe.
  // PRD H28 + polish item 3: marks (B/I/U/code) + link picker (⌘K) all
  // route through the shared EditorActions so the typing path and the
  // toolbar path go through the same code. Save (⌘S) is also handled.
  // Undo (⌘Z) / redo (⌘⇧Z) are NOT intercepted — native contentEditable
  // undo handles them, and execCommand-backed mutations land on the same
  // stack.
  const handleShortcut = useCallback((e: KeyboardEvent): boolean => {
    if (!(e.metaKey || e.ctrlKey)) return false
    switch (e.key.toLowerCase()) {
      case 's': void save(); return true
      case 'b': editorActions.toggleBold(); return true
      case 'i': editorActions.toggleItalic(); return true
      case 'u': editorActions.toggleUnderline(); return true
      case 'k': {
        const url = window.prompt('Link URL', editorActions.currentLinkHref() ?? 'https://')
        if (url === null) return true
        editorActions.setLink(url.trim() === '' ? null : url)
        return true
      }
      default: return false
    }
  }, [save, editorActions])

  // Bridge: ⌘S pressed in the renderer (e.g. user clicked the toolbar
  // first, focus is in the toolbar's iframe boundary, so the iframe-side
  // keydown listener doesn't fire) should still save when the canvas is
  // the active tab. Mirrors MarkdownEditor's window-level ⌘S.
  const hostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 's') return
      const root = hostRef.current
      if (!root) return
      if (!root.contains(document.activeElement) && document.activeElement?.tagName !== 'IFRAME') {
        return
      }
      e.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [save])

  return (
    <div
      ref={hostRef}
      data-duo-workingpane
      tabIndex={0}
      className="flex-1 flex flex-col bg-surface-0 min-h-0 focus:outline-none"
    >
      <EditorToolbar
        actions={editorActions}
        selectionVersion={selectionVersion}
        onSave={() => void save()}
        dirty={dirty}
        saving={saving}
      />
      {error && (
        <div className="shrink-0 px-10 py-2 text-xs text-red-400 border-b border-red-900/40 bg-red-950/20">
          {error}
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        {initialHtml !== null ? (
          <RenderedCanvas
            ref={canvasRef}
            initialHtml={initialHtml}
            onChange={handleChange}
            onShortcut={handleShortcut}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
            Loading…
          </div>
        )}
      </div>
    </div>
  )
}
