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
import { createPortal } from 'react-dom'
import { EditorToolbar } from '../editor/EditorToolbar'
import { RenderedCanvas, type RenderedCanvasHandle } from './RenderedCanvas'
import { buildCanvasEditorActions } from './canvasEditorActions'
import { installMarkdownShortcuts } from './markdownShortcuts'
// BUG-034 — `installPlaceholder` import removed. Module kept in tree at
// `./placeholder` as a starting point for the Stage 17a.5 rebuild (the
// gate has to fire at install time, not on first mutation). When re-
// enabling, restore the import and the call site at the marked location
// in handleReady.
import { IdInjectionBanner } from './IdInjectionBanner'
import { SendToDuoPill, type PillAnchorRect } from '../editor/primitives/SendToDuoPill'
import { WriteWarningBanner } from '../editor/primitives/WriteWarningBanner'
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
  withComment,
  withResolvedThread,
  withReopenedThread,
  type SidecarV1,
  type SidecarComment
} from './sidecar'
import { executeHtmlOp } from './htmlOps'
import { installJustAddedStyles, markJustAdded, REPAINT_FRESHNESS_MS } from './justAddedCanvas'
import { installBlurredSelection } from './blurredSelection'
import { installCanvasSelection, computeCanvasSnapshot } from './canvasSelection'
import { installCanvasActions, isCanvasPathTrusted } from './canvasActions'
import { installCanvasPasteHandlers } from './canvasPaste'
import {
  paintAnchors,
  clearAnchors,
  buildThreads,
  scrollToAnchor,
  type BuiltThread
} from './commentAnchors'
import { CommentRail, type CommentThread } from '../editor/primitives/CommentRail'
import { injectCodeBlockCopyButtons, injectCodeBlockCopyStyle } from '../editor/codeBlockCopyButton'
import { formatCanvasSendPayload } from '../editor/sendFormat'
import { useSelectionFormat } from '../../hooks/useSelectionFormat'
import { decodeUtf8, encodeUtf8 } from '../editor/markdown-io'
import type {
  HtmlCanvasSelectionSnapshot,
  HtmlOpRequest,
  HtmlCommentRequest,
  HtmlCommentResult,
  CanvasAction
} from '@shared/types'

interface Props {
  path: string
  /** Propagate dirty state up so the tab strip can show the unsaved dot. */
  onDirtyChange?: (dirty: boolean) => void
  /** Stage 17c — host-supplied callback fired when the user clicks the
   *  Send → Duo pill. Same shape as MarkdownEditor's onSendToDuo: the
   *  payload is already formatted (per the user's `duo selection-format`
   *  preference), and the host writes it to the active terminal's PTY.
   *  `null` props the pill from rendering at all. */
  onSendToDuo?: ((payload: string) => void) | null
  /** Stage 23 — host-supplied dispatch for `data-duo-action` clicks
   *  inside the canvas. Resolves with `{ ok, error? }`; canvasActions
   *  surfaces dispatch failures to the dev console. Omit to disable
   *  canvas actions (the listener won't be installed). */
  onCanvasAction?: (action: CanvasAction) => Promise<{ ok: boolean; error?: string }>
  /** Stage 23 — user $HOME. Used by the trust gate (canvas files
   *  under ~/.claude/duo/ are trusted; others are inert). Required
   *  whenever onCanvasAction is supplied; otherwise the trust check
   *  returns false and actions never fire. */
  homeDir?: string
  /** BUG-032 — `focusedColumn === 'working'` from the host. Threaded
   *  into RenderedCanvas's `shouldStealFocus` so an iframe load event
   *  fired while the user has the terminal focused doesn't yank the
   *  cursor mid-typing. */
  focused?: boolean
}

const AUTOSAVE_DEBOUNCE_MS = 800

/**
 * 17c — translate a selection rect from iframe-content coordinates to
 * the parent renderer's viewport coordinates so the SendToDuoPill
 * primitive (which positions itself with `position: fixed`) lands on
 * the user's actual selection rather than at (0,0) inside the
 * iframe's own viewport. Returns null when either side is unavailable.
 */
function translateToPillRect(
  handle: RenderedCanvasHandle | null,
  iframeRect: DOMRect | null
): PillAnchorRect | null {
  if (!iframeRect) return null
  const el = handle?.getIframeElement?.()
  if (!el) return null
  const host = el.getBoundingClientRect()
  return {
    top: host.top + iframeRect.top,
    bottom: host.top + iframeRect.bottom,
    right: host.left + iframeRect.right
  }
}

/**
 * 17c — paint the just-added wash on elements Claude wrote to while the
 * canvas was closed (or the renderer was unmounted), but only for the
 * recent past. Reads `recentEdits` from the in-memory sidecar; only
 * entries (a) authored by 'claude' (b) carrying an `anchorId` (c)
 * within the freshness window get repainted.
 *
 * Idempotent: each anchorId is only painted once per repaint pass even
 * if the sidecar carries multiple recent entries against the same id
 * (e.g. two replaces in quick succession). The 6s animation runs from
 * paint time, not edit time — re-opening a file 5s after the edit gives
 * 6s of paint, not 1s. Slight over-emphasis on the recently-closed
 * case is the right tradeoff for "didn't notice the change before
 * closing the tab" recovery.
 */
function repaintRecentClaudeEdits(doc: Document, sidecar: SidecarV1): void {
  const edits = sidecar.recentEdits ?? []
  if (edits.length === 0) return
  const now = Date.now()
  const seen = new Set<string>()
  for (const e of edits) {
    if (e.author !== 'claude') continue
    if (!e.anchorId) continue
    if (seen.has(e.anchorId)) continue
    const ts = Date.parse(e.ts)
    if (Number.isNaN(ts) || now - ts > REPAINT_FRESHNESS_MS) continue
    const el = doc.querySelector(`[data-duo-id="${cssEscape(e.anchorId)}"]`)
    if (!el) continue
    markJustAdded(el)
    seen.add(e.anchorId)
  }
}

/** Tiny CSS attribute-value escape for `data-duo-id` lookups. The id is
 *  Crockford base32 (alphanumeric only) — defense in depth in case a
 *  raw user-supplied id slips through. */
function cssEscape(s: string): string {
  return s.replace(/(["\\])/g, '\\$1')
}

/**
 * 17d — resolve an agent-side `duo html comment` request to a concrete
 * anchor. Three addressing options per PRD H24:
 *   1. `--id <duo-id>`           → exact data-duo-id lookup
 *   2. `--selector <css>`        → resolve to nearest data-duo-id ancestor
 *   3. `--text "<substring>"`    → first text node containing substring,
 *                                  walked up to nearest data-duo-id ancestor
 *
 * Returns the anchor id + the new comment id (so the renderer can
 * persist the entry) or an error result. The actual comment append
 * happens in the caller (which also persists the sidecar via
 * `persistSidecarMutation`).
 */
function handleAgentComment(doc: Document, req: HtmlCommentRequest): HtmlCommentResult {
  let anchor: Element | null = null
  if (req.id) {
    anchor = doc.querySelector(`[data-duo-id="${cssEscape(req.id)}"]`)
    if (!anchor) {
      return { reqId: req.reqId, ok: false, error: `No element with data-duo-id="${req.id}"` }
    }
  } else if (req.selector) {
    const target = doc.querySelector(req.selector)
    if (!target) {
      return { reqId: req.reqId, ok: false, error: `No element matching selector "${req.selector}"` }
    }
    anchor = nearestDuoIdAncestor(target)
    if (!anchor) {
      return { reqId: req.reqId, ok: false, error: `Element matching "${req.selector}" has no data-duo-id ancestor — accept ID injection first` }
    }
  } else if (req.text) {
    const found = findElementByText(doc, req.text)
    if (!found) {
      return { reqId: req.reqId, ok: false, error: `No text matching "${req.text}" found in document` }
    }
    anchor = nearestDuoIdAncestor(found)
    if (!anchor) {
      return { reqId: req.reqId, ok: false, error: 'Matched text has no data-duo-id ancestor — accept ID injection first' }
    }
  } else {
    return {
      reqId: req.reqId,
      ok: false,
      error: 'comment requires --id <duo-id>, --selector <css>, or --text "<substring>"'
    }
  }

  if (!req.body || !req.body.trim()) {
    return { reqId: req.reqId, ok: false, error: 'comment requires a non-empty --body' }
  }

  const anchorId = anchor.getAttribute('data-duo-id')
  if (!anchorId) {
    return { reqId: req.reqId, ok: false, error: 'Anchor has no data-duo-id (unexpected)' }
  }

  const commentId = `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return { reqId: req.reqId, ok: true, commentId, anchorId }
}

function nearestDuoIdAncestor(node: Element | null): Element | null {
  let cur: Element | null = node
  while (cur) {
    if (cur.hasAttribute('data-duo-id')) return cur
    cur = cur.parentElement
  }
  return null
}

function findElementByText(doc: Document, needle: string): Element | null {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if ((node.textContent ?? '').includes(needle)) {
      return node.parentElement
    }
    node = walker.nextNode()
  }
  return null
}

// Honors `<meta name="duo-editable" content="false">` in the HTML head.
// When present, the canvas mounts read-only: no contentEditable, no
// toolbar, no comment composer, no agent-write banner. Used for system
// reference HTMLs (FAQ, What Duo Does) so they can be opened from the
// file navigator without accidentally editing the source. Cheap regex
// scan against the file head — full HTML parsing is overkill for a
// single meta tag.
function parseReadOnlyFromHtml(html: string | null): boolean {
  if (!html) return false
  const m = html.match(/<meta\s+[^>]*name\s*=\s*["']duo-editable["'][^>]*content\s*=\s*["']false["']/i)
  return !!m
}

export function CanvasTab({ path, onDirtyChange, onSendToDuo, onCanvasAction, homeDir, focused = false }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [initialHtml, setInitialHtml] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const readOnly = useMemo(() => parseReadOnlyFromHtml(initialHtml), [initialHtml])

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

  // 17c — pill state, latest selection snapshot, format preference.
  // Mirrors MarkdownEditor's pillRect / lastSelectionRef pattern.
  const [pillRect, setPillRect] = useState<PillAnchorRect | null>(null)
  const lastCanvasSelectionRef = useRef<HtmlCanvasSelectionSnapshot | null>(null)
  const { format: selectionFormat } = useSelectionFormat()

  // 17c — pending agent write awaiting the user's accept/decline. While
  // a banner is up, further html-op WRITE requests get rejected with a
  // clear error so the queue stays at depth 1. PRD H36 (Stage 11 D24
  // parity — same UX as the markdown editor's WriteWarningBanner).
  const [pendingHtmlOp, setPendingHtmlOp] = useState<HtmlOpRequest | null>(null)
  const pendingHtmlOpRef = useRef<HtmlOpRequest | null>(null)
  pendingHtmlOpRef.current = pendingHtmlOp
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty

  // 17d — comment threads computed from the live sidecar. State (not
  // ref) because the rail re-renders on every change. `threadsTick` is
  // a small counter we bump whenever we mutate the sidecar; the
  // rebuild effect reads sidecarRef + this tick.
  const [threadsTick, setThreadsTick] = useState(0)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  // 17d — new-comment composer state. When non-null, a textarea
  // floats over the canvas anchored to the cached selection. The
  // anchor is the current `lastCanvasSelectionRef`'s anchorId.
  const [newCommentAt, setNewCommentAt] = useState<{
    anchorId: string
    anchorPath?: string[]
    excerpt: string
    rect: PillAnchorRect
  } | null>(null)

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
    // ENH-005 — re-inject copy buttons after any mutation (new <pre>
    // landing via paste / agent write needs a button). Idempotent;
    // sentinel class gates per-pre.
    const doc = canvasRef.current?.getDocument()
    if (doc) injectCodeBlockCopyButtons(doc, { markCanvasRuntime: true })
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
  //   - selectionchange   → bump toolbar reactivity (also drives pill)
  //   - markdown shortcuts (item 1)
  //   - placeholder overlay (item 7 / 17a.5 D)
  //   - first-open ID-injection prompt / auto-inject (PRD H14, 17b A)
  //   - re-baseline lastSavedRef against pretty-printed live DOM (17b D)
  //   - 17c: just-added keyframe + blurred-selection styles + selection
  //     observer + recentEdits repaint within freshness window
  const wireCleanupRef = useRef<(() => void) | null>(null)
  const handleReady = useCallback((doc: Document) => {
    // Defensive — if a previous wiring is still in place (path change
    // mid-flight), tear it down before rebuilding.
    wireCleanupRef.current?.()

    const onSelChange = () => bumpVersion()
    doc.addEventListener('selectionchange', onSelChange)

    // Markdown shortcuts are editing-only. Skip in read-only mode so a
    // system reference HTML (FAQ etc.) doesn't wire keyboard mutations.
    const cleanShortcuts = readOnly ? () => {} : installMarkdownShortcuts(doc)
    // BUG-034 — placeholder install disabled. The current `installPlaceholder`
    // shows the onboarding card on EVERY canvas open, including populated
    // files (the `isJustBoilerplate` gate is checked on first mutation, not
    // at install time, so it occludes real content until the user types).
    // Re-enable in Stage 17a.5 with the gate at install time. See
    // placeholder.ts header for the design note.
    const cleanPlaceholder = () => {}

    // BUG-016 + ENH-002 (v0.3.1) — paste handlers. Editing-only:
    // pasting into a read-only canvas is a no-op anyway. Strips
    // inline color / background from regular paste (so dark-mode
    // bold pastes inherit the canvas ink token instead of the
    // source's brown), and adds ⌘⇧V → paste-as-plain-text.
    const cleanPaste = readOnly ? () => {} : installCanvasPasteHandlers(doc)

    // 17c — install the just-added keyframe + class into the iframe
    // stylesheet. Must happen before any markJustAdded call (the
    // recentEdits repaint pass below or the html-op handler later).
    installJustAddedStyles(doc)

    // Stage 23 — install the canvas-action delegated click listener.
    // Skipped if no host dispatcher is wired or no homeDir was passed
    // (which would mean the trust check can't run — we'd rather
    // disable than mis-trust). Trust check uses the canvas file's
    // path; v1 trusts only ~/.claude/duo/ and below.
    const cleanCanvasActions = (onCanvasAction && homeDir)
      ? installCanvasActions(doc, {
          trusted: isCanvasPathTrusted(path, homeDir),
          onAction: onCanvasAction,
          onUntrusted: (action) => {
            // Surface a one-line console hint until 23a-follow-up
            // ships an in-canvas toast or a "trust this folder?"
            // dialog. The user knows clicking did something but
            // didn't fire — better than silent.
            console.info(
              `[duo-canvas-action] ignored ${action.kind} — canvas not under ~/.claude/duo/ (path: ${path})`
            )
          }
        })
      : () => {}

    // 17c (PRD H26) — keep the user's selection painted while the
    // iframe loses focus. CSS Custom Highlight Registry (Chromium 105+)
    // means no DOM mutation, so the dirty path doesn't fire on
    // focus/blur.
    const blurred = installBlurredSelection({ doc })

    // 17c (PRD H25) — selection observer pushes snapshots to main
    // (caches `duo selection --pane canvas`) AND drives the pill rect
    // (translated to viewport coords below).
    const sel = installCanvasSelection({
      doc,
      path,
      onPush: (snap) => {
        lastCanvasSelectionRef.current = snap
        window.electron.canvas?.pushSelection(snap)
      },
      onRect: (iframeRect) => setPillRect(translateToPillRect(canvasRef.current, iframeRect))
    })

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
    // Skipped entirely in read-only mode: anchors are an editing
    // affordance (comments, agent ops) and have no purpose in files
    // the user can't modify. Mutating a read-only file's DOM would
    // also dirty the buffer, which the user can't save.
    const existingIds = readOnly ? 1 : countDuoIds(doc)  // sentinel non-zero skips the injection branch
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

    // 17c (PRD H20 second sentence) — repaint just-added on agent edits
    // that landed while this canvas was closed, but only within the
    // freshness window. Older entries fall off — the wash is meant to
    // signal recency, not "Claude touched this once". `inject-ids` and
    // user-authored edits are skipped (we only highlight CLAUDE writes
    // to specific anchors).
    repaintRecentClaudeEdits(doc, sidecarRef.current)

    // ENH-005 — initial Copy-button injection (style + buttons) on
    // every <pre> in the canvas. Re-runs on doc mutations via
    // handleChange. Marked data-duo-canvas-runtime so the serializer
    // strips both on save.
    injectCodeBlockCopyStyle(doc)
    injectCodeBlockCopyButtons(doc, { markCanvasRuntime: true })

    wireCleanupRef.current = () => {
      doc.removeEventListener('selectionchange', onSelChange)
      cleanShortcuts()
      cleanPlaceholder()
      cleanCanvasActions()
      cleanPaste()
      blurred.dispose()
      sel.dispose()
      clearAnchors(doc)
      setInjectionPrompt(null)
      setPillRect(null)
      setActiveThreadId(null)
      setNewCommentAt(null)
      lastCanvasSelectionRef.current = null
    }
  }, [path, bumpVersion, readOnly, onCanvasAction, homeDir])

  // Tear down iframe-side wiring on unmount (CanvasTab is unmounted via
  // the React `key={tab.id}` on path change in WorkingPane).
  useEffect(() => {
    return () => {
      wireCleanupRef.current?.()
      wireCleanupRef.current = null
    }
  }, [])

  // ENH-002 / v0.4.0 — Edit menu "Paste and Match Style" handler.
  // Mirrors the markdown editor's wiring: subscribe globally; only
  // act when this canvas's iframe body owns keyboard focus. The
  // editor-local ⌘⇧V chord (installed via canvasPaste.ts) is the
  // primary entry point; this adds the menu-item path.
  useEffect(() => {
    return window.electron.appMenu.onPastePlainRequest(() => {
      const doc = canvasRef.current?.getDocument()
      if (!doc) return
      // Active element check: body is the contentEditable host.
      const isFocused = doc.activeElement === doc.body || doc.body.contains(doc.activeElement)
      if (!isFocused) return
      void navigator.clipboard.readText().then(text => {
        if (text) doc.execCommand('insertText', false, text)
      }).catch(err => {
        console.warn('[duo-canvas-paste] readText failed:', err)
      })
    })
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

  // 17b Phase C / 17c — apply a single html-op against the live document.
  // Extracted so both the immediate path (clean buffer) and the post-
  // accept path (dirty buffer + accepted) call the same code. On
  // success: paints just-added on the affected element (write ops
  // only), appends a recentEdits entry, and replies via IPC.
  const applyHtmlOp = useCallback((req: HtmlOpRequest) => {
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
    if (result.ok && req.op !== 'query' && req.op !== 'get') {
      const anchorId = (result.result as { id?: string | null } | undefined)?.id ?? undefined
      // 17c — paint the affected element with the just-added wash so
      // the user can see what Claude changed. Skip 'remove' (the
      // element is gone) and skip when no anchor (the affected node
      // doesn't carry a duo-id, so we can't reach back to it).
      if (req.op !== 'remove' && anchorId) {
        const el = doc.querySelector(`[data-duo-id="${cssEscape(anchorId)}"]`)
        markJustAdded(el)
      }
      sidecarRef.current = withRecentEdit(sidecarRef.current, {
        ts: new Date().toISOString(),
        author: 'claude',
        anchorId: anchorId ?? undefined,
        kind: req.op
      })
      sidecarDirtyRef.current = true
    }
    window.electron.canvas.replyHtmlOp(result)
  }, [getDoc])

  const applyHtmlOpRef = useRef(applyHtmlOp)
  applyHtmlOpRef.current = applyHtmlOp

  // 17b Phase C — subscribe to `duo html *` ops dispatched from main.
  // Active canvas tab is the only subscriber; an op dispatched while no
  // canvas is open ends up timing out in main (no subscriber → no reply).
  // If the request carries a `path` and it doesn't match this tab, we
  // surface a clear error so the agent can address the right tab.
  //
  // 17c (PRD H36) — write ops get gated through the WriteWarningBanner
  // when the buffer is dirty so the user accepts/declines from the
  // canvas chrome instead of finding their unsaved edits clobbered.
  // Read ops (query, get) bypass the gate — they don't mutate state.
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
      const isWrite = req.op !== 'query' && req.op !== 'get'
      if (isWrite && dirtyRef.current) {
        if (pendingHtmlOpRef.current) {
          window.electron.canvas.replyHtmlOp({
            reqId: req.reqId,
            ok: false,
            error: 'Another write is awaiting the user\'s decision.'
          })
          return
        }
        setPendingHtmlOp(req)
        return
      }
      applyHtmlOpRef.current(req)
    })
  }, [initialHtml, path])

  const handlePendingAccept = useCallback(() => {
    const req = pendingHtmlOpRef.current
    if (!req) return
    setPendingHtmlOp(null)
    applyHtmlOpRef.current(req)
  }, [])

  const handlePendingDecline = useCallback(() => {
    const req = pendingHtmlOpRef.current
    if (!req) return
    setPendingHtmlOp(null)
    window.electron.canvas.replyHtmlOp({
      reqId: req.reqId,
      ok: false,
      error: 'User declined the agent\'s write request.'
    })
  }, [])

  // 17c — Send → Duo pill click. Format the cached snapshot via the
  // user's current selection-format preference, then hand it to the
  // host (which writes to the active terminal's PTY).
  const handleSendToDuoClick = useCallback(() => {
    if (!onSendToDuo) return
    const snap = lastCanvasSelectionRef.current
    if (!snap) return
    const payload = formatCanvasSendPayload(snap, selectionFormat)
    onSendToDuo(payload)
    setPillRect(null)
  }, [onSendToDuo, selectionFormat])

  // 17d — comment threads. Recomputed on every threadsTick bump (when
  // sidecar mutates) and on every selection-rebuild — the second case
  // catches the rare "anchor moved in DOM" scenario without us having
  // to thread MutationObserver into the rail explicitly.
  const builtThreads = useMemo<BuiltThread[]>(() => {
    const doc = getDoc()
    if (!doc) return []
    return buildThreads(doc, sidecarRef.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadsTick, getDoc])

  // 17d — paint / repaint anchor badges in the body. Runs on every
  // threads change + active-thread change. Idempotent — paintAnchors
  // reconciles the existing badges with the expected list.
  useEffect(() => {
    const doc = getDoc()
    if (!doc) return
    paintAnchors({
      doc,
      badges: builtThreads.map((t, i) => ({
        threadId: t.threadId,
        number: i + 1,
        resolved: t.resolved
      })),
      activeThreadId,
      onClick: (threadId) => setActiveThreadId(threadId)
    })
  }, [builtThreads, activeThreadId, getDoc])

  // 17d — adapt BuiltThread → CommentThread for the primitive.
  const railThreads = useMemo<CommentThread[]>(() => {
    return builtThreads.map((t, i) => ({
      id: t.threadId,
      number: i + 1,
      excerpt: t.excerpt,
      resolved: t.resolved,
      entries: t.entries.map((e) => ({
        id: e.id,
        author: e.author,
        ts: e.ts,
        body: e.body
      }))
    }))
  }, [builtThreads])

  // 17d — sidecar mutators marked dirty + ticked so the rail rebuilds.
  const persistSidecarMutation = useCallback((next: SidecarV1) => {
    sidecarRef.current = next
    sidecarDirtyRef.current = true
    setThreadsTick(v => v + 1)
    // Trigger autosave path so the sidecar lands without waiting for
    // the next iframe mutation.
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      void saveRef.current()
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [])

  // 17d — handlers for the rail.
  const handleJumpToThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId)
    const doc = getDoc()
    if (doc) scrollToAnchor(doc, threadId)
  }, [getDoc])

  const handleReplyToThread = useCallback((threadId: string, body: string) => {
    const trimmed = body.trim()
    if (!trimmed) return
    const entry: SidecarComment = {
      id: `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      anchorId: threadId,
      author: 'user',
      ts: new Date().toISOString(),
      body: trimmed
    }
    persistSidecarMutation(withComment(sidecarRef.current, entry))
  }, [persistSidecarMutation])

  const handleResolveThread = useCallback((threadId: string) => {
    persistSidecarMutation(withResolvedThread(sidecarRef.current, threadId, 'user'))
  }, [persistSidecarMutation])

  const handleReopenThread = useCallback((threadId: string) => {
    persistSidecarMutation(withReopenedThread(sidecarRef.current, threadId))
  }, [persistSidecarMutation])

  // 17d — "💬 Comment" button in the SendToDuoPill cluster. The button
  // sits next to the Send → Duo pill when the user has a non-collapsed
  // selection inside an anchored element. Clicking opens the
  // composer; submitting calls handleNewComment.
  const handleStartNewComment = useCallback(() => {
    const snap = lastCanvasSelectionRef.current
    if (!snap || !snap.anchorId) return
    const rect = pillRect
    if (!rect) return
    const excerpt = (snap.text || snap.surrounding || '').slice(0, 60)
    setNewCommentAt({
      anchorId: snap.anchorId,
      anchorPath: snap.anchorPath,
      excerpt,
      rect
    })
    // Hide the pill while the composer is open.
    setPillRect(null)
  }, [pillRect])

  const handleSubmitNewComment = useCallback((body: string) => {
    const at = newCommentAt
    if (!at) return
    const trimmed = body.trim()
    if (!trimmed) { setNewCommentAt(null); return }
    const entry: SidecarComment = {
      id: `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      anchorId: at.anchorId,
      author: 'user',
      ts: new Date().toISOString(),
      body: trimmed
    }
    persistSidecarMutation(withComment(sidecarRef.current, entry))
    setActiveThreadId(at.anchorId)
    setNewCommentAt(null)
  }, [newCommentAt, persistSidecarMutation])

  const handleCancelNewComment = useCallback(() => {
    setNewCommentAt(null)
  }, [])

  // 17d — agent-driven `duo html comment` requests. The renderer is the
  // only place that knows the live sidecar + the anchor resolution
  // rules (selector → nearest data-duo-id ancestor). Mirrors the
  // html-op subscription pattern from 17b/c.
  useEffect(() => {
    if (initialHtml === null) return
    return window.electron.canvas?.onHtmlComment((req) => {
      if (req.path && req.path !== path) {
        window.electron.canvas.replyHtmlComment({
          reqId: req.reqId,
          ok: false,
          error: `Active canvas is at ${path}, not ${req.path}`
        })
        return
      }
      const doc = getDoc()
      if (!doc) {
        window.electron.canvas.replyHtmlComment({
          reqId: req.reqId,
          ok: false,
          error: 'Canvas iframe not ready'
        })
        return
      }
      const result = handleAgentComment(doc, req)
      if (result.ok && result.commentId && result.anchorId) {
        const entry: SidecarComment = {
          id: result.commentId,
          anchorId: result.anchorId,
          author: 'claude',
          ts: new Date().toISOString(),
          body: req.body
        }
        persistSidecarMutation(withComment(sidecarRef.current, entry))
      }
      window.electron.canvas.replyHtmlComment(result)
    })
  }, [initialHtml, path, getDoc, persistSidecarMutation])

  // 17d — agent-driven `duo html comments` reads. Returns the threads
  // post-doc-order sort, with optional filter. Renderer is the only
  // authoritative source — main has no copy of the sidecar.
  useEffect(() => {
    if (initialHtml === null) return
    return window.electron.canvas?.onHtmlCommentsList((req) => {
      if (req.path && req.path !== path) {
        window.electron.canvas.replyHtmlCommentsList({
          reqId: req.reqId,
          ok: false,
          error: `Active canvas is at ${path}, not ${req.path}`
        })
        return
      }
      const doc = getDoc()
      if (!doc) {
        window.electron.canvas.replyHtmlCommentsList({
          reqId: req.reqId,
          ok: false,
          error: 'Canvas iframe not ready'
        })
        return
      }
      const all = buildThreads(doc, sidecarRef.current)
      const filtered = (req.filter === 'open')
        ? all.filter(t => !t.resolved)
        : (req.filter === 'resolved')
        ? all.filter(t => t.resolved)
        : all
      const threads = filtered.map((t, i) => ({
        id: t.threadId,
        number: i + 1,
        excerpt: t.excerpt,
        resolved: t.resolved,
        entries: t.entries.map(e => ({
          id: e.id,
          author: e.author,
          ts: e.ts,
          body: e.body
        }))
      }))
      window.electron.canvas.replyHtmlCommentsList({
        reqId: req.reqId,
        ok: true,
        threads
      })
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
      {/* Read-only mode (`<meta name="duo-editable" content="false">`)
          hides the entire editing chrome. Toolbar, ID-injection
          banner, and write-warning banner are all editing affordances
          that have no purpose on a system reference HTML. */}
      {!readOnly && (
        <EditorToolbar
          actions={editorActions}
          selectionVersion={selectionVersion}
          onSave={() => void save()}
          dirty={dirty}
          saving={saving}
        />
      )}
      {!readOnly && pendingHtmlOp && (
        <WriteWarningBanner
          action={describeHtmlOp(pendingHtmlOp)}
          preview={previewHtmlOp(pendingHtmlOp)}
          onAccept={handlePendingAccept}
          onDecline={handlePendingDecline}
        />
      )}
      {!readOnly && injectionPrompt && (
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
            readOnly={readOnly}
            shouldStealFocus={focused}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
            Loading…
          </div>
        )}
        {/* Stage 17d — comment rail. Renders to the right of the canvas
            iframe. Hidden when the file has no `data-duo-id`s yet
            (commenting requires anchors). Also hidden in read-only
            mode — comments are an editing affordance, no purpose on
            a system reference HTML.

            BUG-015 fix (v0.3.1) — also gated on `railThreads.length > 0`
            so an empty rail no longer occupies horizontal space when
            there are no comments. The rail will reappear automatically
            the moment the first comment lands. */}
        {initialHtml !== null && !readOnly && railThreads.length > 0 && (
          <CommentRail
            threads={railThreads}
            activeThreadId={activeThreadId}
            onJumpTo={handleJumpToThread}
            onReply={handleReplyToThread}
            onResolve={handleResolveThread}
            onReopen={handleReopenThread}
          />
        )}
      </div>
      {/* Stage 17c — floating Send → Duo pill + Stage 17d comment
          button. The "💬 Comment" button only shows when the user's
          selection has an anchor (live `data-duo-id` ancestor). Both
          pills are portaled to body via the same primitive. */}
      {onSendToDuo && pillRect && !newCommentAt && (
        <>
          {/* Send → Duo stays available even in read-only mode — quoting
              FROM a reference HTML to the active terminal is a useful
              motion. Comment button is suppressed: comments need
              anchors which need editing. */}
          <SendToDuoPill rect={pillRect} onClick={handleSendToDuoClick} />
          {!readOnly && lastCanvasSelectionRef.current?.anchorId && (
            <CommentButton rect={pillRect} onClick={handleStartNewComment} />
          )}
        </>
      )}
      {/* Stage 17d — new-comment composer (modal popover). Anchored to
          the selection rect captured when the user clicked Comment. */}
      {newCommentAt && (
        <NewCommentComposer
          anchorRect={newCommentAt.rect}
          excerpt={newCommentAt.excerpt}
          onSubmit={handleSubmitNewComment}
          onCancel={handleCancelNewComment}
        />
      )}
    </div>
  )
}

/**
 * 17d — small "💬" icon button rendered to the LEFT of the Send → Duo
 * pill (same anchor rect, offset by the pill's width). Same portal
 * pattern as SendToDuoPill so it lives outside the canvas tree.
 */
function CommentButton({ rect, onClick }: { rect: PillAnchorRect; onClick: () => void }) {
  // BUG-024 fix — stack vertically with the SendToDuoPill instead of
  // side-by-side. Pre-fix, both buttons tried to share the same anchor
  // row above the selection; a narrow selection (single word) plus
  // viewport-edge clamping made them overlap and one would occlude
  // the other. Now: SendToDuoPill stays ABOVE the selection (its
  // primary-action position); Comment button drops BELOW the
  // selection so the two are vertically separated and both always
  // visible. If there's no room below (selection near viewport
  // bottom), stack above the SendToDuoPill instead.
  const PILL_HEIGHT_ESTIMATE = 24
  const PILL_OFFSET_PX = 6
  const PILL_WIDTH_ESTIMATE = 96
  // Try below first (the fresh real-estate); fall back to above-
  // above-pill when the selection is at the viewport bottom.
  const wouldOverflowBottom = rect.bottom + PILL_OFFSET_PX + PILL_HEIGHT_ESTIMATE + 8 > window.innerHeight
  const top = wouldOverflowBottom
    ? rect.top - (PILL_HEIGHT_ESTIMATE + PILL_OFFSET_PX) * 2 // above the SendToDuoPill
    : rect.bottom + PILL_OFFSET_PX
  // Right-align with the SendToDuoPill (same x-coordinate) so the
  // two read as a stack rather than a scattered row.
  const left = Math.max(8, rect.right - PILL_WIDTH_ESTIMATE)
  return createPortal(
    <button
      type="button"
      className="duo-send-pill"
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        // Slimmer than the Send → Duo pill so the visual hierarchy
        // reads "Send → Duo first, Comment second" — comments are an
        // adjacent action, not the primary one.
        padding: '4px 8px',
        background: 'var(--duo-paper)',
        color: 'var(--duo-accent-ink)',
        boxShadow: '0 1px 2px rgba(20, 14, 8, 0.18)',
        fontSize: 11
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      aria-label="Add comment"
    >
      💬 Comment
    </button>,
    document.body
  )
}

/**
 * 17d — new-comment composer. Floats above the user's selection; the
 * user types a comment + clicks Comment / Cancel. ⌘+Enter submits;
 * Escape cancels. On submit, the parent appends to sidecar.comments
 * and dismisses.
 */
function NewCommentComposer({
  anchorRect,
  excerpt,
  onSubmit,
  onCancel
}: {
  anchorRect: PillAnchorRect
  excerpt: string
  onSubmit: (body: string) => void
  onCancel: () => void
}) {
  const [body, setBody] = useState('')
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => { taRef.current?.focus() }, [])

  // Position below the selection so the user can still see what
  // they're commenting on.
  const top = anchorRect.bottom + 8
  const left = Math.max(8, Math.min(anchorRect.right - 320, window.innerWidth - 340))

  return createPortal(
    <div
      className="duo-comment-composer"
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: 320,
        background: 'var(--duo-paper)',
        border: '1px solid var(--duo-paper-edge)',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(20, 14, 8, 0.18)',
        padding: 10,
        zIndex: 60
      }}
    >
      {excerpt && (
        <div style={{
          fontSize: 11,
          color: 'var(--duo-ink-mute)',
          marginBottom: 6,
          fontStyle: 'italic',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          “{excerpt}”
        </div>
      )}
      <textarea
        ref={taRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment…"
        style={{
          width: '100%',
          minHeight: 64,
          background: 'var(--duo-paper)',
          border: '1px solid var(--duo-paper-edge)',
          borderRadius: 4,
          padding: '6px 8px',
          fontFamily: 'inherit',
          fontSize: 12,
          color: 'var(--duo-ink)',
          resize: 'vertical'
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSubmit(body)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="duo-comment-thread__action-link"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="duo-comment-thread__btn-primary"
          onClick={() => onSubmit(body)}
          disabled={body.trim().length === 0}
        >
          Comment
        </button>
      </div>
    </div>,
    document.body
  )
}

/** Human-readable banner copy for an html-op the user is about to accept
 *  or decline. Keeps the banner specific to what Claude is asking to do
 *  (replace this <p>, not "edit a file"). */
function describeHtmlOp(req: HtmlOpRequest): string {
  switch (req.op) {
    case 'set':     return `Replace contents of ${targetLabel(req.id, req.selector)}`
    case 'replace': return `Replace ${targetLabel(req.id, req.selector)}`
    case 'append':  return `Append child to ${targetLabel(req.parentId, req.parentSelector)}`
    case 'remove':  return `Remove ${targetLabel(req.id, req.selector)}`
    case 'attr':    return `Update attributes on ${targetLabel(req.id, req.selector)}`
    case 'query':
    case 'get':     return 'Read the document'
    default: {
      const _exhaustive: never = req
      return 'Modify the document' + (_exhaustive ? '' : '')
    }
  }
}

function targetLabel(id?: string, selector?: string): string {
  if (id) return `#${id}`
  if (selector) return `\`${selector}\``
  return 'an element'
}

/** Truncated preview text shown in the banner. Pulls the html payload
 *  for write ops that carry one; falls back to the JSON of attribute
 *  changes for `attr`. */
function previewHtmlOp(req: HtmlOpRequest): string | undefined {
  if ('html' in req && typeof req.html === 'string') {
    return clip(req.html, 140)
  }
  if (req.op === 'attr') {
    const set = req.set ? Object.entries(req.set).map(([k, v]) => `${k}="${v}"`).join(' ') : ''
    const remove = req.remove?.map(k => `-${k}`).join(' ') ?? ''
    return clip([set, remove].filter(Boolean).join(' '), 140)
  }
  return undefined
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…'
}
