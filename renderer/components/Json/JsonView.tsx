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
import { useDiskReconciliation } from '../../hooks/useDiskReconciliation'
// ENH-195 — pure structured-edit helpers shared with the disk-direct
// path in core/socket-server.ts so the two `duo json` routes can't drift.
import { applyJsonPointer, deepMerge } from '../../../core/json/jsonOps'
import type { JsonOpRequest } from '@shared/types'

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
  /** ENH-195 — true when this JSON viewer is the active visible tab.
   *  Gates the `duo json set|merge` IPC subscription so only the
   *  user-facing viewer responds (same race guard as MarkdownEditor's
   *  onImageInsert / PageTab). */
  isActive?: boolean
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

export function JsonView({ path, onDirtyChange, isActive }: JsonViewProps) {
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

  // ENH-195 — forward-ref to save() (defined below) so the
  // reconciliation hook's triggerSave (Keep-mine) can kick a save
  // without a hook→save import cycle. Mirrors MarkdownEditor's saveRef.
  const saveRef = useRef<(override?: { text?: string }) => void>(() => {})

  /**
   * ENH-195 — the text save() WOULD write, computed from the current
   * view mode WITHOUT mutating state or hitting disk. Used as the
   * reconciliation hook's `serialize` adapter (its dirty-check baseline)
   * and as the body passed to `recon.beforeSave`. Returns '' on any
   * serialize failure (tree value can't serialize, source can't parse)
   * — the hook treats '' as "nothing to compare", which is correct for
   * an un-serializable buffer (the save path itself surfaces the error).
   */
  const computeSerializedText = useCallback((): string => {
    try {
      if (load.status === 'too-large' || load.status === 'read-error') {
        // Read-only modes never write; the on-disk text IS the baseline.
        return lastSavedTextRef.current
      }
      if (viewMode === 'tree') {
        return serializeSource(valueRef.current, format)
      }
      // Source mode — the canonical (re-serialized) form is what save
      // writes. If it doesn't parse yet, there's nothing valid to write.
      const parsed = parseSource(sourceText, format)
      return serializeSource(parsed, format)
    } catch {
      return ''
    }
  }, [load.status, viewMode, sourceText, format])

  /**
   * ENH-195 — re-parse a fresh on-disk text and re-seed the surface
   * (value + source buffer + load status + view mode), mirroring the
   * mount-load logic. Used by the reconciliation hook's `applyReload`
   * (Reload-from-disk / clean byte-faithful reload). Advances
   * `lastSavedTextRef` (the JsonView-local on-disk mirror); the hook's
   * own baselines are advanced by its rebaselineAfterReload path
   * (serialize() is valid synchronously after this). Does NOT write.
   */
  const loadFromText = useCallback((text: string) => {
    lastSavedTextRef.current = text
    const size = encodeUtf8(text).byteLength
    if (size > LARGE_FILE_THRESHOLD) {
      setLoad({ status: 'too-large', rawText: text, size })
      setSourceText(text)
      setViewMode('source')
      return
    }
    try {
      const parsed = parseSource(text, format)
      valueRef.current = parsed
      setSourceText(text)
      if (parsed === null || typeof parsed !== 'object') {
        // Primitive root — tree can't render it; force source view.
        setLoad({ status: 'ready', value: parsed, rawText: text, size })
        setViewMode('source')
        return
      }
      setLoad({ status: 'ready', value: parsed, rawText: text, size })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setSourceText(text)
      setLoad({ status: 'parse-error', rawText: text, size, parseError: msg })
      setViewMode('source')
    }
  }, [format])

  // ENH-195 — shared editor↔disk reconciliation primitive (D5). Owns the
  // chokidar watcher, the echo gauntlet, the byte-exact baseline,
  // save-pre-reconcile, and the "changed on disk" banner — the same one
  // the markdown editor + canvas consume. JSON injects byte-exact
  // comparators (echoEqual / isDirty are RAW string compares — NOT the
  // markdown normalizer; JSON has no cosmetic round-trip noise to
  // tolerate). readDiskBody is identity (no frontmatter). Ready once the
  // load settles to a non-loading state.
  const recon = useDiskReconciliation({
    path,
    isNew: false,
    surface: 'json',
    ready: load.status === 'ready' || load.status === 'parse-error' || load.status === 'too-large',
    serialize: () => computeSerializedText(),
    applyReload: (diskBody) => loadFromText(diskBody),
    readDiskBody: (raw) => raw,
    isDirty: (live, base) => live !== base,
    echoEqual: (a, b) => a === b,
    onDirtyChange: (d) => setDirty(d),
    rebaselineAfterReload: true,
    triggerSave: () => { void saveRef.current() },
    appVersion: window.electron?.env?.appVersion ?? '?.?.?',
    watchOptions: { ignored: [], watchParents: true },
  })

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
          // ENH-195 — read-only: serialize() returns the on-disk text, so
          // the serialized baseline equals the disk body.
          recon.noteLoaded(text, text)
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
            valueRef.current = parsed
            // ENH-195 — seed both baselines. The serialized view (what
            // save would write) is the canonical re-serialization; the
            // disk body is `text`. Source mode round-trips to canonical
            // on save, so the serialized baseline is the canonical form.
            recon.noteLoaded(serializeSource(parsed, format), text)
            lastSavedTextRef.current = text
            setLoad({ status: 'ready', value: parsed, rawText: text, size })
            setSourceText(text)
            // Force source view for primitive roots — tree can't render them.
            setViewMode('source')
            return
          }
          valueRef.current = parsed
          recon.noteLoaded(serializeSource(parsed, format), text)
          lastSavedTextRef.current = text
          setSourceText(text)
          setLoad({ status: 'ready', value: parsed, rawText: text, size })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // ENH-195 — unparseable on load: serialize() returns '' (can't
          // re-serialize), so seed the serialized baseline as '' and the
          // disk body as `text`. A subsequent fix + save advances both.
          recon.noteLoaded('', text)
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
      // ENH-195 — pre-save reconcile through the shared hook: if disk
      // drifted externally since our baseline it surfaces the banner and
      // we bail; otherwise it registers the echo so our own write isn't
      // misread as an external change by the watcher.
      if ((await recon.beforeSave(text)) === 'conflict') return
      await window.electron.files.write(path, encodeUtf8(text))
      // ENH-195 — advance both baselines (JsonView-local + the hook's).
      recon.noteSaved(text)
      lastSavedTextRef.current = text
      setSourceText(text)
      setDirty(false)
      setSaveError(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
    // recon's methods (beforeSave/noteSaved) are stable closures; the
    // recon object literal is new each render but reading .beforeSave /
    // .noteSaved live is safe (matches MarkdownEditor's save, which also
    // omits recon from its deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, format, viewMode, sourceText, load.status])

  // ENH-195 — saveRef declared above the reconciliation hook; keep it
  // pointed at the latest save closure.
  saveRef.current = save

  // ENH-195 — `duo json set|merge` handler (open-file buffer path).
  // Gated on PATH only (file tabs stay mounted, so one JsonView owns the
  // path). Applies the structured edit to the live parsed value via the
  // shared pure helpers (matching the disk-direct path in socket-server
  // byte-for-byte), updates both views, and routes through the existing
  // echo-safe save() — NEVER writes disk directly (the recon hook
  // recognizes the save as our own echo).
  useEffect(() => {
    return window.electron.json?.onJsonOp((req: JsonOpRequest) => {
      // ENH-195 (review) — gate on PATH only, NOT isActive: file tabs stay
      // mounted (display:none) so exactly one JsonView owns this path, and an
      // inactive-but-open tab must still answer `duo json` (matches markdown's
      // onDocEditPlain). Gating on isActive made the op hang 10s + lose the edit.
      if (req.path !== path) return
      const replyOk = (changed: boolean, reason: string) =>
        window.electron.json.replyJsonOp({ reqId: req.reqId, ok: true, changed, reason, path })
      const replyErr = (error: string) =>
        window.electron.json.replyJsonOp({ reqId: req.reqId, ok: false, changed: false, reason: '', path, error })

      // Read-only / unreadable modes can't accept structured edits.
      if (load.status === 'too-large') {
        replyErr('file is open read-only (too large for structured edit)')
        return
      }
      if (load.status === 'read-error') {
        replyErr('file could not be read')
        return
      }

      try {
        // Build a clean root from the CURRENT buffer state (captures
        // unsaved source-mode edits too). computeSerializedText throws-
        // safely → '' on an un-parseable source buffer; guard that.
        const currentText = computeSerializedText()
        const root: unknown = currentText.trim() === ''
          ? (req.op === 'merge' ? {} : undefined)
          : parseSource(currentText, format)

        let nextRoot: unknown
        if (req.op === 'set') {
          let value: unknown
          try {
            value = req.valueJson !== undefined ? JSON.parse(req.valueJson) : undefined
          } catch (e) {
            replyErr(`valueJson is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
            return
          }
          nextRoot = applyJsonPointer(root, req.pointer ?? '', value)
        } else {
          let patch: unknown
          try {
            patch = req.mergeJson !== undefined ? JSON.parse(req.mergeJson) : undefined
          } catch (e) {
            replyErr(`mergeJson is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
            return
          }
          if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
            replyErr('merge patch must be a JSON object')
            return
          }
          nextRoot = deepMerge(root, patch)
        }

        // Re-serialize canonically + push into both views, then save
        // through the echo-safe path.
        const nextText = serializeSource(nextRoot, format)
        valueRef.current = nextRoot
        setSourceText(nextText)
        // If the new root is a renderable object, keep load.value fresh
        // so a tree re-render shows the change; otherwise leave status.
        if (nextRoot !== null && typeof nextRoot === 'object') {
          setLoad((prev) => prev.status === 'ready'
            ? { ...prev, value: nextRoot, rawText: nextText }
            : prev)
        }
        setDirty(true)
        setSaveError(null)
        setSourceParseError(null)
        // ENH-195 (review) — pass the freshly-computed text as an override so
        // save() writes THIS edit, not the stale-closure sourceText (which in
        // SOURCE mode — primitive roots, parse-error buffers, the Edit toggle —
        // would silently drop the op while still replying ok).
        void saveRef.current({ text: nextText })

        const reason = format === 'yaml'
          ? 'YAML serialized — comments and anchor names are not preserved'
          : ''
        replyOk(true, reason)
      } catch (err) {
        replyErr(err instanceof Error ? err.message : String(err))
      }
    })
  }, [path, load.status, format, computeSerializedText])

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
        <div className="font-semibold duo-text-error">Could not read file</div>
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
            <div className="rounded px-2 py-0.5 duo-banner-error" title={load.parseError}>
              Parse error
            </div>
          )}
          {dirty && <div className="text-ink-mute">● unsaved</div>}
          {saveError && (
            <div className="rounded px-2 py-0.5 duo-banner-error" title={saveError}>
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

      {/* ENH-195 — "changed on disk" reconciliation banner (shared hook).
          Same amber treatment + Reload / Keep-mine affordances as the
          markdown editor. */}
      {recon.externalConflict && (
        <div className="shrink-0 px-3 py-2 text-xs border-b duo-banner-warn flex items-center gap-3">
          <span className="flex-1">
            <strong className="font-semibold">This file changed on disk</strong> while you were editing.
            Reload (loses your edits) or keep yours (next save will overwrite the new disk version).
          </span>
          <button
            type="button"
            onClick={recon.resolveReload}
            className="px-2 py-1 rounded border border-amber-800/60 hover:border-amber-700 hover:bg-amber-900/30"
          >
            Reload from disk
          </button>
          <button
            type="button"
            onClick={recon.resolveKeepMine}
            className="px-2 py-1 rounded border border-amber-800/60 hover:border-amber-700 hover:bg-amber-900/30"
          >
            Keep mine
          </button>
        </div>
      )}

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
              <div className="border-b px-3 py-2 text-sm duo-banner-error">
                {/* Walk-5 fix — friendly preface + hint + raw error.
                    Walk-6 fix — bumped contrast across all three
                    layers (text-red-100 + bg-red-950/60). The dim
                    raw-error line in walk-5 (red-400/70) was
                    illegible against the dark background. */}
                <div className="font-semibold duo-text-error">{sourceParseError.summary}</div>
                {sourceParseError.hint && (
                  <div className="mt-1 duo-text-error">{sourceParseError.hint}</div>
                )}
                {sourceParseError.raw && (
                  <div className="mt-1 font-mono text-xs duo-text-error">{sourceParseError.raw}</div>
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
