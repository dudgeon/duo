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
import { IdInjectionBanner } from './IdInjectionBanner'
import {
  countDuoIds,
  injectIds,
  getChoiceForDir,
  setChoiceForDir,
  dirOf
} from './idInjector'
import {
  readSidecar,
  writeSidecar,
  emptySidecar,
  withRecentEdit,
  type SidecarV1
} from './sidecar'
import { executeHtmlOp } from './htmlOps'
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

  // 17b Phase A — first-open ID-injection banner. `null` = no decision
  // pending (banner hidden). `{ candidateCount }` = banner shown for
  // the user to accept / decline. PRD H14.
  const [injectionPrompt, setInjectionPrompt] = useState<{ candidateCount: number } | null>(null)

  // 17b Phase B — in-memory sidecar. Loaded on canvas mount; mutated
  // by the canvas (recentEdits append on injection, future agent
  // edits, comments) and persisted alongside the .html on save.
  // Refs (not state) because we don't render off this — autosave reads
  // the latest value at flush time. PRD H22.
  const sidecarRef = useRef<SidecarV1>(emptySidecar())
  const sidecarDirtyRef = useRef(false)

  const getDoc = useCallback(() => canvasRef.current?.getDocument() ?? null, [])

  // Build EditorActions once — it's a thin closure over `getDoc`, so it
  // never needs to rebuild. Toolbar reactivity is driven by selectionVersion.
  const editorActions = useMemo(() => buildCanvasEditorActions(getDoc), [getDoc])

  // Banner handlers (17b Phase A). Injection on accept marks the
  // buffer dirty so the IDs land on disk via the existing autosave
  // pipeline. Either choice can be persisted for the directory via
  // the banner's "don't ask again" checkbox.
  const handleAcceptInjection = useCallback((rememberForDir: boolean) => {
    const doc = getDoc()
    if (!doc) { setInjectionPrompt(null); return }
    injectIds(doc)
    // DOM mutations from injection land on the iframe's MutationObserver
    // → onChange → handleChange → dirty + autosave. No manual fire needed.
    if (rememberForDir) setChoiceForDir(dirOf(path), 'always')
    // 17b Phase B — record the injection in the sidecar so the recent-
    // edits log captures it; flushed on next save by save().
    sidecarRef.current = withRecentEdit(sidecarRef.current, {
      ts: new Date().toISOString(),
      author: 'user',
      kind: 'inject-ids'
    })
    sidecarDirtyRef.current = true
    setInjectionPrompt(null)
  }, [getDoc, path])
  const handleDeclineInjection = useCallback((rememberForDir: boolean) => {
    if (rememberForDir) setChoiceForDir(dirOf(path), 'never')
    setInjectionPrompt(null)
  }, [path])

  // Load the file on mount + path change. Same lifecycle as MarkdownEditor.
  // 17b Phase B — sidecar lives alongside; absence is fine (defaults).
  useEffect(() => {
    let cancelled = false
    setError(null)
    setInitialHtml(null)
    setDirty(false)
    sidecarRef.current = emptySidecar()
    sidecarDirtyRef.current = false

    void readSidecar(path).then((sc) => {
      if (cancelled) return
      if (sc) sidecarRef.current = sc
    })

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
    const htmlChanged = html !== lastSavedRef.current
    if (!htmlChanged && !dirty && !sidecarDirtyRef.current) return

    setSaving(true)
    try {
      // .html first; if it succeeds, persist the sidecar. Order matters
      // because the sidecar is meaningless without the canvas file.
      if (htmlChanged) {
        await window.electron.files.write(path, encodeUtf8(html))
        lastSavedRef.current = html
      }
      // Sidecar (17b Phase B) — write alongside whenever it has pending
      // changes (recentEdits append, future agent edits, etc.). The
      // sidecar is small + atomic; cost is one extra fs.write.
      if (sidecarDirtyRef.current) {
        await writeSidecar(path, sidecarRef.current)
        sidecarDirtyRef.current = false
      }
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

  // Wire iframe-side hooks via RenderedCanvas's `onReady` callback —
  // fires AFTER the iframe has finished parsing srcdoc and the body is
  // populated. Wiring at the previous earlier moment (an effect keyed
  // on `initialHtml`) was racy: the parser would wipe our placeholder
  // + listeners when it replaced body with the parsed content.
  //
  //   - selectionchange   → bump toolbar reactivity
  //   - markdown shortcuts (item 1)
  //   - placeholder overlay (item 7 / 17a.5 D)
  //   - first-open ID-injection prompt / auto-inject (PRD H14, 17b A)
  //   - re-baseline lastSavedRef against pretty-printed live DOM (17b D)
  const wireCleanupRef = useRef<(() => void) | null>(null)
  const handleReady = useCallback((doc: Document) => {
    // Defensive — if a previous wiring is still in place (path change
    // mid-flight), tear it down before rebuilding.
    wireCleanupRef.current?.()

    const onSelChange = () => bumpVersion()
    doc.addEventListener('selectionchange', onSelChange)

    const cleanShortcuts = installMarkdownShortcuts(doc)
    const cleanPlaceholder = installPlaceholder(doc)

    // 17b Phase D — re-baseline lastSavedRef against the pretty-printed
    // serialized form of the live DOM. Without this, every canvas opens
    // "dirty" because the on-disk text (raw, possibly from a hand-
    // authored file) doesn't match our canonical serializer output.
    // Must happen BEFORE the ID-injection logic below — auto-inject
    // mutates the DOM, and we want those mutations to register as a
    // dirty state against the no-ID baseline so autosave persists them.
    const initialSerialized = canvasRef.current?.serialize()
    if (initialSerialized) lastSavedRef.current = initialSerialized

    // ── ID injection (PRD H12–H14). If the file already has duo-ids,
    // do nothing — they're stable across sessions. Otherwise consult
    // the per-directory choice; auto-act on it, or surface the prompt.
    const existingIds = countDuoIds(doc)
    if (existingIds === 0) {
      const dir = dirOf(path)
      const choice = getChoiceForDir(dir)
      if (choice === 'always') {
        injectIds(doc)
        // The DOM mutations land on the iframe's MutationObserver
        // which fires onChange → handleChange → dirty + autosave.
      } else if (choice === 'never') {
        // Respect the user's earlier "no" — keep the file pristine.
      } else {
        // First time we've seen a file in this directory: count what we
        // *would* inject, then surface the banner.
        const probe = injectIds(doc)
        // Undo the probe so the user sees a clean buffer until they
        // accept. Easier than dry-running with a separate walker.
        if (probe.injected > 0) {
          doc.body.querySelectorAll('[data-duo-id]').forEach(el => {
            // Only strip the ones we just injected. We can recognise
            // them: a fresh injection on a previously-zero-ID document
            // means EVERY data-duo-id was added by us.
            el.removeAttribute('data-duo-id')
          })
        }
        setInjectionPrompt({ candidateCount: probe.total })
      }
    }

    wireCleanupRef.current = () => {
      doc.removeEventListener('selectionchange', onSelChange)
      cleanShortcuts()
      cleanPlaceholder()
      setInjectionPrompt(null)
    }
  }, [path, bumpVersion])

  // Tear down iframe-side wiring on unmount (CanvasTab is unmounted via
  // the React `key={tab.id}` on path change in WorkingPane).
  useEffect(() => {
    return () => {
      wireCleanupRef.current?.()
      wireCleanupRef.current = null
    }
  }, [])

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

  // 17b Phase C — subscribe to `duo html *` ops dispatched from main.
  // Active canvas tab is the only subscriber; an op dispatched while no
  // canvas is open ends up timing out in main (no subscriber → no reply).
  // If the request carries a `path` and it doesn't match this tab, we
  // surface a clear error so the agent can address the right tab.
  // recentEdits get an entry on every WRITE op (set/replace/append/
  // remove/attr) so the sidecar log captures agent activity.
  useEffect(() => {
    if (initialHtml === null) return
    return window.electron.canvas?.onHtmlOp((req) => {
      if (req.path && req.path !== path) {
        window.electron.canvas.replyHtmlOp({
          reqId: req.reqId,
          ok: false,
          error: `Active canvas is at ${path}, not ${req.path}`
        })
        return
      }
      const doc = getDoc()
      if (!doc) {
        window.electron.canvas.replyHtmlOp({
          reqId: req.reqId,
          ok: false,
          error: 'Canvas iframe not ready'
        })
        return
      }
      const result = executeHtmlOp(doc, req)
      // Append a recentEdits entry for write ops on success.
      if (result.ok && req.op !== 'query' && req.op !== 'get') {
        const anchorId = (result.result as { id?: string | null } | undefined)?.id ?? undefined
        sidecarRef.current = withRecentEdit(sidecarRef.current, {
          ts: new Date().toISOString(),
          author: 'claude',
          anchorId: anchorId ?? undefined,
          kind: req.op
        })
        sidecarDirtyRef.current = true
      }
      window.electron.canvas.replyHtmlOp(result)
    })
  }, [initialHtml, path, getDoc])

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
      {injectionPrompt && (
        <IdInjectionBanner
          dir={dirOf(path)}
          candidateCount={injectionPrompt.candidateCount}
          onAccept={handleAcceptInjection}
          onDecline={handleDeclineInjection}
        />
      )}
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
            onReady={handleReady}
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
