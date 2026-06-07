// Stage 10 Phase 5 — polymorphic WorkingPane shell.
//
// Merges browser tabs (owned by main-process BrowserManager via the
// `browser:*` IPC) with file tabs (owned by the renderer state that App.tsx
// passes down) into a single unified tab strip. A single active-tab state
// controls which renderer mounts below the strip.

import { useCallback, useEffect, useRef, useState } from 'react'
import { cycleNext } from '../keyboard/tabCycle'
import { BrowserRenderer } from './BrowserRenderer'
import { AuxBrowserSlot } from './AuxBrowserSlot'
import { MarkdownPreview } from './MarkdownPreview'
import { MarkdownEditor } from './editor/MarkdownEditor'
import { PageTab } from './Page/PageTab'
import { PdfPreview, UnknownFilePreview } from './FileRenderers'
import { ImageView } from './ImageView'
import { JsonView } from './Json/JsonView'
import { WorkingTabStrip } from './WorkingTabStrip'
import { useBrowserState } from '../hooks/useBrowserState'
import { classifyFile } from './fileClassifier'
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

/** ENH-041 / Sprint 3 — Split View aux state. v1 single-slot
 *  (paths.length always 0 or 1). Owned by App.tsx; passed in for
 *  rendering. State shape is multi-tab capable for v2 (Option B). */
export interface WorkingAuxLocalState {
  paths: string[]
  activeIndex: number
  splitPct: number
}

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
  /** ENH-176 — label override for the Send pill. Default behavior
   *  preserved: when omitted, each surface defaults to "Send →
   *  agent". App.tsx flips this to "Send → Terminal" when the
   *  terminal feature flag is on and claudePresence is NOT 'claude'. */
  pillLabel?: string
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
   *  browser routing logic, so dispatch lives there and PageTab
   *  just calls back. */
  onPlaygroundAction?: (action: import('@shared/types').PlaygroundAction) => Promise<{ ok: boolean; error?: string }>
  /** Stage 23 — user $HOME for the canvas trust check (only canvas
   *  files under ~/.claude/duo/ may dispatch actions in v1). */
  homeDir?: string
  /** BUG-037 — fires when the user clicks inside an HTML canvas
   *  iframe. Forwarded to App.tsx so it can flip `focusedColumn` to
   *  'working'. The column wrapper's own `onMouseDown` covers
   *  non-iframe surfaces (markdown editor, image preview, etc.) but
   *  iframe events don't bubble out, so the canvas needs an
   *  explicit forwarder. */
  onPageFocusGained?: () => void
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
  /** ENH-041 / Sprint 3 — Split View aux state. null = closed
   *  (single-column layout); non-null = render side-by-side with
   *  splitPct controlling the main:aux ratio. v1 paths.length ≤ 1. */
  auxState?: WorkingAuxLocalState | null
  /** Sprint 7 Phase 3c — browser tab pinned to Split View aux. When
   *  set, the aux pane renders an `<AuxBrowserSlot>` over the
   *  BrowserManager's auxTabId-tagged WebContentsView (no React
   *  iframe — same path as the main browser pane, so scripts run
   *  exactly as they would in main). Mutually exclusive with
   *  auxState (a file in aux clears any browser pin and vice versa).
   *  v1 single-slot only. */
  auxBrowserTab?: {
    id: number
    url: string
    title: string
    splitPct: number
  } | null
  /** Phase 3c — right-click "Move to Split View" on a browser tab in
   *  the main strip routes here. Threaded through to WorkingTabStrip;
   *  carries the numeric BrowserTab id (extracted from `b:<n>`). */
  onMoveBrowserTabToSplit?: (browserTabId: number) => void
  /** ENH-041 — close the aux pane (✕ button in AuxHeader). */
  onAuxClose?: () => void
  /** ENH-041 — promote aux's active tab back to main + close aux. */
  onAuxPromote?: () => void
  /** ENH-041 — divider drag updates splitPct (clamped [0.20, 0.80]). */
  onAuxResize?: (pct: number) => void
  /** Sprint 3 Phase 3b — move a tab's file into the Split View aux
   *  slot. Threaded through to WorkingTabStrip's right-click menu;
   *  surfaces only on file tabs (browser-in-aux is Phase 3c). */
  onMoveTabToSplit?: (path: string) => void
  /** ENH-097 — "Edit in canvas" on file:// browser tabs. Closes the
   *  browser tab and re-opens the file in canvas mode (forces
   *  canvas-mode mount even if the file declares browser as default). */
  onEditBrowserTabInCanvas?: (browserTabId: number, path: string) => void
  /** ENH-131 — "Open in browser" on canvas tabs backed by an HTML file.
   *  Inverse of `onEditBrowserTabInCanvas` — closes the canvas tab and
   *  re-opens the same path as a browser tab so scripts run / buttons
   *  fire (the playground modality). */
  onOpenCanvasTabInBrowser?: (fileTabId: string, path: string) => void
  /** ENH-083 (v0.6.5) — collapse-canvas pane control, moved from
   *  titlebar to the new-tab cluster. App.tsx owns the splitPct state
   *  and the collapse semantics; WorkingPane just threads the props
   *  through to WorkingTabStrip. */
  isCanvasCollapsed?: boolean
  onToggleCanvasCollapsed?: () => void
  /** ENH-085 (v0.6.5) — destructive trash from the aux header right-
   *  click menu. App.tsx implements: confirm via system dialog →
   *  files.trash(path) → setAuxState(null). The strip pattern
   *  (WorkingTabStrip) keeps the confirm INSIDE the strip; we mirror
   *  that here so AuxHeader stays self-contained. */
  onAuxTrash?: (path: string) => void
  /** ENH-182 Phase 2 — when a project focus is active, the host
   *  passes the set of file-tab ids that belong to the focused
   *  project (plus pinned cross-project tabs). The strip filters
   *  to these; mount loops below stay full-sized so editor state
   *  isn't lost for hidden tabs. `undefined` = no focus, show all. */
  visibleFileTabIds?: ReadonlySet<string>
  /** ENH-182 Phase 2b — set of browser-tab ids (BrowserTab.id) that
   *  belong to the focused project (via file:// path membership) OR
   *  are non-file URLs treated as cross-project reference material.
   *  Same `undefined` semantics as visibleFileTabIds. */
  visibleBrowserTabIds?: ReadonlySet<number>
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
  pillLabel,
  visibleFileTabIds,
  visibleBrowserTabIds,
  onNewFile,
  pins,
  onTogglePin,
  onPlaygroundAction,
  auxBrowserTab,
  onMoveBrowserTabToSplit,
  homeDir,
  onPageFocusGained,
  onRevealInNavigator,
  onTrashTabFile,
  onStartRenameFromTab,
  auxState,
  onAuxClose,
  onAuxPromote,
  onAuxResize,
  onMoveTabToSplit,
  onEditBrowserTabInCanvas,
  onOpenCanvasTabInBrowser,
  isCanvasCollapsed = false,
  onToggleCanvasCollapsed,
  onAuxTrash
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
    // Sprint 7 Phase 3c — browser tabs marked `inAux` are pinned to
    // Split View and do NOT belong in the main strip's list. Filter
    // them out before merging so they don't render as duplicates.
    // The aux pane finds its tab by browserTabId via auxBrowserTab.
    ...browserTabs.filter(bt => !bt.inAux).map(bt => ({
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

  // ENH-042 — user-controlled tab order. tabOrder is a per-session
  // list of strip-ids that the merge sorts by; new tabs append, closed
  // tabs drop. Reorder operations (drag, "Move left/right" menu)
  // mutate tabOrder. Within each pinned/unpinned zone, sort by
  // tabOrder index; cross-zone reorder is rejected (pinned stays
  // pinned-leftmost). Not persisted across launches — file-tab ids
  // are uuids generated on creation, so cross-launch state would have
  // no anchor to map to. Session-local is enough; the user re-orders
  // tabs they've just opened, not tabs from yesterday.
  const [tabOrder, setTabOrder] = useState<string[]>([])

  // ENH-084 (v0.6.5) — DEFECT, deferred to v0.6.6 → carried 3 sprints →
  // Sprint 17 commit 6 (2026-05-11) v4 INSTRUMENTATION PASS. Three v1-v3
  // attempts at exclusive subpane focus all failed; see tasks.md § ENH-084
  // for the full history. The state + refs are kept (no harm; they're
  // cheap). v4 task entry warning: "design the fix from data, not theory."
  // The useEffect below installs document-level focusin + mousedown
  // listeners that log `[ENH-084-v4]` entries identifying which subpane
  // the event targets (via mainColRef / auxColRef containment). Owner
  // walks for ~60s clicking between main and aux; the captured stream
  // names which signal correctly tracks subpane focus. Fix design follows.
  const [focusedSubpane] = useState<'main' | 'aux'>('main')

  // ENH-084 v4 — column refs for the instrumentation pass below.
  // Attached to the main + aux column wrappers; the focusin / mousedown
  // listeners use `.contains(target)` to classify each event's subpane.
  const mainColRef = useRef<HTMLDivElement | null>(null)
  const auxColRef = useRef<HTMLDivElement | null>(null)

  // ENH-084 v4 — INSTRUMENTATION ONLY. NO behavior change. Logs:
  //   - focusin    target element + which subpane (main / aux / neither)
  //   - mousedown  ditto
  //   - blur       target element + which subpane it left
  // Plus onPageFocusGained gets its own log when invoked. After owner
  // walks for 60s, grep [ENH-084-v4] in /tmp/duo-dev-*.log to read the
  // event stream + decide which signal source is the right driver.
  //
  // BUG-167 (folded into ENH-182) — opt-in flag. This pass was filed as
  // "INSTRUMENTATION ONLY" but never re-gated, so it shipped to release
  // builds and floods the console on every focusin/mousedown/blur. Now
  // gated behind `localStorage.duo.debug.focus === '1'` (read once on
  // mount). Silent in release; if the subpane-focus work resumes, set
  // the flag in DevTools and reload to re-arm the stream. Deliberate
  // asymmetry: developer-only, no `duo` verb (not a product surface).
  useEffect(() => {
    let focusDebug = false
    try { focusDebug = localStorage.getItem('duo.debug.focus') === '1' } catch { /* storage disabled */ }
    if (!focusDebug) return
    const subpaneOf = (target: EventTarget | null): 'main' | 'aux' | 'neither' => {
      if (!(target instanceof Node)) return 'neither'
      if (mainColRef.current?.contains(target)) return 'main'
      if (auxColRef.current?.contains(target)) return 'aux'
      return 'neither'
    }
    const describe = (target: EventTarget | null): string => {
      if (!(target instanceof Element)) return target instanceof Node ? `<${target.nodeName}>` : 'none'
      const tag = target.tagName.toLowerCase()
      const id = target.id ? `#${target.id}` : ''
      const cls = target.className && typeof target.className === 'string'
        ? `.${target.className.split(/\s+/).slice(0, 2).join('.')}`
        : ''
      return `${tag}${id}${cls}`
    }
    // Use single-string log args so the renderer→main forwarder
    // captures the full payload (object args render as [object Object]
    // in the dev log even though devtools shows them in full).
    const onFocusin = (e: FocusEvent) => {
      console.log(`[ENH-084-v4] ${Date.now()} focusin subpane=${subpaneOf(e.target)} target=${describe(e.target)}`)
    }
    const onMousedown = (e: MouseEvent) => {
      console.log(`[ENH-084-v4] ${Date.now()} mousedown subpane=${subpaneOf(e.target)} target=${describe(e.target)}`)
    }
    const onBlur = (e: FocusEvent) => {
      console.log(`[ENH-084-v4] ${Date.now()} blur subpane=${subpaneOf(e.target)} target=${describe(e.target)}`)
    }
    document.addEventListener('focusin', onFocusin, true)
    document.addEventListener('mousedown', onMousedown, true)
    document.addEventListener('blur', onBlur, true)
    return () => {
      document.removeEventListener('focusin', onFocusin, true)
      document.removeEventListener('mousedown', onMousedown, true)
      document.removeEventListener('blur', onBlur, true)
    }
  }, [])
  // Keep tabOrder reconciled with current strip ids: append unknown
  // ids in their insertion order, drop ids no longer present. The
  // join is the dep — string identity is fine here, list is short.
  const currentIdsKey = unsortedTabs.map(t => t.id).join(',')
  useEffect(() => {
    setTabOrder(prev => {
      const present = new Set(unsortedTabs.map(t => t.id))
      const filtered = prev.filter(id => present.has(id))
      const known = new Set(filtered)
      const appended = unsortedTabs.map(t => t.id).filter(id => !known.has(id))
      if (filtered.length === prev.length && appended.length === 0) return prev
      return [...filtered, ...appended]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdsKey])

  const orderIdx = new Map(tabOrder.map((id, i) => [id, i]))
  const byOrder = (a: WorkingTab, b: WorkingTab) =>
    (orderIdx.get(a.id) ?? Number.POSITIVE_INFINITY) -
    (orderIdx.get(b.id) ?? Number.POSITIVE_INFINITY)

  // Pinned tabs sort to leftmost (Stage 24); ENH-042 layers tabOrder
  // on top, sorting WITHIN each zone independently so a user reorder
  // never crosses the pinned/unpinned boundary.
  const mergedTabsAll: WorkingTab[] = [
    ...unsortedTabs.filter(t => t.pinned).sort(byOrder),
    ...unsortedTabs.filter(t => !t.pinned).sort(byOrder)
  ]
  // ENH-182 Phase 2 + Phase 2b — visibility filter. When focus is
  // active, the host passes the set of file-tab ids AND browser-tab
  // ids that belong to the focused project (or are cross-project
  // pinned reference material). Drop everything not in either set.
  // Pinned-tab gate still applies (cross-project refs). Mount loops
  // below stay full-sized so editor state isn't lost for hidden tabs.
  const mergedTabs: WorkingTab[] = visibleFileTabIds
    ? mergedTabsAll.filter((t) => {
        if (t.pinned) return true
        if (t.type === 'browser') {
          // Phase 2b: gate browser tabs by visibleBrowserTabIds when
          // provided. The host computes this from file:// path mem-
          // bership + non-file-URL passthrough; defensively allow if
          // the host didn't supply (parity with the Phase 2 first cut
          // behavior — no regression for callers not yet on Phase 2b).
          if (!visibleBrowserTabIds) return true
          const browserId = t.id.startsWith('b:') ? Number(t.id.slice(2)) : NaN
          return Number.isFinite(browserId) && visibleBrowserTabIds.has(browserId)
        }
        // file-tab id shape is "f:<uuid>" — strip prefix for the set lookup.
        const fileId = t.id.startsWith('f:') ? t.id.slice(2) : t.id
        return visibleFileTabIds.has(fileId)
      })
    : mergedTabsAll

  // ENH-042 — reorder a tab to land before/after a target in the same
  // zone. If source was originally to target's LEFT, insert AFTER
  // target (drag-rightward intent); if RIGHT, insert BEFORE target
  // (drag-leftward intent). Cross-zone moves silently no-op so the
  // pinned-leftmost guarantee survives. Also no-ops on self-drop.
  const reorderTab = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    setTabOrder(prev => {
      const sourceIdx = prev.indexOf(sourceId)
      const targetIdx = prev.indexOf(targetId)
      if (sourceIdx < 0 || targetIdx < 0) return prev
      const without = prev.filter(id => id !== sourceId)
      const newTargetIdx = without.indexOf(targetId)
      if (newTargetIdx < 0) return prev
      const insertAt = sourceIdx < targetIdx ? newTargetIdx + 1 : newTargetIdx
      return [...without.slice(0, insertAt), sourceId, ...without.slice(insertAt)]
    })
  }, [])

  const handleSelect = (id: string) => {
    const parsed = parseId(id)
    console.debug('[BUG-079]', Date.now(), 'handleSelect entry', { id, parsedKind: parsed.kind })
    if (parsed.kind === 'file') {
      setActiveWorking({ kind: 'file', id: parsed.id })
    } else {
      setActiveWorking({ kind: 'browser' })
      console.debug('[BUG-079]', Date.now(), 'invoking switchTab IPC', { browserId: parsed.id })
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
      console.debug('[BUG-079]', Date.now(), 'WorkingPane handler entry', { delta, prevActive: activeIdRef.current })
      const tabs = mergedTabsRef.current
      if (tabs.length === 0) return
      const nextId = cycleNext(tabs, activeIdRef.current, delta)
      console.debug('[BUG-079]', Date.now(), 'cycleNext returned', { nextId, tabsLen: tabs.length })
      if (nextId) {
        // BUG-076 v2 (v0.6.5) — optimistically update activeIdRef
        // BEFORE the React re-render lands. handleSelect dispatches
        // setActiveWorking + switchTab(id), but switchTab's tabs-
        // change IPC is async (main → renderer). If the user presses
        // ⌃Tab faster than the round-trip, the next press reads stale
        // activeIdRef.current (still the previous id), cycleNext
        // returns the SAME nextId again, and switchTab short-circuits
        // because idx === activeIndex. Cycle silently drops. Updating
        // the ref synchronously means subsequent presses see the
        // user's intent immediately; React state catches up on the
        // next render.
        activeIdRef.current = nextId
        console.debug('[BUG-079]', Date.now(), 'calling handleSelect', { nextId })
        handleSelect(nextId)
        console.debug('[BUG-079]', Date.now(), 'handleSelect returned (sync part complete)')
      }
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

  // BUG-046 — keep every file-tab renderer mounted permanently and
  // toggle visibility via display:none. Switching between markdown
  // tabs no longer tears down + re-spins-up the TipTap editor, which
  // was the source of the visible 1–2s render delay BUG-038's smoke
  // walk surfaced. Mirrors the TerminalPane pattern (xterm instances
  // stay mounted across tab switches).
  //
  // BrowserRenderer stays mount/unmount because it's a singleton
  // wrapper around the native WebContentsView pool — the WCV is
  // already kept alive across tab cycles by BrowserManager itself,
  // and BrowserRenderer's unmount cleanup (collapse to 1×1) is what
  // lets a file tab take over the visible region. Always-mounting
  // BrowserRenderer would race the bounds push against display:none.
  const isFileActive = (tabId: string) =>
    activeWorking.kind === 'file' && activeWorking.id === tabId

  function renderFileTab(tab: FileTab): React.ReactNode {
    // ENH-113 — the "file removed on disk" strip's Close button. A MAIN tab
    // closes by id; the SPLIT-VIEW aux tab carries a synthesized `aux:` id that
    // is NOT in fileTabs (so closeFileTab would silently no-op), so it dismisses
    // the aux slot via onAuxClose instead. If no aux-close handler is wired the
    // button hides (onCloseTab undefined) rather than dead-clicking. Unlike ⌘W /
    // `duo close-tab`, this deliberately skips the pinned-tab confirm — a removed
    // file's pin already points at a deleted path, so closing it silently is fine.
    const onCloseTab = tab.id.startsWith('aux:') ? onAuxClose : (() => closeFileTab(tab.id))
    if (tab.type === 'editor') {
      return (
        <MarkdownEditor
          path={tab.path}
          isNew={tab.isNew}
          // FOLLOWUP-014/walk-2 — gates `onImageInsert` IPC subscription
          // so only the active editor responds to `duo image insert`.
          // Pre-fix every mounted MarkdownEditor responded; first reply
          // won; image landed in the wrong file when multiple tabs were
          // open. Same race shape as the doc-read bug.
          isActive={isFileActive(tab.id)}
          onDirtyChange={(d) => onTabDirtyChange(tab.id, d)}
          onCommitNewFile={(p, t) => onCommitNewFile(tab.id, p, t)}
          onCancelNew={() => closeFileTab(tab.id)}
          onCloseTab={onCloseTab}
          onSendToDuo={onSendToDuo}
          pillLabel={pillLabel}
        />
      )
    }
    if (tab.type === 'page') {
      // Stage 17a + 17c — rendered + editable .html with Send → Duo,
      // just-added highlight on agent edits, and warn-before-overwrite
      // banner. Comments + CriticMarkup track-changes land in 17d/14.
      return (
        <PageTab
          path={tab.path}
          onDirtyChange={(d) => onTabDirtyChange(tab.id, d)}
          onSendToDuo={onSendToDuo}
          pillLabel={pillLabel}
          onPlaygroundAction={onPlaygroundAction}
          homeDir={homeDir}
          // BUG-032 + BUG-046 — only let the iframe steal focus when
          // the user has chosen the working pane AND this tab is the
          // active one. Without the active gate, hidden canvases would
          // try to claim focus when ⌘` lands in the working pane.
          focused={focused && isFileActive(tab.id)}
          // FOLLOWUP-014/walk-2 — gates `onImageInsert` IPC subscription
          // so only the active canvas responds to `duo image insert`.
          // Same race shape as the doc-read bug; without the gate older
          // canvases (from session restore) would win the response race.
          isActive={isFileActive(tab.id)}
          // BUG-037 — iframe mousedown forwards up to App.tsx so it
          // can flip focusedColumn to 'working'. Otherwise clicks
          // into the canvas while terminal had focus leave the
          // pane-focus signal stuck.
          onUserInteract={onPageFocusGained}
          onCloseTab={onCloseTab}
        />
      )
    }
    if (tab.type === 'markdown-preview') {
      return (
        <MarkdownPreview
          path={tab.path}
          onOpenMarkdown={onOpenMarkdown}
        />
      )
    }
    if (tab.type === 'image') return <ImageView tab={asWorkingTab(tab)} />
    if (tab.type === 'pdf') return <PdfPreview tab={asWorkingTab(tab)} />
    if (tab.type === 'json') {
      // ENH-110 — JSON / YAML viewer-editor. Tree view default + raw-
      // text source toggle. Format (json|yaml) is implicit from the
      // path extension (formatFromPath in jsonFormat.ts).
      return (
        <JsonView
          path={tab.path}
          onDirtyChange={(d) => onTabDirtyChange(tab.id, d)}
          // ENH-195 — gates the `duo json set|merge` IPC subscription so
          // only the active viewer responds (same race guard as the
          // MarkdownEditor / PageTab onImageInsert wiring).
          isActive={isFileActive(tab.id)}
          onCloseTab={onCloseTab}
        />
      )
    }
    return <UnknownFilePreview tab={asWorkingTab(tab)} />
  }

  // ENH-041 / Sprint 3 → Sprint 7 Phase 3c — Split View. Two slot
  // kinds today, mutually exclusive: a file path (auxState.paths) or
  // a pinned browser tab (auxBrowserTab). Either one being set
  // counts as splitOpen. The splitPct is read from whichever slot is
  // active. v1 single-slot only.
  const fileSplitOpen = !!(auxState && auxState.paths.length > 0)
  const browserSplitOpen = !!auxBrowserTab
  const splitOpen = fileSplitOpen || browserSplitOpen
  const auxPath = fileSplitOpen ? (auxState!.paths[auxState!.activeIndex] ?? auxState!.paths[0]) : null
  const auxFileTab: FileTab | null = auxPath ? buildAuxFileTab(auxPath) : null
  const activeSplitPct = browserSplitOpen
    ? auxBrowserTab!.splitPct
    : (auxState?.splitPct ?? 0.5)

  // Main pane — owned by App.tsx, never persists across session
  // unmount; the existing WorkingTabStrip + render logic. Wrapped so
  // the layout can compose main + aux side-by-side when split is
  // open.
  const mainPaneFragment = (
    <>
      <WorkingTabStrip
        onReorderTab={reorderTab}
        tabs={mergedTabs}
        onSelect={handleSelect}
        onNewFile={onNewFile}
        onNewBrowserTab={handleNewBrowserTab}
        onClose={handleClose}
        onTogglePin={handleTogglePin}
        // ENH-084 v2 (v0.6.5) — exclusive subpane glow. Main strip
        // glows ONLY when working column has focus AND main is the
        // active subpane. focusedSubpane is updated via the document-
        // level focusin listener above, which sees iframe focus
        // events that mousedownCapture missed. When split is closed,
        // focusedSubpane is always 'main' (default + reset effect).
        focused={focused && focusedSubpane === 'main'}
        onRevealInNavigator={onRevealInNavigator}
        onTrashFile={onTrashTabFile}
        onStartRenameFromTab={onStartRenameFromTab}
        onMoveToSplit={onMoveTabToSplit}
        onMoveBrowserTabToSplit={onMoveBrowserTabToSplit}
        onEditInCanvas={onEditBrowserTabInCanvas}
        onOpenInBrowser={onOpenCanvasTabInBrowser}
        isCanvasCollapsed={isCanvasCollapsed}
        onToggleCanvasCollapsed={onToggleCanvasCollapsed}
      />
      {/* BUG-046 — each file tab renders inside an absolutely-
          positioned wrapper with display gated on activity. All
          renderers stay mounted; only the active one is visible. */}
      <div className="flex-1 min-h-0 relative">
        {fileTabs.map(tab => (
          <div
            key={tab.id}
            className="absolute inset-0 flex flex-col"
            style={{ display: isFileActive(tab.id) ? 'flex' : 'none' }}
          >
            {renderFileTab(tab)}
          </div>
        ))}
        {(activeWorking.kind === 'browser' ||
          (activeWorking.kind === 'file' &&
            !fileTabs.some(ft => ft.id === activeWorking.id))) && (
          // Browser is the active surface, OR we have a stale file id
          // (closeFileTab usually flips back to 'browser', but defend
          // against any race that leaves activeWorking pointing at a
          // missing tab — fall back to the browser pane).
          <div className="absolute inset-0 flex flex-col">
            <BrowserRenderer onSendToDuo={onSendToDuo} pillLabel={pillLabel} />
          </div>
        )}
      </div>
    </>
  )

  return (
    // Stage 12 Phase 3 — working pane sits on `paper` (surface-0) so the
    // active tab in WorkingTabStrip (also paper) reads as continuous with
    // the content below. Strip itself is paper-deep (surface-1) for
    // contrast. See docs/design/atelier/project/duo-components.jsx ~L286.
    //
    // ENH-041 — when splitOpen is false, the working pane is a single
    // column (the historical layout). When true, switches to a
    // horizontal flex with main + divider + aux columns.
    <div className={`w-full h-full bg-surface-0 ${splitOpen ? 'flex' : 'flex flex-col'}`}>
      {/* Main column. min-w-0 lets the flex child shrink past its
          intrinsic content width when the user drags the divider.
          ENH-084 deferred to v0.6.6 — see tasks.md for the v1/v2/v3
          attempt history. The column wrapper has no focus signal
          plumbed in v0.6.5; revisit in Sprint 5 with diagnostic
          instrumentation BEFORE writing the v4 fix. */}
      <div
        ref={mainColRef}
        className="flex flex-col min-w-0"
        style={splitOpen ? { flex: `${(1 - activeSplitPct) * 100} 0 0%` } : { flex: '1 0 auto' }}
      >
        {mainPaneFragment}
      </div>
      {splitOpen && (
        <>
          <SplitViewDivider
            splitPct={activeSplitPct}
            onResize={onAuxResize}
          />
          <div
            ref={auxColRef}
            className="flex flex-col min-w-0 border-l border-paper-rule"
            style={{ flex: `${activeSplitPct * 100} 0 0%` }}
            // ENH-098 (Sprint 9 walk-1) — marker so focusPane('aux')
            // can target the aux subtree's editor (vs. the main one).
            // Both main + aux editors carry [data-duo-workingpane], so
            // a generic selector picks the DOM-first one (almost
            // always main) — disambiguation lives in this attribute.
            data-duo-workingpane-aux="1"
          >
            {browserSplitOpen && auxBrowserTab && (
              <AuxBrowserSlot
                browserTabId={auxBrowserTab.id}
                url={auxBrowserTab.url}
                title={auxBrowserTab.title}
                onClose={onAuxClose}
                onPromote={onAuxPromote}
                focused={focused && focusedSubpane === 'aux'}
              />
            )}
            {fileSplitOpen && auxFileTab && (
              <>
                <AuxHeader
                  path={auxFileTab.path}
                  title={auxFileTab.title}
                  onClose={onAuxClose}
                  onPromote={onAuxPromote}
                  // ENH-084 — focus glow on aux header when the aux
                  // subpane has focus.
                  focused={focused && focusedSubpane === 'aux'}
                  // ENH-085 (v0.6.5) — right-click parity with main canvas
                  // tab. The reveal/rename/trash callbacks already exist
                  // on WorkingPane for the main strip; thread them through
                  // to AuxHeader's handleContextMenu.
                  onRevealInNavigator={onRevealInNavigator}
                  onStartRenameFromTab={onStartRenameFromTab}
                  onAuxTrash={onAuxTrash}
                />
                <div className="flex-1 min-h-0 relative">
                  <div className="absolute inset-0 flex flex-col">
                    {renderFileTab(auxFileTab)}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** ENH-041 — construct a FileTab from a path. Used by aux to render
 *  the aux's active path through the same renderFileTab helper main
 *  uses. The id is path-derived (stable) so re-renders don't churn
 *  React keys. dirty/isNew aren't tracked for aux in v1 (Phase 3c
 *  promotes that). */
function buildAuxFileTab(path: string): FileTab {
  // classifyFile returns a non-'browser' subset of WorkingTabType for
  // local file paths — exactly what FileTab.type requires. Aux v1
  // doesn't support browser kinds anyway (no http(s):// URLs in aux);
  // Phase 3c handles browser-in-aux properly.
  const { type, mime } = classifyFile(path)
  return {
    id: `aux:${path}`,
    type,
    path,
    title: path.split('/').pop() ?? path,
    mime
  }
}

/** ENH-041 — slim aux header. Shows the aux file's basename + a
 *  promote button + a close button. Mirrors the WorkingTabStrip's
 *  visual register (paper-deep background, ink text) so the split
 *  reads as one product. v1: no aux tab strip (single-slot); only
 *  active path + chrome.
 *
 *  ENH-085 (v0.6.5) — right-click parity with main canvas tab.
 *  Menu items: Reveal in navigator / Rename / Copy path / Move
 *  back to main / Move to Trash. Same NSMenu-via-IPC pattern as
 *  WorkingTabStrip § handleContextMenu (ENH-050).
 *
 *  No focus tracking yet — Phase 3b layers in pane-aware ⌘W /
 *  ⌃Tab routing. v1 buttons fire prop callbacks directly.
 */
function AuxHeader({
  path,
  title,
  focused = false,
  onClose,
  onPromote,
  onRevealInNavigator,
  onStartRenameFromTab,
  onAuxTrash
}: {
  path: string
  title: string
  /** ENH-084 (v0.6.5) — when the aux subpane has focus, paint the
   *  header with the same accent-soft treatment WorkingTabStrip uses
   *  for its focused-strip indicator. WorkingPane decides via its
   *  internal `focusedSubpane` state. */
  focused?: boolean
  onClose?: () => void
  onPromote?: () => void
  onRevealInNavigator?: (path: string) => void
  onStartRenameFromTab?: (path: string) => void
  /** ENH-085 (v0.6.5) — destructive trash from aux header right-click.
   *  App.tsx implements: confirm via system dialog → files.trash(path)
   *  → setAuxState(null). The strip pattern (WorkingTabStrip) confirms
   *  inside the strip; we keep that pattern here for parity. */
  onAuxTrash?: (path: string) => void
}): JSX.Element {
  // ENH-085 — right-click → native NSMenu via main process. Same
  // pattern as WorkingTabStrip § handleContextMenu (ENH-050). The
  // renderer fires `menu.popup({items})` and dispatches by chosen id.
  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    const items: import('@shared/types').MenuTemplateItem[] = []
    if (onRevealInNavigator) {
      items.push({ id: 'aux-reveal', label: 'Reveal in navigator' })
    }
    if (onStartRenameFromTab) {
      items.push({ id: 'aux-rename', label: 'Rename…' })
    }
    items.push({ id: 'aux-copy-path', label: 'Copy path' })
    if (onPromote) {
      if (items.length > 0) items.push({ id: 'aux-sep-1', type: 'separator' })
      items.push({ id: 'aux-promote', label: 'Move back to main' })
    }
    if (onAuxTrash) {
      if (items.length > 0) items.push({ id: 'aux-sep-2', type: 'separator' })
      items.push({ id: 'aux-trash', label: 'Move to Trash…' })
    }
    if (items.length === 0) return
    const result = await window.electron.menu.popup({
      items,
      x: e.clientX,
      y: e.clientY
    })
    if (!result.chosenId) return
    switch (result.chosenId) {
      case 'aux-reveal':
        onRevealInNavigator?.(path)
        return
      case 'aux-rename':
        onStartRenameFromTab?.(path)
        return
      case 'aux-copy-path':
        // BUG-105 (Sprint 10) — route through main's clipboard
        // module; the renderer-side API silently rejects when fired
        // from a native NSMenu callback (no user-gesture context).
        try { await window.electron.clipboard.writeText(path) } catch { /* perm denied */ }
        return
      case 'aux-promote':
        onPromote?.()
        return
      case 'aux-trash': {
        if (!onAuxTrash) return
        const confirm = await window.electron.dialog.confirm({
          title: `Move "${title}" to the Trash?`,
          message: 'The file will be moved to the macOS Trash. You can restore it from there. The Split View will close.',
          buttons: ['Cancel', 'Move to Trash'],
          defaultId: 1,
          cancelId: 0,
          type: 'warning'
        })
        if (confirm.response === 1) onAuxTrash(path)
        return
      }
    }
  }

  return (
    <div
      className={[
        'flex items-center gap-2 h-9 px-3 border-b transition-colors',
        // ENH-084 — focused state mirrors WorkingTabStrip's accent-soft
        // treatment so the user sees which subpane will receive ⌃Tab,
        // ⌘W, etc. when the working column has focus.
        focused
          ? 'bg-accent-soft border-accent text-ink'
          : 'bg-paper-deep border-paper-rule text-ink-soft'
      ].join(' ')}
      title={path}
      onContextMenu={(e) => { void handleContextMenu(e) }}
    >
      <span className="text-[11px] uppercase tracking-wide text-ink-mute">Split</span>
      <span className="text-sm truncate flex-1 text-ink">{title}</span>
      {/* Sprint 7 rev6 — single ✕ button replaces the ⇤ + ✕ pair.
          App.tsx wires both onAuxClose and onAuxPromote to
          splitViewPromote so closing the split also promotes the file
          back to a main-pane tab. The right-click "Move back to main"
          menu entry remains as a synonym. */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="text-ink-mute hover:text-ink px-1.5 py-0.5 rounded"
          title="Move back to main (⌘⇧\\)"
          aria-label="Move back to main"
        >
          ✕
        </button>
      )}
    </div>
  )
}

/** ENH-041 — vertical drag-divider between main + aux columns.
 *  Mirrors the existing terminal/canvas split-divider behavior
 *  (BUG-031's overlay-during-drag pattern). v1: drag to resize
 *  with [0.20, 0.80] clamp matching the locked spec. Double-click
 *  resets to 50/50. */
function SplitViewDivider({
  splitPct,
  onResize
}: {
  splitPct: number
  onResize?: (pct: number) => void
}): JSX.Element {
  const draggingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    draggingRef.current = true
    // Cache the parent flex row so we can compute pct against its
    // bounding rect in onMouseMove. The divider lives between two
    // flex children inside that parent.
    containerRef.current = (e.currentTarget.parentElement as HTMLDivElement | null)
    // BUG-031 — install a transparent overlay during drag so iframe /
    // WebContentsView surfaces don't trap mousemove events.
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;'
    overlay.dataset.duoSplitDragOverlay = '1'
    document.body.appendChild(overlay)

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      const c = containerRef.current
      if (!c) return
      const r = c.getBoundingClientRect()
      if (r.width <= 0) return
      // splitPct is the AUX width fraction (right column). x increases
      // L→R; aux is on the right so as we drag RIGHT (increasing x),
      // aux gets SMALLER, main grows. So splitPct = (right edge - x) / width.
      const auxFrac = (r.right - ev.clientX) / r.width
      const clamped = Math.min(Math.max(auxFrac, 0.20), 0.80)
      onResize?.(clamped)
    }
    const onUp = () => {
      draggingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const existing = document.querySelector<HTMLDivElement>('[data-duo-split-drag-overlay]')
      existing?.parentNode?.removeChild(existing)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [onResize])

  const onDoubleClick = useCallback(() => {
    onResize?.(0.5)
  }, [onResize])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Split View divider"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className="w-1 cursor-col-resize bg-paper-rule hover:bg-accent/40 transition-colors flex-shrink-0"
      style={{ flex: '0 0 4px' }}
      title={`Split: ${Math.round(splitPct * 100)}% aux · drag to resize · double-click to reset`}
    />
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
