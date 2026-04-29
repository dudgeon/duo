import { app, BrowserWindow, Menu, ipcMain, nativeTheme, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { promises as fsPromises } from 'fs'
import { resolveClaudeBinary } from './resolve-claude'
import { PtyManager } from './pty-manager'
import { BrowserManager } from './browser-manager'
import { CdpBridge } from './cdp-bridge'
import { SocketServer, ensureSocketDir } from './socket-server'
import { FilesService } from './files-service'
import { PinsService } from './pins-service'
import { NavPinsService } from './nav-pins-service'
import { InstallService } from './install-service'
import { UpdateChecker } from './update-checker'
import { initAutoUpdater } from './auto-updater'
import { SessionStateService } from './session-state-service'
import { ClaudePresenceProbe } from './claude-presence'
import { BrowserHistoryService } from './browser-history-service'
import { IPC } from '../shared/types'
import { htmlBoilerplate } from '../shared/html-boilerplate'
import type {
  BrowserBounds,
  BrowserState,
  BrowserTab,
  NavStateSnapshot,
  EditorSelectionSnapshot,
  DocWriteRequest,
  DocWriteResult,
  DocReadRequest,
  DocReadResult,
  HtmlOpRequest,
  HtmlOpResult,
  HtmlCommentRequest,
  HtmlCommentResult,
  HtmlCommentsListRequest,
  HtmlCommentsListResult,
  HtmlCanvasSelectionSnapshot,
  ThemeMode,
  ThemeStateSnapshot,
  SelectionFormat,
  SelectionFormatStateSnapshot,
  NewTabRequest,
  NewTabResult,
  ExternalRedirectedPush
} from '../shared/types'

// Last nav state snapshot the renderer pushed. Drives `duo nav state`.
// Starts with sensible defaults so a CLI call before the renderer has
// pushed anything returns a well-formed object.
let navState: NavStateSnapshot = {
  cwd: process.env.HOME ?? '/',
  selected: null,
  expanded: [],
  pinned: false
}

// Stage 11 \u00a7 D29a — most recent selection snapshot from the active editor.
// `null` means no editor tab is active or no doc is loaded.
let editorSelection: EditorSelectionSnapshot | null = null

// Stage 17c — most recent selection snapshot from the active HTML canvas.
// `null` means no canvas tab is active or no element is selected. Drives
// `duo selection --pane canvas`.
let canvasSelection: HtmlCanvasSelectionSnapshot | null = null

// Pending doc-write requests awaiting a renderer reply.
const docWritePending = new Map<string, (res: DocWriteResult) => void>()

// Pending doc-read requests awaiting a renderer reply.
const docReadPending = new Map<string, (res: DocReadResult) => void>()

// Stage 17b Phase C — pending `duo html *` ops awaiting a renderer reply.
const htmlOpPending = new Map<string, (res: HtmlOpResult) => void>()

// Stage 17d — pending `duo html comment` / `duo html comments` requests
// awaiting a renderer reply. Same Map-pairing pattern as htmlOpPending.
const htmlCommentPending = new Map<string, (res: HtmlCommentResult) => void>()
const htmlCommentsListPending = new Map<string, (res: HtmlCommentsListResult) => void>()

// Stage 11 \u00a7 D33d \u2014 most recent theme state pushed by the renderer.
// Drives `duo theme` reads. Renderer is the source of truth.
let themeState: ThemeStateSnapshot = { mode: 'system', effective: 'dark' }

// Stage 15 G19 — Send → Duo payload format. Renderer is the source of
// truth (persisted in localStorage); main caches the latest snapshot
// for `duo selection-format` reads. Default 'a' (quote + provenance).
let selectionFormatState: SelectionFormatStateSnapshot = { format: 'a' }

// Stage 15 G17 — most recent active terminal-tab id pushed by the
// renderer. `duo send` writes payloads into this terminal's PTY.
// `null` means no terminal tabs exist (degenerate state — `duo send`
// surfaces an error).
let activeTerminalId: string | null = null

// ENH-013 — claude-presence probe. Polls the active terminal's PTY
// process tree for a live `claude` descendant; broadcasts state
// changes so the renderer's Send → Duo pill gates correctly.
const claudePresence = new ClaudePresenceProbe()

// Stage 19c D27 — pending `duo new-tab` requests awaiting a renderer
// reply. Shape mirrors docWritePending / docReadPending.
const newTabPending = new Map<string, (res: NewTabResult) => void>()

// Stage 12 — Atelier "light is hero". Was 'dark'; flipped so macOS
// chrome (menu, dialogs) matches the new design baseline at app boot
// before the renderer has a chance to push its preference.
//
// IMPORTANT (BUG-017): Electron's `nativeTheme.themeSource` governs
// BOTH native chrome AND the renderer's `prefers-color-scheme` media
// query. The earlier comment claiming "this only governs native chrome"
// was incorrect — keeping it pinned to 'light' broke the renderer's
// `system` mode (the OS preference was never visible to matchMedia).
// The renderer now pushes its mode via `IPC.THEME_STATE_PUSH` (see
// the handler below), and main updates `nativeTheme.themeSource` to
// match. Boot default stays 'light' so the splash + first paint match
// Atelier; the push runs immediately after the renderer mounts.
nativeTheme.themeSource = 'light'

let mainWindow: BrowserWindow | null = null
const ptyManager = new PtyManager()
const filesService = new FilesService()
const pinsService = new PinsService()
const navPinsService = new NavPinsService()
// Issue #27 / Stage 21c Phase 3 — browser history for URL-bar autocomplete.
const browserHistory = new BrowserHistoryService()
const installService = new InstallService()
const updateChecker = new UpdateChecker()
// Load the cached check at boot so the renderer's first IPC call
// can return immediately even before a network refresh completes.
// `maybeRefresh()` will then fire the network call in the background
// when the renderer asks; subsequent calls return cached results.
void updateChecker.loadCache()
const sessionStateService = new SessionStateService()
let browserManager: BrowserManager | null = null
let socketServer: SocketServer | null = null

// Stage 9 — the menu's Cozy mode checkmark tracks the active tab.
// The renderer is the source of truth; main caches the last pushed value
// so the menu rebuild logic can read it synchronously.
let cozyActiveTab = false
let cozyMenuItemId: string | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    // Stage 12 — Atelier paper. Pre-CSS-load flash color matches the
     // new light hero so first-paint doesn't flash dark.
     backgroundColor: '#FBF8EE',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // required for preload to use Node.js APIs
    }
  })

  ptyManager.setWebContents(mainWindow.webContents)

  // Browser manager owns WebContentsViews and forwards state to renderer
  const cdpBridge = new CdpBridge()
  browserManager = new BrowserManager(
    mainWindow,
    cdpBridge,
    (state: BrowserState) => mainWindow?.webContents.send(IPC.BROWSER_STATE, state),
    (tabs: BrowserTab[]) => mainWindow?.webContents.send(IPC.BROWSER_TABS, tabs),
    browserHistory
  )

  // Socket server starts listening; CLI connects here
  ensureSocketDir()
  socketServer = new SocketServer(cdpBridge, browserManager, filesService, {
    getState: getNavState,
    reveal: sendReveal,
    view: sendView,
    edit: sendEdit,
    getSelection: getEditorSelection,
    getCanvasSelection: getCanvasSelection,
    docWrite: dispatchDocWrite,
    docRead: dispatchDocRead,
    getTheme: getThemeState,
    setTheme: setThemeMode,
    setSplit: setSplit,
    openExternal: openExternalUrl,
    getSelectionFormat: getSelectionFormatState,
    setSelectionFormat: setSelectionFormat,
    sendToActiveTerminal: sendToActiveTerminal,
    htmlNew: htmlNew,
    htmlOp: dispatchHtmlOp,
    htmlComment: dispatchHtmlComment,
    htmlCommentsList: dispatchHtmlCommentsList,
    newTab: dispatchNewTab,
    pushNavPinsChanged: (pins) => {
      mainWindow?.webContents.send(IPC.NAV_PINS_CHANGED, pins)
    }
  }, navPinsService)
  socketServer.start()

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ENH-013 — start the claude-presence probe + wire its broadcast to
  // the renderer. Subscribed once at first load so the pill responds
  // to state changes for the lifetime of the window. The unsubscribe
  // hook isn't kept (process tear-down is the only ender).
  claudePresence.start()
  claudePresence.onChange((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.TERMINAL_CLAUDE_PRESENCE_CHANGED, state)
    }
  })

  // Once the renderer reports its bounds, attach CDP to the active tab
  mainWindow.webContents.once('did-finish-load', async () => {
    if (browserManager) await browserManager.attachCdp()

    // Stage 21c Phase 2 — restore browser tabs from persisted session.
    // Done after did-finish-load so the renderer is mounted to receive
    // the resulting BROWSER_TABS broadcast. Best-effort; failure
    // doesn't block app startup.
    if (browserManager) {
      try {
        const persisted = await sessionStateService.load()
        if (persisted.browserTabs.length > 0) {
          await browserManager.restoreFromSession(persisted.browserTabs, persisted.activeBrowserIndex)
        }
      } catch (err) {
        console.warn('[main] browser-tab restore failed:', (err as Error)?.message ?? err)
      }
    }
  })

  // Lock the main renderer at zoom factor 1 so the WebContentsView bounds
  // we get from getBoundingClientRect (CSS pixels, zoom-affected) match
  // the window coordinate system Electron uses for setBounds. Without this,
  // Cmd+/- zooms the UI and the browser view drifts relative to its DOM
  // anchor — the "black bar on the left of the working pane" bug. Also
  // persists across relaunches so any lingering zoom from a previous run
  // gets cleared.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.setZoomFactor(1)
    mainWindow?.webContents.setVisualZoomLevelLimits(1, 1)
  })
  mainWindow.webContents.on('zoom-changed', () => {
    mainWindow?.webContents.setZoomFactor(1)
  })

  mainWindow.on('closed', () => {
    socketServer?.stop()
    browserManager?.dispose()
    mainWindow = null
    browserManager = null
    socketServer = null
  })
}

app.whenReady().then(() => {
  setupIPC()
  installAppMenu()
  createWindow()

  // Stage 21c — fire-and-forget auto-update check. No-ops in dev.
  // Uses Electron's native dialogs for v1 ("Update available — Download?"
  // and "Update downloaded — Restart to install?"); future phases can
  // replace with a banner-integrated experience.
  initAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Stage 21c — flush any pending session-state write before quit so
// the user's last state lands on disk even on force-quit / cmd-Q
// during a debounce window.
app.on('before-quit', () => {
  void sessionStateService.flush()
  // Issue #27 — flush pending history writes too.
  void browserHistory.flush()
  // ENH-013 — stop polling.
  claudePresence.stop()
})

app.on('window-all-closed', () => {
  ptyManager.dispose()
  void filesService.dispose()
  // Best-effort final flush — `before-quit` already fired but the
  // disk write may still be in flight.
  void sessionStateService.flush()
  void browserHistory.flush()
  if (process.platform !== 'darwin') app.quit()
})

function setupIPC(): void {
  // ── PTY ──────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.PTY_CREATE, (_event, { id, shell, cwd }: { id: string; shell?: string; cwd?: string }) => {
    ptyManager.create(id, shell, cwd)
  })

  ipcMain.handle(IPC.PTY_WRITE, (_event, { id, data }: { id: string; data: string }) => {
    ptyManager.write(id, data)
  })

  ipcMain.handle(IPC.PTY_RESIZE, (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    ptyManager.resize(id, cols, rows)
  })

  ipcMain.handle(IPC.PTY_KILL, (_event, { id }: { id: string }) => {
    ptyManager.kill(id)
  })

  // ── Browser ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.BROWSER_NAVIGATE, async (_event, { url }: { url: string }) => {
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    return browserManager.navigate(url)
  })

  ipcMain.on(IPC.BROWSER_BACK, () => {
    browserManager?.goBack()
  })

  ipcMain.on(IPC.BROWSER_FORWARD, () => {
    browserManager?.goForward()
  })

  ipcMain.on(IPC.BROWSER_RELOAD, () => {
    browserManager?.reload()
  })

  // Renderer reports the pixel bounds of the browser content area whenever
  // the split moves or the window resizes. We reposition the WebContentsView.
  ipcMain.on(IPC.BROWSER_BOUNDS, (_event, bounds: BrowserBounds) => {
    browserManager?.setBounds(bounds)
  })

  ipcMain.handle(IPC.BROWSER_GET_STATE, () => {
    return browserManager?.getState() ?? null
  })

  ipcMain.handle(IPC.BROWSER_GET_TABS, () => {
    return browserManager?.getTabs() ?? []
  })

  ipcMain.handle(IPC.BROWSER_ADD_TAB, async (_event, { url }: { url?: string }) => {
    if (!browserManager) return { ok: false, id: -1, url: '', title: '' }
    return browserManager.openTab(url)
  })

  ipcMain.handle(IPC.BROWSER_SWITCH_TAB, async (_event, { id }: { id: number }) => {
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    return browserManager.switchTab(id)
  })

  ipcMain.handle(IPC.BROWSER_CLOSE_TAB, async (_event, { id }: { id: number }) => {
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    return browserManager.closeTab(id)
  })

  // BUG-027 — ⌘⇧T from browser focus pops the last-closed tab.
  ipcMain.handle(IPC.BROWSER_REOPEN_LAST_CLOSED, async () => {
    if (!browserManager) return { ok: false, reason: 'no-browser-manager' }
    return browserManager.reopenLastClosed()
  })

  // Issue #27 — URL-bar autocomplete suggestions from persisted history.
  ipcMain.handle(IPC.BROWSER_HISTORY_SUGGEST, async (_event, args: { prefix: string; limit?: number }) => {
    return browserHistory.suggest(args.prefix ?? '', args.limit ?? 8)
  })

  ipcMain.on(IPC.BROWSER_FOCUS_ACTIVE, () => {
    browserManager?.focusActive()
  })

  // ── Files (Stage 10) ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.FILES_LIST, (_event, { path: p }: { path: string }) => {
    return filesService.list(p)
  })

  ipcMain.handle(IPC.FILES_READ, (_event, { path: p }: { path: string }) => {
    return filesService.read(p)
  })

  ipcMain.handle(IPC.FILES_WRITE, (_event, { path: p, bytes }: { path: string; bytes: Uint8Array }) => {
    return filesService.write(p, bytes)
  })

  ipcMain.handle(IPC.FILES_OPEN_EXTERNAL, (_event, { path: p }: { path: string }) => {
    return filesService.openExternal(p)
  })

  ipcMain.handle(IPC.FILES_REVEAL_IN_FINDER, (_event, { path: p }: { path: string }) => {
    filesService.revealInFinder(p)
  })

  ipcMain.handle(IPC.FILES_GET_HTML_META, (_event, { path: p }: { path: string }) => {
    return filesService.getHtmlMeta(p)
  })

  // Stage 26 item 6 — file-mutation actions (right-click Delete / Rename + CLI parity).
  ipcMain.handle(IPC.FILES_TRASH, (_event, { path: p }: { path: string }) => {
    return filesService.trash(p)
  })
  ipcMain.handle(IPC.FILES_RENAME, (_event, { oldPath, newPath }: { oldPath: string; newPath: string }) => {
    return filesService.rename(oldPath, newPath)
  })

  // Stage 24 — pinned WorkingPane tabs.
  ipcMain.handle(IPC.PINS_LIST, () => {
    return pinsService.list()
  })
  ipcMain.handle(IPC.PINS_TOGGLE, (_event, entry: import('../shared/types').PinEntry) => {
    return pinsService.toggle(entry)
  })

  // Stage 26 PR 2 (ENH-010) — pinned files & folders in the navigator.
  ipcMain.handle(IPC.NAV_PINS_LIST, () => {
    return navPinsService.list()
  })
  ipcMain.handle(IPC.NAV_PINS_TOGGLE, async (_event, entry: import('../shared/types').NavPinEntry) => {
    const next = await navPinsService.toggle(entry)
    // BUG-030 — push to renderer so any other subscriber (or other
    // window someday) sees the change live.
    mainWindow?.webContents.send(IPC.NAV_PINS_CHANGED, next)
    return next
  })

  // Stage 21c Phase 2 — session state restored across relaunches.
  ipcMain.handle(IPC.SESSION_STATE_LOAD, () => {
    return sessionStateService.load()
  })
  ipcMain.handle(IPC.SESSION_STATE_SAVE, (_event, state: import('../shared/types').SessionState) => {
    sessionStateService.save(state)
  })

  // Stage 18 — first-launch self-install.
  ipcMain.handle(IPC.INSTALL_STATUS, () => {
    return installService.status()
  })
  ipcMain.handle(IPC.INSTALL_RUN, () => {
    return installService.run()
  })

  // v0.4.0 — GitHub Releases update checker.
  ipcMain.handle(IPC.UPDATE_CHECK, () => {
    return updateChecker.maybeRefresh()
  })

  ipcMain.handle(IPC.FILES_WATCH_START, (event, { id, paths }: { id: string; paths: string[] }) => {
    filesService.startWatch(id, paths, event.sender, IPC.FILES_CHANGED)
  })

  ipcMain.handle(IPC.FILES_WATCH_UPDATE, (_event, { id, paths }: { id: string; paths: string[] }) => {
    return filesService.updateWatchPaths(id, paths)
  })

  ipcMain.handle(IPC.FILES_WATCH_STOP, (_event, { id }: { id: string }) => {
    return filesService.stopWatch(id)
  })

  // ── Navigator state cache (Stage 10 Phase 6) ──────────────────────────────
  // Renderer pushes its navigator state on every change; main caches the last
  // snapshot for `duo nav state` to return without a renderer round-trip.

  ipcMain.on(IPC.NAV_STATE_PUSH, (_event, snapshot: NavStateSnapshot) => {
    navState = snapshot
  })

  // Stage 11 — selection snapshot push from the active editor.
  ipcMain.on(IPC.EDITOR_SELECTION_PUSH, (_event, snapshot: EditorSelectionSnapshot | null) => {
    editorSelection = snapshot
  })

  // Stage 17c — canvas selection snapshot push from the active canvas.
  ipcMain.on(IPC.CANVAS_SELECTION_PUSH, (_event, snapshot: HtmlCanvasSelectionSnapshot | null) => {
    canvasSelection = snapshot
  })

  // Stage 11 — renderer's reply to a doc-write request.
  ipcMain.on(IPC.EDITOR_DOC_WRITE_RESULT, (_event, result: DocWriteResult) => {
    const resolver = docWritePending.get(result.reqId)
    if (resolver) {
      docWritePending.delete(result.reqId)
      resolver(result)
    }
  })

  // Renderer's reply to a doc-read request (live editor buffer).
  ipcMain.on(IPC.EDITOR_DOC_READ_RESULT, (_event, result: DocReadResult) => {
    const resolver = docReadPending.get(result.reqId)
    if (resolver) {
      docReadPending.delete(result.reqId)
      resolver(result)
    }
  })

  // Stage 17b Phase C — renderer's reply to a `duo html *` op.
  ipcMain.on(IPC.CANVAS_HTML_OP_RESULT, (_event, result: HtmlOpResult) => {
    const resolver = htmlOpPending.get(result.reqId)
    if (resolver) {
      htmlOpPending.delete(result.reqId)
      resolver(result)
    }
  })

  // Stage 17d — renderer's reply to a `duo html comment` / `duo html comments`.
  ipcMain.on(IPC.CANVAS_HTML_COMMENT_RESULT, (_event, result: HtmlCommentResult) => {
    const resolver = htmlCommentPending.get(result.reqId)
    if (resolver) {
      htmlCommentPending.delete(result.reqId)
      resolver(result)
    }
  })
  ipcMain.on(IPC.CANVAS_HTML_COMMENTS_LIST_RESULT, (_event, result: HtmlCommentsListResult) => {
    const resolver = htmlCommentsListPending.get(result.reqId)
    if (resolver) {
      htmlCommentsListPending.delete(result.reqId)
      resolver(result)
    }
  })

  // Stage 11 \u00a7 D33d \u2014 theme state push from the renderer.
  // BUG-017 fix (v0.3.1) \u2014 also sync nativeTheme.themeSource with the
  // user's mode so the renderer's `prefers-color-scheme` media query
  // reflects the user's choice. Without this, hardcoding
  // `nativeTheme.themeSource = 'light'` at boot (kept here so native
  // chrome \u2014 menus, dialogs \u2014 always look light) bleeds into the
  // renderer's matchMedia result, breaking 'system' mode (the renderer
  // would always see prefers-color-scheme=light regardless of OS).
  // Per the Electron docs, themeSource governs BOTH native chrome AND
  // the renderer's matchMedia, so we have to set it dynamically:
  //   - 'system' \u2192 follow OS (renderer's media query reflects OS)
  //   - 'light' / 'dark' \u2192 force that mode
  ipcMain.on(IPC.THEME_STATE_PUSH, (_event, snapshot: ThemeStateSnapshot) => {
    themeState = snapshot
    if (snapshot.mode === 'system' || snapshot.mode === 'light' || snapshot.mode === 'dark') {
      nativeTheme.themeSource = snapshot.mode
    }
  })

  // Stage 15 G19 \u2014 Send \u2192 Duo payload format push from the renderer.
  ipcMain.on(IPC.SELECTION_FORMAT_STATE_PUSH, (_event, snapshot: SelectionFormatStateSnapshot) => {
    selectionFormatState = snapshot
  })

  // Stage 15 G17 \u2014 active terminal-tab id push from the renderer.
  // ENH-013 \u2014 the payload also carries `kind` so the claude-presence
  // probe can arm its starting-grace window for kind=='claude' tabs.
  ipcMain.on(IPC.TERMINAL_ACTIVE_PUSH, (_event, payload: { id: string | null; kind: 'claude' | 'shell' | null }) => {
    activeTerminalId = payload.id
    const pid = payload.id ? ptyManager.getPid(payload.id) : null
    claudePresence.setTarget({ pid, kind: payload.kind })
  })

  // Stage 19c D23 \u2014 renderer asks "is `claude` on PATH?" before spawning a
  // claude tab so it can choose between auto-typing `claude\n` and the
  // install-banner fallback. Resolved synchronously per call (cheap;
  // `which` is fast) so the answer always reflects PATH at the moment of
  // the spawn \u2014 covers the case where the user `brew install`s claude
  // mid-session and then opens a tab.
  ipcMain.handle('terminal:claude-on-path', () => isClaudeOnPath())

  // Stage 19c D27 \u2014 renderer reply to a `duo new-tab` request.
  ipcMain.on(IPC.NEW_TAB_RESULT, (_event, result: NewTabResult) => {
    const resolver = newTabPending.get(result.reqId)
    if (resolver) {
      newTabPending.delete(result.reqId)
      resolver(result)
    }
  })

  // ── Cozy mode (Stage 9) ────────────────────────────────────────────────────
  // Renderer pushes the active tab's cozy state so the View-menu checkmark
  // stays in sync as the user switches tabs or toggles.

  ipcMain.on(IPC.COZY_STATE_PUSH, (_event, cozy: boolean) => {
    cozyActiveTab = cozy
    const menu = Menu.getApplicationMenu()
    if (!menu || !cozyMenuItemId) return
    const item = menu.getMenuItemById(cozyMenuItemId)
    if (item) item.checked = cozy
  })
}

// ── App menu ────────────────────────────────────────────────────────────────
// Minimal menu template — only the View submenu carries product-specific
// items today (cozy toggle). Everything else follows Electron defaults so
// macOS shortcuts like Cmd+Q / Cmd+H / Cmd+M still work.

function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  cozyMenuItemId = 'cozy-toggle'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        // ENH-002 / v0.4.0 — "Paste and Match Style" with macOS-
        // standard ⌘⇧V. Both editors (markdown + HTML canvas)
        // already handle ⌘⇧V via their own keydown handlers; this
        // adds the menu surface for discoverability. Click sends a
        // `paste-plain` IPC to the active editor, which performs
        // the same plain-text insert.
        {
          label: 'Paste and Match Style',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => {
            mainWindow?.webContents.send(IPC.PASTE_PLAIN_REQUEST)
          }
        },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          id: cozyMenuItemId,
          label: 'Cozy mode — current tab',
          type: 'checkbox',
          checked: cozyActiveTab,
          click: () => {
            // Renderer flips authoritative state, then echoes back via
            // COZY_STATE_PUSH so the checkmark tracks the truth.
            mainWindow?.webContents.send(IPC.COZY_TOGGLE)
          }
        },
        {
          // Menu accelerator, not just a keyboard shortcut: macOS
          // intercepts ⌘` at the system level (its built-in "cycle
          // windows of the same app"). Registering it here routes the
          // key through Electron's menu system first, so the system
          // shortcut never sees it.
          //
          // BUG-004 fix: pull OS-level keyboard focus back to the main
          // renderer BEFORE asking it to cycle. If the user pressed ⌘`
          // while the browser WebContentsView had focus, the renderer
          // didn't own focus — so a renderer-side `xterm.focus()` would
          // be a no-op (you can't give focus you don't have). Calling
          // `mainWindow.webContents.focus()` first reclaims focus from
          // the WebContentsView; the renderer's togglePaneFocus then
          // hands it on to xterm or the editor as appropriate. (For the
          // working→browser direction the renderer immediately calls
          // `browser.focusActive()` which re-focuses the WebContentsView
          // — that path is unaffected.)
          label: 'Toggle pane focus',
          accelerator: 'CmdOrCtrl+`',
          click: () => {
            mainWindow?.webContents.focus()
            mainWindow?.webContents.send(IPC.PANE_TOGGLE_FOCUS)
          }
        },
        { type: 'separator' },
        // ENH-014 — preset pane sizes. Accelerators use ⌘⌥<digit>
        // because ⌘<digit> is already taken by jumpTerminalTab.
        // Range matches the divider drag clamp (20–80).
        {
          label: 'Pane size',
          submenu: [
            {
              label: 'Even (50/50)',
              accelerator: 'CmdOrCtrl+Alt+2',
              click: () => setSplit(50)
            },
            {
              label: 'Terminal heavy (67/33)',
              accelerator: 'CmdOrCtrl+Alt+1',
              click: () => setSplit(67)
            },
            {
              label: 'Canvas heavy (33/67)',
              accelerator: 'CmdOrCtrl+Alt+3',
              click: () => setSplit(33)
            },
            { type: 'separator' },
            {
              label: 'Full terminal',
              accelerator: 'CmdOrCtrl+Alt+0',
              click: () => setSplit(80)
            },
            {
              label: 'Full canvas',
              accelerator: 'CmdOrCtrl+Alt+9',
              click: () => setSplit(20)
            }
          ]
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// Helpers exposed to SocketServer via `NavBridge` (passed below).

export function getNavState(): NavStateSnapshot {
  return navState
}

export function sendReveal(path: string): { ok: boolean; error?: string } {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.NAV_REVEAL, path)
  return { ok: true }
}

export function sendView(path: string): { ok: boolean; error?: string } {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.NAV_VIEW, path)
  return { ok: true }
}

export function sendEdit(path: string): { ok: boolean; error?: string } {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.NAV_EDIT, path)
  return { ok: true }
}

export function getEditorSelection(): EditorSelectionSnapshot | null {
  return editorSelection
}

// Stage 17c — drives `duo selection --pane canvas` and the auto-select
// path's html-canvas branch.
export function getCanvasSelection(): HtmlCanvasSelectionSnapshot | null {
  return canvasSelection
}

/**
 * Stage 11 \u2014 dispatch a doc-write request to the renderer's active editor
 * and wait for the reply. Times out at 5s to avoid CLI hangs if the
 * renderer is busy.
 */
export function getThemeState(): ThemeStateSnapshot {
  return themeState
}

export function setThemeMode(mode: ThemeMode): { ok: boolean; error?: string } {
  if (mode !== 'system' && mode !== 'light' && mode !== 'dark') {
    return { ok: false, error: `Invalid theme mode: ${mode}. Expected system|light|dark.` }
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.THEME_SET, mode)
  return { ok: true }
}

// ENH-014 — `duo split <pct>` and View → Pane size menu items both
// land here. Renderer clamps to the divider drag's 20–80 range; the
// validator below mirrors that so an invalid CLI value errors at the
// socket boundary instead of a silent clamp.
export function setSplit(pct: number): { ok: boolean; pct?: number; error?: string } {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) {
    return { ok: false, error: 'split pct must be a finite number' }
  }
  const clamped = Math.min(Math.max(pct, 20), 80)
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.SPLIT_SET, clamped)
  return { ok: true, pct: clamped }
}

// Stage 15 G19 — `duo selection-format` reads the cache; `duo
// selection-format <a|b|c>` dispatches a SET to the renderer, which
// persists to localStorage and pushes the new state back.
export function getSelectionFormatState(): SelectionFormatStateSnapshot {
  return selectionFormatState
}

export function setSelectionFormat(format: SelectionFormat): { ok: boolean; error?: string } {
  if (format !== 'a' && format !== 'b' && format !== 'c') {
    return { ok: false, error: `Invalid selection-format: ${format}. Expected a|b|c.` }
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.SELECTION_FORMAT_SET, format)
  return { ok: true }
}

// Stage 13b — doc-write timeout has to accommodate the human-in-the-loop
// case: when the buffer is dirty, the renderer surfaces a
// <WriteWarningBanner> and waits for the human to accept or decline. The
// agent's CLI is blocked on this promise the whole time, so the timeout
// has to be long enough to cover real reading + decision time. 5 minutes
// is conservative — enough for a thoughtful read, short enough that a
// genuinely abandoned write doesn't pin the agent forever. doc-read
// stays on the original 5s budget (no human gate).
const DOC_WRITE_TIMEOUT_MS = 5 * 60 * 1000

export function dispatchDocWrite(req: Omit<DocWriteRequest, 'reqId'>): Promise<DocWriteResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `dw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<DocWriteResult>((resolve) => {
    const timer = setTimeout(() => {
      docWritePending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${DOC_WRITE_TIMEOUT_MS / 1000}s` })
    }, DOC_WRITE_TIMEOUT_MS)
    docWritePending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.EDITOR_DOC_WRITE, { ...req, reqId })
  })
}

export function dispatchDocRead(req: Omit<DocReadRequest, 'reqId'>): Promise<DocReadResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `dr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<DocReadResult>((resolve) => {
    const timer = setTimeout(() => {
      docReadPending.delete(reqId)
      resolve({ reqId, ok: false, error: 'Renderer did not reply within 5s' })
    }, 5000)
    docReadPending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.EDITOR_DOC_READ, { ...req, reqId })
  })
}

// Stage 17b Phase C — dispatch a `duo html *` op to the active canvas
// tab and await its reply. 30s timeout: ample for any single DOM op
// (queries are sub-ms; writes are milliseconds at worst). If no canvas
// is active, the renderer's CanvasTab subscription doesn't fire and
// the timeout returns the error.
const HTML_OP_TIMEOUT_MS = 30_000

export function dispatchHtmlOp(req: Omit<HtmlOpRequest, 'reqId'>): Promise<HtmlOpResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `ho_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<HtmlOpResult>((resolve) => {
    const timer = setTimeout(() => {
      htmlOpPending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${HTML_OP_TIMEOUT_MS / 1000}s (no active canvas?)` })
    }, HTML_OP_TIMEOUT_MS)
    htmlOpPending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.CANVAS_HTML_OP, { ...req, reqId })
  })
}

// Stage 17d — `duo html comment` / `duo html comments`. Same 30s timeout
// as html-op (DOM ops are fast; the timeout window only matters when no
// canvas is active to subscribe).
export function dispatchHtmlComment(req: Omit<HtmlCommentRequest, 'reqId'>): Promise<HtmlCommentResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `hc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<HtmlCommentResult>((resolve) => {
    const timer = setTimeout(() => {
      htmlCommentPending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${HTML_OP_TIMEOUT_MS / 1000}s (no active canvas?)` })
    }, HTML_OP_TIMEOUT_MS)
    htmlCommentPending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.CANVAS_HTML_COMMENT, { ...req, reqId })
  })
}

export function dispatchHtmlCommentsList(req: Omit<HtmlCommentsListRequest, 'reqId'>): Promise<HtmlCommentsListResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `hcl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<HtmlCommentsListResult>((resolve) => {
    const timer = setTimeout(() => {
      htmlCommentsListPending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${HTML_OP_TIMEOUT_MS / 1000}s (no active canvas?)` })
    }, HTML_OP_TIMEOUT_MS)
    htmlCommentsListPending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.CANVAS_HTML_COMMENTS_LIST, { ...req, reqId })
  })
}

// Stage 5 v2 A24 — open a URL in the system default browser. The duo
// subagent reaches for this when a target hostname is on the user's
// `~/.claude/duo/external-domains.json` list (sites that don't render
// well in the embedded WebContentsView, or that the user wants to
// keep cookied in their personal browser). We validate the URL parses
// and only honour http/https/mailto schemes — refusing file:// and
// other dangerous schemes that `shell.openExternal` would happily
// route into native handlers.
// Stage 15 G17 — `duo send <text>` writes a payload into the active
// terminal's PTY. No Enter is appended (G11) — the user (or a chained
// agent verb) confirms by hitting Enter themselves. If no terminal is
// active (no tabs, or the last tab was just killed), surface an error
// rather than silently dropping the write.
export function sendToActiveTerminal(text: string): { ok: boolean; written?: number; terminalId?: string; error?: string } {
  if (typeof text !== 'string') {
    return { ok: false, error: 'send requires a string text payload' }
  }
  if (activeTerminalId === null) {
    return { ok: false, error: 'No active terminal — open one and try again' }
  }
  try {
    ptyManager.write(activeTerminalId, text)
    return { ok: true, written: text.length, terminalId: activeTerminalId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Stage 17a — `duo html new <path>`. Writes the H17 boilerplate atomically
// via FilesService, then dispatches NAV_EDIT to the renderer; the
// renderer's classifier routes `.html` to the html-canvas tab type. Title
// defaults to the file's basename without extension. Path validation
// (must end in .html / .htm) happens in socket-server.
export async function htmlNew(absPath: string, title?: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  try {
    const base = absPath.slice(absPath.lastIndexOf('/') + 1).replace(/\.html?$/i, '')
    const docTitle = title ?? base ?? 'Untitled'
    const html = htmlBoilerplate(docTitle)
    const bytes = new TextEncoder().encode(html)
    await filesService.write(absPath, bytes)
    mainWindow.webContents.send(IPC.NAV_EDIT, absPath)
    return { ok: true, path: absPath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Stage 19c D23 — does the user's shell know where `claude` is? The
// renderer uses this answer to decide between auto-typing `claude\n`
// and printing the install banner.
//
// v0.4.5: re-implemented on top of resolveClaudeBinary() (which asks
// the user's actual shell — interactive + login — so .zshrc PATH
// additions are picked up). v0.4.4 used a bare `which claude` against
// Electron's inherited PATH, which on Finder-launched apps only
// contains the macOS-default /usr/bin:/bin:/usr/sbin:/sbin and never
// the user's ~/.local/bin where the official Claude Code installer
// drops the binary. Result: every Finder-launched Duo terminal tab
// printed the "Install Claude Code" banner even when claude WAS
// installed.
async function isClaudeOnPath(): Promise<boolean> {
  return (await resolveClaudeBinary()) !== null
}

// Stage 19c D27 — dispatch a `duo new-tab` request to the renderer and
// wait for the reply. Mirrors dispatchDocWrite / dispatchDocRead.
// Renderer owns tab state, so it's the source of truth for the new tab's
// id/cwd/title; main just brokers the request and resolves on its reply.
const NEW_TAB_TIMEOUT_MS = 5000

export function dispatchNewTab(
  req: Omit<NewTabRequest, 'reqId'>
): Promise<NewTabResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `nt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<NewTabResult>((resolve) => {
    const timer = setTimeout(() => {
      newTabPending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${NEW_TAB_TIMEOUT_MS / 1000}s` })
    }, NEW_TAB_TIMEOUT_MS)
    newTabPending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.NEW_TAB_REQUEST, { ...req, reqId })
  })
}

export async function openExternalUrl(url: string): Promise<{ ok: boolean; opened?: string; error?: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: `Not a valid URL: ${url}` }
  }
  const scheme = parsed.protocol.toLowerCase()
  if (scheme !== 'http:' && scheme !== 'https:' && scheme !== 'mailto:') {
    return { ok: false, error: `Refusing to open scheme "${scheme}" externally — only http/https/mailto allowed` }
  }
  try {
    await shell.openExternal(url)
    // Stage 25 — push a post-redirect event so the renderer can
    // surface a small "Sent <host> to your default browser" banner.
    // The renderer auto-dismisses after a few seconds; the user
    // doesn't have to interact with it.
    if (mainWindow && !mainWindow.isDestroyed() && (scheme === 'http:' || scheme === 'https:')) {
      const host = parsed.hostname
      const reason = await lookupExternalDomainReason(host)
      const push: ExternalRedirectedPush = { host, reason: reason || undefined }
      mainWindow.webContents.send(IPC.EXTERNAL_REDIRECTED, push)
    }
    return { ok: true, opened: url }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Stage 25 — look up a per-domain `reason` string in
 * `~/.claude/duo/external-domains.json`'s extended schema. The
 * historical schema is `{ domains: ["host.com", "*.suffix.com"] }`;
 * the extended schema (backward-compatible) also accepts entries
 * shaped like `{ host: "host.com", reason: "internal SSO" }`. We
 * match exact hostname or `*.suffix` glob; first match wins. Returns
 * empty string when no entry has a reason or no entry matches.
 */
async function lookupExternalDomainReason(host: string): Promise<string> {
  const PATH_TO_FILE = `${process.env.HOME ?? ''}/.claude/duo/external-domains.json`
  try {
    const raw = await fsPromises.readFile(PATH_TO_FILE, 'utf8')
    const parsed = JSON.parse(raw) as { domains?: Array<string | { host: string; reason?: string }> }
    if (!Array.isArray(parsed.domains)) return ''
    for (const entry of parsed.domains) {
      const ent = typeof entry === 'string' ? { host: entry, reason: undefined } : entry
      if (typeof ent.host !== 'string') continue
      if (matchesDomain(host, ent.host)) {
        return typeof ent.reason === 'string' ? ent.reason : ''
      }
    }
    return ''
  } catch {
    return ''
  }
}

function matchesDomain(host: string, pattern: string): boolean {
  if (pattern === host) return true
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2) // drop leading '*.'
    if (host === suffix) return true
    if (host.endsWith(`.${suffix}`)) return true
  }
  return false
}
