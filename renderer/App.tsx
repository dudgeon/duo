import { useState, useCallback, useRef, useEffect } from 'react'
import { TabBar } from './components/TabBar'
import { TerminalPane } from './components/TerminalPane'
import { WorkingPane } from './components/WorkingPane'
import { PinnedCloseConfirm } from './components/PinnedCloseConfirm'
import { FirstLaunchBanner } from './components/FirstLaunchBanner'
import { UpdateAvailableBanner } from './components/UpdateAvailableBanner'
import { ExternalRedirectedBanner } from './components/ExternalRedirectedBanner'
import type { FileTab, ActiveWorking } from './components/WorkingPane'
import { classifyFile } from './components/fileClassifier'
import { FilesPane } from './components/FilesPane'
import { ThemeToggle } from './components/ThemeToggle'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useNavigator, computePendingCwd } from './hooks/useNavigator'
import { useUserClaudeNavigator } from './hooks/useUserClaudeNavigator'
import { useNavPins } from './hooks/useNavPins'
import { useTheme } from './hooks/useTheme'
import { useSelectionFormat } from './hooks/useSelectionFormat'
import { htmlBoilerplate } from './components/HtmlCanvas/htmlBoilerplate'
import { encodeUtf8 } from './components/editor/markdown-io'
import type { TabSession, DirEntry, TerminalTabKind, NewTabResult, PinEntry, SessionState, BrowserTab } from '@shared/types'

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

// Stage 19c D28 — persisted last manual choice between shell and claude.
// The split-button `+` always opens claude regardless (the primary
// affordance is opinionated). This persisted value only governs `duo
// new-tab` calls that arrive without a --kind flag, so an agent popping
// tabs follows the user's most recent manual selection.
const LAST_TAB_KIND_KEY = 'duo.lastNewTabKind'

function loadLastTabKind(): TerminalTabKind {
  try {
    const v = localStorage.getItem(LAST_TAB_KIND_KEY)
    return v === 'shell' || v === 'claude' ? v : 'claude'
  } catch { return 'claude' }
}

function saveLastTabKind(kind: TerminalTabKind): void {
  try { localStorage.setItem(LAST_TAB_KIND_KEY, kind) } catch { /* quota */ }
}

// Stage 19c D23 — banner the user sees on a `+ claude` click when
// `claude` isn't on PATH. Single shell line; clears on the next prompt.
// The URL is the canonical install doc — short enough not to wrap on
// narrow terminals.
const CLAUDE_MISSING_BANNER =
  'echo "Install Claude Code to enable agent tabs: https://docs.claude.com/claude-code"\n'

// BUG-009 fix — wait for the shell's PS1 to be emitted before writing
// the post-spawn payload. Without this, the write races the shell's
// startup: the bytes can land before the shell has read its rc files,
// causing the literal payload to render as raw text outside the prompt
// and the trailing newline to no-op against an empty prompt.
//
// BUG-010 fix — the original "first PTY data" trigger was too eager:
// shells emit terminal-init escape codes (OSC 133 prompt-marks,
// alt-screen toggles, cursor-position queries) and rc-file output
// (conda/nvm init lines, MOTDs) BEFORE the visible PS1 lands, so the
// post-spawn write would still interleave with shell startup chatter.
// We now accumulate the data stream, strip ANSI/CSI/OSC escapes from
// the visible tail, and only resolve once the tail looks like a
// rendered prompt (`$ `, `% `, `# `, `❯ `, `> `, …). Both the 30ms
// paint settle and the 1s hard fallback are preserved — exotic
// custom prompts that don't match any of the recognized tails will
// still get the write after the timeout, which is no worse than the
// pre-BUG-009 behavior.
const PROMPT_TAIL_REGEX = /[$%#❯>›→]\s*$/
const ANSI_STRIP_REGEX = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[@-Z\\-_])/g

function stripAnsi(s: string): string {
  // Remove CSI / OSC / single-char ESC sequences, plus carriage
  // returns and NULs that don't render as visible characters.
  return s.replace(ANSI_STRIP_REGEX, '').replace(/[\r\x00]/g, '')
}

function waitForPtyReady(id: string, timeoutMs: number = 1000): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    let buffer = ''
    const finish = () => {
      if (done) return
      done = true
      off()
      setTimeout(resolve, 30)
    }
    const off = window.electron.pty.onData(id, (chunk: string) => {
      if (done) return
      buffer += chunk
      // Bound the regex by checking only the recent visible tail —
      // an rc that prints a kilobyte of MOTD shouldn't slow us down.
      const tail = stripAnsi(buffer).slice(-160)
      if (PROMPT_TAIL_REGEX.test(tail)) finish()
    })
    setTimeout(() => {
      if (done) return
      done = true
      off()
      resolve()
    }, timeoutMs)
  })
}

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

// Stage 19c D26 — title format. Claude tabs prefix `claude · ` so a
// mixed strip of shell + claude tabs reads at a glance. Shell tabs use
// today's title (xterm OSC sequences eventually overwrite both).
function tabTitle(kind: TerminalTabKind, cwd: string, home: string): string {
  const basename = cwd === home || cwd === '~'
    ? '~'
    : (cwd.slice(cwd.lastIndexOf('/') + 1) || cwd)
  return kind === 'claude' ? `claude · ${basename}` : (basename || 'Terminal')
}

function makeTab(cwd: string, kind: TerminalTabKind, home: string): TabSession {
  return {
    id: crypto.randomUUID(),
    title: tabTitle(kind, cwd, home),
    cwd,
    kind
  }
}

export function App() {
  const home = window.electron.env.HOME || '~'
  const nav = useNavigator(home)
  // Stage 22 — separate navigator state for the top "Your Claude
  // settings" pane (rooted at ~/.claude/). Lives at App level so its
  // expanded set + show-all toggle persist across re-mounts.
  const userClaudeNav = useUserClaudeNavigator(home)
  // Stage 26 PR 2 (ENH-010) — navigator pin state, persisted at
  // ~/.claude/duo/nav-pins.json. Hook loads on mount; PinnedNav
  // renders the section when pins.length > 0.
  const navPins = useNavPins()
  const pendingCwd = computePendingCwd(nav.state)
  const theme = useTheme()
  // Stage 15 G19 — sets up the localStorage round-trip for `duo
  // selection-format`. The hook's return value isn't consumed yet
  // (the editor pill that uses it lands in 15.1's UI half); calling
  // it here is what bootstraps the renderer→main pushState so CLI
  // reads return the persisted value rather than the default.
  useSelectionFormat()

  // Stage 19c — first tab on app launch defaults to a vanilla shell, not
  // claude. Rationale: today the user lands in the same place they always
  // have; the new opinionated default surfaces via the split-button `+`
  // (and ⌘T from terminal focus) — affordances they will discover. A
  // disruptive change to the boot tab would be a worse first impression
  // than what 19c is trying to fix. The PRD's "PM hits ⌘T and is talking
  // to a primed Claude in three seconds" criterion measures the
  // user-initiated path, not boot.
  const [tabs, setTabs] = useState<TabSession[]>(() => [makeTab(home, 'shell', home)])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)
  const [lastTabKind, setLastTabKind] = useState<TerminalTabKind>(loadLastTabKind)

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

  // Stage 24 — pinned WorkingPane tabs. Owned at App level so the ⌘W
  // keyboard handler can gate close-of-pinned-tab behind a confirm
  // modal. Persisted via the pins service in main; loaded once on
  // mount, refreshed after each toggle.
  const [pins, setPins] = useState<PinEntry[]>([])
  useEffect(() => {
    let cancelled = false
    void window.electron.pins.list().then(list => {
      if (!cancelled) setPins(list)
    })
    return () => { cancelled = true }
  }, [])
  const togglePin = useCallback(async (entry: PinEntry) => {
    const next = await window.electron.pins.toggle(entry)
    setPins(next)
  }, [])
  // App-level pinned-close confirmation (used by the ⌘W keyboard path
  // when the active working tab is pinned). Strip-side close-button
  // path uses its own local state in WorkingTabStrip — both render
  // the same modal component.
  const [pendingClosePinned, setPendingClosePinned] = useState<{ kind: 'file'; id: string; label: string } | { kind: 'browser'; id: number; label: string } | null>(null)

  // Stage 21c Phase 2 — session state restored across Duo relaunches
  // (issue #24). Hydrate `tabs` / `fileTabs` / `activeTabId` /
  // `activeWorking` from `~/.claude/duo/session-state.json` on mount;
  // debounce-save on every state change post-hydration. Browser tabs
  // are restored separately by main (BrowserManager.restoreFromSession
  // after did-finish-load) — we just observe the latest list here for
  // save purposes. Navigator path uses its own localStorage layer
  // (`useNavigator`) and is not routed through session-state.json.
  const [sessionHydrated, setSessionHydrated] = useState(false)
  const sessionLoadStartedRef = useRef(false)
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([])

  // Subscribe to BrowserManager's tab broadcasts so `browserTabs`
  // tracks main's view of the browser tab list. Used by the save
  // effect below.
  useEffect(() => {
    return window.electron.browser.onTabsChange(setBrowserTabs)
  }, [])

  // One-shot session-state load on mount.
  useEffect(() => {
    if (sessionLoadStartedRef.current) return
    sessionLoadStartedRef.current = true

    void window.electron.sessionState.load().then(state => {
      // Terminal tabs first — these drive most of the renderer's
      // initial state. Empty list (first launch) → keep the default
      // single shell tab the constructor seeded.
      if (state.terminals.length > 0) {
        const restored = state.terminals.map(t => makeTab(t.cwd, t.kind, home))
        setTabs(restored)
        const idx = state.activeTerminalIndex
        if (Number.isInteger(idx) && idx >= 0 && idx < restored.length) {
          setActiveTabId(restored[idx].id)
        } else {
          setActiveTabId(restored[0].id)
        }
      }

      // File tabs — IDs are session-local; mint fresh, key off path.
      const restoredFileTabs: FileTab[] = state.fileTabs.map(f => ({
        id: crypto.randomUUID(),
        type: f.type,
        path: f.path,
        title: f.path.split('/').pop() || f.path,
        mime: f.mime
      }))
      if (restoredFileTabs.length > 0) {
        setFileTabs(restoredFileTabs)
      }

      // Active working selection.
      if (state.activeWorking && state.activeWorking.kind === 'file') {
        const targetPath = state.activeWorking.path
        const matching = restoredFileTabs.find(t => t.path === targetPath)
        if (matching) {
          setActiveWorking({ kind: 'file', id: matching.id })
        }
      }
      // 'browser' is the default initial state, no-op.

      setSessionHydrated(true)
    }).catch(err => {
      console.warn('[session-state] load failed (using defaults):', err)
      setSessionHydrated(true)  // don't block the save loop on a load failure
    })
  }, [home])

  // Debounced save on every change post-hydration. The 500ms in
  // renderer + 250ms in main coalesces bursty edits into a single
  // disk write.
  const sessionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!sessionHydrated) return
    if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current)
    sessionSaveTimerRef.current = setTimeout(() => {
      const activeTerminalIndex = tabs.findIndex(t => t.id === activeTabId)
      const activeBrowserIndex = browserTabs.findIndex(b => b.isActive)
      const activeFileTab = activeWorking.kind === 'file'
        ? fileTabs.find(f => f.id === activeWorking.id)
        : undefined

      const state: SessionState = {
        version: 1,
        savedAt: new Date().toISOString(),
        appVersion: '0.4.1',
        terminals: tabs.map(t => ({ cwd: t.cwd, kind: t.kind, title: t.title })),
        activeTerminalIndex: activeTerminalIndex >= 0 ? activeTerminalIndex : -1,
        browserTabs: browserTabs.map(b => ({ url: b.url, title: b.title })),
        activeBrowserIndex: activeBrowserIndex >= 0 ? activeBrowserIndex : -1,
        fileTabs: fileTabs.map(f => ({ path: f.path, type: f.type, mime: f.mime })),
        activeWorking: activeWorking.kind === 'browser'
          ? { kind: 'browser', index: activeBrowserIndex >= 0 ? activeBrowserIndex : 0 }
          : (activeFileTab ? { kind: 'file', path: activeFileTab.path } : null),
        navigatorPath: ''  // useNavigator owns this via localStorage (Stage 10 Phase 4)
      }
      void window.electron.sessionState.save(state)
    }, 500)
    return () => {
      if (sessionSaveTimerRef.current) clearTimeout(sessionSaveTimerRef.current)
    }
  }, [sessionHydrated, tabs, activeTabId, fileTabs, activeWorking, browserTabs])

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

  // Stage 19c D21–D23 — after PtyManager spawns the user's shell, write
  // the post-spawn payload (claude\n, the install banner, or whatever the
  // CLI's --cmd specified) into the same PTY. Done here, not in main,
  // because PTY data writes route through the renderer's preload pty API
  // — same path the user's keystrokes take, so the payload appears in
  // the terminal exactly as if the user typed it.
  //
  // BUG-009 fix — wait for the shell to have emitted its PS1 (first
  // PTY data event) before writing. Earlier code used queueMicrotask
  // alone, which deferred only one renderer event-loop tick — not
  // enough for zsh to read rc files and print its prompt. Result was a
  // visible race: literal payload text rendered above the prompt, and
  // the trailing newline got swallowed against an empty pre-prompt
  // state. waitForPtyReady (defined above) handles all post-spawn
  // payloads — claude auto-launch, install banner, --cmd from CLI.
  const dispatchPostSpawnWrite = useCallback(async (id: string, kind: TerminalTabKind, cmd?: string) => {
    let payload: string | null = null
    if (cmd && cmd.length > 0) {
      // D21 alternative path: explicit --cmd from the CLI wins over
      // the kind-based default. No trailing newline — parity with
      // `duo send` (the user / agent confirms).
      payload = cmd
    } else if (kind === 'claude') {
      // D23 — only auto-launch if claude is reachable; otherwise print
      // the install banner so the user knows why their tab opened bare.
      const onPath = await window.electron.terminal.claudeOnPath()
      payload = onPath ? 'claude\n' : CLAUDE_MISSING_BANNER
    }
    if (payload === null) return
    await waitForPtyReady(id)
    void window.electron.pty.write(id, payload)
  }, [])

  // Stage 10 § D9 + Stage 19c — new terminal tabs launch in `pendingCwd`
  // (navigator's current folder or the selected file's parent). `kind`
  // controls whether the tab auto-launches claude after the shell starts
  // (D17 / D21). The split-button `+` always passes 'claude'; `>` passes
  // 'shell'. The persisted last-kind only governs `duo new-tab` calls
  // without --kind — see addTabFromCli below.
  const newTab = useCallback((kind: TerminalTabKind) => {
    const tab = makeTab(pendingCwd, kind, home)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    void dispatchPostSpawnWrite(tab.id, kind)
    return tab
  }, [pendingCwd, home, dispatchPostSpawnWrite])

  // "Open terminal here" from the navigator's right-click menu (§ D11).
  // Explicit CWD bypasses the pending-CWD rule so the user gets exactly
  // the folder they right-clicked. Stage 19c: today this still opens a
  // vanilla shell (the right-click menu's "open terminal here" wording
  // promises a shell, not an agent). The Navigator polish bundle has a
  // separate item for a "claude here" hover-action; that lives there,
  // not in this menu item.
  const openTerminalHere = useCallback((folderPath: string) => {
    const tab = makeTab(folderPath, 'shell', home)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    setFocusedColumn('terminal')
  }, [home])

  // Stage 26 item 7 — hover "new Claude here" on folder rows. Same
  // explicit-CWD pattern as openTerminalHere, but kind='claude' so the
  // post-spawn writer runs `claude\n` (or the install banner if claude
  // isn't on PATH). CLI parity already lives in
  // `duo new-tab --claude --cwd <path>`.
  const openClaudeIn = useCallback((folderPath: string) => {
    const tab = makeTab(folderPath, 'claude', home)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    setFocusedColumn('terminal')
    void dispatchPostSpawnWrite(tab.id, 'claude')
  }, [home, dispatchPostSpawnWrite])

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

  // Smart file-open dispatcher: pre-flights HTML files for the
  // `<meta name="duo-open-in" content="browser">` routing hint. When
  // present, the file lands in a browser tab via `file://` URL instead
  // of the canvas. Used by system reference HTMLs (FAQ, What Duo Does)
  // and any user file that opts in. Non-HTML files skip the pre-flight
  // entirely (cheap fast path). On read failure or no meta present,
  // falls through to the canvas as before.
  const openFileSmart = useCallback(async (path: string, title: string) => {
    const lower = path.toLowerCase()
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      try {
        const meta = await window.electron.files.getHtmlMeta(path)
        if (meta?.openIn === 'browser') {
          const fileUrl = `file://${encodeURI(path)}`
          await window.electron.browser.addTab(fileUrl)
          setActiveWorking({ kind: 'browser' })
          setFocusedColumn('working')
          return
        }
      } catch {
        // Fall through to canvas on any IPC / parse failure.
      }
    }
    openFile(path, title)
  }, [openFile])

  const onOpenFile = useCallback((entry: DirEntry) => {
    void openFileSmart(entry.path, entry.name)
  }, [openFileSmart])

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

  // Stage 23 — host-side dispatcher for canvas data-duo-action clicks.
  // CanvasTab installs the listener, parses the action verb + args, and
  // calls back here. We translate to existing infrastructure:
  //   - claude:spawn   → mirror the `duo new-tab --claude` flow used by
  //                      the CLI route (makeTab + setTabs +
  //                      dispatchPostSpawnWrite). Surfaces the terminal
  //                      column so the new tab is visible immediately.
  //   - terminal:send  → pty.write into the active PTY, with optional
  //                      Enter via the data-enter="true" attribute (see
  //                      Stage 23b).
  //   - browser:open   → browser.addTab(url) — flips WorkingPane to the
  //                      browser slot first so the new tab is visible.
  //
  // Trust gating happens canvas-side in canvasActions.ts; this handler
  // is only called for trusted canvases (path under ~/.claude/duo/).
  const handleCanvasAction = useCallback(async (
    action: import('@shared/types').CanvasAction
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      switch (action.kind) {
        case 'claude:spawn': {
          const cwd = action.cwd && action.cwd.length > 0 ? action.cwd : pendingCwd
          const tab = makeTab(cwd, 'claude', home)
          setTabs(prev => [...prev, tab])
          setActiveTabId(tab.id)
          setLastTabKind('claude')
          saveLastTabKind('claude')
          setFocusedColumn('terminal')
          // Use the claude post-spawn write (claude\n) by default; if
          // the canvas supplied a `data-cmd`, use that instead so the
          // first thing the agent sees is the user's chosen prompt.
          void dispatchPostSpawnWrite(tab.id, 'claude', action.cmd)
          return { ok: true }
        }
        case 'terminal:send': {
          if (!activeTabId) {
            return { ok: false, error: 'no active terminal tab' }
          }
          const payload = action.enter ? `${action.text}\n` : action.text
          await window.electron.pty.write(activeTabId, payload)
          setFocusedColumn('terminal')
          return { ok: true }
        }
        case 'browser:open': {
          // Validate the URL minimally — empty string or whitespace
          // wouldn't help anyone. Don't enforce protocol; the browser
          // pane handles relative + bare hostnames gracefully.
          const url = action.url.trim()
          if (!url) return { ok: false, error: 'browser:open requires a non-empty URL' }
          setActiveWorking({ kind: 'browser' })
          setFocusedColumn('working')
          await window.electron.browser.addTab(url)
          return { ok: true }
        }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }, [activeTabId, pendingCwd, home, dispatchPostSpawnWrite])

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

  // Finalize a new-file tab: write the seed bytes at the resolved path,
  // then update tab metadata so subsequent autosaves write through.
  //
  // Stage 17a — the audible from kickoff: ⌘N opens the new-file
  // interstitial; the typed extension dictates which canvas mounts.
  // .md (or no extension, defaulting to .md via the interstitial) keeps
  // the markdown editor; .html / .htm swaps the tab to `html-canvas`
  // and seeds the file with boilerplate so the iframe has something
  // to render. Other extensions fall through to whatever classifyFile
  // returns (image, pdf, unknown preview) — those surfaces already
  // expect bytes on disk so an empty seed is fine.
  const onCommitNewFile = useCallback(async (id: string, resolvedPath: string, title: string) => {
    const { type, mime } = classifyFile(resolvedPath)
    const seed = type === 'html-canvas'
      ? encodeUtf8(htmlBoilerplate(title.replace(/\.[^.]+$/, '')))
      : new Uint8Array()
    try {
      await window.electron.files.write(resolvedPath, seed)
    } catch (err) {
      console.error('[Duo] failed to create new file:', err)
      return
    }
    setFileTabs(prev => prev.map(t =>
      t.id === id
        ? { ...t, path: resolvedPath, title, type, mime, isNew: false }
        : t
    ))
  }, [])

  // Called by MarkdownPreview when the user clicks an internal link.
  // Routes through openFileSmart so duo-open-in:browser is honored.
  const onOpenMarkdown = useCallback((path: string) => {
    const name = path.slice(path.lastIndexOf('/') + 1) || path
    void openFileSmart(path, name)
  }, [openFileSmart])

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
  // Routes through openFileSmart so duo-open-in:browser is honored
  // when the agent runs `duo view ~/.claude/duo/help/faq.html` etc.
  useEffect(() => {
    return window.electron.nav.onView((p) => {
      const name = p.slice(p.lastIndexOf('/') + 1) || p
      void openFileSmart(p, name)
    })
  }, [openFileSmart])

  // Stage 11: `duo edit <path>` from the CLI. Same dispatch as view — the
  // classifier routes `.md` to the editor tab type; other types open in
  // their usual preview. duo-open-in:browser still honored.
  useEffect(() => {
    return window.electron.nav.onEdit((p) => {
      const name = p.slice(p.lastIndexOf('/') + 1) || p
      void openFileSmart(p, name)
    })
  }, [openFileSmart])

  // Stage 19c D27 — `duo new-tab` from the CLI. The renderer is the
  // authoritative tab state, so we add the tab here and reply with
  // {id, kind, cwd, title} for the socket to return. Defaults: kind →
  // persisted last-kind (D28); cwd → navigator pending CWD (D25); cmd →
  // none (kind-default spawn flow runs).
  useEffect(() => {
    return window.electron.terminal.onNewTabRequest((req) => {
      const reply = (result: NewTabResult) => window.electron.terminal.replyNewTab(result)
      try {
        const kind = req.kind ?? lastTabKind
        const cwd = req.cwd && req.cwd.length > 0 ? req.cwd : pendingCwd
        const tab = makeTab(cwd, kind, home)
        setTabs(prev => [...prev, tab])
        setActiveTabId(tab.id)
        if (req.kind !== undefined) {
          // Explicit --kind flag → also bump persisted last-kind so
          // subsequent flagless calls follow the agent's recent choice.
          setLastTabKind(kind)
          saveLastTabKind(kind)
        }
        void dispatchPostSpawnWrite(tab.id, kind, req.cmd)
        reply({ reqId: req.reqId, ok: true, id: tab.id, kind, cwd, title: tab.title })
      } catch (err) {
        reply({
          reqId: req.reqId,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })
  }, [pendingCwd, lastTabKind, home, dispatchPostSpawnWrite])

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
    // Stage 19c D18 — `⌘T` from terminal focus opens a *claude* tab
    // (the new opinionated default). The hook handles the focus-aware
    // routing — from non-terminal focus, ⌘T still goes to a new
    // browser tab (D20, today's behavior). ⌘⇧T anywhere opens a
    // vanilla shell (D19, today's behavior, now explicitly typed).
    newClaudeTab: () => {
      newTab('claude')
      setLastTabKind('claude')
      saveLastTabKind('claude')
    },
    newShellTab: () => {
      newTab('shell')
      setLastTabKind('shell')
      saveLastTabKind('shell')
    },
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
        // BUG-019 fix — the previous queueMicrotask scheduled the
        // focus call BEFORE React had finished re-rendering the
        // working pane (which holds the address bar). Two nested
        // requestAnimationFrames push us past the React commit AND
        // past the paint cycle, so the address-bar DOM node is
        // guaranteed mounted + visible when we focus().
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const addr = document.querySelector<HTMLInputElement>('[data-duo-addressbar]')
            addr?.focus()
            addr?.select()
          })
        })
      })
    },
    newMarkdownFile,
    closeTab: () => {
      if (focusedColumn === 'working') {
        // § D29 — close whichever working-pane tab is currently active.
        // Stage 24 — gate pinned tabs behind a confirm modal.
        if (activeWorking.kind === 'file') {
          const ft = fileTabs.find(f => f.id === activeWorking.id)
          if (ft && pins.some(p => p.kind === 'file' && p.ref === ft.path)) {
            setPendingClosePinned({ kind: 'file', id: ft.id, label: ft.title })
            return
          }
          closeFileTab(activeWorking.id)
        } else {
          void (async () => {
            const btabs = await window.electron.browser.getTabs()
            const active = btabs.find(t => t.isActive)
            if (!active) return
            if (active.url && pins.some(p => p.kind === 'browser' && p.ref === active.url)) {
              setPendingClosePinned({ kind: 'browser', id: active.id, label: active.title || active.url })
              return
            }
            await window.electron.browser.closeTab(active.id)
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

      {/* Stage 18 — first-launch self-install banner. Renders only
          when ~/.claude/duo/installed.json is absent or the recorded
          version is stale; auto-hides on success / dismissal. */}
      <FirstLaunchBanner />

      {/* v0.4.0 — GitHub Releases upgrade-available banner. Renders
          only when api.github.com says a newer Duo tag is published
          and the user hasn't dismissed THIS upstream version yet. */}
      <UpdateAvailableBanner />

      {/* Stage 25 (v0.4.0) — post-redirect chrome banner. Auto-
          dismisses after ~6s; only renders briefly after `duo
          external` (or another shell.openExternal call) routes a
          URL to the system browser. */}
      <ExternalRedirectedBanner />

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
            userClaudeNav={userClaudeNav}
            navPins={navPins}
            onOpenFile={onOpenFile}
            onOpenTerminalHere={openTerminalHere}
            onOpenClaudeIn={openClaudeIn}
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
              // Stage 19c D17 — split button. `+` = claude (primary,
              // opinionated); `>` = shell. Both update the persisted
              // last-kind so `duo new-tab` without --kind follows the
              // user's most recent manual selection (D28).
              onNewClaude={() => {
                newTab('claude')
                setLastTabKind('claude')
                saveLastTabKind('claude')
              }}
              onNewShell={() => {
                newTab('shell')
                setLastTabKind('shell')
                saveLastTabKind('shell')
              }}
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
              onNewFile={newMarkdownFile}
              focused={focusedColumn === 'working'}
              // Stage 15.1 — Send → Duo pill: pipe the formatted payload
              // into the active terminal's PTY. PRD G11: no Enter
              // appended — the user confirms by pressing Enter
              // themselves. Focus moves to the active terminal so the
              // user can immediately type their verb without an extra
              // click. We need both the React-side `focusedColumn`
              // flip (drives the focus-ring CSS) AND OS-level focus on
              // the xterm helper-textarea so PTY keystrokes route in —
              // mirrors togglePaneFocus's terminal branch.
              onSendToDuo={
                activeTabId
                  ? (payload) => {
                      void window.electron.pty.write(activeTabId, payload)
                      setFocusedColumn('terminal')
                      queueMicrotask(() => {
                        const textarea = document.querySelector<HTMLTextAreaElement>(
                          '.xterm-host:not([style*="display: none"]) .xterm-helper-textarea'
                        )
                        textarea?.focus()
                      })
                    }
                  : null
              }
              pins={pins}
              onTogglePin={togglePin}
              onCanvasAction={handleCanvasAction}
              homeDir={home}
            />
          </div>
        </div>
      </div>
      {pendingClosePinned && (
        <PinnedCloseConfirm
          label={pendingClosePinned.label}
          onConfirm={() => {
            const target = pendingClosePinned
            setPendingClosePinned(null)
            if (target.kind === 'file') {
              closeFileTab(target.id)
            } else {
              void window.electron.browser.closeTab(target.id)
            }
          }}
          onCancel={() => setPendingClosePinned(null)}
        />
      )}
    </div>
  )
}
