// Stage 11 — rich markdown editor (PRD D1–D5, D10–D11, D21).
//
// TipTap/ProseMirror under the hood; tiptap-markdown for round-trip.
// YAML frontmatter is split off, preserved verbatim, re-attached on save.
// v1 ships: core marks + nodes (StarterKit, underline, link, image, task
// lists, tables, code blocks with syntax highlighting). Autosave (800ms
// debounce) + ⌘S + dirty dot.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { ViewSourcePanel } from '../ViewSourcePanel'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { DuoImage, ImageBlobCache } from './extensions/DuoImage'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
// BUG-210 — multi-line cells (bullet lists / hard breaks) round-trip as
// single-line `<br>` instead of shattering the GFM table on save.
import {
  TableWithMarkdownCells,
  HardBreakWithMarkdown,
  TableCellBrParse,
  tableRowsSurviveSerialize
} from './extensions/TableMarkdownRoundtrip'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { Markdown } from 'tiptap-markdown'

import type { Editor } from '@tiptap/react'

import { EditorToolbar } from './EditorToolbar'
import { HistoryModal } from './HistoryModal'
import { SuggestingBanner } from './SuggestingBanner'
import { UnifiedAnnotationRail } from './UnifiedAnnotationRail'
import { collectTrackedChanges, countTrackedChanges, type TrackedRange } from './trackedChanges'
import { FrontmatterPanel } from './FrontmatterPanel'
import { useAutosavePreference } from './autosavePreference'
import { buildTiptapEditorActions } from './tiptapEditorActions'
import type { EditorActions } from './EditorActions'
import { TableShortcuts } from './extensions/TableShortcuts'
import { TableCellCopy } from './extensions/TableCellCopy'
import { PersistentSelection } from './extensions/PersistentSelection'
import { JustAdded } from './extensions/JustAdded'
import { MarkdownPaste } from './extensions/MarkdownPaste'
import { BulletListWithMarker } from './extensions/BulletListWithMarker'
import { FindHighlight } from './extensions/FindHighlight'
import { ListIndentShortcuts } from './extensions/ListIndentShortcuts'
import { MarkdownLinkShortcuts } from './extensions/MarkdownLinkShortcuts'
import { InsertionMark } from './extensions/InsertionMark'
import { DeletionMark } from './extensions/DeletionMark'
import { HighlightMark } from './extensions/HighlightMark'
import { SuggestingMode } from './extensions/SuggestingMode'
import { FencedCodeBlockEnter } from './extensions/FencedCodeBlockEnter'
import { FindBar } from './FindBar'
import { CodeBlockCopyButton } from './extensions/CodeBlockCopyButton'
import { CommentMark, collectCommentRanges } from './extensions/CommentMark'
import { WikilinkDecorations } from './extensions/WikilinkDecorations'
import { WikilinkSuggestion } from './extensions/WikilinkSuggestion'
import { AtMention } from './extensions/AtMention'
import { LineNumbers, lineNumbersPluginKey, LINE_NUMBERS_STORAGE_KEY } from './extensions/LineNumbers'
import { useVaultIndex, rankVaultFiles } from './vaultIndex'
// ENH-216 (U7) — cmd+click nav for standard markdown relative links (the
// OKF at-rest link shape). The wikilink twin (cmd+click on `[[ ]]`) is
// handled by the WikilinkDecorations plugin; this covers the `[ ](rel.md)`
// link-mark case so both serializers' links are navigable.
import { resolveMdLinkInVault } from './wikilinkResolver'
// ENH-216 (U7) — okfLinkInsert builds the markdown relative link the
// stub-create placeholder rewrite (D3) splices into the BODY. (Frontmatter
// `[[ ]]` persists AS `[[ ]]` per FOLLOWUP-051 — no rewrite.)
import { okfLinkInsert } from './okfLinks'
// BUG-207 — the two pure-UI editor prefs (Suggesting mode + Properties-panel
// collapse) persist in per-path localStorage, not the `.duo.json` sidecar, so
// an otherwise-empty fresh note never spawns a sidecar file.
import {
  readSuggestingPref,
  writeSuggestingPref,
  readFrontmatterCollapsedPref,
  writeFrontmatterCollapsedPref
} from './docUiPrefs'
import { WriteWarningBanner } from './primitives/WriteWarningBanner'
import { SendToDuoPill } from './primitives/SendToDuoPill'
import { NewCommentComposer } from './primitives/NewCommentComposer'
// ENH-208 D4 — silent-stub type picker, opened by WikilinkSuggestion's
// create row. ENH-208 D22 — the vault-search palette's goto-match handoff.
import { TypePickerPopover } from './primitives/TypePickerPopover'
import { jumpToMatch } from './gotoMatchJump'
import { consumeGotoMatch, VAULT_GOTO_MATCH_EVENT, type VaultGotoMatch } from './vaultGotoMatch'
import { formatSendPayload } from './sendFormat'
import { useSelectionFormat } from '../../hooks/useSelectionFormat'
import { matchGlobalShortcut } from '../../keyboard/globalShortcuts'
import { normalizeForEchoCompare } from '../../utils/conflictDiagnostic'
import { useDiskReconciliation } from '../../hooks/useDiskReconciliation'
import { computeReloadDiff } from './reloadDiff'
import { applyTrackedDiff } from './trackedDiff'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { DocWriteRequest, EditorSelectionSnapshot } from '@shared/types'
import {
  splitFrontmatter,
  joinFrontmatter,
  decodeUtf8,
  encodeUtf8
} from './markdown-io'
import {
  readSidecar,
  writeSidecar,
  emptySidecar,
  withComment as sidecarWithComment,
  withResolvedThread as sidecarWithResolvedThread,
  withReopenedThread as sidecarWithReopenedThread,
  type SidecarV1,
  type SidecarComment
} from '../Page/sidecar'
import {
  applyCommentMarksFromSidecar,
  refreshSidecarFromDoc,
  buildMarkdownThreads,
  captureExcerptContext,
  scrollToCommentAnchor
} from './markdownComments'
import {
  applyCriticMarkupFromText,
  serializeWithCriticMarkup,
  preprocessSubstitutions
} from './markdownCriticMarkup'
// ENH-195 — pure surgical PLAIN-text replace for `duo doc edit` (open-
// file path). Sibling to the CriticMarkup docEdit helpers but produces
// a literal edited body (no `{~~old~>new~~}` tokens).
import { plainReplace } from '../../../core/markdown/plainEdit'
import type { DocEditPlainRequest } from '@shared/types'
import { migrateSidecarCommentsToInline } from './migrateSidecarComments'
import { useAuthor } from '../../hooks/useAuthor'

interface Props {
  path: string
  /** Propagate dirty state up so the tab strip can show the unsaved dot. */
  onDirtyChange?: (dirty: boolean) => void
  /** Stage 11 § D33a — when true, the editor shows a "Name this document"
   *  interstitial bar instead of reading the file. The path prop carries a
   *  suggested filename; the user can rename freely before commit. */
  isNew?: boolean
  /** Called when the user confirms the filename for a new document. The
   *  parent should write an empty file, update the tab path/title, and
   *  drop the `isNew` flag. */
  onCommitNewFile?: (resolvedPath: string, title: string) => Promise<void>
  /** Called when the user cancels naming (Escape). Parent typically
   *  closes the tab. */
  onCancelNew?: () => void
  /** Stage 15.1 — host-supplied callback fired when the user clicks the
   *  Send → Duo pill. The payload is already formatted (per the user's
   *  current `duo selection-format` preference); the host writes it to
   *  the active terminal's PTY. `null` props the pill from rendering at
   *  all (e.g. no terminal tabs are open). */
  onSendToDuo?: ((payload: string) => void) | null
  /** ENH-176 — label shown on the Send pill. Default is "Send → agent"
   *  (matches the existing pill primitive default). App.tsx overrides
   *  to "Send → Terminal" when the terminal-variant feature flag is
   *  on and claudePresence is NOT 'claude'. */
  pillLabel?: string
  /** FOLLOWUP-014/walk-2 — true when this editor is the active visible
   *  tab. Gates IPC handlers (currently `onImageInsert`) that should
   *  only fire on the user-facing surface. Without the gate, multiple
   *  mounted editors race to respond and the first reply wins —
   *  silently delivering content to the wrong file. */
  isActive?: boolean
}

const AUTOSAVE_DEBOUNCE_MS = 800

// ENH-108 (Sprint 12) — paste-image / drop-image MIME → file-extension
// map. Entries cover what the standard browser clipboard yields when
// the user copies an image from a screenshot tool, browser context
// menu, or another app. Anything not in the map falls through to 'png'
// (the most common screenshot format) rather than producing an
// extension-less file.
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff'
}

// ENH-128 (Sprint 14) — HEIC / HEIF / RAW require nativeImage transcode
// before saving. Listed separately from MIME_TO_EXT so the paste/drop
// handler can branch on the convert path without the fall-through.
// Owner pick (ENH-118 conversation 2026-05-10): convert HEIC to JPEG,
// other RAW formats to PNG. Apple Photos.app uses HEIC by default; this
// closes the drag-from-Photos workflow.
const CONVERT_MIMES = new Set([
  'image/heic',
  'image/heif',
  'image/x-canon-cr2',
  'image/x-canon-cr3',
  'image/x-nikon-nef',
  'image/x-sony-arw',
  'image/x-fuji-raf',
  'image/x-adobe-dng'
])

// Walk-1 fix (2026-05-10) — Chrome / Electron's File API often returns
// `file.type === ""` for HEIC and RAW formats because they're not in
// the browser's MIME registry. Without an extension fallback the paste/
// drop handler misses these files entirely (seen in walk-1 — drag a
// .heic from Photos.app was a silent no-op). Map extension → MIME so
// the existing CONVERT_MIMES branch fires correctly. Same pattern for
// PDFs (rare but possible).
const EXT_TO_MIME: Record<string, string> = {
  heic: 'image/heic',
  heif: 'image/heif',
  cr2: 'image/x-canon-cr2',
  cr3: 'image/x-canon-cr3',
  nef: 'image/x-nikon-nef',
  arw: 'image/x-sony-arw',
  raf: 'image/x-fuji-raf',
  dng: 'image/x-adobe-dng',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff'
}

function inferMimeFromName(name: string | undefined, fallback: string): string {
  if (fallback) return fallback
  if (!name) return ''
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? (EXT_TO_MIME[m[1]] ?? '') : ''
}

// ENH-129 (Sprint 14) — PDFs accepted on paste/drop, saved alongside
// the doc, inserted as a markdown link `[filename.pdf](relative-path)`.
// Owner pick (ENH-118): link form, NOT inline `<embed>`. Standard
// markdown — click opens externally.
const PDF_MIME = 'application/pdf'

/**
 * ENH-108 / ENH-128 / ENH-129 — unified asset-paste handler. Three
 * branches:
 *   1. PDF (application/pdf) → save bytes verbatim, insert markdown
 *      LINK `[filename.pdf](relPath)`.
 *   2. HEIC / HEIF / RAW (CONVERT_MIMES) → transcode bytes via main's
 *      nativeImage helper, save converted bytes, insert as image.
 *   3. Plain image (image/*) → existing path unchanged.
 *
 * Errors are logged + swallowed; the user sees nothing if we fail
 * (the file just doesn't appear). Could surface a toast in v2.
 */
async function handleAssetPaste(
  file: File,
  docPath: string,
  editor: { chain: () => { focus: (pos?: number) => { setImage: (attrs: { src: string }) => { run: () => unknown }; insertContent: (markdown: string) => { run: () => unknown } } } } | null,
  // Walk-2 fix (ENH-129) — when the asset arrives via drag-drop, the
  // caller passes the doc position at the drop client coords (computed
  // via ProseMirror's view.posAtCoords). We `focus(pos)` to place the
  // caret at that position before insertion so the asset lands AT the
  // drop point, not at the editor's prior focus location. Paste
  // handlers pass null (clipboard inserts naturally at the active
  // selection — no override needed).
  insertPos: number | null = null
): Promise<void> {
  if (!editor) return
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const effectiveMime = inferMimeFromName(file.name, file.type)
  // Helper — apply the focus(pos) override only when a drop position
  // was supplied. focus() with no arg restores the prior caret;
  // focus(pos) sets caret to pos. Three insert sites use this.
  const focused = () => editor.chain().focus(insertPos ?? undefined)
  try {
    if (effectiveMime === PDF_MIME) {
      const origName = file.name && /\.pdf$/i.test(file.name) ? file.name : 'paste.pdf'
      const baseName = origName.replace(/\.pdf$/i, '')
      const safeBase = baseName.replace(/[^a-zA-Z0-9._-]/g, '-')
      const result = await window.electron.files.saveImageBeside(docPath, bytes, 'pdf', safeBase)
      focused().insertContent(`[${origName}](${result.relPath})`).run()
      return
    }
    if (CONVERT_MIMES.has(effectiveMime)) {
      const converted = await window.electron.files.convertImageBytes(bytes, effectiveMime)
      const result = await window.electron.files.saveImageBeside(docPath, converted.bytes, converted.ext)
      focused().setImage({ src: result.relPath }).run()
      return
    }
    // Default image path (PNG / JPEG / GIF / WEBP / SVG / BMP / TIFF).
    const ext = MIME_TO_EXT[effectiveMime] ?? 'png'
    const result = await window.electron.files.saveImageBeside(docPath, bytes, ext)
    focused().setImage({ src: result.relPath }).run()
  } catch (err) {
    console.error('[ENH-108/128/129] asset paste failed:', err)
  }
}

// Module-scope lowlight instance — cheap to construct, shared across tabs.
const lowlight = createLowlight(common)

// ENH-022 — GitHub-style heading slug. Lowercase, whitespace → '-',
// strip non-alphanumerics-or-hyphens. The agent reaches for this when
// it wants a stable anchor name (e.g. `#bug-040` matches `### BUG-040
// Foo bar` after slugifying both sides).
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// 17a polish item 3 — no-op EditorActions used while the TipTap editor
// instance is being constructed (single render frame). Avoids
// conditional-render plumbing in the toolbar; toolbar buttons are
// effectively inert for the one frame before useEditor settles.
const NULL_ACTIONS: EditorActions = {
  toggleBold: () => {}, toggleItalic: () => {}, toggleUnderline: () => {},
  toggleStrike: () => {}, toggleCode: () => {},
  setBlock: () => {}, toggleBulletList: () => {}, toggleOrderedList: () => {},
  toggleTaskList: () => {}, toggleBlockquote: () => {}, toggleCodeBlock: () => {},
  insertHr: () => {}, insertTable: () => {},
  setLink: () => {}, currentLinkHref: () => undefined,
  undo: () => {}, redo: () => {}, canUndo: () => false, canRedo: () => false,
  isActive: () => false, currentBlock: () => 'p',
  inTable: () => false
}

export function MarkdownEditor({ path, onDirtyChange, isNew, onCommitNewFile, onCancelNew, onSendToDuo, pillLabel, isActive }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  // BUG-138 Phase 2 — current human author identity. Used when
  // stamping new CriticMarkup marks (comments today; Phase 4
  // track-changes inserts/deletes). Mirrors localStorage('duo:author')
  // and the `duo author` CLI verb. Falls back to '$USER' on a fresh
  // install via the hook's default.
  const { author: currentAuthor } = useAuthor()
  const authorOrLegacy = currentAuthor.trim().length > 0 ? currentAuthor.trim() : 'user'
  // Sprint 10 ENH-103 — last save failure (separate from `error`,
  // which surfaces read/load errors via the banner). Drives the
  // SaveControl pill's "Failed — retry" state. Cleared on next edit
  // and on next successful save.
  const [saveError, setSaveError] = useState<string | null>(null)
  // Sprint 10 ENH-104 — per-app autosave preference (single global
  // localStorage key, shared with PageTab). Off → 800ms debounce
  // suppressed; ⌘S + Save-button still write.
  const [autosaveOn, toggleAutosave] = useAutosavePreference()
  const autosaveOnRef = useRef(autosaveOn)
  autosaveOnRef.current = autosaveOn
  // Sprint 6 BUG-085 — external-write reconciliation now lives in the shared
  // `useDiskReconciliation` hook (ENH-195 D5): it owns the watcher, the echo
  // gauntlet, the byte-exact baseline, save-pre-reconcile, and the
  // "changed on disk" banner. The hook is wired up below (after `editor`).
  // ENH-117 — view-source overlay state. Snapshot of `getMarkdown()` +
  // frontmatter taken at chord time; the overlay renders read-only.
  const [viewSource, setViewSource] = useState<string | null>(null)
  // Sprint 6 Phase 4 / MISSING-001 — comment thread state. Sidecar
  // lives at `<path>.md.duo.json` and stores comment bodies + the
  // excerpt/context used to re-anchor commentMark on file load.
  // `threadsTick` mirrors the canvas's PageTab tick — bumped on
  // sidecar mutation OR after the file-load re-anchor pass so the
  // builtThreads useMemo recomputes against fresh state.
  const sidecarRef = useRef<SidecarV1>(emptySidecar())
  const sidecarDirtyRef = useRef(false)
  const [threadsTick, setThreadsTick] = useState(0)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  // BUG-138 Phase 4 — Suggesting mode. Mirrors sidecar.suggestingMode
  // but lives in component state so the toolbar re-renders on toggle.
  // Synced on file load + every toggle.
  const [suggestingMode, setSuggestingMode] = useState(false)
  // ENH-221 — file version-history modal ("the richer rewind").
  const [historyOpen, setHistoryOpen] = useState(false)
  const [newCommentAt, setNewCommentAt] = useState<{
    commentId: string
    range: { from: number; to: number }
    excerpt: string
    contextBefore: string
    contextAfter: string
    rect: DOMRect
  } | null>(null)
  // Forward-reference container for handleStartNewComment. The
  // editorActions useMemo (built early to feed the toolbar) needs to
  // call into `handleStartNewComment` which is defined further down
  // in the comment-handlers section. Pointing through a ref keeps the
  // editorActions closure stable while always invoking the latest
  // handler; the ref's `.current` is updated on each render below.
  const startCommentRef = useRef<() => void>(() => {})
  // BUG-138 Phase 4 — forward-ref for the Suggesting toggle (same
  // pattern as startCommentRef — keeps editorActions closures stable
  // while always invoking the latest closure that captures fresh
  // `suggestingMode` state via the useCallback dep array).
  const toggleSuggestingRef = useRef<() => void>(() => {})
  // ENH-023 — find bar visibility. ⌘F opens; ⎋ inside the input
  // closes (handled in FindBar). The extension's storage flips
  // `open` for any callers that need to gate behavior on it (e.g.
  // hiding the comment rail while find is up).
  const [findOpen, setFindOpen] = useState(false)
  // ENH-069 / BUG-186 — toggleable line numbers. Global per-user
  // preference (NOT per-tab) — when set, every markdown editor on
  // every launch shows numbers. Persisted to localStorage. The numbers
  // are the TRUE markdown source line of each top-level block (computed
  // by the LineNumbers plugin), so they match what Claude Code calls
  // "line N". Numbers are sparse — see LineNumbers.ts / globals.css.
  const [lineNumbers, setLineNumbers] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LINE_NUMBERS_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(LINE_NUMBERS_STORAGE_KEY, lineNumbers ? '1' : '0')
    } catch { /* private mode / quota — best-effort */ }
  }, [lineNumbers])

  const hostRef = useRef<HTMLDivElement | null>(null)

  // FOLLOWUP-014 (Sprint 13) — DuoImage NodeView resolves relative
  // image src → blob URL via files.read on mount. Cache holds blob
  // URLs keyed by absPath. Reads latest doc path through the
  // pre-existing pathRef (declared further below alongside the file
  // load effect). Cache lifetime = component lifetime; revokeAll on
  // unmount avoids leaking blob URLs into the renderer's memory.
  const imageBlobCacheRef = useRef<ImageBlobCache>(new ImageBlobCache())
  useEffect(() => {
    const cache = imageBlobCacheRef.current
    return () => {
      cache.revokeAll()
    }
  }, [])

  // Preserved across save cycles; body is what the editor edits.
  const frontmatterRef = useRef<string | null>(null)
  // BUG-139 — state mirror of frontmatterRef so the Properties panel
  // re-renders on change. The ref stays the autoritative source for
  // the save path; this state just gates the panel UI.
  const [frontmatterState, setFrontmatterState] = useState<string | null>(null)
  // BUG-139 — collapsed state for the Properties panel; synced from
  // sidecar.frontmatterPanelCollapsed on load, persists on toggle.
  const [frontmatterCollapsed, setFrontmatterCollapsed] = useState(false)
  const eolRef = useRef<'\n' | '\r\n'>('\n')
  // ENH-195 D5 — the on-disk reconciliation baselines (the serialized-view
  // baseline for the dirty check, the BUG-166 byte-exact baseline for the
  // conflict check, and the BUG-099 recently-written echo set) all moved into
  // `useDiskReconciliation`. The hook is wired up below (after `editor`); the
  // surface reads `recon.getSerializedBaseline()` for its dirty check and
  // calls `recon.noteLoaded` / `noteSaved` / `noteDiskWrite` to advance them.

  // Track the latest path we loaded, so late-arriving reads don't clobber a
  // newer tab open.
  const pathRef = useRef(path)
  pathRef.current = path

  // ENH-221 — set when the next save's content originated from a Duo-mediated
  // agent op (duo doc write/edit on the open buffer). The save reads it to tag
  // the version-history capture 'agent' instead of 'save' (the "who" column),
  // then clears it. User keystrokes leave it false → 'save'.
  const agentWritePendingRef = useRef(false)

  // Track previous isNew so we can detect the new-file commit transition
  // (true \u2192 false) and hand keyboard focus to the prose, per D33f.
  const wasNewRef = useRef<boolean>(!!isNew)
  // D33f regression guard \u2014 when the new-file commit fires, the load
  // effect re-runs (path changed from placeholder to resolved): it sets
  // loaded=false, reads the empty file, calls setContent(''), then
  // setLoaded(true). A queueMicrotask focus call from the D33f effect
  // races that load \u2014 by the time the microtask runs, the prose may be
  // mid-reset and the focus call no-ops or lands at position 0 only to
  // be wiped by the subsequent setContent. Fix: arm a "needs focus"
  // flag here when isNew flips false; consume it inside the load
  // effect's success path AFTER setContent + setLoaded(true) have run.
  const pendingProseFocusRef = useRef<boolean>(false)

  // Sprint 11 — vault index for the suggestion popovers (ENH-096 B.2
  // wikilink autocomplete + ENH-105 `@` mention). Refreshes when the
  // active path moves to a different vault root; manual `refresh()`
  // available for post-create/-delete invalidation. The two extensions
  // below pass `getItems` / `isLoading` closures that read through
  // refs so the useMemo([]) extension list doesn't have to rebuild.
  const vaultIndex = useVaultIndex(path)
  const vaultFilesRef = useRef(vaultIndex.files)
  vaultFilesRef.current = vaultIndex.files
  const vaultLoadingRef = useRef(vaultIndex.loading)
  vaultLoadingRef.current = vaultIndex.loading
  // ENH-208 D4 — vault root threaded through a ref for the same
  // static-extension-list reason as vaultFilesRef above (gates the
  // create row in WikilinkSuggestion). The picker state is the pending
  // stub request: the wikilink target + the post-insert caret rect the
  // popover anchors to; null = closed.
  const vaultRootRef = useRef(vaultIndex.vaultRoot)
  vaultRootRef.current = vaultIndex.vaultRoot
  // ENH-216 (U7) — the active vault's at-rest link mode (D4), threaded
  // through a ref for the same static-extension-list reason as
  // vaultRootRef. The [[ ]] gesture + cmd+click branch on this.
  const vaultModeRef = useRef(vaultIndex.mode)
  vaultModeRef.current = vaultIndex.mode
  // ENH-216 (U7) — stub-picker state now also carries the inserted
  // PLACEHOLDER range (OKF mode only). When the stub is created, the host
  // rewrites that span to a markdown relative link via okfLinkInsert.
  // `range` is null in Obsidian mode (the [[ ]] is already its final form).
  const [stubPicker, setStubPicker] = useState<{
    name: string
    rect: DOMRect | null
    range: { from: number; to: number } | null
  } | null>(null)

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // CodeBlockLowlight replaces StarterKit's codeBlock.
        codeBlock: false,
        // ENH-018 — BulletListWithMarker replaces StarterKit's bulletList
        // so the source marker character (`*`, `-`, `+`) round-trips
        // through save/reopen instead of getting normalized to `-`.
        bulletList: false,
        // BUG-210 — HardBreakWithMarkdown replaces StarterKit's hardBreak so
        // a break inside a table cell serializes as `<br>` (single-line GFM)
        // instead of the `[hardBreak]` placeholder the stock extension emits
        // under `html:false`.
        hardBreak: false,
        // StarterKit's heading defaults to levels [1..6] — leave as-is.
        // Keep history plugin (undo/redo).
      }),
      HardBreakWithMarkdown,
      BulletListWithMarker,
      Underline,
      Link.configure({
        openOnClick: false,
        // ENH-174 (2026-05-23) — autolink OFF. Bare URL-shaped text
        // (`prd.md`, `example.com`, `foo.org/path`) no longer gets
        // auto-converted to a link mark on parse. Closes the disk-
        // mutation half of BUG-155 (the false-positive conflict
        // dialog was patched in normalizeForEchoCompare; this stops
        // the source rewrite at the source). Users still link via
        // ⌘K (LinkPromptModal), direct markdown `[text](url)`, or
        // paste-on-selection (linkOnPaste below — independent path).
        autolink: false,
        linkOnPaste: true,
        // BUG-137 walk-1 follow-up — render the href on each anchor's
        // `title` so hover surfaces the URL as a native tooltip.
        HTMLAttributes: { rel: 'noopener noreferrer', class: 'duo-link' }
      }).extend({
        renderHTML({ HTMLAttributes }) {
          // Same shape as the default Link.renderHTML but with the href
          // copied to a `title` attribute so hover-tooltips show the URL.
          const href = (HTMLAttributes.href as string | undefined) ?? ''
          return ['a', { ...HTMLAttributes, title: href || null }, 0]
        }
      }),
      // BUG-137 — adds the markdown-link input rule (`[text](url)`)
      // + ⌘K keyboard shortcut. Companion to Link.configure above.
      MarkdownLinkShortcuts,
      // FOLLOWUP-014 (Sprint 13) — paste-image v2. DuoImage extends
      // TipTap's Image with a NodeView that resolves relative `src`
      // → blob URL via files.read at mount time. Markdown source
      // stays portable (`![](image-<stamp>.png)`) instead of carrying
      // the renderer-process-scoped blob URLs of v1.
      DuoImage.configure({
        getDocPath: () => pathRef.current,
        cache: imageBlobCacheRef.current
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      // BUG-210 — table serializer that keeps multi-line cells (bullet lists,
      // stacked paragraphs, hard breaks) on a single GFM line via `<br>`.
      TableWithMarkdownCells.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      // BUG-210 — parse-side companion: rehydrate `<br>` inside table cells
      // into real breaks (scoped to cells; prose `<br>` untouched).
      TableCellBrParse,
      TableShortcuts,
      // BUG-108 (Sprint 12) — intercept clipboard text serialization
      // for intra-table selections; without this, tiptap-markdown's
      // serializer falls through to the HTMLNode "[table]" placeholder
      // because slice.content always wraps cell selections in the
      // table node. Higher priority than tiptap-markdown's
      // markdownClipboard plugin so this hook wins for the table case
      // and defers (returns null) otherwise.
      TableCellCopy,
      PersistentSelection,
      JustAdded,
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({ placeholder: 'Start typing — markdown shortcuts work (`# `, `- `, `> `, `**bold**`)…' }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: '-',
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true
      }),
      // BUG-026 — block-aware paste. Higher priority than tiptap-markdown's
      // own clipboard plugin so block-level markdown (headings, lists,
      // fences) lands as structure rather than collapsed-to-code-block.
      MarkdownPaste,
      // ENH-005 — Copy button on every codeBlock. Implemented as a PM
      // widget decoration so the button survives ProseMirror's
      // contentEditable reconciliation.
      CodeBlockCopyButton,
      // ENH-023 — find-in-document. Highlights matches inline +
      // exposes setFindQuery/findNext/findPrev/closeFind commands.
      // FindBar (mounted below) drives it.
      FindHighlight,
      // ENH-025 — ⌘[ / ⌘] outdent / indent for list items.
      // No-op outside a list; bubbles to the global matcher (which
      // doesn't claim plain ⌘[ / ⌘]) so we don't disrupt other
      // surfaces.
      ListIndentShortcuts,
      // BUG-060 — Enter on a paragraph matching `\`\`\`(\w*)$`
      // converts to a codeBlock with that language. Closes the gap
      // where TipTap's built-in input rule only fires on trailing
      // SPACE — users typing the fence + Enter expected the
      // paragraph to convert, but nothing happened.
      FencedCodeBlockEnter,
      // Sprint 6 Phase 4 / MISSING-001 — anchor mark for inline
      // comment threads. Stripped on markdown serialize (html=false
      // above); re-applied on file load by `applyCommentMarksFromSidecar`
      // matching sidecar excerpts back to the parsed doc.
      CommentMark,
      // BUG-138 / Stage 14b — CriticMarkup marks for track-changes
      // + comments. Round-trip via markdownCriticMarkup.ts at the
      // setContent / serialize boundaries (wired below).
      InsertionMark,
      DeletionMark,
      HighlightMark,
      // BUG-138 Phase 4b/4c — auto-wrap intercept. The extension's
      // storage flags (enabled + getAuthor) get updated below on
      // every render so changes flow through without a remount.
      SuggestingMode,
      // ENH-096 (B1) — Wikilink decoration plugin. Recognizes
      // `[[Page Name]]` patterns in the doc and renders them as
      // styled clickable spans. cmd+click fires `duo-wikilink-open`
      // CustomEvent — App.tsx resolves the target against the vault
      // root and opens the linked file. The markdown source stays
      // verbatim; tiptap-markdown round-trips `[[…]]` literals through
      // save without touching them.
      WikilinkDecorations,
      // Sprint 11 ENH-096 (B.2) — autocomplete on `[[`. Pops the
      // SuggestionPopover anchored at caret, fuzzy matches against
      // the vault index. Inserts `[[<basename>]]`. Closes the v0.6.8
      // owner directive ("we only have half a feature"). Reads the
      // vault file list through a ref so the `useMemo([])` extension
      // list doesn't need to rebuild when the index updates.
      WikilinkSuggestion.configure({
        getItems: () => vaultFilesRef.current,
        isLoading: () => vaultLoadingRef.current,
        rank: rankVaultFiles,
        // ENH-208 D4 — the create row needs the vault root (gates the
        // offer) and a way to hand the inserted name + caret rect to
        // the TypePickerPopover. setStubPicker is a stable useState
        // setter, safe to close over in this useMemo([]) list; the
        // root reads through the ref so it stays fresh.
        getVaultRoot: () => vaultRootRef.current,
        // ENH-216 (U7) — mode + doc path gate the OKF expand-on-resolve
        // (D3). Both read through refs so the static list stays stable.
        getMode: () => vaultModeRef.current,
        getDocPath: () => pathRef.current,
        onCreateStub: (payload) => setStubPicker(payload)
      }),
      // Sprint 11 ENH-105 — `@` filename autocomplete. Same vault
      // index, parallel popover. Obsidian inserts `[[wikilink]]`; OKF
      // (ENH-216 D3) inserts a standard markdown relative link.
      AtMention.configure({
        getItems: () => vaultFilesRef.current,
        isLoading: () => vaultLoadingRef.current,
        rank: rankVaultFiles,
        getMode: () => vaultModeRef.current,
        getDocPath: () => pathRef.current
      }),
      // BUG-186 — source-line-number gutter. Computes the true markdown
      // source line for each top-level block (via the save serializer)
      // and renders it through globals.css. Enabled state is driven by
      // the `lineNumbers` toggle below via a plugin meta transaction, so
      // this static extension list never rebuilds.
      LineNumbers
    ],
    []
  )

  // ── Load file ────────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: 'duo-editor-prose focus:outline-none',
        spellcheck: 'true'
      },
      // Preventative kb-shortcut architecture (BUG-014). Capture-phase
      // listener at document level normally fires before TipTap, but
      // ProseMirror has its own keymap that can claim some keys before
      // bubbling. Returning `false` from handleKeyDown lets ProseMirror
      // still process the event for editor-local shortcuts (⌘B/⌘I/⌘U
      // for marks); we only short-circuit when the shared matcher
      // identifies the key as a global shortcut.
      handleKeyDown: (_view, e) => {
        // ENH-002 (v0.3.1) — ⌘⇧V / ⌃⇧V → paste-as-plain-text.
        // Editor-local shortcut (no global meaning), so handled here
        // rather than via the global shortcut registry. Reads the
        // clipboard's text/plain via the async API and inserts via
        // TipTap's content-insertion command, which composes with
        // the editor's undo stack and markdown serializer.
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
          e.preventDefault()
          void navigator.clipboard.readText().then((text) => {
            if (text) editor?.commands.insertContent(text)
          }).catch((err) => {
            console.warn('[duo-editor-paste] readText failed:', err)
          })
          return true
        }

        // ENH-221 / v0.11.2 fix — pass inAnyTextInput:true. The editor IS a
        // text-input surface, so chords gated on it (notably ENH-179's ⌘Z
        // reopen-last-closed-tab) must DEFER to the editor's own handling.
        // Omitting it made ⌘Z match reopen here → `return true` → ProseMirror's
        // undo keymap never ran (the live "can't undo" the owner hit: undo
        // button + ⌘⇧Z worked, ⌘Z dead). The document capture-phase listener
        // already computes inAnyTextInput correctly; this mirrors it.
        const match = matchGlobalShortcut(e, { inEditableSurface: true, inAnyTextInput: true })
        if (match) {
          // Don't let ProseMirror also act on it. The document
          // capture-phase listener has already fired and dispatched
          // the action, so we just prevent local handling.
          return true
        }
        return false
      },
      // ENH-216 (U7) — cmd/ctrl+click on a standard markdown link mark
      // (`[Display](./rel.md)`, the OKF at-rest link shape) follows the
      // link. Resolves the relative href against the doc path to an
      // ABSOLUTE target and dispatches the existing `duo-wikilink-open`
      // event with a pre-resolved `resolvedPath` so App.tsx short-circuits
      // its vault-walk. External / anchor-only hrefs return null (handled
      // natively by the Link extension's openOnClick:false, i.e. inert).
      // The `[[ ]]` wikilink cmd+click stays owned by WikilinkDecorations.
      handleClickOn: (_view, _pos, _node, _nodePos, event, _direct) => {
        const me = event as MouseEvent
        if (!(me.metaKey || me.ctrlKey)) return false
        // Walk up from the click target to the anchor carrying the href.
        const targetEl = me.target instanceof Element
          ? me.target
          : (me.target as Node | null)?.parentElement ?? null
        const anchor = targetEl?.closest?.('a[href]') as HTMLAnchorElement | null
        const href = anchor?.getAttribute('href')
        if (!href) return false
        const resolved = resolveMdLinkInVault(href, pathRef.current)
        if (!resolved) return false   // external / anchor-only — leave inert
        window.dispatchEvent(
          new CustomEvent('duo-wikilink-open', {
            detail: { target: href, resolvedPath: resolved }
          })
        )
        event.preventDefault()
        return true
      },
      // ENH-108 (Sprint 12) — paste-image. ⌘V (or drag-drop, see
      // handleDrop below) with image data on the clipboard saves the
      // image alongside the active doc and inserts a markdown link at
      // caret. Closes the workflow gap: today users save-to-Desktop →
      // drag-to-Finder → markdown-link-by-hand. After: ⌘V "just works."
      // Untitled files (isNew) bail with a console warning — saving an
      // image beside a non-existent doc has no obvious target.
      handlePaste: (_view, event) => {
        const cb = event.clipboardData
        if (!cb) return false
        const items = Array.from(cb.items)
        // ENH-108 image / ENH-128 HEIC-RAW / ENH-129 PDF — accept any
        // of: image/* / a CONVERT_MIMES entry / application/pdf.
        // Walk-1 fix — also accept files where type is empty but the
        // extension matches (HEIC / RAW often have empty file.type in
        // Electron / Chromium).
        const file = items
          .map(it => it.kind === 'file' ? it.getAsFile() : null)
          .find((f): f is File => {
            if (!f) return false
            if (f.type.startsWith('image/') || CONVERT_MIMES.has(f.type) || f.type === PDF_MIME) return true
            const inferred = inferMimeFromName(f.name, '')
            return inferred.startsWith('image/') || CONVERT_MIMES.has(inferred) || inferred === PDF_MIME
          })
        if (!file) return false
        if (isNew) {
          console.warn('[ENH-108] paste asset into untitled doc — save the doc first so we know where to put it')
          return false
        }
        event.preventDefault()
        void handleAssetPaste(file, path, editor)
        return true
      },
      // ENH-108 (Sprint 12) — drag-drop image parity. Same handler as
      // paste; just routes through dataTransfer instead of clipboardData.
      // ENH-128 / ENH-129 (Sprint 14) extend to HEIC + PDF.
      handleDrop: (view, event) => {
        const dt = event.dataTransfer
        if (!dt) return false
        // Walk-2 fix — switched from `dt.files` to `dt.items`. Native
        // macOS drags from Finder / Photos.app populate `dt.items` (each
        // with kind='file' + getAsFile()), but `dt.files` is often empty
        // for these drags (browser API quirk). Using items mirrors
        // handlePaste's pattern + makes HEIC drops from Finder actually
        // fire. Pre-walk-2 the dt.files path silently no-op'd.
        const items = Array.from(dt.items)
        const file = items
          .map(it => it.kind === 'file' ? it.getAsFile() : null)
          .find((f): f is File => {
            if (!f) return false
            if (f.type.startsWith('image/') || CONVERT_MIMES.has(f.type) || f.type === PDF_MIME) return true
            const inferred = inferMimeFromName(f.name, '')
            return inferred.startsWith('image/') || CONVERT_MIMES.has(inferred) || inferred === PDF_MIME
          })
        if (!file) return false
        if (isNew) {
          console.warn('[ENH-108] drop asset into untitled doc — save the doc first')
          return false
        }
        event.preventDefault()
        // Walk-2 fix (ENH-129) — extract drop position from client coords
        // so the asset inserts AT the drop point, not at the prior caret
        // location. Pre-fix `editor.chain().focus().insertContent(...)`
        // restored caret to its last-known position (often doc end), so
        // dragging a PDF to the middle of a long doc inserted the link
        // at the bottom. Copy-paste worked because clipboard inserts
        // happen at the active selection naturally.
        const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null
        void handleAssetPaste(file, path, editor, dropPos)
        return true
      }
    },
    // Content is set after the async file read lands.
    content: ''
  }, [path])

  // 17a polish item 3 — adapt the TipTap editor to the surface-agnostic
  // EditorActions interface the shared toolbar consumes. `toolbarVersion`
  // is bumped on every selectionUpdate / update so the toolbar re-renders
  // and re-reads `actions.isActive(...)` / `currentBlock()` etc. (replaces
  // the previous TipTap-specific `useEditorState` subscription).
  const editorActions: EditorActions = useMemo(
    () => editor
      ? buildTiptapEditorActions(editor, {
          // Sprint 6 Phase 4 — toolbar Comment button. canStartComment
          // is queried on every toolbar render (driven by toolbarVersion
          // bumps below); the closure reads the live selection
          // directly so the enabled state stays in sync. startComment
          // routes through `startCommentRef.current` which the comment
          // handlers section keeps pointed at the latest closure.
          startComment: () => startCommentRef.current(),
          canStartComment: () => {
            const sel = editor.state.selection
            return sel.from !== sel.to
          },
          // BUG-138 Phase 4 — Suggesting mode toggle. Read by the
          // toolbar on every render via `actions.suggestingOn`.
          // suggestingMode state changes trigger a re-render of this
          // component, which rebuilds editorActions through this
          // useMemo (suggestingMode is in the dep array).
          suggestingOn: suggestingMode,
          toggleSuggesting: () => toggleSuggestingRef.current()
        })
      : NULL_ACTIONS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, suggestingMode]
  )
  const [toolbarVersion, setToolbarVersion] = useState(0)
  useEffect(() => {
    if (!editor) return
    const bump = () => setToolbarVersion(v => v + 1)
    editor.on('selectionUpdate', bump)
    editor.on('update', bump)
    editor.on('transaction', bump)
    return () => {
      editor.off('selectionUpdate', bump)
      editor.off('update', bump)
      editor.off('transaction', bump)
    }
  }, [editor])

  // ENH-002 / v0.4.0 — Edit menu "Paste and Match Style" handler.
  // Editor-local ⌘⇧V already does this via handleKeyDown above; this
  // adds the menu-item path so the keystroke isn't the only entry
  // point. Only fire when this editor has keyboard focus (the
  // canvas's listener does the same; whichever editor owns focus
  // reacts).
  useEffect(() => {
    if (!editor) return
    return window.electron.appMenu.onPastePlainRequest(() => {
      if (!editor.isFocused) return
      void navigator.clipboard.readText().then(text => {
        if (text) editor.commands.insertContent(text)
      }).catch(err => {
        console.warn('[duo-editor-paste] readText failed:', err)
      })
    })
  }, [editor])

  // ENH-195 — forward-ref to save() (defined far below) so the reconciliation
  // hook can kick a save on "Keep mine" without a hook→save import cycle.
  const saveRef = useRef<() => void>(() => {})

  // ENH-195 B4 / D3 — "file removed on disk" + ">50%-of-doc reloaded" strips.
  const [fileRemoved, setFileRemoved] = useState(false)
  const [reloadedFlash, setReloadedFlash] = useState(false)
  // ENH-216 (U7) — best-effort "a note may have moved" info toast (OKF
  // mode only). Non-blocking + dismissible; surfaces when the shared
  // reconciliation hook's debounced move-detection fires. Informational
  // only — links repair on the next vault open or via `duo vault relink`.
  const [likelyMoved, setLikelyMoved] = useState(false)
  // ENH-195 / v0.9.0 — the user's doc captured the instant BEFORE a destructive
  // external reload, so the reload banner's "Keep mine" / "View diff" can recover
  // or diff it. Set in applyReload; read by the banner handlers below.
  const preReloadDocRef = useRef<PMNode | null>(null)

  // ENH-195 D5 — the shared editor↔disk reconciliation primitive. Owns the
  // chokidar watcher, the echo gauntlet, the byte-exact baseline,
  // save-pre-reconcile, and the "changed on disk" banner. This surface injects
  // only its editing contract (serialize / reload + the D3 change-highlight /
  // frontmatter split / dirty).
  const recon = useDiskReconciliation({
    path,
    isNew: !!isNew,
    surface: 'markdown',
    ready: !!editor && loaded,
    serialize: () => (editor ? serializeWithCriticMarkup(editor) : ''),
    // PURE — beforeSave's pre-reconcile calls this; a side effect here would
    // clobber the user's in-progress frontmatter on save (ENH-195 regression
    // caught in review). Frontmatter adoption happens in applyReload instead.
    readDiskBody: (raw) => splitFrontmatter(raw).body,
    applyReload: (diskBody, rawText) => {
      if (!editor) return
      // Adopt the reloaded file's frontmatter/eol (this is the ONLY place that
      // re-derives them on an external reload, now that readDiskBody is pure).
      const s = splitFrontmatter(rawText)
      frontmatterRef.current = s.frontmatter
      setFrontmatterState(s.frontmatter)
      eolRef.current = s.eol
      const oldDoc = editor.state.doc
      preReloadDocRef.current = oldDoc   // for the reload banner's Keep-mine / View-diff
      editor.commands.setContent(preprocessSubstitutions(diskBody), false)
      applyCriticMarkupFromText(editor)
      applyCommentMarksFromSidecar(editor, sidecarRef.current)
      setThreadsTick(v => v + 1)
      // ENH-195 D3 — paint what changed (markdown only; canvas → ENH-196).
      try {
        const diff = computeReloadDiff(oldDoc, editor.state.doc)
        if (diff.changedFraction > 0.5) {
          // Destructive reload — most of the doc changed. Surface the recovery
          // banner (Keep mine / Load new / View diff) and let it PERSIST until
          // the user picks (no auto-dismiss — it carries actions now).
          setReloadedFlash(true)
        } else {
          for (const r of diff.inserted) editor.commands.markJustAddedPersist(r.from, r.to)
          for (const pos of diff.deletedAt) editor.commands.markDeletedAtPersist(pos)
        }
      } catch { /* highlight is best-effort chrome — never block a reload */ }
    },
    isDirty: (live, baseline) => live !== baseline,
    echoEqual: (a, b) => normalizeForEchoCompare(a) === normalizeForEchoCompare(b),
    onDirtyChange: (d) => setDirty(d),
    onFileRemoved: setFileRemoved,
    // ENH-216 (U7) — best-effort move detection. Only surface the info
    // toast in OKF mode (markdown rel links don't survive moves; Obsidian
    // wikilinks resolve by basename so a move is harmless). Read the mode
    // through the ref so this stable callback sees the live value.
    onLikelyMove: () => {
      // PR#98 F24 — a detected move SUPERSEDES the B4 "file removed" strip:
      // clear it so the editor shows ONE affordance (the more-accurate move
      // toast), not two stacked. B4's "Save to recreate it" would also
      // mis-advise here — saving recreates a stale orphan at the old path.
      if (vaultModeRef.current === 'okf') {
        setFileRemoved(false)
        setLikelyMoved(true)
      }
    },
    rebaselineAfterReload: true,
    triggerSave: () => { void saveRef.current() },
    appVersion: window.electron?.env?.appVersion ?? '?.?.?',
    watchOptions: { ignored: [], watchParents: true },
  })

  // ENH-195 / v0.9.0 — destructive-overwrite reload banner actions. A reload
  // where >50% of the doc changed leaves `reloadedFlash` set + the pre-reload
  // doc in `preReloadDocRef`. The banner (rendered far below) offers three:
  const handleReloadKeepMine = useCallback(() => {
    const old = preReloadDocRef.current
    setReloadedFlash(false)
    if (!editor || !old) return
    editor.commands.setContent(old.toJSON(), false)   // restore the user's pre-reload version
    setDirty(true)
    void saveRef.current()                            // re-persist it (re-overwrites the external change)
  }, [editor])

  const handleReloadLoadNew = useCallback(() => {
    setReloadedFlash(false)                           // keep the disk version (already loaded)
  }, [])

  const handleReloadViewDiff = useCallback(() => {
    const old = preReloadDocRef.current
    setReloadedFlash(false)
    if (!editor || !old) return
    // Rebuild the doc as tracked changes (struck old + inserted new); the
    // SuggestingBanner (Accept all = disk · Reject all = yours) + inline marks
    // let the user resolve it. Dirty until resolved + saved.
    applyTrackedDiff(editor, old, { author: authorOrLegacy, ts: new Date().toISOString() })
    setDirty(true)
  }, [editor, authorOrLegacy])

  // ENH-202 — "View diff" on the DIRTY-buffer conflict banner. Unlike the
  // destructive-overwrite case (already reloaded to disk), here the editor still
  // holds the user's UNSAVED edits. Capture them, swap in the disk content (same
  // content/frontmatter/criticmarkup steps as applyReload, minus the highlight/
  // destructive-flash chrome), then rebuild as accept/rejectable tracked changes:
  // your text struck → disk text inserted (Accept-all = disk, Reject-all = yours).
  const handleConflictViewDiff = useCallback(() => {
    const conflict = recon.externalConflict
    if (!editor || !conflict) return
    const old = editor.state.doc                       // the user's unsaved doc
    const s = splitFrontmatter(conflict.rawText)
    frontmatterRef.current = s.frontmatter
    setFrontmatterState(s.frontmatter)
    eolRef.current = s.eol
    editor.commands.setContent(preprocessSubstitutions(conflict.diskBody), false)
    applyCriticMarkupFromText(editor)
    applyCommentMarksFromSidecar(editor, sidecarRef.current)
    setThreadsTick(v => v + 1)
    applyTrackedDiff(editor, old, { author: authorOrLegacy, ts: new Date().toISOString() })
    setDirty(true)
    recon.dismissConflict(conflict.diskBody)           // clear banner + baselines = disk
  }, [editor, recon, authorOrLegacy])

  useEffect(() => {
    if (!editor) return
    let cancelled = false
    setError(null)
    setLoaded(false)
    setDirty(false)

    // D33f — if the user just committed a new-file's name, hand focus to
    // the prose AFTER setContent + setLoaded(true) have run. requestAnimationFrame
    // (not queueMicrotask) gives React a tick to commit the post-load
    // render so the prose's contenteditable is fully reachable.
    const consumePendingFocus = () => {
      if (!pendingProseFocusRef.current) return
      pendingProseFocusRef.current = false
      requestAnimationFrame(() => {
        if (cancelled) return
        editor.commands.focus('end')
      })
    }

    // New-file mode: don't try to read disk, the file doesn't exist yet.
    // Editor stays empty until the user commits a filename.
    // ENH-195 — the recently-written echo set + the byte-exact baseline reset
    // on path change inside `useDiskReconciliation` (its [path] effect).
    if (isNew) {
      frontmatterRef.current = null
      setFrontmatterState(null)
      setFrontmatterCollapsed(false)
      eolRef.current = '\n'
      editor.commands.setContent('', false)
      setLoaded(true)
      // No-op for the initial mount where we just entered new-file mode.
      // Consumed only on the post-commit re-run when isNew is finally false.
      consumePendingFocus()
      return () => { cancelled = true }
    }

    // Sprint 6 Phase 4 — reset sidecar state up-front so a stale
    // sidecar from the previously-open file doesn't leak across the
    // path change. The async read below re-populates.
    sidecarRef.current = emptySidecar()
    sidecarDirtyRef.current = false
    setActiveThreadId(null)
    setNewCommentAt(null)

    // BUG-138 Phase 2 — read the sidecar AND the body together. The
    // sidecar→inline migration (if eligible) needs both before deciding
    // whether to splice CriticMarkup tokens into the body. Pre-Phase-2
    // these ran in parallel with the body rendering immediately and the
    // sidecar layering marks in when it resolved, but the migration is
    // a body-mutating step that must happen BEFORE setContent.
    Promise.all([
      window.electron.files.read(path),
      readSidecar(path)
    ]).then(
      ([res, sc]) => {
        if (cancelled || pathRef.current !== path) return
        const text = decodeUtf8(res.bytes)
        const split = splitFrontmatter(text)
        frontmatterRef.current = split.frontmatter
        eolRef.current = split.eol

        const initialSidecar = sc ?? emptySidecar()

        // BUG-138 Phase 2 — silent auto-migrate sidecar comments to
        // inline CriticMarkup when the body has no CM tokens yet.
        // Locked decisions (BUG-138 playground Q5+Q6): silent migration
        // on first load; read-both-until-touched. The body we hand to
        // setContent below is the migrated form; the sidecar gets
        // rewritten with successfully-migrated entries removed.
        const migration = migrateSidecarCommentsToInline(split.body, initialSidecar)
        if (migration.migrated > 0) {
          console.info(
            `[duo-md] migrated ${migration.migrated} sidecar comment thread(s) to inline CriticMarkup` +
            (migration.orphans > 0 ? ` (${migration.orphans} orphan(s) kept in sidecar)` : '')
          )
        } else if (migration.orphans > 0) {
          console.warn(`[duo-md] ${migration.orphans} sidecar comment(s) could not be re-anchored; kept as orphans`)
        }
        sidecarRef.current = migration.sidecar
        // BUG-207 — Suggesting state now lives in per-path localStorage
        // (docUiPrefs), not the sidecar. One-time migration fallback: if
        // the per-path pref is unset but a legacy sidecar carried the flag,
        // honor it (and forward it) so existing users don't lose the choice.
        {
          const stored = readSuggestingPref(path)
          const legacy = migration.sidecar.suggestingMode === true
          const effective = stored ?? legacy
          setSuggestingMode(effective)
          if (stored === null && legacy) writeSuggestingPref(path, true)
        }
        // BUG-139 v1.1 / BUG-207 — Properties-panel collapse now lives in
        // per-path localStorage. Q4 default stays COLLAPSED when unset
        // (true). A legacy sidecar `frontmatterPanelCollapsed === false`
        // (user explicitly expanded) migrates forward.
        {
          const stored = readFrontmatterCollapsedPref(path)
          const legacyExpanded = migration.sidecar.frontmatterPanelCollapsed === false
          const effective = stored ?? !legacyExpanded
          setFrontmatterCollapsed(effective)
          if (stored === null && legacyExpanded) writeFrontmatterCollapsedPref(path, false)
        }
        setFrontmatterState(split.frontmatter)

        // Second-arg `false` suppresses an update event so the initial load
        // doesn't count as a user edit.
        editor.commands.setContent(preprocessSubstitutions(migration.body), false)

        // BUG-138 Phase 1b — convert CriticMarkup tokens in the loaded
        // body to TipTap marks. Must run BEFORE the markdown-baseline
        // capture so the baseline reflects the marked state (otherwise
        // the next serialize would re-emit CM tokens AND the post-
        // tokenized body would diff against the raw-token baseline,
        // producing a spurious dirty state).
        applyCriticMarkupFromText(editor)

        // ENH-195 — seed the reconciliation baselines: the serializer's view
        // of the loaded doc (round-trip-stable, for the dirty check) + the raw
        // disk body (byte-exact, for the conflict check). Markdown round-trip
        // isn't byte-exact (list markers, whitespace), so the serialized view
        // avoids a spurious "dirty" the instant the user types one character.
        recon.noteLoaded(serializeWithCriticMarkup(editor), split.body)

        // Re-apply comment marks for any sidecar entries that didn't
        // migrate (orphans, or — pre-Phase-2 — when migration was
        // skipped because the body already had CM tokens). Idempotent;
        // the load-side applyCriticMarkupFromText pass already stamped
        // marks for the inline-migrated comments.
        applyCommentMarksFromSidecar(editor, sidecarRef.current)
        setThreadsTick(v => v + 1)

        // BUG-138 Phase 2 — flush the migration to disk. Write the
        // migrated body back to the .md file AND the cleared sidecar
        // back to .duo.json. Run async after the editor is set up;
        // failure to persist isn't catastrophic (re-runs on next load).
        if (migration.bodyChanged) {
          const migratedFullText = joinFrontmatter(frontmatterRef.current, migration.body, eolRef.current)
          // ENH-195 — disk now holds the migrated body (not `split.body`):
          // advance the byte-exact baseline + echo set so the migration
          // write's own watcher event is recognized and the first real save's
          // fast-path matches. The serialized baseline (seeded above) is left.
          recon.noteDiskWrite(migration.body)
          void window.electron.files
            .write(path, encodeUtf8(migratedFullText))
            .then(() => {
              if (cancelled) return
              if (migration.sidecarChanged) {
                return writeSidecar(path, migration.sidecar)
              }
            })
            .catch((err) => {
              console.warn('[duo-md] failed to persist sidecar→inline migration:', err)
            })
        }

        setLoaded(true)
        consumePendingFocus()
      },
      (err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoaded(true)
      }
    )
    return () => { cancelled = true }
  }, [path, editor, isNew])

  // ENH-195 D5 — the external-write watcher + conflict-banner resolution
  // handlers moved into `useDiskReconciliation` (wired above the load
  // effect). The banner renders from `recon.externalConflict` with
  // `recon.resolveReload` / `recon.resolveKeepMine`.

  // ── Save ─────────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!editor) return
    if (saving) return

    // Pull current body markdown from tiptap-markdown storage.
    const body = serializeWithCriticMarkup(editor)
    const bodyChanged = body !== recon.getSerializedBaseline()
    if (!bodyChanged && !dirty && !sidecarDirtyRef.current) return

    setSaving(true)
    try {
      // ENH-195 — pre-save reconcile through the shared hook: if disk
      // drifted externally since our baseline it surfaces the banner and
      // we bail; otherwise it registers the echo (so our own write isn't
      // misread), then we write and advance both baselines.
      if (bodyChanged) {
        // BUG-210 — backstop: never persist a body where a table lost rows to
        // a serialization shatter. The TableWithMarkdownCells serializer keeps
        // rows single-line, so this should never trip; if it ever does (an
        // unhandled block-in-cell case, a future regression) we surface an
        // error and keep the on-disk file intact rather than corrupt it.
        if (!tableRowsSurviveSerialize(editor, body)) {
          setSaveError('Save blocked: a table would be corrupted by this change. Please report this file (BUG-210).')
          return
        }

        if ((await recon.beforeSave(body)) === 'conflict') return

        const full = joinFrontmatter(frontmatterRef.current, body, eolRef.current)
        const bytes = encodeUtf8(full)
        // ENH-221 — tag the history capture 'agent' when this save carries
        // agent-applied content; consume the flag so the next user edit is 'save'.
        const historySource = agentWritePendingRef.current ? 'agent' : 'save'
        agentWritePendingRef.current = false
        await window.electron.files.write(path, bytes, { historySource })
        recon.noteSaved(body)
      }

      // Sprint 6 Phase 4 — refresh + persist the sidecar. Refresh
      // happens on EVERY save (even body-only changes) so each
      // comment's excerpt + context tracks the latest text — that's
      // what the next reopen's re-anchor pass keys off. Write only
      // when the sidecar is actually dirty (avoids a no-op write
      // every body save).
      const refreshed = refreshSidecarFromDoc(editor.state.doc, sidecarRef.current)
      if (refreshed !== sidecarRef.current) {
        sidecarRef.current = refreshed
        sidecarDirtyRef.current = true
      }
      if (sidecarDirtyRef.current) {
        await writeSidecar(path, sidecarRef.current)
        sidecarDirtyRef.current = false
      }

      setDirty(false)
      onDirtyChange?.(false)
      // Sprint 10 ENH-103 — successful save clears the pill's
      // "Failed — retry" state.
      setSaveError(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [editor, path, saving, dirty, onDirtyChange])

  // ── Dirty tracking + autosave ────────────────────────────────────────────
  // ENH-195 — saveRef declared above the reconciliation hook; keep fresh.
  saveRef.current = save

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // BUG-033 v1 (a) — block autosave while a pending agent write is on
  // screen. We can't use the React state directly inside the change
  // handler (closure staleness), so route through a ref that the
  // setPendingWrite effect updates.
  const blockAutosaveRef = useRef(false)

  useEffect(() => {
    if (!editor) return

    const handler = () => {
      if (!loaded) return
      const body = serializeWithCriticMarkup(editor)
      const isDirty = body !== recon.getSerializedBaseline()
      setDirty(isDirty)
      // Sprint 10 ENH-103 — clear any prior save-failure indicator on
      // the next edit; the pill returns to plain "Save" so the user
      // doesn't see a stale red state while still typing.
      if (isDirty) setSaveError(null)
      // Sprint 10 ENH-104 — autosave-off suppresses the 800ms timer
      // path. ⌘S + Save-button + unmount-flush still fire (autosave
      // is about latency in steady-state, not data preservation on
      // tab close). Read through ref so closure capture stays fresh.
      if (isDirty && !blockAutosaveRef.current && autosaveOnRef.current) {
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = setTimeout(() => {
          autosaveTimerRef.current = null
          void saveRef.current()
        }, AUTOSAVE_DEBOUNCE_MS)
      }
    }

    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [editor, loaded])

  // Propagate dirty up in its own effect — never inside setState or render,
  // which would cross-update the parent component and trigger React's
  // setState-during-render warning.
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // D33f \u2014 when a new-file tab transitions from naming to edit mode, arm
  // a pending-focus flag. The actual `editor.commands.focus()` call lives
  // in the load effect's success path (below) so it runs AFTER the
  // resolved-path read + setContent + setLoaded(true) have all settled.
  // Doing it inline with `queueMicrotask` here races the load effect's
  // setContent('', false) on the same render tick \u2014 the prior bug.
  useEffect(() => {
    const wasNew = wasNewRef.current
    wasNewRef.current = !!isNew
    if (wasNew && !isNew) {
      pendingProseFocusRef.current = true
    }
  }, [isNew])

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

  // ── Selection push (for `duo selection`) ────────────────────────────────
  // Also drives the Stage 15.1 Send → Duo pill: we cache the latest
  // selection snapshot AND the selection's screen rect so the pill
  // can mount portaled to document.body without re-reading editor
  // state on every render.
  const [pillRect, setPillRect] = useState<DOMRect | null>(null)
  const lastSelectionRef = useRef<EditorSelectionSnapshot | null>(null)
  const { format: selectionFormat } = useSelectionFormat()

  useEffect(() => {
    if (!editor || isNew) return

    const computeRect = (): DOMRect | null => {
      // Hide the pill when the editor doesn't have DOM focus —
      // selection persists for `duo selection` reads (Stage 11 D29c)
      // but the visible affordance shouldn't follow the user out of
      // the editor.
      if (!editor.isFocused) return null
      const { from, to } = editor.state.selection
      if (from === to) return null
      // ProseMirror gives us the DOM range backing the selection.
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      // Some collapsed-but-not-collapsed states (e.g. just after
      // double-click selecting an empty span) report 0×0 rects.
      if (rect.width === 0 && rect.height === 0) return null
      return rect
    }

    const pushSnapshot = () => {
      const snapshot = computeSelectionSnapshot(editor, path)
      lastSelectionRef.current = snapshot
      window.electron.editor?.pushSelection(snapshot)
      setPillRect(computeRect())
    }

    pushSnapshot()
    editor.on('selectionUpdate', pushSnapshot)
    editor.on('focus', pushSnapshot)
    editor.on('blur', pushSnapshot)
    editor.on('update', pushSnapshot)

    // Also reposition the pill on scroll / resize — selection rect is
    // viewport-relative.
    const onLayout = () => setPillRect(computeRect())
    window.addEventListener('scroll', onLayout, true)
    window.addEventListener('resize', onLayout)

    return () => {
      editor.off('selectionUpdate', pushSnapshot)
      editor.off('focus', pushSnapshot)
      editor.off('blur', pushSnapshot)
      editor.off('update', pushSnapshot)
      window.removeEventListener('scroll', onLayout, true)
      window.removeEventListener('resize', onLayout)
      // Clear the cache when this editor unmounts so `duo selection`
      // can't return stale data after the user closed/switched the tab.
      window.electron.editor?.pushSelection(null)
      setPillRect(null)
      lastSelectionRef.current = null
    }
  }, [editor, path, isNew])

  // Click handler — format the cached snapshot and hand it to the host.
  // Tagged with the discriminant so future surfaces can branch on kind.
  const handleSendToDuoClick = useCallback(() => {
    if (!onSendToDuo) return
    const snap = lastSelectionRef.current
    if (!snap) return
    const payload = formatSendPayload({ kind: 'editor', ...snap }, selectionFormat)
    onSendToDuo(payload)
    // Pill self-hides on click per PRD G1. The selection remains
    // intact (Stage 11 D29c) so the user can re-select-and-send if
    // they want; the pill reappears as soon as a new selectionUpdate
    // fires.
    setPillRect(null)
  }, [onSendToDuo, selectionFormat])

  // Stage 15.3 — ⌘D listener. The global shortcut matcher fires a
  // CustomEvent; each surface that hosts a Send → Duo pill subscribes
  // and runs its own pill-click handler. Only one editor is mounted
  // at a time, so the listener is unambiguous; we still gate on a
  // non-null pillRect so a chord with no active selection no-ops
  // cleanly instead of sending an empty payload.
  useEffect(() => {
    const handler = () => {
      if (!lastSelectionRef.current) return
      handleSendToDuoClick()
    }
    window.addEventListener('duo-send-to-duo', handler)
    return () => window.removeEventListener('duo-send-to-duo', handler)
  }, [handleSendToDuoClick])

  // ── Comment threads (Sprint 6 Phase 4 / MISSING-001) ──────────────────────

  /** Build threads off the live ProseMirror doc + the sidecar. The
   *  unified rail consumes BuiltMarkdownThread directly (range.from
   *  feeds the document-order sort). Recomputed on every threadsTick
   *  bump (sidecar mutation, file load, mark application). */
  const builtThreads = useMemo(() => {
    if (!editor) return []
    return buildMarkdownThreads(editor.state.doc, sidecarRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadsTick, editor])

  /** BUG-138 Phase 4d — count of tracked-change marks (insert / delete
   *  / highlight) in the doc. Drives the SuggestingBanner's mount.
   *  Recomputes on every toolbarVersion bump (which fires on
   *  selectionUpdate + update — i.e. any time the doc could have
   *  changed). */
  const trackedChangesCount = useMemo(() => {
    if (!editor) return 0
    return countTrackedChanges(editor.state.doc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolbarVersion, editor])

  /** BUG-138 Phase 4e — full collected list of tracked-change ranges
   *  for the rail. Same toolbarVersion gate as the count above. */
  const trackedChangesList = useMemo<TrackedRange[]>(() => {
    if (!editor) return []
    return collectTrackedChanges(editor.state.doc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolbarVersion, editor])

  /** Scroll the editor to a track-change range. Same pattern as
   *  scrollToCommentAnchor but for ins/del/highlight ranges. */
  const handleJumpToTrackedChange = useCallback((range: TrackedRange) => {
    if (!editor) return
    const view = editor.view
    const dom = view.domAtPos(range.from)
    const node = dom.node.nodeType === 1
      ? (dom.node as HTMLElement)
      : (dom.node.parentElement as HTMLElement | null)
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [editor])

  /** Persist a sidecar mutation through the same autosave path as
   *  body edits. Mirrors PageTab's persistSidecarMutation. */
  const persistSidecarMutation = useCallback((next: SidecarV1) => {
    sidecarRef.current = next
    sidecarDirtyRef.current = true
    setThreadsTick(v => v + 1)
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      void saveRef.current()
    }, AUTOSAVE_DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** BUG-138 Phase 4 — flip the Suggesting mode flag in the sidecar
   *  and the local state mirror. Triggered by the toolbar button OR
   *  the ⌘⌥T chord. */
  const toggleSuggestingMode = useCallback(() => {
    const next = !suggestingMode
    setSuggestingMode(next)
    // BUG-207 — persist to per-path localStorage, not the sidecar, so an
    // otherwise-empty note never spawns a `<file>.duo.json` sidecar.
    writeSuggestingPref(pathRef.current, next)
  }, [suggestingMode])

  /** BUG-139 — commit a Properties-panel edit. Updates the
   *  frontmatter ref + state mirror, marks the editor dirty, and
   *  schedules an autosave. `next === null` clears the frontmatter
   *  block entirely. */
  const handleFrontmatterChange = useCallback((next: string | null) => {
    frontmatterRef.current = next
    setFrontmatterState(next)
    setDirty(true)
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      void saveRef.current()
    }, AUTOSAVE_DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** BUG-139 — flip the Properties panel's collapsed flag. */
  const toggleFrontmatterCollapsed = useCallback(() => {
    setFrontmatterCollapsed(prev => {
      const next = !prev
      // BUG-207 — per-path localStorage, not the sidecar (see toggleSuggestingMode).
      writeFrontmatterCollapsedPref(pathRef.current, next)
      return next
    })
  }, [])

  /** Update [data-duo-comment-active] on every comment span so the
   *  active thread reads stronger than its siblings. BUG-087 fix —
   *  also re-apply on every editor transaction. ProseMirror manages
   *  its own DOM and can re-create mark spans on transactions
   *  (selection updates, content changes); without this, the active
   *  attribute set via direct setAttribute would be wiped the next
   *  time PM re-rendered the spans, and only the FIRST rail-click
   *  worked (subsequent clicks landed on freshly-rendered spans
   *  whose attribute hadn't been re-applied yet). */
  useEffect(() => {
    if (!editor) return
    const apply = () => {
      const root = editor.view.dom
      root.querySelectorAll<HTMLElement>('[data-duo-comment-id]').forEach((el) => {
        if (el.getAttribute('data-duo-comment-id') === activeThreadId) {
          el.setAttribute('data-duo-comment-active', '1')
        } else {
          el.removeAttribute('data-duo-comment-active')
        }
      })
    }
    apply()
    // Re-apply on every PM transaction so ProseMirror-driven re-
    // renders don't strip the active attribute.
    editor.on('transaction', apply)
    return () => { editor.off('transaction', apply) }
  }, [activeThreadId, builtThreads, editor])

  /** Click-on-anchor → activate the corresponding rail thread.
   *  Delegated listener catches clicks anywhere inside a comment span
   *  (or its descendants — bold/italic/link inside a commented run). */
  useEffect(() => {
    if (!editor) return
    const root = editor.view.dom
    const handler = (e: Event) => {
      const target = e.target as Element | null
      if (!target) return
      const commented = target.closest('[data-duo-comment-id]') as HTMLElement | null
      if (!commented) return
      const id = commented.getAttribute('data-duo-comment-id')
      if (id) setActiveThreadId(id)
    }
    root.addEventListener('click', handler)
    return () => root.removeEventListener('click', handler)
  }, [editor])

  /** Open the new-comment composer over the current selection. Same
   *  contract as PageTab's handler — no-op when the selection is
   *  collapsed or rect-less. */
  const handleStartNewComment = useCallback(() => {
    if (!editor) return
    const sel = editor.state.selection
    if (sel.from === sel.to) return
    const rect = pillRect
    if (!rect) return
    const { excerpt, contextBefore, contextAfter } = captureExcerptContext(
      editor.state.doc,
      { from: sel.from, to: sel.to }
    )
    if (!excerpt.trim()) return
    const commentId = `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    setNewCommentAt({
      commentId,
      range: { from: sel.from, to: sel.to },
      excerpt,
      contextBefore,
      contextAfter,
      rect
    })
    // Hide the SendToDuo pill while the composer is open — same
    // single-affordance posture as the canvas.
    setPillRect(null)
  }, [editor, pillRect])

  const handleSubmitNewComment = useCallback((body: string) => {
    if (!editor) return
    const at = newCommentAt
    if (!at) return
    const trimmed = body.trim()
    if (!trimmed) { setNewCommentAt(null); return }
    // Apply the mark BEFORE persisting — if the user edited between
    // start-comment and submit, the range may have shifted; PM will
    // map the original from/to through the intervening transactions.
    // BUG-138 — the mark now carries full metadata + body. We still
    // write the sidecar entry below for now (legacy path); Phase 2's
    // migration step + Phase 1b's serializer will phase the sidecar
    // out. During the transition window both stores hold the data.
    const ts = new Date().toISOString()
    // BUG-138 Phase 2 — stamp the live identity from useAuthor instead
    // of the legacy 'user' literal. Falls back to 'user' when the
    // author hook hasn't resolved a value yet (e.g. first launch
    // before localStorage is touched, $USER env var also empty).
    const author = authorOrLegacy
    editor.commands.applyCommentMark({
      commentId: at.commentId,
      author,
      ts,
      body: trimmed
    }, at.range.from, at.range.to)
    const entry: SidecarComment = {
      id: `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      anchorId: at.commentId,
      author,
      ts,
      body: trimmed,
      excerpt: at.excerpt,
      contextBefore: at.contextBefore,
      contextAfter: at.contextAfter
    }
    persistSidecarMutation(sidecarWithComment(sidecarRef.current, entry))
    setNewCommentAt(null)
    setActiveThreadId(at.commentId)
  }, [editor, newCommentAt, persistSidecarMutation])

  const handleCancelNewComment = useCallback(() => {
    setNewCommentAt(null)
  }, [])

  const handleJumpToThread = useCallback((threadId: string) => {
    if (!editor) return
    setActiveThreadId(threadId)
    scrollToCommentAnchor(editor.view, threadId)
  }, [editor])

  const handleReplyToThread = useCallback((threadId: string, body: string) => {
    const trimmed = body.trim()
    if (!trimmed) return
    const entry: SidecarComment = {
      id: `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      anchorId: threadId,
      // BUG-138 Phase 2 — live identity from useAuthor.
      author: authorOrLegacy,
      ts: new Date().toISOString(),
      body: trimmed
    }
    persistSidecarMutation(sidecarWithComment(sidecarRef.current, entry))
  }, [persistSidecarMutation, authorOrLegacy])

  const handleResolveThread = useCallback((threadId: string) => {
    if (!editor) return
    // BUG-138 Phase 2 — record the live identity in the resolution marker.
    persistSidecarMutation(sidecarWithResolvedThread(sidecarRef.current, threadId, authorOrLegacy))
    // Visual cleanup — strip the anchor decoration once resolved
    // (parallel to the canvas's resolved-thread behavior).
    editor.commands.removeCommentMark(threadId)
  }, [editor, persistSidecarMutation, authorOrLegacy])

  const handleReopenThread = useCallback((threadId: string) => {
    if (!editor) return
    persistSidecarMutation(sidecarWithReopenedThread(sidecarRef.current, threadId))
    applyCommentMarksFromSidecar(editor, sidecarRef.current)
    setThreadsTick(v => v + 1)
  }, [editor, persistSidecarMutation])

  // Update the forward-reference ref (declared near top) so the
  // editorActions closure always invokes the latest closure. ⌘⌥M /
  // canvas right-click both fire 'duo-start-comment' window events
  // which the listener below picks up.
  startCommentRef.current = handleStartNewComment
  // BUG-138 Phase 4 — keep the suggestion-toggle ref pointed at the
  // latest closure so the toolbar button always toggles against the
  // current state (without re-running editorActions useMemo
  // unnecessarily).
  toggleSuggestingRef.current = toggleSuggestingMode

  // BUG-138 Phase 4b — sync the SuggestingMode extension's storage
  // with live state on every render. This is how the plugin's
  // appendTransaction sees the latest enabled-flag + author without
  // a remount (extension storage is mutable across renders).
  useEffect(() => {
    if (!editor) return
    const storage = editor.storage.suggestingMode as
      | { enabled: boolean; getAuthor: () => string } | undefined
    if (!storage) return
    storage.enabled = suggestingMode
    storage.getAuthor = () => authorOrLegacy
  }, [editor, suggestingMode, authorOrLegacy])

  // BUG-186 — push the line-number toggle into the LineNumbers plugin.
  // The plugin recomputes decorations only while enabled, so flipping
  // this dispatches a meta transaction that rebuilds (or clears) the
  // gutter without rebuilding the static extension list.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(
      editor.state.tr.setMeta(lineNumbersPluginKey, { enabled: lineNumbers })
    )
  }, [editor, lineNumbers])

  useEffect(() => {
    const handler = () => handleStartNewComment()
    window.addEventListener('duo-start-comment', handler)
    return () => window.removeEventListener('duo-start-comment', handler)
  }, [handleStartNewComment])

  // BUG-138 Phase 4 — ⌘⌥T chord listener. Only the active markdown
  // editor responds (matches isActive prop). Toggles the per-doc
  // Suggesting mode flag in the sidecar.
  useEffect(() => {
    const handler = () => {
      if (!isActive) return
      toggleSuggestingRef.current()
    }
    window.addEventListener('duo-toggle-suggesting', handler)
    return () => window.removeEventListener('duo-toggle-suggesting', handler)
  }, [isActive])

  // ── Serve doc-read requests with the live buffer ────────────────────────
  //
  // BUG-112 (filed 2026-05-09 walk-2) — gate on `isActive` so only the
  // visible editor responds when no `req.path` is supplied. Pre-fix all
  // mounted editors raced; first reply won; `duo doc read` would return
  // an arbitrary tab's content (often whichever was opened first this
  // session). Same race shape as ENH-125's image-insert race; fixed
  // identically. With `req.path` supplied, the existing path-filter
  // already routes to the right editor — no change there.
  useEffect(() => {
    if (!editor || isNew) return
    return window.electron.editor?.onDocRead((req) => {
      // BUG-144 — when a path filter is supplied, silently ignore on
      // mismatch so only the editor whose `path` matches replies. The
      // prior behavior replied with an error from EVERY non-matching
      // mounted editor; with multiple editors open, whichever bogus
      // error reached the socket first won the race and the matching
      // editor's success reply was discarded by the CLI as a duplicate.
      // No reply at all on mismatch is the right shape — the matching
      // editor still replies; absence of any matching editor will time
      // out, which is the visible failure we want.
      if (req.path && req.path !== path) return
      if (!req.path && !isActiveRef.current) return // no path filter, not active → ignore
      try {
        const body = serializeWithCriticMarkup(editor)
        const full = joinFrontmatter(frontmatterRef.current, body, eolRef.current)
        const isDirty = body !== recon.getSerializedBaseline()
        window.electron.editor.replyDocRead({
          reqId: req.reqId,
          ok: true,
          path,
          text: full,
          dirty: isDirty
        })
      } catch (err) {
        window.electron.editor.replyDocRead({
          reqId: req.reqId,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })
  }, [editor, path, isNew])

  // ── Serve doc-goto requests (ENH-022) ───────────────────────────────────
  // Three target modes:
  //   --heading "X" : case-insensitive substring match on heading text.
  //   --line N      : 1-indexed line in the markdown source.
  //   --anchor "X"  : matches the slugified-id of any heading (GitHub
  //                   slug convention: lowercase, whitespace → '-',
  //                   strip non-alphanumerics-or-hyphens).
  // After landing: scroll into view (start), focus the editor,
  // place the caret at the target. The renderer also paints a brief
  // "just-added" decoration via the existing JustAdded extension so
  // the user sees where the cursor jumped to.
  useEffect(() => {
    if (!editor || isNew) return
    return window.electron.editor?.onDocGoto(async (req) => {
      // BUG-144 — silent ignore on path mismatch (see onDocRead).
      if (req.path && req.path !== path) return
      try {
        const heading = req.heading
        const anchor = req.anchor
        const reqLine = req.line

        // ENH-022 v4 — buffer-staleness defense. When tasks.md (or any
        // long-lived file) gets edits via `duo doc-write` / external
        // editor / `duo html *` AFTER the user opened it in Duo, the
        // editor's TipTap doc is the snapshot loaded at open time —
        // not what's on disk. The heading walk below operates on the
        // editor's stale buffer, so newly-added headings don't match
        // even though they exist on disk. This is the most likely
        // cause of v3's "scrolls to BUG-034 instead of BUG-038":
        // BUG-038's heading was added after the user opened tasks.md.
        //
        // Reconciliation: re-read disk; if it differs from the
        // editor's serialized buffer AND the editor is clean (no
        // unsaved local edits), reload via setContent. If dirty,
        // skip the reload to avoid clobbering user work — surface
        // staleness in the response so the agent knows to ask the
        // user to save.
        let bufferStale = false
        let didReload = false
        try {
          const diskRead = await window.electron.files.read(path)
          const diskText = decodeUtf8(diskRead.bytes)
          const diskSplit = splitFrontmatter(diskText)
          const diskBody = diskSplit.body
          const editorBody = serializeWithCriticMarkup(editor)
          if (diskBody !== editorBody) {
            const editorIsDirty = editorBody !== recon.getSerializedBaseline()
            if (!editorIsDirty) {
              // Clean buffer behind disk — safe to reload.
              frontmatterRef.current = diskSplit.frontmatter
              eolRef.current = diskSplit.eol
              editor.commands.setContent(preprocessSubstitutions(diskBody), false)
              // ENH-195 — advance both reconciliation baselines in lockstep.
              recon.noteLoaded(serializeWithCriticMarkup(editor), diskBody)
              didReload = true
            } else {
              // Dirty buffer + diverged disk = real conflict. Don't
              // touch the buffer; mark the response so the agent
              // can warn. Stage 16 (external-write reconciliation)
              // is the longer-term fix; this is a doc-goto-local
              // band-aid.
              bufferStale = true
            }
          }
        } catch (err) {
          console.warn('[doc-goto v4] disk reload failed:', err)
        }
        // Smoke-walk diagnostic — surface in DevTools console so
        // wrong-match reports tell us whether v4's reload path ran.
        // Drop or gate behind a flag once stable.
        console.log('[doc-goto v4]', { path, didReload, bufferStale, heading: req.heading })

        // Walk heading nodes once; collect text + slug + position.
        type HeadingHit = { text: string; slug: string; pos: number; line: number }
        const headings: HeadingHit[] = []
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'heading') {
            const text = node.textContent
            const slug = slugifyHeading(text)
            // Convert ProseMirror position → 1-indexed source line.
            // Approximation: count newlines in the markdown up to
            // the heading. Build that mapping below from the
            // serialized markdown (cheap; doc is small).
            headings.push({ text, slug, pos, line: 0 })
          }
          return true
        })

        // Build a markdown line index for line/heading-line mapping.
        const md = serializeWithCriticMarkup(editor)
        const mdLines = md.split('\n')
        // Match each heading to its source line by walking md and
        // looking for `^#{1,6}\s+<text>` lines in order.
        let mdHeadingCursor = 0
        for (const h of headings) {
          for (let i = mdHeadingCursor; i < mdLines.length; i++) {
            const m = mdLines[i].match(/^#{1,6}\s+(.+)$/)
            if (m && m[1].trim() === h.text.trim()) {
              h.line = i + 1
              mdHeadingCursor = i + 1
              break
            }
          }
        }

        // Resolve the target.
        let resolvedPos: number | null = null
        let resolvedLine: number | undefined
        let resolvedAnchor: string | undefined
        // ENH-022 v3 — surface the matched heading text in the
        // response so the user can verify which heading the
        // precedence chain picked (vs. assuming "BUG-038" landed on
        // BUG-038). Wrong-match reports become self-diagnosing.
        let resolvedHeading: string | undefined

        if (heading !== undefined) {
          // ENH-022 v3 — match precedence: exact (case-insensitive) >
          // starts-with > whole-word > substring. Previous v2 logic
          // used a single `includes` pass which could pick a heading
          // that mentions the needle in passing (e.g. an entry whose
          // body cross-refs the target ID would not match — but if
          // an earlier heading TEXT contains the needle as a stray
          // substring, find returns that one first). Tightening the
          // precedence resolves "duo doc goto --heading BUG-038
          // landed on BUG-032" by ranking exact / starts-with / word
          // matches above naive substring.
          const needle = heading.toLowerCase()
          const exact = headings.find(h => h.text.toLowerCase() === needle)
          const startsWith = !exact ? headings.find(h => h.text.toLowerCase().startsWith(needle)) : null
          // Word-boundary match — needle preceded/followed by non-word char
          // OR start/end of the heading text. Catches "BUG-038" inside
          // "### BUG-038: …" (colon is a word boundary) but rejects a
          // heading that just has "bug-038" as part of a longer slug.
          const wordRe = new RegExp(`(^|\\W)${needle.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(\\W|$)`, 'i')
          const wordMatch = !exact && !startsWith ? headings.find(h => wordRe.test(h.text)) : null
          const sub = !exact && !startsWith && !wordMatch ? headings.find(h => h.text.toLowerCase().includes(needle)) : null
          const hit = exact || startsWith || wordMatch || sub
          if (!hit) {
            window.electron.editor.replyDocGoto({
              reqId: req.reqId, ok: false,
              error: `No heading matched "${heading}". Try one of: ${headings.slice(0, 8).map(h => `"${h.text}"`).join(', ')}${headings.length > 8 ? ', …' : ''}`
            })
            return
          }
          resolvedPos = hit.pos
          resolvedLine = hit.line
          resolvedAnchor = hit.slug
          resolvedHeading = hit.text
        } else if (anchor !== undefined) {
          const needle = anchor.toLowerCase()
          // Match exact slug, then prefix, then substring — first hit wins.
          const exact = headings.find(h => h.slug === needle)
          const prefix = !exact ? headings.find(h => h.slug.startsWith(needle)) : null
          const sub = !exact && !prefix ? headings.find(h => h.slug.includes(needle)) : null
          const hit = exact || prefix || sub
          if (!hit) {
            window.electron.editor.replyDocGoto({
              reqId: req.reqId, ok: false,
              error: `No heading slug matched "${anchor}".`
            })
            return
          }
          resolvedPos = hit.pos
          resolvedLine = hit.line
          resolvedAnchor = hit.slug
          resolvedHeading = hit.text
        } else if (reqLine !== undefined) {
          // Line-based goto: clamp to last line; map to a PM position.
          const targetLine = Math.min(Math.max(1, reqLine), mdLines.length)
          resolvedLine = targetLine
          // PM doesn't have a direct line→pos API; walk the doc
          // counting newlines until we hit the target line, then
          // position at the start of that block.
          let line = 1
          let foundPos: number | null = null
          editor.state.doc.descendants((node, pos) => {
            if (foundPos !== null) return false
            if (node.isBlock && line === targetLine) {
              foundPos = pos + 1 // inside the block, before its first child
              return false
            }
            if (node.isBlock) {
              // Heuristic: each top-level block bumps line by its
              // textContent's newline count + 1. Markdown
              // serialization isn't perfectly 1:1 with PM blocks,
              // but it's close enough for line-jump behavior to
              // feel right on real docs.
              const text = node.textContent
              line += 1 + (text.match(/\n/g)?.length ?? 0)
            }
            return true
          })
          resolvedPos = foundPos ?? Math.max(1, editor.state.doc.content.size - 1)
        }

        if (resolvedPos !== null) {
          // ENH-022 v2 — chain everything into ONE transaction so the
          // scrollIntoView flag is on the same tr that moves the
          // selection. The original three-separate-commands form
          // ended up with scrollIntoView running on an empty
          // transaction after the selection had already settled,
          // which PM treated as "selection already visible — nothing
          // to scroll" depending on layout. Chain forces PM to scroll
          // to the new selection at commit time.
          editor.chain()
            .focus()
            .setTextSelection(resolvedPos)
            .scrollIntoView()
            .run()
          // ENH-022 v2 belt-and-braces — same family of failures as
          // BUG-043: ProseMirror's scrollIntoView walks up looking for
          // a scrollable ancestor, but the MarkdownEditor's actual
          // scroll container is 2-3 ancestors above view.dom (the
          // .flex-1.overflow-auto wrapper, with .tiptap and the
          // centered column in between). When PM's heuristic misses,
          // the chain above succeeds but no visual scroll happens.
          // Resolve the target's DOM node and call native
          // scrollIntoView so the browser walks all the way up. RAF
          // defers until after the chain's transaction has rendered.
          const targetPos = resolvedPos
          requestAnimationFrame(() => {
            try {
              const dom = editor.view.domAtPos(targetPos)
              const node = dom.node.nodeType === 1
                ? (dom.node as HTMLElement)
                : (dom.node.parentElement as HTMLElement | null)
              if (node && typeof node.scrollIntoView === 'function') {
                node.scrollIntoView({ block: 'center', behavior: 'smooth' })
              }
            } catch {
              /* domAtPos can throw on edge positions; PM's chain
                 already attempted the scroll, so swallow */
            }
          })
        }

        window.electron.editor.replyDocGoto({
          reqId: req.reqId, ok: true, path,
          line: resolvedLine, anchor: resolvedAnchor,
          matched_heading: resolvedHeading,
          buffer_stale: bufferStale || undefined
        })
      } catch (err) {
        window.electron.editor.replyDocGoto({
          reqId: req.reqId, ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })
  }, [editor, path, isNew])

  // ── ⌘F find bar wiring (ENH-023) ────────────────────────────────────────
  // App.tsx routes the global ⌘F / ⌘G shortcuts into custom events on
  // `window`. Only one MarkdownEditor is mounted at a time (WorkingPane
  // swaps activeRenderer per-tab), so this listener is unambiguous:
  // whichever editor is mounted handles the event. ENH-208 retired the
  // GLOBAL ⌘⇧F findPrev id (the chord now opens the vault search
  // palette), so the 'duo-editor-find-prev' listener is gone — find-prev
  // stays reachable via the FindBar's input-local ⌘⇧F / ⇧↩ / ↑ and the
  // ▲ button.
  useEffect(() => {
    if (!editor) return
    const onOpen = () => setFindOpen(true)
    const onNext = () => {
      // ⌘G works even when the bar is closed if there's a stored
      // query — open the bar first to make the highlight visible.
      const total = editor.storage.findHighlight?.total as number ?? 0
      if (total > 0) setFindOpen(true)
      editor.commands.findNext()
    }
    window.addEventListener('duo-editor-find-open', onOpen)
    window.addEventListener('duo-editor-find-next', onNext)
    return () => {
      window.removeEventListener('duo-editor-find-open', onOpen)
      window.removeEventListener('duo-editor-find-next', onNext)
    }
  }, [editor])

  // ── Vault goto-match (ENH-208 D22) ──────────────────────────────────────
  // The vault-search palette opens a hit "at line" by asking for the Nth
  // occurrence of its query — not a disk line number, because the doc
  // omits frontmatter (it lives in the Properties panel). Two delivery
  // paths (vaultGotoMatch.ts): a parked request claimed here once the
  // doc body has loaded, and a live window event for the already-open
  // case. The live handler ALSO consumes the parked copy so a stale
  // request can never replay on a later remount.
  useEffect(() => {
    if (!editor || !loaded || isNew) return
    const runJump = (req: { query: string; matchIndex: number }) => {
      jumpToMatch(editor, req)
      // ENH-022 v2 / BUG-043 belt-and-braces — PM's scrollIntoView can
      // miss the editor's real scroll container (2-3 ancestors above
      // view.dom). Resolve the selection's DOM node and native-scroll
      // it after the chain's transaction has rendered.
      requestAnimationFrame(() => {
        try {
          const dom = editor.view.domAtPos(editor.state.selection.from)
          const node = dom.node.nodeType === 1
            ? (dom.node as HTMLElement)
            : (dom.node.parentElement as HTMLElement | null)
          if (node && typeof node.scrollIntoView === 'function') {
            node.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }
        } catch {
          /* domAtPos can throw on edge positions; the chain already
             attempted the scroll, so swallow */
        }
      })
    }
    const parked = consumeGotoMatch(path)
    if (parked) runJump(parked)
    const onGoto = (ev: Event) => {
      const detail = (ev as CustomEvent<VaultGotoMatch>).detail
      if (!detail || detail.path !== path) return
      consumeGotoMatch(detail.path)
      runJump(detail)
    }
    window.addEventListener(VAULT_GOTO_MATCH_EVENT, onGoto)
    return () => window.removeEventListener(VAULT_GOTO_MATCH_EVENT, onGoto)
  }, [editor, loaded, path, isNew])

  // Stage 27 — `selection:set` editor-target listener. Companion to
  // PageTab's same-named effect: a canvas action button that wants
  // to drop the cursor into the active markdown editor (typically to
  // direct the user's attention) fires `duo-canvas-selection-set` from
  // App.tsx; we listen for the editor-targeted variant. v1 supports
  // `text` (use the FindHighlight extension's setFindQuery/findNext to
  // jump to + highlight first match) and `line` (clamp + walk doc to
  // the matching block, mirroring onDocGoto's line path). `anchor` is
  // canvas-only; ignore for the editor target.
  useEffect(() => {
    if (!editor) return
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        target: 'editor' | 'canvas'
        text?: string
        line?: number
        anchor?: string
      }>).detail
      if (!detail || detail.target !== 'editor') return
      try {
        if (detail.text !== undefined && detail.text !== '') {
          // Prime the find extension with the needle, then advance to
          // the first match. Leaves the bar closed by default; users
          // can ⌘F to surface it. ScrollIntoView happens via PM's
          // native find behaviour.
          editor.commands.setFindQuery?.({ query: detail.text })
          editor.commands.findNext?.()
          editor.commands.focus()
          return
        }
        if (detail.line !== undefined) {
          // Reuse onDocGoto's line-walk logic in miniature: walk the
          // doc, count newlines, position at start of the matching
          // block. Lines are 1-indexed and clamped to the last line.
          const md = serializeWithCriticMarkup(editor)
          const mdLines = md.split('\n')
          const targetLine = Math.min(Math.max(1, detail.line), mdLines.length)
          let line = 1
          let foundPos: number | null = null
          editor.state.doc.descendants((node, pos) => {
            if (foundPos !== null) return false
            if (node.isBlock && line === targetLine) {
              foundPos = pos + 1
              return false
            }
            if (node.isBlock) {
              const text = node.textContent
              line += 1 + (text.match(/\n/g)?.length ?? 0)
            }
            return true
          })
          if (foundPos !== null) {
            editor.chain().focus().setTextSelection(foundPos).scrollIntoView().run()
          }
        }
      } catch (err) {
        console.warn('[duo-canvas-selection-set] editor handler failed:', err)
      }
    }
    window.addEventListener('duo-canvas-selection-set', handler)
    return () => window.removeEventListener('duo-canvas-selection-set', handler)
  }, [editor])

  // ── Serve doc-find requests (ENH-023) ───────────────────────────────────
  useEffect(() => {
    if (!editor || isNew) return
    return window.electron.editor?.onDocFind((req) => {
      // BUG-144 — silent ignore on path mismatch (see onDocRead).
      if (req.path && req.path !== path) return
      try {
        const body = serializeWithCriticMarkup(editor)
        const lines = body.split('\n')
        const haystackLines = req.caseSensitive ? lines : lines.map(l => l.toLowerCase())
        const needle = req.caseSensitive ? req.query : req.query.toLowerCase()
        let matches = 0
        let first: { line: number; col: number } | undefined
        for (let i = 0; i < haystackLines.length; i++) {
          let idx = haystackLines[i].indexOf(needle)
          while (idx !== -1) {
            matches++
            if (!first) first = { line: i + 1, col: idx }
            idx = haystackLines[i].indexOf(needle, idx + needle.length)
          }
        }
        window.electron.editor.replyDocFind({
          reqId: req.reqId, ok: true, path, matches, first
        })
      } catch (err) {
        window.electron.editor.replyDocFind({
          reqId: req.reqId, ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })
  }, [editor, path, isNew])

  // ── Apply doc-write requests from the agent ─────────────────────────────
  //
  // Stage 13b — when the buffer is dirty, queue the request and render a
  // <WriteWarningBanner> so the human accepts/declines from the editor
  // chrome instead of the terminal. While the banner is up, the IPC reply
  // is held; further writes from the agent are rejected with a "another
  // write awaiting your decision" error so we don't queue a backlog.

  /** Apply a doc-write request: parses content, paints just-added
   *  highlight, resolves the IPC. Used both for the immediate path
   *  (clean buffer) and the post-accept path (dirty buffer + accepted). */
  const applyDocWrite = useCallback((req: DocWriteRequest) => {
    if (!editor) return
    // ENH-221 — this content is agent-authored; the ensuing autosave tags it 'agent'.
    agentWritePendingRef.current = true
    try {
      if (req.mode === 'replace-all') {
        // Markdown text — tiptap-markdown reparses it into PM doc.
        editor.commands.setContent(req.text, true)
        // Stage 13a — paint the entire body as just-added so the human
        // can see the agent's rewrite. PM positions: 0 → doc.content.size.
        editor.commands.markJustAdded(0, editor.state.doc.content.size)
      } else {
        // replace-selection: plain-text replacement of the current
        // selection (or insertion at caret if collapsed). Agents that
        // need markdown formatting should use --replace-all for v1.
        //
        // Stage 13a — capture the selection start BEFORE the insert so
        // we know where the just-added range begins. After insertContent,
        // the caret sits at the end of the inserted content.
        const { from: insertStart } = editor.state.selection
        editor.chain().focus().insertContent(req.text).run()
        const insertEnd = editor.state.selection.from
        if (insertEnd > insertStart) {
          editor.commands.markJustAdded(insertStart, insertEnd)
        }
      }
      window.electron.editor.replyDocWrite({ reqId: req.reqId, ok: true })
    } catch (err) {
      window.electron.editor.replyDocWrite({
        reqId: req.reqId,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }, [editor])

  const [pendingWrite, setPendingWrite] = useState<DocWriteRequest | null>(null)
  // BUG-033 v1 (a) — when a pending write appears, immediately suspend
  // the autosave loop and clear any timer that was about to fire. Save
  // resumes on accept/decline (the next user keystroke arms a fresh
  // timer through the normal change handler).
  useEffect(() => {
    blockAutosaveRef.current = pendingWrite !== null
    if (pendingWrite && autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }, [pendingWrite])

  // Refs let the IPC handler read latest dirty + pending state without
  // re-subscribing on every keystroke (which would tear down listeners
  // mid-edit and miss writes).
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const pendingWriteRef = useRef<DocWriteRequest | null>(null)
  pendingWriteRef.current = pendingWrite

  // ENH-117 / FOLLOWUP-015 — view-source panel listener. Capture-phase
  // listener for the `duo-view-source` window event dispatched by ⌘⌥V
  // chord, View → View source menu, and tab right-click → View source.
  // Gated on `isActive` so only the visible editor responds (one
  // panel across the app at a time). Toggle semantics: chord with the
  // panel already open closes it (returns to the editor). Snapshot
  // the markdown source at open time so the panel shows what the
  // editor's storage currently has — same source the next save would
  // write. v2 (FOLLOWUP-015) made this a panel-fill that replaces the
  // prose area in-place rather than a centered modal overlay; the
  // event-firing path is unchanged.
  useEffect(() => {
    if (!editor || isNew) return
    const onViewSource = () => {
      if (!isActiveRef.current) return
      setViewSource(prev => {
        if (prev !== null) return null
        const body = serializeWithCriticMarkup(editor)
        return joinFrontmatter(frontmatterRef.current, body, eolRef.current)
      })
    }
    window.addEventListener('duo-view-source', onViewSource)
    return () => window.removeEventListener('duo-view-source', onViewSource)
  }, [editor, isNew])

  // ENH-108 (Sprint 12) / FOLLOWUP-014 (Sprint 13) — `duo image
  // insert <path>` handler. Mirrors handlePaste: saveImageBeside +
  // setImage with the relative filename. DuoImage's NodeView
  // resolves and renders the blob URL. Markdown source stays
  // portable.
  //
  // FOLLOWUP-014/walk-2 — gated on `isActive` via a ref (so a tab
  // switch doesn't tear down + re-add the listener; both inactive
  // tabs are silent; only the visible one responds). Pre-gate every
  // mounted editor responded, first reply won, image landed in the
  // wrong file. Same race shape as the doc-read bug.
  const isActiveRef = useRef(isActive ?? false)
  isActiveRef.current = isActive ?? false
  useEffect(() => {
    if (!editor || isNew) return
    return window.electron.editor?.onImageInsert(async (req) => {
      if (!isActiveRef.current) return // silently ignore on inactive tabs
      try {
        const result = await window.electron.files.saveImageBeside(path, req.bytes, req.ext)
        const attrs: { src: string; alt?: string } = { src: result.relPath }
        if (req.alt !== undefined) attrs.alt = req.alt
        editor.chain().focus().setImage(attrs).run()
        window.electron.editor.replyImageInsert({ reqId: req.reqId, ok: true, absPath: result.absPath })
      } catch (err) {
        window.electron.editor.replyImageInsert({
          reqId: req.reqId,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })
  }, [editor, path, isNew])

  useEffect(() => {
    if (!editor || isNew) return
    return window.electron.editor?.onDocWrite((req) => {
      // BUG-144 — silent ignore on path mismatch (see onDocRead).
      if (req.path && req.path !== path) return

      // Stage 13b — gate dirty-buffer writes behind the warning banner.
      if (dirtyRef.current) {
        if (pendingWriteRef.current) {
          window.electron.editor.replyDocWrite({
            reqId: req.reqId,
            ok: false,
            error: 'Another write is awaiting the user\'s decision.'
          })
          return
        }
        setPendingWrite(req)
        return
      }

      applyDocWrite(req)
    })
  }, [editor, path, isNew, applyDocWrite])

  // ENH-195 — `duo doc edit` surgical PLAIN-text replace (open-file
  // path). Distinct from onDocWrite (whole-buffer replace, dirty-gated
  // behind the warning banner) and the disk-only CriticMarkup `doc-
  // edit` family. The replace is literal (non-CriticMarkup — a direct
  // accepted edit), applied to the serialized body via the pure
  // `plainReplace`, then re-parsed into the live buffer. It routes
  // through the existing echo-safe save (saveRef → recon hook), so it
  // NEVER writes disk directly — the watcher recognizes the save as our
  // own echo and doesn't banner. markJustAdded paints the change (the
  // 6s wash) just like applyDocWrite's replace-all, since this is an
  // explicit agent edit. NOT gated behind the dirty-buffer banner: a
  // surgical find/replace is far narrower than a whole-buffer rewrite,
  // and the recon hook's save-pre-reconcile still protects against a
  // genuine external-divergence conflict.
  useEffect(() => {
    if (!editor || isNew) return
    return window.electron.editor?.onDocEditPlain((req: DocEditPlainRequest) => {
      // BUG-144 pattern — silent ignore on path mismatch (an inactive
      // editor for a different file must not answer).
      if (req.path && req.path !== path) return
      try {
        const body = serializeWithCriticMarkup(editor)
        const res = plainReplace(body, req.find, req.replace, {
          occurrence: req.occurrence,
          all: req.all,
          atLine: req.atLine
        })
        if (!res.changed) {
          window.electron.editor.replyDocEditPlain({
            reqId: req.reqId, ok: true, changed: false, replacements: 0, reason: res.reason, path
          })
          return
        }
        // ENH-221 — agent-authored content; tag the ensuing save 'agent'.
        agentWritePendingRef.current = true
        editor.commands.setContent(preprocessSubstitutions(res.body), true)
        editor.commands.markJustAdded(0, editor.state.doc.content.size)
        // Echo-safe save (routes through the recon hook). Fire-and-
        // forget — saveRef.current handles its own errors via setSaveError.
        void saveRef.current()
        window.electron.editor.replyDocEditPlain({
          reqId: req.reqId, ok: true, changed: true, replacements: res.replacements, reason: '', path
        })
      } catch (err) {
        window.electron.editor.replyDocEditPlain({
          reqId: req.reqId,
          ok: false,
          changed: false,
          replacements: 0,
          reason: '',
          path,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })
  }, [editor, path, isNew])

  const handlePendingAccept = useCallback(() => {
    const req = pendingWriteRef.current
    if (!req) return
    setPendingWrite(null)
    applyDocWrite(req)
  }, [applyDocWrite])

  const handlePendingDecline = useCallback(() => {
    const req = pendingWriteRef.current
    if (!req) return
    setPendingWrite(null)
    window.electron.editor.replyDocWrite({
      reqId: req.reqId,
      ok: false,
      error: 'User declined the agent\'s write request.'
    })
  }, [])

  // ── ⌘S ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only intercept when this editor instance is the focused one. Tiptap's
      // editor element covers the doc area; guard by containment.
      if (!(e.metaKey || e.ctrlKey) || e.key !== 's') return
      const root = hostRef.current
      if (!root) return
      if (!root.contains(document.activeElement)) return
      e.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [save])

  // ── Render ───────────────────────────────────────────────────────────────
  // Stage 17a — extension-based dispatch. The interstitial accepts any
  // typed extension; classifyFile in App.tsx decides which canvas mounts
  // (.md → MarkdownEditor, .html → PageTab, others → preview tabs).
  // No-extension input still defaults to .md so muscle memory survives.
  const handleCommitName = useCallback((filename: string) => {
    const trimmed = filename.trim()
    if (!trimmed) return
    const finalName = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : trimmed + '.md'
    const dir = path.slice(0, path.lastIndexOf('/')) || '.'
    void onCommitNewFile?.(`${dir}/${finalName}`, finalName)
  }, [path, onCommitNewFile])

  const suggestedBaseName = (() => {
    const base = path.slice(path.lastIndexOf('/') + 1)
    return base.replace(/\.md$/i, '')
  })()

  return (
    <div
      ref={hostRef}
      data-duo-workingpane
      tabIndex={0}
      className="flex-1 flex flex-col bg-surface-0 min-h-0 focus:outline-none"
    >
      {isNew && (
        <NewFileBar
          suggestedName={suggestedBaseName}
          onCommit={handleCommitName}
          onCancel={() => onCancelNew?.()}
        />
      )}
      <EditorToolbar
        actions={editorActions}
        selectionVersion={toolbarVersion}
        onSave={() => void save()}
        dirty={dirty}
        saving={saving}
        saveError={saveError}
        autosaveOn={autosaveOn}
        onToggleAutosave={toggleAutosave}
        onShowHistory={isNew ? undefined : () => setHistoryOpen(true)}
      />
      {/* ENH-221 — version-history modal (additional rewind atop native Cmd+Z). */}
      <HistoryModal
        open={historyOpen}
        path={pathRef.current}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => editor?.commands.focus()}
      />
      {/* BUG-139 — Properties panel for YAML frontmatter. Always
          visible (collapsed or expanded) when the file has a
          frontmatter block; shows "+ Add properties" when empty.
          Skipped in isNew mode (no file yet). */}
      {!isNew && (
        <FrontmatterPanel
          frontmatter={frontmatterState}
          onChange={handleFrontmatterChange}
          collapsed={frontmatterCollapsed}
          onToggleCollapsed={toggleFrontmatterCollapsed}
          // FOLLOWUP-050 — live `[[ ]]` autocomplete in the raw-YAML editor,
          // reusing the SAME vault index the body WikilinkSuggestion uses.
          // FOLLOWUP-051 — a picked `[[ ]]` persists AS `[[ ]]` in both modes
          // (a bare frontmatter rel-path isn't a graph edge), so the panel no
          // longer needs mode/docPath/resolveWikilink.
          vaultFiles={vaultIndex.files}
          vaultLoading={vaultIndex.loading}
          vaultRoot={vaultIndex.vaultRoot}
          onVaultRefresh={vaultIndex.refresh}
        />
      )}
      {/* BUG-138 Phase 4d — bulk banner above the editor body when
          the doc carries one or more tracked-change marks. Recomputes
          via trackedChangesCount on toolbarVersion bumps (every
          selectionUpdate / update); hides itself at count=0. */}
      <SuggestingBanner editor={editor} count={trackedChangesCount} />
      {/* ENH-023 — find bar drops down between toolbar and prose
          when ⌘F is pressed. Closed state renders nothing. */}
      <FindBar editor={editor} open={findOpen} onClose={() => setFindOpen(false)} />
      {pendingWrite && (
        <WriteWarningBanner
          action={
            // BUG-033 v1 (b) — replace-all is silently destructive when
            // accepted under typing. Spell out the consequence so the
            // user can decide deliberately rather than dismiss on
            // muscle memory.
            pendingWrite.mode === 'replace-all'
              ? 'Replace the whole document (your unsaved edits will be lost)'
              : 'Insert at the current selection'
          }
          preview={pendingWrite.text.slice(0, 140) + (pendingWrite.text.length > 140 ? '…' : '')}
          onAccept={handlePendingAccept}
          onDecline={handlePendingDecline}
        />
      )}
      {error && (
        <div className="shrink-0 px-10 py-2 text-xs text-red-400 border-b border-red-900/40 bg-red-950/20">
          {error}
        </div>
      )}
      {/* ENH-195 / v0.9.0 — destructive external reload: recover your version,
          take the disk version, or review the change as tracked changes. */}
      {reloadedFlash && (
        <div className="shrink-0 px-10 py-2.5 text-xs border-b border-amber-900/40 bg-amber-950/30 text-amber-200 flex items-center gap-3">
          <span className="flex-1">
            <strong className="font-semibold">Most of this document was replaced by a change on disk.</strong>{' '}
            Keep your version, take the new one, or review the differences as tracked changes.
          </span>
          <button
            type="button"
            onClick={handleReloadKeepMine}
            className="px-2 py-1 rounded border border-amber-800/60 hover:border-amber-700 hover:bg-amber-900/30"
          >
            Keep mine
          </button>
          <button
            type="button"
            onClick={handleReloadLoadNew}
            className="px-2 py-1 rounded border border-amber-800/60 hover:border-amber-700 hover:bg-amber-900/30"
          >
            Load new
          </button>
          <button
            type="button"
            onClick={handleReloadViewDiff}
            className="px-2 py-1 rounded border border-amber-800/60 hover:border-amber-700 hover:bg-amber-900/30"
          >
            View diff
          </button>
        </div>
      )}
      {/* ENH-195 B4 — file deleted on disk; the buffer is preserved (save recreates it). */}
      {fileRemoved && (
        <div className="shrink-0 px-10 py-1.5 text-[11px] border-b border-red-900/40 bg-red-950/20 text-red-300">
          This file was removed on disk. Save to recreate it.
        </div>
      )}
      {/* ENH-216 (U7) — best-effort, non-blocking "a note may have moved"
          info toast (OKF mode only). Dismissible; informational only —
          OKF markdown rel links repair on the next vault open or via
          `duo vault relink`. */}
      {likelyMoved && (
        <div className="shrink-0 px-10 py-1.5 text-[11px] border-b border-sky-900/40 bg-sky-950/20 text-sky-200 flex items-center gap-3">
          <span className="flex-1">
            A note may have moved — links repair on the next vault open or via{' '}
            <code className="font-mono">duo vault relink</code>.
          </span>
          <button
            type="button"
            onClick={() => setLikelyMoved(false)}
            className="px-2 py-0.5 rounded border border-sky-800/60 hover:border-sky-700 hover:bg-sky-900/30"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        </div>
      )}
      {recon.externalConflict && (
        <div className="shrink-0 px-10 py-2.5 text-xs border-b border-amber-900/40 bg-amber-950/30 text-amber-200 flex items-center gap-3">
          <span className="flex-1">
            <strong className="font-semibold">This file changed on disk</strong> while you were editing.
            Keep yours, take the disk version, or review the change as tracked changes.
          </span>
          <button
            type="button"
            onClick={recon.resolveKeepMine}
            className="px-2 py-1 rounded border border-amber-800/60 hover:border-amber-700 hover:bg-amber-900/30"
          >
            Keep mine
          </button>
          <button
            type="button"
            onClick={recon.resolveReload}
            className="px-2 py-1 rounded border border-amber-800/60 hover:border-amber-700 hover:bg-amber-900/30"
          >
            Reload from disk
          </button>
          <button
            type="button"
            onClick={handleConflictViewDiff}
            className="px-2 py-1 rounded border border-amber-800/60 hover:border-amber-700 hover:bg-amber-900/30"
          >
            View diff
          </button>
        </div>
      )}
      {/*
        Clicking anywhere in the scrollable area below the toolbar should
        focus the prose so the user can type immediately, not just the
        narrow centered content column. Without this, gray-margin clicks
        are no-ops and the user has to aim at the prose itself or the
        toolbar (which steals focus). We only act when the click target
        is the scroll-host or the centered column itself — not when it's
        inside the prose (it already handles that natively) or any
        interactive descendant. mousedown (not click) so the focus
        lands before the browser's default selection-collapsing
        behavior.
      */}
      {/* Sprint 6 Phase 4 — flex container for the prose + comment
          rail. Rail mounts only when there's at least one comment
          (parallel to the canvas; an empty rail wastes horizontal
          space). New-file mode skips the rail entirely (no on-disk
          file means no sidecar).
          FOLLOWUP-015 — view-source v2 replaces this entire container
          (prose + rail) with ViewSourcePanel when active, so source
          mode owns the full content area. */}
      <div className="flex-1 min-h-0 flex">
      {viewSource !== null ? (
        <ViewSourcePanel
          source={viewSource}
          title={path.split('/').pop() ?? path}
          onClose={() => setViewSource(null)}
        />
      ) : (
        <>
        <div
          className="flex-1 overflow-auto"
          onMouseDown={(e) => {
            if (!editor) return
            const target = e.target as HTMLElement
            // Click landed on the prose or one of its descendants — let
            // ProseMirror handle it natively (cursor placement, selection).
            if (target.closest('.ProseMirror')) return
            // Anything else inside the scroll-host (gray margins, inside
            // the centered column but outside the prose) → focus prose.
            e.preventDefault()
            editor.commands.focus()
          }}
        >
          <div
            className="mx-auto max-w-[760px] px-10 py-10"
            // ENH-069 — line-number toggle. The CSS in globals.css
            // hangs counter rules off `[data-line-numbers="true"]`.
            data-line-numbers={lineNumbers ? 'true' : undefined}
          >
            <EditorContent editor={editor} />
          </div>
          {/* ENH-069 — small floating toggle in the bottom-right of
              the scroll-host. Discreet (low contrast, small) so it
              doesn't compete with content; visible enough to find.
              Click flips the persistent preference. */}
          <button
            type="button"
            onClick={() => setLineNumbers(v => !v)}
            title={lineNumbers ? 'Hide line numbers' : 'Show line numbers'}
            aria-label={lineNumbers ? 'Hide line numbers' : 'Show line numbers'}
            className={[
              'sticky bottom-3 ml-3 px-2 h-6 rounded text-[11px] flex items-center gap-1.5 transition-colors shrink-0',
              lineNumbers
                ? 'bg-accent text-white hover:bg-accent-ink'
                : 'text-ink-mute hover:text-ink hover:bg-surface-2'
            ].join(' ')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <text x="2" y="5" fontFamily="monospace" fontSize="3.6" fill="currentColor">1</text>
              <text x="2" y="9" fontFamily="monospace" fontSize="3.6" fill="currentColor">2</text>
              <path d="M6 4h5M6 8h5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
            </svg>
            {/* ENH-071 (v0.6.3) — text changed from "Lines" to `#`
                per owner walk-2 note. Glyph stays. */}
            <span className="font-mono">#</span>
          </button>
        </div>
        {/* ENH-166 v2 — unified annotation rail. v1 (this morning) put
            both rails inside one 280px column but kept them as two
            stacked sections. Owner pushback: items should INTERLEAVE
            by document position so reading the rail mirrors reading
            the document. UnifiedAnnotationRail merges tracked changes
            + comment threads into one sorted list keyed on PM
            position. Hidden in isNew mode (no sidecar / no file yet)
            and when both lists are empty. */}
        {!isNew && (trackedChangesList.length > 0 || builtThreads.length > 0) && (
          <UnifiedAnnotationRail
            editor={editor}
            ranges={trackedChangesList}
            threads={builtThreads}
            currentAuthor={authorOrLegacy}
            activeThreadId={activeThreadId}
            onJumpToRange={handleJumpToTrackedChange}
            onJumpToThread={handleJumpToThread}
            onReply={handleReplyToThread}
            onResolve={handleResolveThread}
            onReopen={handleReopenThread}
          />
        )}
        </>
      )}
      </div>
      {/* Stage 15.1 — floating Send → Duo pill, portaled to body.
          ENH-176 — label flips between "Send → agent" / "Send →
          Terminal" depending on which feature-flag path armed the
          pill (host computes in App.tsx). */}
      {onSendToDuo && !newCommentAt && (
        <SendToDuoPill rect={pillRect} onClick={handleSendToDuoClick} label={pillLabel} />
      )}
      {/* Sprint 6 Phase 4 — new-comment composer. Anchored to the
          selection rect captured when the user invoked Comment. */}
      {newCommentAt && (
        <NewCommentComposer
          anchorRect={newCommentAt.rect}
          excerpt={newCommentAt.excerpt}
          onSubmit={handleSubmitNewComment}
          onCancel={handleCancelNewComment}
        />
      )}
      {/* ENH-208 D4 — silent-stub type picker. Opens after the create
          row inserted [[name]]; picking a type stubs through the same
          code path as `duo vault stub` and closes WITHOUT opening a
          tab. Esc / click-outside cancels — the unresolved link stays
          (harmless, Obsidian-compatible). */}
      {stubPicker && vaultIndex.vaultRoot && (
        <TypePickerPopover
          vaultRoot={vaultIndex.vaultRoot}
          name={stubPicker.name}
          anchorRect={stubPicker.rect}
          onCreated={(stub) => {
            // ENH-216 (U7) D3 — in OKF mode the create row inserted a
            // PLAIN-TEXT placeholder (the human name); now that the stub's
            // on-disk path is known, rewrite that span to a standard
            // markdown relative link. Link text = the human name the user
            // typed (D6). Obsidian mode left the [[ ]] in place — no range
            // was recorded, so nothing to rewrite.
            const range = stubPicker.range
            if (range && editor) {
              const link = okfLinkInsert(stubPicker.name, pathRef.current, stub.absPath)
              editor
                .chain()
                .focus()
                .insertContentAt({ from: range.from, to: range.to }, link)
                .run()
            }
            setStubPicker(null)
            // The new stub must show up in the suggesters' index (and
            // flip any unresolved-link styling) without a manual refresh.
            vaultIndex.refresh()
            editor?.commands.focus()
          }}
          onCancel={() => {
            setStubPicker(null)
            editor?.commands.focus()
          }}
        />
      )}
    </div>
  )
}

// Walk the doc up to `pos` collecting the active heading trail. Each new
// heading at level L pops the stack down to entries above L, then pushes
// itself \u2014 so the resulting list reads outermost-to-innermost.
function computeHeadingTrail(editor: Editor, pos: number): string[] {
  const stack: { level: number; text: string }[] = []
  editor.state.doc.nodesBetween(0, Math.max(0, pos - 1), (node) => {
    if (node.type.name === 'heading') {
      const level = (node.attrs.level as number) ?? 1
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop()
      }
      stack.push({ level, text: node.textContent })
      return false
    }
    return true
  })
  return stack.map(s => s.text)
}

function computeSelectionSnapshot(editor: Editor, path: string): EditorSelectionSnapshot {
  const { state } = editor
  const { from, to } = state.selection
  const text = from === to ? '' : state.doc.textBetween(from, to, '\n', ' ')
  const $from = state.doc.resolve(from)
  // Closest block ancestor (paragraph/heading/list-item content) for the
  // surrounding-context field.
  let paragraph = ''
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth)
    if (node.isBlock && node.isTextblock) {
      paragraph = node.textContent
      break
    }
  }
  return {
    path,
    text,
    paragraph,
    heading_trail: computeHeadingTrail(editor, from),
    start: from,
    end: to
  }
}

function NewFileBar({
  suggestedName,
  onCommit,
  onCancel
}: {
  suggestedName: string
  onCommit: (filename: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(suggestedName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  // Stage 17a — show the effective extension so the user knows whether
  // they're getting the markdown editor or the HTML canvas. Typed
  // extension wins; otherwise fall back to the auto-suffix default
  // (.md). Mirrors handleCommitName's logic above.
  const trimmed = name.trim()
  const typedExt = trimmed.match(/\.([a-z0-9]+)$/i)?.[0]
  const effectiveExt = typedExt ?? '.md'

  return (
    <div className="shrink-0 px-4 py-3 bg-surface-2 border-b border-border flex items-center gap-2">
      <span className="text-zinc-400 text-xs uppercase tracking-wider">New document</span>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onCommit(name)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        placeholder="my-document  ·  .md (default) or .html for canvas"
        className="flex-1 bg-surface-1 border border-border rounded px-3 py-1.5 text-zinc-100 text-sm focus:outline-none focus:border-accent"
      />
      <span className="text-zinc-500 text-xs tabular-nums" title={typedExt ? 'Using your typed extension' : 'No extension typed — defaulting to .md'}>
        {effectiveExt}
      </span>
      <button
        onClick={() => onCommit(name)}
        disabled={!name.trim()}
        className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent/85 disabled:opacity-40 disabled:hover:bg-accent transition-colors"
      >
        Create
      </button>
      <button
        onClick={onCancel}
        className="px-3 py-1.5 rounded border border-border text-zinc-400 text-xs hover:border-zinc-500 hover:text-zinc-200 transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}
