// Stage 10 Phase 5 — polymorphic WorkingPane shell.
//
// Merges browser tabs (owned by main-process BrowserManager via the
// `browser:*` IPC) with file tabs (owned by the renderer state that App.tsx
// passes down) into a single unified tab strip. A single active-tab state
// controls which renderer mounts below the strip.

import { useCallback, useEffect, useRef } from 'react'
import { cycleNext } from '../keyboard/tabCycle'
import { BrowserRenderer } from './BrowserRenderer'
import { MarkdownPreview } from './MarkdownPreview'
import { MarkdownEditor } from './editor/MarkdownEditor'
import { CanvasTab } from './HtmlCanvas/CanvasTab'
import { ImagePreview, PdfPreview, UnknownFilePreview } from './FileRenderers'
import { WorkingTabStrip } from './WorkingTabStrip'
import { useBrowserState } from '../hooks/useBrowserState'
import type { WorkingTab, WorkingTabType, PinEntry } from '@shared/types'

export interface FileTab {
  id: string
  type: Exclude<WorkingTabType, 'browser'>
  path: string
  title: string
  mime: string
  /** Stage 11 — unsaved-edits flag for `editor` tabs. */
  dirty?: boolean
  /** Stage 11 § D33a — newly-created file that hasn't been named/written
   *  to disk yet. The editor renders a "Name this document" interstitial
   *  before the prose canvas while this is true. */
  isNew?: boolean
}

export type ActiveWorking =
  | { kind: 'browser' }
  | { kind: 'file'; id: string }

interface WorkingPaneProps {
  fileTabs: FileTab[]
  activeWorking: ActiveWorking
  setActiveWorking: (a: ActiveWorking) => void
  closeFileTab: (id: string) => void
  onOpenMarkdown: (path: string) => void
  /** Stage 11 — let the editor push its dirty state up so the tab chip can
   *  show the unsaved dot. */
  onTabDirtyChange: (id: string, dirty: boolean) => void
  /** Stage 11 § D33a — finalize a new-file tab: write empty file at
   *  resolved path, drop `isNew`, update title. */
  onCommitNewFile: (id: string, path: string, title: string) => Promise<void>
  /** BUG-003 fix — passed through to the tab strip so it can paint a
   *  focused state. */
  focused?: boolean
  /** Stage 15.1 — host callback fired when the editor's Send → Duo
   *  pill is clicked. Receives an already-formatted payload string;
   *  the host writes it to the active terminal's PTY. `null` props
   *  the pill from rendering at all. */
  onSendToDuo?: ((payload: string) => void) | null
  /** 17a polish item 2 — host-supplied "open new-file interstitial"
   *  callback (mirrors ⌘N in App.tsx). Plain click on the tab-strip
   *  `+` button calls this; ⌥-click falls back to opening a new
   *  browser tab (preserves the pre-Stage-17 muscle memory). */
  onNewFile: () => void
  /** Stage 24 — current pin list, owned by App.tsx so the ⌘W
   *  keyboard handler can gate close-of-pinned-tab on a confirm
   *  modal at the App level. WorkingPane reads to mark which tabs
   *  render with the pin glyph + sort to leftmost. */
  pins: PinEntry[]
  /** Stage 24 — toggle a pin entry. WorkingPane builds the entry
   *  from the right-clicked tab's path/url/title and calls this;
   *  App.tsx persists via the pins service and updates the pins
   *  state. */
  onTogglePin: (entry: PinEntry) => Promise<void>
  /** Stage 23 — host-supplied dispatcher for canvas `data-duo-action`
   *  clicks. App.tsx owns the active-tab id, the tab spawn, and the
   *  browser routing logic, so dispatch lives there and CanvasTab
   *  just calls back. */
  onCanvasAction?: (action: import('@shared/types').CanvasAction) => Promise<{ ok: boolean; error?: string }>
  /** Stage 23 — user $HOME for the canvas trust check (only canvas
   *  files under ~/.claude/duo/ may dispatch actions in v1). */
  homeDir?: string
  /** BUG-037 — fires when the user clicks inside an HTML canvas
   *  iframe. Forwarded to App.tsx so it can flip `focusedColumn` to
   *  'working'. The column wrapper's own `onMouseDown` covers
   *  non-iframe surfaces (markdown editor, image preview, etc.) but
   *  iframe events don't bubble out, so the canvas needs an
   *  explicit forwarder. */
  onCanvasFocusGained?: () => void
  /** ENH-026 — Reveal a tab's underlying file in the navigator
   *  (selects + scrolls + expands). App.tsx owns the navigator. */
  onRevealInNavigator?: (path: string) => void
  /** ENH-026 — Move a tab's file to the Trash AND close the tab.
   *  App.tsx confirms (already done in the strip), calls
   *  `files.trash`, and closes the tab. */
  onTrashTabFile?: (id: string, path: string) => void
  /** ENH-026 — Reveal a tab's file in the navigator AND start
   *  rename mode on its row. */
  onStartRenameFromTab?: (path: string) => void
}

export function WorkingPane({
  fileTabs,
  activeWorking,
  setActiveWorking,
  closeFileTab,
  onOpenMarkdown,
  onTabDirtyChange,
  onCommitNewFile,
  focused = false,
  onSendToDuo,
  onNewFile,
  pins,
  onTogglePin,
  onCanvasAction,
  homeDir,
  onCanvasFocusGained,
  onRevealInNavigator,
  onTrashTabFile,
  onStartRenameFromTab
}: WorkingPaneProps) {
  const { tabs: browserTabs, addTab, switchTab, closeTab: closeBrowserTab } = useBrowserState()

  // Stage 24 — pinned tabs. Pins state owned by App.tsx (so the
  // ⌘W keyboard handler can also gate on pinned status); WorkingPane
  // receives the read API + toggle action via props.
  const isPinned = (kind: 'browser' | 'file', ref: string): boolean => {
    return pins.some(p => p.kind === kind && p.ref === ref)
  }

  const handleTogglePin = useCallback((stripId: string) => {
    const parsed = parseId(stripId)
    let entry: PinEntry | null = null
    if (parsed.kind === 'file') {
      const ft = fileTabs.find(f => f.id === parsed.id)
      if (!ft) return
      entry = { kind: 'file', ref: ft.path, title: ft.title }
    } else {
      const bt = browserTabs.find(b => b.id === parsed.id)
      if (!bt) return
      const url = bt.url
      if (!url || url === 'about:blank') return
      entry = { kind: 'browser', ref: url, title: bt.title }
    }
    void onTogglePin(entry)
  }, [fileTabs, browserTabs, onTogglePin])

  // Merge for the strip. Stable order: file tabs first (in insertion order),
  // then browser tabs by their id. The strip serializes both into the shared
  // `WorkingTab` shape. IDs in the merged view: file tabs carry their
  // string uuid; browser tabs' numeric ids get prefixed with "b:" so the
  // two namespaces can't collide inside the strip.
  const unsortedTabs: WorkingTab[] = [
    ...fileTabs.map(ft => ({
      id: stringifyFileId(ft.id),
      type: ft.type,
      title: ft.isNew ? `${ft.title} \u00b7 unsaved` : ft.title,
      path: ft.path,
      mime: ft.mime,
      dirty: ft.dirty || ft.isNew,
      isActive: activeWorking.kind === 'file' && activeWorking.id === ft.id,
      pinned: !ft.isNew && isPinned('file', ft.path)
    })),
    ...browserTabs.map(bt => ({
      id: stringifyBrowserId(bt.id),
      type: 'browser' as const,
      title: bt.title,
      url: bt.url,
      // Browser's own active flag survives at the main-process level, but
      // when a file tab is active in the strip, no browser tab should show
      // as active.
      isActive: activeWorking.kind === 'browser' && bt.isActive,
      pinned: !!bt.url && bt.url !== 'about:blank' && isPinned('browser', bt.url)
    }))
  ]

  // Stage 24 — pinned tabs sort to leftmost. Stable order within each
  // group preserves insertion order (file tabs first by file insertion,
  // then browser tabs in id order — matches the existing layout).
  const mergedTabs: WorkingTab[] = [
    ...unsortedTabs.filter(t => t.pinned),
    ...unsortedTabs.filter(t => !t.pinned)
  ]

  const handleSelect = (id: string) => {
    const parsed = parseId(id)
    if (parsed.kind === 'file') {
      setActiveWorking({ kind: 'file', id: parsed.id })
    } else {
      setActiveWorking({ kind: 'browser' })
      void switchTab(parsed.id)
    }
  }

  // BUG-038 v4 — useKeyboardShortcuts dispatches a CustomEvent for
  // ⌃Tab / ⌃⇧Tab in the working pane (since WorkingPane owns the
  // merged tab list and its pinned-first sort, not the hook). We
  // need refs because the listener installs once but mergedTabs +
  // active id rebuild every render — without the ref, the closure
  // would freeze the first render's state.
  const mergedTabsRef = useRef<WorkingTab[]>([])
  const activeIdRef = useRef<string>('')
  mergedTabsRef.current = mergedTabs
  // Compute the strip-id of the currently active tab so cycleNext
  // can find the right index. activeWorking carries the typed
  // identity; we re-encode to the strip namespace ("f:<uuid>" or
  // "b:<numericId>") for the lookup.
  const activeStripId = (() => {
    if (activeWorking.kind === 'file') return stringifyFileId(activeWorking.id)
    const activeBrowserTab = browserTabs.find(b => b.isActive)
    return activeBrowserTab ? stringifyBrowserId(activeBrowserTab.id) : ''
  })()
  activeIdRef.current = activeStripId

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ delta: 1 | -1 }>
      const delta = ce.detail?.delta
      if (delta !== 1 && delta !== -1) return
      const tabs = mergedTabsRef.current
      if (tabs.length === 0) return
      const nextId = cycleNext(tabs, activeIdRef.current, delta)
      if (nextId) handleSelect(nextId)
    }
    window.addEventListener('duo-cycle-working-tab', handler)
    return () => window.removeEventListener('duo-cycle-working-tab', handler)
    // handleSelect is recreated each render but reads through
    // refs / stable hooks; safe to omit from deps to avoid churning
    // the listener on every render. The ref reads inside the
    // handler always see fresh values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClose = (id: string) => {
    const parsed = parseId(id)
    if (parsed.kind === 'file') {
      closeFileTab(parsed.id)
    } else {
      void closeBrowserTab(parsed.id)
    }
  }

  // 17a polish item 2 — plain click on `+` opens the new-file
  // interstitial (parity with ⌘N — covers the most common post-Stage-17
  // intent: making a doc, not opening a website).
  //
  // ENH-006 (PR 4) — the new-browser-tab path used to ride on ⌥-click;
  // the split button on WorkingTabStrip now exposes it as a discrete
  // affordance, mirroring the terminal strip's `+` (claude) | `>`
  // (shell) split. Same dispatch landing point either way — focuses
  // the address bar after creation so the tab isn't dead on arrival.
  const handleNewBrowserTab = () => {
    setActiveWorking({ kind: 'browser' })
    void addTab().then(() => {
      // BUG-019 fix — see App.tsx § newBrowserTab for rationale.
      // Two RAFs push past React commit + paint so the address
      // bar is mounted before focus() runs.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const addr = document.querySelector<HTMLInputElement>('[data-duo-addressbar]')
          addr?.focus()
          addr?.select()
        })
      })
    })
  }

  // Renderer dispatch.
  let activeRenderer: React.ReactNode = null
  if (activeWorking.kind === 'browser') {
    activeRenderer = <BrowserRenderer onSendToDuo={onSendToDuo} />
  } else {
    const tab = fileTabs.find(ft => ft.id === activeWorking.id)
    if (!tab) {
      // Stale active id — fall back to browser.
      activeRenderer = <BrowserRenderer onSendToDuo={onSendToDuo} />
    } else if (tab.type === 'editor') {
      activeRenderer = (
        <MarkdownEditor
          key={tab.id}
          path={tab.path}
          isNew={tab.isNew}
          onDirtyChange={(d) => onTabDirtyChange(tab.id, d)}
          onCommitNewFile={(p, t) => onCommitNewFile(tab.id, p, t)}
          onCancelNew={() => closeFileTab(tab.id)}
          onSendToDuo={onSendToDuo}
        />
      )
    } else if (tab.type === 'html-canvas') {
      // Stage 17a + 17c — rendered + editable .html with Send → Duo,
      // just-added highlight on agent edits, and warn-before-overwrite
      // banner. Comments + CriticMarkup track-changes land in 17d/14.
      activeRenderer = (
        <CanvasTab
          key={tab.id}
          path={tab.path}
          onDirtyChange={(d) => onTabDirtyChange(tab.id, d)}
          onSendToDuo={onSendToDuo}
          onCanvasAction={onCanvasAction}
          homeDir={homeDir}
          // BUG-032 — only let the iframe steal focus when the user
          // has chosen the working pane. Without this, every iframe
          // load (mount, srcdoc reload, post-write rerender) re-grabs
          // focus from the terminal mid-typing.
          focused={focused}
          // BUG-037 — iframe mousedown forwards up to App.tsx so it
          // can flip focusedColumn to 'working'. Otherwise clicks
          // into the canvas while terminal had focus leave the
          // pane-focus signal stuck.
          onUserInteract={onCanvasFocusGained}
        />
      )
    } else if (tab.type === 'markdown-preview') {
      activeRenderer = (
        <MarkdownPreview
          path={tab.path}
          onOpenMarkdown={onOpenMarkdown}
        />
      )
    } else if (tab.type === 'image') {
      activeRenderer = <ImagePreview tab={asWorkingTab(tab)} />
    } else if (tab.type === 'pdf') {
      activeRenderer = <PdfPreview tab={asWorkingTab(tab)} />
    } else {
      activeRenderer = <UnknownFilePreview tab={asWorkingTab(tab)} />
    }
  }

  return (
    // Stage 12 Phase 3 — working pane sits on `paper` (surface-0) so the
    // active tab in WorkingTabStrip (also paper) reads as continuous with
    // the content below. Strip itself is paper-deep (surface-1) for
    // contrast. See docs/design/atelier/project/duo-components.jsx ~L286.
    <div className="flex flex-col w-full h-full bg-surface-0">
      <WorkingTabStrip
        tabs={mergedTabs}
        onSelect={handleSelect}
        onNewFile={onNewFile}
        onNewBrowserTab={handleNewBrowserTab}
        onClose={handleClose}
        onTogglePin={handleTogglePin}
        focused={focused}
        onRevealInNavigator={onRevealInNavigator}
        onTrashFile={onTrashTabFile}
        onStartRenameFromTab={onStartRenameFromTab}
      />
      {activeRenderer}
    </div>
  )
}

function asWorkingTab(ft: FileTab): WorkingTab {
  return {
    id: stringifyFileId(ft.id),
    type: ft.type,
    title: ft.title,
    isActive: true,
    path: ft.path,
    mime: ft.mime
  }
}

function stringifyFileId(id: string): string { return 'f:' + id }
function stringifyBrowserId(id: number): string { return 'b:' + id }
function parseId(id: string): { kind: 'file'; id: string } | { kind: 'browser'; id: number } {
  if (id.startsWith('f:')) return { kind: 'file', id: id.slice(2) }
  if (id.startsWith('b:')) return { kind: 'browser', id: parseInt(id.slice(2), 10) }
  throw new Error(`Invalid tab id: ${id}`)
}
