// ENH-110 — JSON / YAML viewer-editor (Tier 3 collapsible tree + raw-
// text source toggle). Owner picks captured during walk-3 decision gate
// (2026-05-10):
//   Q1 tier: Tier 3 (interactive collapsible tree)
//   Q2 edit: autosave on debounce (matches MarkdownEditor / PageTab)
//   Q3 yaml: single tab kind + format discriminator (formatFromPath)
//   Q4 lib:  @uiw/react-json-view (with @uiw/react-json-view/editor for
//            click-to-edit values)
//   §3a:     tree + raw-text toggle (CodeMirror with JSON/YAML lang +
//            inline JSON.parse / yaml.load error markers; save-time
//            guard refuses to save unparseable input)
//
// File loads on mount → parsed via formatFromPath helper → tree renders
// with `JsonView.editor`. Edits mutate the value object in place; the
// editor's onEdit callback schedules a debounced autosave that
// re-serializes via the same helper. The user can flip to source view
// to hand-edit raw text; toggling back parses + applies (rejecting the
// flip if invalid). Tier 1+2 fallback (read-only large-file viewer)
// kicks in for files above LARGE_FILE_THRESHOLD.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JsonViewEditor from '@uiw/react-json-view/editor'
import CodeMirror from '@uiw/react-codemirror'
import { json as cmJson } from '@codemirror/lang-json'
import { yaml as cmYaml } from '@codemirror/lang-yaml'
import { linter, type Diagnostic } from '@codemirror/lint'
import { decodeUtf8, encodeUtf8 } from '../editor/markdown-io'
import { useAutosavePreference } from '../editor/autosavePreference'
import { formatFromPath, parseSource, serializeSource, humanizeParseError, type JsonFormat, type ParserErrorDisplay } from './jsonFormat'

const AUTOSAVE_DEBOUNCE_MS = 800
const LARGE_FILE_THRESHOLD = 1024 * 1024 // 1 MB — above this, skip the tree (render cost is prohibitive) and drop to read-only source view.

type ViewMode = 'tree' | 'source'

/** Walk-6 fix (ENH-110) — CodeMirror linter that converts a parser
 *  error into a Diagnostic with a from/to range derived from the
 *  message's "at position N" / "line L column C" markers. CodeMirror
 *  draws a red squiggly underline at that position + a gutter dot +
 *  a hover tooltip with the message. Position scoping varies by
 *  parser:
 *    - JSON: V8 emits "at position N" — we use that as a single-byte
 *      span (CodeMirror still highlights the line).
 *    - YAML: js-yaml's YAMLException carries `mark.position`, but the
 *      raw message string usually includes "(L:N)" or " line L,
 *      column N" — we extract from message text since we only have
 *      the Error instance here.
 */
function makeLinter(format: JsonFormat) {
  return linter((view): Diagnostic[] => {
    const text = view.state.doc.toString()
    if (text.trim() === '') return []
    try {
      // Round-trip parse — same call the save path uses.
      parseSource(text, format)
      return []
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const len = view.state.doc.length
      // Try a few common position formats. Cheap; falls back to (0, end).
      const posMatch = msg.match(/at position (\d+)/)
      const lineColMatch = msg.match(/line (\d+)\s+column (\d+)/i) || msg.match(/\((\d+):(\d+)\)/)
      let from = 0
      if (posMatch) {
        from = Math.min(parseInt(posMatch[1], 10), len)
      } else if (lineColMatch) {
        const line = Math.max(1, parseInt(lineColMatch[1], 10))
        const col = Math.max(1, parseInt(lineColMatch[2], 10))
        try {
          const lineInfo = view.state.doc.line(line)
          from = Math.min(lineInfo.from + col - 1, len)
        } catch {
          from = 0
        }
      }
      const to = Math.min(from + 1, len)
      return [{
        from,
        to,
        severity: 'error',
        message: msg,
      }]
    }
  })
}

interface JsonViewProps {
  path: string
  onDirtyChange?: (dirty: boolean) => void
}

interface LoadState {
  status: 'loading' | 'ready' | 'parse-error' | 'too-large' | 'read-error'
  /** Initial parsed value for tree view. Populated when status === 'ready'. */
  value?: unknown
  /** Raw text from disk. Always populated when status !== 'read-error'. */
  rawText?: string
  /** Disk size in bytes (from FileReadResult). */
  size?: number
  /** Parser error message when status === 'parse-error'. */
  parseError?: string
  /** Read error when status === 'read-error'. */
  readError?: string
}

export function JsonView({ path, onDirtyChange }: JsonViewProps) {
  const format: JsonFormat = useMemo(() => formatFromPath(path), [path])
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [viewMode, setViewMode] = useState<ViewMode>('tree')
  const [sourceText, setSourceText] = useState<string>('')
  const [sourceParseError, setSourceParseError] = useState<ParserErrorDisplay | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // The live JSON object. Mutated in place by JsonViewEditor's onEdit;
  // re-serialized by save() and by the tree → source toggle.
  const valueRef = useRef<unknown>(undefined)

  // Last successfully-saved source text. Used for dirty detection +
  // mirrors MarkdownEditor's lastSavedBodyRef pattern (BUG-107 lineage).
  const lastSavedTextRef = useRef<string>('')

  const [autosaveOn] = useAutosavePreference()
  const autosaveOnRef = useRef(autosaveOn)
  autosaveOnRef.current = autosaveOn

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load on mount / path change ────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    setDirty(false)
    setSaveError(null)
    setSourceParseError(null)

    window.electron.files.read(path).then(
      (res) => {
        if (cancelled) return
        const text = decodeUtf8(res.bytes)
        const size = res.bytes.byteLength

        if (size > LARGE_FILE_THRESHOLD) {
          // Tier 1+2 fallback — too big for the tree. Read-only source.
          lastSavedTextRef.current = text
          setLoad({ status: 'too-large', rawText: text, size })
          setSourceText(text)
          setViewMode('source')
          return
        }

        try {
          const parsed = parseSource(text, format)
          // The tree view requires an object root. Primitive roots
          // (just `42` or `"hello"`) fall back to source view.
          if (parsed === null || typeof parsed !== 'object') {
            lastSavedTextRef.current = text
            valueRef.current = parsed
            setLoad({ status: 'ready', value: parsed, rawText: text, size })
            setSourceText(text)
            // Force source view for primitive roots — tree can't render them.
            setViewMode('source')
            return
          }
          valueRef.current = parsed
          lastSavedTextRef.current = text
          setSourceText(text)
          setLoad({ status: 'ready', value: parsed, rawText: text, size })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          lastSavedTextRef.current = text
          setSourceText(text)
          setLoad({ status: 'parse-error', rawText: text, size, parseError: msg })
          // Open in source view so the user can fix it.
          setViewMode('source')
        }
      },
      (err) => {
        if (cancelled) return
        setLoad({ status: 'read-error', readError: err instanceof Error ? err.message : String(err) })
      }
    )

    return () => { cancelled = true }
  }, [path, format])

  // ── Save ───────────────────────────────────────────────────────────
  const save = useCallback(async (override?: { text?: string }) => {
    if (load.status === 'too-large') return // Read-only mode; nothing to save.
    if (load.status === 'read-error') return

    let text: string
    if (override?.text !== undefined) {
      text = override.text
    } else if (viewMode === 'tree') {
      // Re-serialize from the live value object (mutated in place by JsonViewEditor).
      try {
        text = serializeSource(valueRef.current, format)
      } catch (err) {
        setSaveError(`Serialize failed: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
    } else {
      // Source mode — validate before saving.
      try {
        const parsed = parseSource(sourceText, format)
        // Re-serialize for canonical formatting on save (matches the
        // tree view's output).
        text = serializeSource(parsed, format)
        // Update valueRef so a switch back to tree view shows the
        // parsed structure.
        valueRef.current = parsed
        setSourceParseError(null)
      } catch (err) {
        const display = humanizeParseError(err, format)
        setSourceParseError(display)
        setSaveError(`Cannot save invalid ${format.toUpperCase()} — see editor for details.`)
        return
      }
    }

    if (text === lastSavedTextRef.current) {
      setDirty(false)
      return
    }

    try {
      await window.electron.files.write(path, encodeUtf8(text))
      lastSavedTextRef.current = text
      setSourceText(text)
      setDirty(false)
      setSaveError(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }, [path, format, viewMode, sourceText, load.status])

  const saveRef = useRef(save)
  saveRef.current = save

  // ── Push dirty up to the tab strip ─────────────────────────────────
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // ── Flush pending autosave on unmount ──────────────────────────────
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
        void saveRef.current()
      }
    }
  }, [])

  // ── Edit handlers ──────────────────────────────────────────────────
  const scheduleAutosave = useCallback(() => {
    if (!autosaveOnRef.current) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      void saveRef.current()
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [])

  const onTreeEdit = useCallback(() => {
    setDirty(true)
    setSaveError(null)
    // The library's onAdd / onDelete / etc. all funnel through this.
    // Schedule the save after the synchronous mutation lands.
    setTimeout(() => scheduleAutosave(), 0)
    return true
  }, [scheduleAutosave])

  const onSourceChange = useCallback((next: string) => {
    setSourceText(next)
    setDirty(next !== lastSavedTextRef.current)
    setSaveError(null)
    // Live-validate so the error banner updates as the user types.
    try {
      parseSource(next, format)
      setSourceParseError(null)
    } catch (err) {
      setSourceParseError(humanizeParseError(err, format))
    }
    scheduleAutosave()
  }, [format, scheduleAutosave])

  // Walk-5 fix (ENH-110) — Revert button in source mode. Resets the
  // CodeMirror buffer to the last successfully-saved text and clears
  // dirty/parse-error state. Useful when the user has made a mess and
  // wants to start over without manually re-typing the whole doc.
  const onRevert = useCallback(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    setSourceText(lastSavedTextRef.current)
    setSourceParseError(null)
    setSaveError(null)
    setDirty(false)
  }, [])

  // ── View-mode toggle ───────────────────────────────────────────────
  const toggleView = useCallback(() => {
    if (viewMode === 'tree') {
      // Tree → Source ('Edit' button). Re-serialize current tree state to text.
      let text: string
      try {
        text = serializeSource(valueRef.current, format)
      } catch (err) {
        setSaveError(`Cannot switch to source: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      setSourceText(text)
      setViewMode('source')
    } else {
      // Source → Tree ('Save' button — walk-6 owner directive).
      // Behavior: cancel any pending autosave timer + force a save NOW
      // (so clicking Save commits even mid-debounce) + parse + flip to
      // tree. If parse fails, stay in source with the error banner.
      try {
        const parsed = parseSource(sourceText, format)
        if (parsed === null || typeof parsed !== 'object') {
          setSourceParseError({
            summary: 'Tree view needs an object or array root',
            hint: `Got ${typeof parsed}. Wrap the value in {} (object) or [] (array) to view as a tree, or stay in this view to edit it.`,
            raw: '',
          })
          return
        }
        // Cancel any pending autosave so the explicit Save isn't
        // followed by a redundant write a beat later.
        if (autosaveTimerRef.current) {
          clearTimeout(autosaveTimerRef.current)
          autosaveTimerRef.current = null
        }
        valueRef.current = parsed
        setSourceParseError(null)
        // Fire the save synchronously (the same code path as autosave,
        // but no debounce). The click handler is intentionally
        // fire-and-forget — saveRef.current handles errors via its own
        // setSaveError calls.
        void saveRef.current()
        setViewMode('tree')
      } catch (err) {
        setSourceParseError(humanizeParseError(err, format))
      }
    }
  }, [viewMode, sourceText, format])

  // ── Render ─────────────────────────────────────────────────────────
  if (load.status === 'loading') {
    return <div className="p-4 text-sm text-ink-mute">Loading…</div>
  }
  if (load.status === 'read-error') {
    return (
      <div className="p-4 text-sm">
        <div className="font-semibold text-red-400">Could not read file</div>
        <div className="mt-1 font-mono text-xs text-ink-mute">{load.readError}</div>
      </div>
    )
  }

  // Walk-6 fix — CodeMirror linter draws inline error markers for
  // unparseable input (red squiggly + gutter dot + hover tooltip).
  // Memoized so we don't re-create on every render.
  const cmExtensions = format === 'yaml' ? [cmYaml(), makeLinter('yaml')] : [cmJson(), makeLinter('json')]
  const sizeLabel = load.size != null ? `${(load.size / 1024).toFixed(1)} KB` : ''
  const formatLabel = format === 'yaml' ? 'YAML' : 'JSON'
  const canRenderTree = load.status === 'ready' && valueRef.current !== null && typeof valueRef.current === 'object'

  return (
    <div className="flex h-full flex-col" data-duo-tab-kind="json">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5 text-xs">
        <div className="font-semibold text-ink">{formatLabel}</div>
        {sizeLabel && <div className="text-ink-mute">{sizeLabel}</div>}

        <div className="ml-auto flex items-center gap-2">
          {load.status === 'too-large' && (
            <div className="rounded bg-accent-soft px-2 py-0.5 text-accent-ink" title={`Files larger than ${(LARGE_FILE_THRESHOLD / 1024).toFixed(0)} KB skip the tree view; tree render cost is prohibitive at scale.`}>
              Read-only (large file)
            </div>
          )}
          {load.status === 'parse-error' && (
            <div className="rounded bg-red-950/40 px-2 py-0.5 text-red-400" title={load.parseError}>
              Parse error
            </div>
          )}
          {dirty && <div className="text-ink-mute">● unsaved</div>}
          {saveError && (
            <div className="rounded bg-red-950/40 px-2 py-0.5 text-red-400" title={saveError}>
              Save failed
            </div>
          )}

          {/* Walk-5 fix — Revert button visible in source mode when
              there are unsaved edits OR when the buffer can't parse.
              Resets the CodeMirror buffer to the last-saved text. */}
          {viewMode === 'source' && (dirty || sourceParseError !== null) && load.status !== 'too-large' && (
            <button
              type="button"
              className="rounded border border-border px-2 py-0.5 text-ink hover:bg-surface-1"
              onClick={onRevert}
              title="Discard unsaved edits and restore the last saved version"
            >
              Revert
            </button>
          )}

          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 text-ink hover:bg-surface-1 disabled:opacity-50"
            onClick={toggleView}
            disabled={load.status === 'too-large' || (viewMode === 'source' && sourceParseError !== null)}
            title={viewMode === 'tree' ? 'Switch to raw-text editor' : 'Save edits and return to tree view'}
          >
            {/* Walk-5 owner directive — tree-mode label "Edit" is the
                clearer affordance. Walk-6 owner directive — source-mode
                label is "Save" (was "Tree"); the click force-saves +
                flips back to the tree. */}
            {viewMode === 'tree' ? 'Edit' : 'Save'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {viewMode === 'tree' && canRenderTree && (
          <div className="p-3 font-mono text-sm">
            <JsonViewEditor
              value={valueRef.current as object}
              collapsed={2}
              displayDataTypes={false}
              displayObjectSize={true}
              enableClipboard={true}
              onEdit={onTreeEdit}
            />
          </div>
        )}
        {viewMode === 'source' && (
          <div className="flex h-full flex-col">
            {sourceParseError && (
              <div className="border-b border-red-700/60 bg-red-950/60 px-3 py-2 text-sm text-red-100">
                {/* Walk-5 fix — friendly preface + hint + raw error.
                    Walk-6 fix — bumped contrast across all three
                    layers (text-red-100 + bg-red-950/60). The dim
                    raw-error line in walk-5 (red-400/70) was
                    illegible against the dark background. */}
                <div className="font-semibold text-red-50">{sourceParseError.summary}</div>
                {sourceParseError.hint && (
                  <div className="mt-1 text-red-100">{sourceParseError.hint}</div>
                )}
                {sourceParseError.raw && (
                  <div className="mt-1 font-mono text-xs text-red-200">{sourceParseError.raw}</div>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1">
              <CodeMirror
                value={sourceText}
                onChange={load.status === 'too-large' ? undefined : onSourceChange}
                extensions={cmExtensions}
                editable={load.status !== 'too-large'}
                readOnly={load.status === 'too-large'}
                height="100%"
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: true,
                  highlightSelectionMatches: false,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
