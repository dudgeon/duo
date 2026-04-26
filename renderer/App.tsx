import { useState, useCallback, useRef, useEffect } from 'react'
import { TabBar } from './components/TabBar'
import { TerminalPane } from './components/TerminalPane'
import { WorkingPane } from './components/WorkingPane'
import type { FileTab, ActiveWorking } from './components/WorkingPane'
import { classifyFile } from './components/fileClassifier'
import { FilesPane } from './components/FilesPane'
import { ThemeToggle } from './components/ThemeToggle'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useNavigator, computePendingCwd } from './hooks/useNavigator'
import { useTheme } from './hooks/useTheme'
import { useSelectionFormat } from './hooks/useSelectionFormat'
import type { TabSession, DirEntry } from '@shared/types'

// Stage 10 § D32: auto-collapse the Files column on windows narrower than
// this. The user can manually re-expand; we don't re-collapse again unless
// the threshold is re-crossed (hysteresis prevents jitter).
const AUTO_COLLAPSE_WIDTH = 1100

// Stage 9: cozy-mode persistence keys. Per-tab map survives within a
// session but tab UUIDs don't span relaunches; the last-choice flag is the
// durable piece (new tabs inherit it per PRD § C4).
const COZY_BY_TAB_KEY = 'duo.cozy.v1.byTab'
const COZY_LAST_KEY = 'duo.cozy.v1.lastChoice'

// Per-tab terminal font-size bump (⌘+/-/0). Signed integer, added on top
// of the cozy/default base fontSize in TerminalPane. Same new-tab-inherits
// pattern as cozy so new tabs pick up the last-used bump.
const FONT_BUMP_BY_TAB_KEY = 'duo.fontBump.v1.byTab'
const FONT_BUMP_LAST_KEY = 'duo.fontBump.v1.lastChoice'
const FONT_BUMP_MIN = -4
const FONT_BUMP_MAX = 10

function loadCozyByTab(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COZY_BY_TAB_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch { return {} }
}

function loadCozyLast(): boolean {
  try { return localStorage.getItem(COZY_LAST_KEY) === '1' } catch { return false }
}

function loadFontBumpByTab(): Record<string, number> {
  try {
    const raw = localStorage.getItem(FONT_BUMP_BY_TAB_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch { return {} }
}

function loadFontBumpLast(): number {
  try {
    const n = parseInt(localStorage.getItem(FONT_BUMP_LAST_KEY) || '0', 10)
    if (isNaN(n)) return 0
    return Math.max(FONT_BUMP_MIN, Math.min(FONT_BUMP_MAX, n))
  } catch { return 0 }
}

type FocusedColumn = 'files' | 'terminal' | 'working'

function makeTab(cwd: string): TabSession {
  return {
    id: crypto.randomUUID(),
    title: 'Terminal',
    cwd
  }
}

export function App() {
  const home = window.electron.env.HOME || '~'
  const nav = useNavigator(home)
  const pendingCwd = computePendingCwd(nav.state)
  const theme = useTheme()
  // Stage 15 G19 — sets up the localStorage round-trip for `duo
  // selection-format`. The hook's return value isn't consumed yet
  // (the editor pill that uses it lands in 15.1's UI half); calling
  // it here is what bootstraps the renderer→main pushState so CLI
  // reads return the persisted value rather than the default.
  useSelectionFormat()

  const [tabs, setTabs] = useState<TabSession[]>(() => [makeTab(home)])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)

  const [splitPct, setSplitPct] = useState(55)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const [filesCollapsed, setFilesCollapsed] = useState(false)
  const lastAutoCollapseState = useRef(false)

  const [focusedColumn, setFocusedColumn] = useState<FocusedColumn>('terminal')

  // Stage 10 Phase 5 — working-pane file tabs live in App-level state so
  // the navigator can push into them from FilesPane.onOpenFile.
  const [fileTabs, setFileTabs] = useState<FileTab[]>([])
  const [activeWorking, setActiveWorking] = useState<ActiveWorking>({ kind: 'browser' })

  // Stage 10 Phase 6 § D16 — dismissible chip when the agent drives the
  // navigator via `duo reveal`. Cleared after ~4s or by user dismiss.
  const [revealChip, setRevealChip] = useState<string | null>(null)

  // Stage 9 — per-tab cozy mode. `cozyByTab` is keyed by tab UUID;
  // `cozyDefault` seeds new tabs with the last-toggled value.
  const [cozyByTab, setCozyByTab] = useState<Record<string, boolean>>(loadCozyByTab)
  const [cozyDefault, setCozyDefault] = useState<boolean>(loadCozyLast)

  // Per-tab terminal font-size bump from ⌘+/-/0.
  const [fontBumpByTab, setFontBumpByTab] = useState<Record<string, number>>(loadFontBumpByTab)
  const [fontBumpDefault, setFontBumpDefault] = useState<number>(loadFontBumpLast)

  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeCozy = activeTab ? (cozyByTab[activeTab.id] ?? cozyDefault) : false

  // Stage 15 G17 — push the active terminal id to main so `duo send`
  // can write into the right PTY. `null` covers the degenerate case
  // where every terminal tab was closed (today the UI prevents this,
  // but the IPC contract supports it for future surfaces).
  useEffect(() => {
    window.electron.terminal?.pushActiveId(activeTab ? activeTab.id : null)
  }, [activeTab?.id])

  // ── Tab actions ────────────────────────────────────────────────────────────

  // Stage 10 § D9: new terminal tabs launch in `pendingCwd`, which is the
  // navigator's current folder (or the selected file's parent).
  const newTab = useCallback(() => {
    const tab = makeTab(pendingCwd)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
  }, [pendingCwd])

  // "Open terminal here" from the navigator's right-click menu (§ D11).
  // Explicit CWD bypasses the pending-CWD rule so the user gets exactly
  // the folder they right-clicked, even if a file is selected elsewhere.
  const openTerminalHere = useCallback((folderPath: string) => {
    const tab = makeTab(folderPath)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    setFocusedColumn('terminal')
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length === 1) return prev
      const next = prev.filter(t => t.id !== id)
      if (id === activeTabId) {
        const idx = prev.findIndex(t => t.id === id)
        setActiveTabId(next[Math.max(0, idx - 1)].id)
      }
      return next
    })
  }, [activeTabId])

  const updateTabTitle = useCallback((id: string, title: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, title } : t))
  }, [])

  // Stage 10 § D1: follow-mode — unless the navigator is pinned, switching
  // between terminal tabs moves the navigator's cwd to that tab's launch
  // CWD. This is the "context drawer" behavior.
  //
  // The trigger is a *tab switch*, not any nav-state change. Earlier
  // versions re-ran on every render, which reverted any breadcrumb /
  // tree click back to the active tab's launch CWD. The ref guards against
  // that: we only follow when activeTabId differs from the last tab we
  // followed.
  const lastFollowedTabIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (nav.state.pinned || !activeTab) return
    if (lastFollowedTabIdRef.current === activeTabId) return
    lastFollowedTabIdRef.current = activeTabId
    if (nav.state.cwd !== activeTab.cwd) nav.setCwd(activeTab.cwd)
  }, [activeTabId, activeTab, nav])

  // Stage 10 Phase 6: push navigator-state snapshots to the main process
  // so `duo nav state` can read the current value without a renderer RPC.
  useEffect(() => {
    window.electron.nav.pushState({
      cwd: nav.state.cwd,
      selected: nav.state.selected,
      expanded: [...nav.state.expanded],
      pinned: nav.state.pinned
    })
  }, [nav.state.cwd, nav.state.selected, nav.state.expanded, nav.state.pinned])

  // ── File-open from the navigator ───────────────────────────────────────────

  // Open (or switch to) a file tab in the WorkingPane. § D13 — same-path
  // identity: if a tab already exists for this path, activate it instead of
  // creating a duplicate.
  const openFile = useCallback((path: string, title: string) => {
    setFileTabs(prev => {
      const existing = prev.find(t => t.path === path)
      if (existing) {
        setActiveWorking({ kind: 'file', id: existing.id })
        return prev
      }
      const { type, mime } = classifyFile(path)
      const id = crypto.randomUUID()
      setActiveWorking({ kind: 'file', id })
      return [...prev, { id, type, path, title, mime }]
    })
    setFocusedColumn('working')
  }, [])

  const onOpenFile = useCallback((entry: DirEntry) => {
    openFile(entry.path, entry.name)
  }, [openFile])

  const closeFileTab = useCallback((id: string) => {
    setFileTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      // If we closed the active file tab, fall back to the browser tab set.
      if (activeWorking.kind === 'file' && activeWorking.id === id) {
        setActiveWorking({ kind: 'browser' })
      }
      return next
    })
  }, [activeWorking])

  // Stage 11 — editor tabs push their dirty state up so the strip can show
  // the unsaved dot. No-op if the tab is already at the requested state.
  const onTabDirtyChange = useCallback((id: string, dirty: boolean) => {
    setFileTabs(prev => {
      const tab = prev.find(t => t.id === id)
      if (!tab || (tab.dirty ?? false) === dirty) return prev
      return prev.map(t => t.id === id ? { ...t, dirty } : t)
    })
  }, [])

  // Stage 11 § D33a — \u2318N opens a new editor tab in the navigator's CWD.
  // Auto-pick `untitled.md`, fall back to `untitled-2.md`, etc., to dodge
  // collisions with already-open tabs. (Disk collisions are surfaced when
  // the user commits a name that already exists.)
  const newMarkdownFile = useCallback(() => {
    const dir = nav.state.cwd
    const taken = new Set(fileTabs.map(t => t.path))
    let candidate = `${dir}/untitled.md`
    let n = 2
    while (taken.has(candidate)) {
      candidate = `${dir}/untitled-${n}.md`
      n++
    }
    const id = crypto.randomUUID()
    const title = candidate.slice(candidate.lastIndexOf('/') + 1)
    setFileTabs(prev => [
      ...prev,
      { id, type: 'editor', path: candidate, title, mime: 'text/markdown', isNew: true }
    ])
    setActiveWorking({ kind: 'file', id })
    setFocusedColumn('working')
  }, [nav.state.cwd, fileTabs])

  // Finalize a new-file tab: write an empty file at the resolved path,
  // then update tab metadata so subsequent autosaves write through.
  const onCommitNewFile = useCallback(async (id: string, resolvedPath: string, title: string) => {
    try {
      await window.electron.files.write(resolvedPath, new Uint8Array())
    } catch (err) {
      console.error('[Duo] failed to create new file:', err)
      return
    }
    setFileTabs(prev => prev.map(t =>
      t.id === id
        ? { ...t, path: resolvedPath, title, isNew: false }
        : t
    ))
  }, [])

  // Called by MarkdownPreview when the user clicks an internal .md link.
  const onOpenMarkdown = useCallback((path: string) => {
    const name = path.slice(path.lastIndexOf('/') + 1) || path
    openFile(path, name)
  }, [openFile])

  // Stage 10 Phase 6: `duo reveal <path>` from the CLI. Move the navigator
  // to that path and surface a dismissible chip.
  useEffect(() => {
    return window.electron.nav.onReveal((p) => {
      nav.actions.navigateTo(p)
      setRevealChip(p)
    })
  }, [nav.actions])

  // Auto-dismiss the chip after 4 seconds.
  useEffect(() => {
    if (!revealChip) return
    const h = setTimeout(() => setRevealChip(null), 4000)
    return () => clearTimeout(h)
  }, [revealChip])

  // Stage 10 Phase 6: `duo view <path>` from the CLI. Open as a file tab.
  useEffect(() => {
    return window.electron.nav.onView((p) => {
      const name = p.slice(p.lastIndexOf('/') + 1) || p
      openFile(p, name)
    })
  }, [openFile])

  // Stage 11: `duo edit <path>` from the CLI. Same dispatch as view — the
  // classifier routes `.md` to the editor tab type; other types open in
  // their usual preview.
  useEffect(() => {
    return window.electron.nav.onEdit((p) => {
      const name = p.slice(p.lastIndexOf('/') + 1) || p
      openFile(p, name)
    })
  }, [openFile])

  // ── Cozy mode (Stage 9) ────────────────────────────────────────────────────

  // Listen for View → Cozy mode menu clicks. Flip the active tab's cozy
  // state, update the "remember last choice" default, persist, and push
  // the new value back so the menu checkmark tracks it.
  //
  // Guard the electron.cozy API: in dev, preload only loads once per window
  // creation. A stale preload (from before Stage 9) has no `cozy` surface,
  // so the effect would throw and crash the component tree. Silently
  // no-oping here means cozy is just inert until Electron is restarted.
  useEffect(() => {
    if (!window.electron.cozy) return
    return window.electron.cozy.onToggle(() => {
      if (!activeTab) return
      const current = cozyByTab[activeTab.id] ?? cozyDefault
      const next = !current
      setCozyByTab(prev => {
        const updated = { ...prev, [activeTab.id]: next }
        try { localStorage.setItem(COZY_BY_TAB_KEY, JSON.stringify(updated)) } catch { /* quota */ }
        return updated
      })
      setCozyDefault(next)
      try { localStorage.setItem(COZY_LAST_KEY, next ? '1' : '0') } catch { /* quota */ }
      window.electron.cozy?.pushState(next)
    })
  }, [activeTab, cozyByTab, cozyDefault])

  // Keep the menu checkmark aligned with the active tab whenever it changes.
  useEffect(() => {
    window.electron.cozy?.pushState(activeCozy)
  }, [activeCozy])

  // Drop stale cozy + font-bump entries when tabs close so the persisted
  // maps can't grow unbounded across sessions.
  useEffect(() => {
    const liveIds = new Set(tabs.map(t => t.id))
    setCozyByTab(prev => {
      const pruned: Record<string, boolean> = {}
      let changed = false
      for (const [id, val] of Object.entries(prev)) {
        if (liveIds.has(id)) pruned[id] = val
        else changed = true
      }
      if (!changed) return prev
      try { localStorage.setItem(COZY_BY_TAB_KEY, JSON.stringify(pruned)) } catch { /* quota */ }
      return pruned
    })
    setFontBumpByTab(prev => {
      const pruned: Record<string, number> = {}
      let changed = false
      for (const [id, val] of Object.entries(prev)) {
        if (liveIds.has(id)) pruned[id] = val
        else changed = true
      }
      if (!changed) return prev
      try { localStorage.setItem(FONT_BUMP_BY_TAB_KEY, JSON.stringify(pruned)) } catch { /* quota */ }
      return pruned
    })
  }, [tabs])

  // ⌘` — cycle focus between the terminal column and the working pane.
  // Files column is a toggle with ⌘B and intentionally not in this cycle.
  //
  // BUG-004 fix: this MUST move actual OS-level focus, not just flip the
  // React `focusedColumn` state. The renderer-side focus calls below only
  // work because the menu accelerator's main-process click handler has
  // already called `mainWindow.webContents.focus()` to reclaim OS focus
  // from any active WebContentsView (see electron/main.ts § installAppMenu).
  //
  // Per destination:
  //   - terminal → focus the visible xterm helper textarea (so PTY
  //     keystrokes route in)
  //   - working+browser → focusActive() on the BrowserManager (returns
  //     OS focus to the active WebContentsView's webContents)
  //   - working+editor (or any non-browser file tab) → focus the
  //     contenteditable prose, falling back to the wrapper. The wrapper
  //     alone has tabIndex=0 but isn't a typing target — typing into
  //     a focused tabIndex wrapper is a no-op for the editor.
  const togglePaneFocus = useCallback(() => {
    setFocusedColumn(prev => {
      const next = prev === 'working' ? 'terminal' : 'working'
      queueMicrotask(() => {
        if (next === 'terminal') {
          const textarea = document.querySelector<HTMLTextAreaElement>(
            '.xterm-host:not([style*="display: none"]) .xterm-helper-textarea'
          )
          textarea?.focus()
        } else if (activeWorking.kind === 'browser') {
          window.electron.browser.focusActive()
        } else {
          const wrapper = document.querySelector<HTMLElement>('[data-duo-workingpane]')
          if (!wrapper) return
          // Editor tab: prose is `.ProseMirror[contenteditable=true]`.
          // Other file types (image / pdf / unknown preview) have no
          // contenteditable; fall back to focusing the wrapper so arrow
          // keys can scroll the pane.
          const ce = wrapper.querySelector<HTMLElement>('[contenteditable="true"]')
          if (ce) ce.focus()
          else wrapper.focus()
        }
      })
      return next
    })
  }, [activeWorking])

  // ⌘+ / ⌘- / ⌘0 handler for terminal font bump. Flips the active tab's
  // bump value, updates the "remember last choice" default (so new tabs
  // inherit the user's preferred size), and persists both.
  const adjustFontBump = useCallback((delta: number | 'reset') => {
    if (!activeTab) return
    const current = fontBumpByTab[activeTab.id] ?? fontBumpDefault
    const next = delta === 'reset'
      ? 0
      : Math.max(FONT_BUMP_MIN, Math.min(FONT_BUMP_MAX, current + delta))
    setFontBumpByTab(prev => {
      const updated = { ...prev, [activeTab.id]: next }
      try { localStorage.setItem(FONT_BUMP_BY_TAB_KEY, JSON.stringify(updated)) } catch { /* quota */ }
      return updated
    })
    setFontBumpDefault(next)
    try { localStorage.setItem(FONT_BUMP_LAST_KEY, String(next)) } catch { /* quota */ }
  }, [activeTab, fontBumpByTab, fontBumpDefault])

  // ── Split-pane resize (middle/right) ───────────────────────────────────────

  const onDividerMouseDown = useCallback(() => {
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current || !splitContainerRef.current) return
      const { left, width } = splitContainerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - left) / width) * 100
      setSplitPct(Math.min(Math.max(pct, 20), 80))
    }
    const onUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ── Window-width auto-collapse for Files column ────────────────────────────

  useEffect(() => {
    const check = () => {
      const narrow = window.innerWidth < AUTO_COLLAPSE_WIDTH
      if (narrow !== lastAutoCollapseState.current) {
        lastAutoCollapseState.current = narrow
        if (narrow) setFilesCollapsed(true)
      }
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useKeyboardShortcuts({
    newTerminalTab: newTab,
    newBrowserTab: () => {
      // Stage 11 \u00a7 D33e \u2014 \u2318T must foreground a new browser tab even when
      // the active WorkingPane tab is an editor (or any non-browser type).
      // Three steps in order:
      //   1) flip the WorkingPane's active slot to `browser` so the editor
      //      tab releases the renderer surface
      //   2) add the tab (BrowserManager activates it on creation)
      //   3) focus the address bar after a microtask so the user can type
      //      a URL immediately
      setActiveWorking({ kind: 'browser' })
      setFocusedColumn('working')
      void window.electron.browser.addTab().then(() => {
        queueMicrotask(() => {
          const addr = document.querySelector<HTMLInputElement>('[data-duo-addressbar]')
          addr?.focus()
          addr?.select()
        })
      })
    },
    newMarkdownFile,
    closeTab: () => {
      if (focusedColumn === 'working') {
        // § D29 — close whichever working-pane tab is currently active.
        if (activeWorking.kind === 'file') {
          closeFileTab(activeWorking.id)
        } else {
          void (async () => {
            const btabs = await window.electron.browser.getTabs()
            const active = btabs.find(t => t.isActive)
            if (active) await window.electron.browser.closeTab(active.id)
          })()
        }
      } else {
        closeTab(activeTabId)
      }
    },
    tabs,
    activeTabId,
    setActiveTabId,
    toggleFilesColumn: () => setFilesCollapsed(prev => !prev),
    // ⌘+ / ⌘- / ⌘0 — bump / shrink / reset terminal font size for the
    // active tab. Browser-focus forwarding intentionally skips these so
    // ⌘+/- keeps its native page-zoom behavior inside a browser tab.
    adjustTerminalFontBump: adjustFontBump,
    // ⌘` — fallback for platforms where the key isn't intercepted by
    // a menu accelerator. On macOS the system shortcut intercepts ⌘`
    // before this handler sees it; see `onPaneToggleFocus` below.
    togglePaneFocus,
    // BUG-001 fix — pane-aware ⌃Tab routing. Without this, ⌃Tab from
    // terminal focus cycles browser tabs instead of terminal tabs.
    activePaneFocus: focusedColumn
  })

  // ⌘` menu-accelerator path. The app menu registers the same
  // accelerator at the Electron level so it beats macOS's built-in
  // "cycle windows of the same app" shortcut — which swallows the
  // keydown before the renderer can see it.
  useEffect(() => {
    return window.electron.keyboard?.onPaneToggleFocus?.(togglePaneFocus)
  }, [togglePaneFocus])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-0">
      {/* Top chrome row. Window drag surface; small no-drag controls on the
          right (theme toggle) escape the drag via .titlebar-nodrag. macOS
          traffic lights are positioned over this row by
          `trafficLightPosition` without a DOM spacer. */}
      <div className="h-10 shrink-0 bg-surface-1 border-b border-border titlebar-drag flex items-center justify-end pr-2 gap-1">
        <ThemeToggle mode={theme.mode} onCycle={theme.cycleMode} />
      </div>

      <div className="flex flex-1 overflow-hidden min-w-0">
        <div
          className="h-full shrink-0 min-w-0"
          onMouseDown={() => setFocusedColumn('files')}
          aria-label="Files column"
        >
          <FilesPane
            collapsed={filesCollapsed}
            focused={focusedColumn === 'files'}
            home={home}
            state={nav.state}
            actions={nav.actions}
            onOpenFile={onOpenFile}
            onOpenTerminalHere={openTerminalHere}
            revealChip={revealChip}
            onDismissRevealChip={() => setRevealChip(null)}
            onToggleCollapsed={() => setFilesCollapsed(prev => !prev)}
          />
        </div>

        <div
          ref={splitContainerRef}
          className="flex flex-1 overflow-hidden min-w-0"
        >
          <div
            className={[
              // Stage 12 — Atelier layout depth: terminal column sits on
              // `paper-deep`, working pane on `paper`. The 1px right
              // border (paper-rule) is the seam between them.
              //
              // BUG-003 fix (rev 2): primary focus indicator now lives in
              // the tab strip (TabBar tints to accent-soft when
              // focused={true}) — strip is renderer DOM and never
              // occluded, unlike the column wrapper which xterm canvas
              // paints over. Seam border still flips to full-opacity
              // accent as a secondary cue.
              'flex flex-col h-full bg-surface-1 border-r transition-colors min-w-0 overflow-hidden',
              focusedColumn === 'terminal' ? 'border-accent' : 'border-border'
            ].join(' ')}
            style={{ width: `${splitPct}%` }}
            onMouseDown={() => setFocusedColumn('terminal')}
            aria-label="Terminal column"
          >
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelect={setActiveTabId}
              onNew={newTab}
              onClose={closeTab}
              pendingCwd={pendingCwd}
              focused={focusedColumn === 'terminal'}
            />
            <div className="flex-1 overflow-hidden">
              <TerminalPane
                tabs={tabs}
                activeTabId={activeTabId}
                onTitleChange={updateTabTitle}
                cozyByTab={cozyByTab}
                cozyDefault={cozyDefault}
                fontBumpByTab={fontBumpByTab}
                fontBumpDefault={fontBumpDefault}
                themeEffective={theme.effective}
              />
            </div>
          </div>

          <div
            className="split-divider"
            onMouseDown={onDividerMouseDown}
          />

          <div
            className={[
              // BUG-003 fix (rev 2): see Terminal column. Inset shadow
              // dropped — the WebContentsView occludes 3 of 4 sides, so
              // the ring was misleading. Focus indicator is now inside
              // WorkingTabStrip (renderer DOM, never covered by the
              // WebContentsView).
              'flex-1 overflow-hidden border-l transition-colors min-w-0',
              focusedColumn === 'working' ? 'border-accent' : 'border-transparent'
            ].join(' ')}
            onMouseDown={() => setFocusedColumn('working')}
            aria-label="Working pane"
          >
            <WorkingPane
              fileTabs={fileTabs}
              activeWorking={activeWorking}
              setActiveWorking={setActiveWorking}
              closeFileTab={closeFileTab}
              onOpenMarkdown={onOpenMarkdown}
              onTabDirtyChange={onTabDirtyChange}
              onCommitNewFile={onCommitNewFile}
              focused={focusedColumn === 'working'}
              // Stage 15.1 — Send → Duo pill: pipe the formatted payload
              // into the active terminal's PTY. PRD G11: no Enter
              // appended — the user confirms by pressing Enter
              // themselves. Focus moves to the active terminal so the
              // user can append a verb without having to click first.
              onSendToDuo={
                activeTabId
                  ? (payload) => {
                      void window.electron.pty.write(activeTabId, payload)
                      setFocusedColumn('terminal')
                    }
                  : null
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}
