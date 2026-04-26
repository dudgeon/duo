import { app, BrowserWindow, Menu, ipcMain, nativeTheme, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { PtyManager } from './pty-manager'
import { BrowserManager } from './browser-manager'
import { CdpBridge } from './cdp-bridge'
import { SocketServer, ensureSocketDir } from './socket-server'
import { FilesService } from './files-service'
import { IPC } from '../shared/types'
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
  ThemeMode,
  ThemeStateSnapshot,
  SelectionFormat,
  SelectionFormatStateSnapshot
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

// Pending doc-write requests awaiting a renderer reply.
const docWritePending = new Map<string, (res: DocWriteResult) => void>()

// Pending doc-read requests awaiting a renderer reply.
const docReadPending = new Map<string, (res: DocReadResult) => void>()

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

// Stage 12 — Atelier "light is hero". Was 'dark'; flipped so macOS
// chrome (menu, dialogs) matches the new design baseline. The
// renderer's useTheme hook independently honours user preference for
// the in-app surfaces; this only governs Electron's native chrome.
nativeTheme.themeSource = 'light'

let mainWindow: BrowserWindow | null = null
const ptyManager = new PtyManager()
const filesService = new FilesService()
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
    (tabs: BrowserTab[]) => mainWindow?.webContents.send(IPC.BROWSER_TABS, tabs)
  )

  // Socket server starts listening; CLI connects here
  ensureSocketDir()
  socketServer = new SocketServer(cdpBridge, browserManager, filesService, {
    getState: getNavState,
    reveal: sendReveal,
    view: sendView,
    edit: sendEdit,
    getSelection: getEditorSelection,
    docWrite: dispatchDocWrite,
    docRead: dispatchDocRead,
    getTheme: getThemeState,
    setTheme: setThemeMode,
    openExternal: openExternalUrl,
    getSelectionFormat: getSelectionFormatState,
    setSelectionFormat: setSelectionFormat,
    sendToActiveTerminal: sendToActiveTerminal
  })
  socketServer.start()

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Once the renderer reports its bounds, attach CDP to the active tab
  mainWindow.webContents.once('did-finish-load', async () => {
    if (browserManager) await browserManager.attachCdp()
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptyManager.dispose()
  void filesService.dispose()
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

  // Stage 11 \u00a7 D33d \u2014 theme state push from the renderer.
  ipcMain.on(IPC.THEME_STATE_PUSH, (_event, snapshot: ThemeStateSnapshot) => {
    themeState = snapshot
  })

  // Stage 15 G19 \u2014 Send \u2192 Duo payload format push from the renderer.
  ipcMain.on(IPC.SELECTION_FORMAT_STATE_PUSH, (_event, snapshot: SelectionFormatStateSnapshot) => {
    selectionFormatState = snapshot
  })

  // Stage 15 G17 \u2014 active terminal-tab id push from the renderer.
  ipcMain.on(IPC.TERMINAL_ACTIVE_PUSH, (_event, id: string | null) => {
    activeTerminalId = id
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
    return { ok: true, opened: url }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
